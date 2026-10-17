import type {
  InventoryMovement,
  InventoryReservation,
  Order,
  OrderItem,
  Payment,
  PickingOrder,
  Sale,
  SaleItem,
} from "@/core/entities";
import {
  CashMovementType,
  CashShiftStatus,
  DeliveryMethod,
  InventoryMovementType,
  InventoryReservationStatus,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductType,
  SaleStatus,
} from "@/core/enums";
import { planInventoryAllocation } from "@/core/inventory/stockAvailability";
import { expandKitDemand } from "@/core/kits/kitDemand";
import { assertOrderDeliveryMethodAllowed } from "@/core/orders/orderDeliveryPolicy";
import { isBranchScopedResourceAvailable } from "@/core/scopes/branchScope";
import type {
  ConfirmSaleInput,
  ConfirmSaleResult,
  SaleConfirmationRepository,
} from "@/core/repositories";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import { validatePhoneNumber } from "@/config/contact-policy";
import { normalizeEmail, validateEmail } from "@/config/email-policy";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import type { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { registerCashMovementInTransaction } from "@/infrastructure/mock/repositories/cashMovementMutations";
import {
  findInventoryReservationBalance,
  getInventoryReservationAllocationRemaining,
} from "@/infrastructure/mock/repositories/inventoryReservationMutations";
import { scheduleDeferredFulfillmentInTransaction } from "@/infrastructure/mock/repositories/orderFulfillmentMutations";
import {
  consumePlannedStockLots,
  getLotAwareBalances,
  planStockLotConsumption,
  type StockLotAllocation,
} from "@/infrastructure/mock/repositories/stockLotMutations";
import {
  consumePlannedSerials,
  getLotSerialAwareBalances,
  getSerialAwareBalances,
  planLotSerialConsumption,
  planSerialConsumption,
} from "@/infrastructure/mock/repositories/serialNumberMutations";

export interface MockSaleConfirmationRepositoryTestHooks {
  afterDeferredPickingCreated?: () => void;
}

interface DeferredFulfillmentResult {
  order: Order;
  pickingOrder: PickingOrder;
  reservationChanges: Array<{ reservation: InventoryReservation; changed: boolean }>;
}

interface SaleConfirmationMutationResult extends ConfirmSaleResult {
  reservationChanges: DeferredFulfillmentResult["reservationChanges"];
  deferredFulfillmentCreated: boolean;
}

export class MockSaleConfirmationRepository
  extends BaseMockRepository
  implements SaleConfirmationRepository
{
  constructor(
    store: MockDatabaseStore,
    eventBus: DataEventBus,
    private readonly testHooks: MockSaleConfirmationRepositoryTestHooks = {},
  ) {
    super(store, eventBus);
  }

  async confirm(input: ConfirmSaleInput): Promise<ConfirmSaleResult> {
    this.assertBasicInput(input);

    const fingerprint = getConfirmationFingerprint(input);
    const existing = this.findExistingConfirmation(
      input.tenantId,
      input.confirmationId,
      fingerprint,
    );
    if (existing) return existing;

    const result = this.store.transact<SaleConfirmationMutationResult>((db) => {
      this.assertReferences(input, db);
      this.assertPaymentMethods(input, db);
      this.assertPayments(input, db);

      const now = this.now();
      const saleId = this.id("sale");
      const saleNumber = nextSaleNumber(db.sales, input.tenantId);

      const deferredFulfillment = input.deferredOrder
        ? this.createDeferredFulfillment(input, saleNumber, now, db)
        : undefined;

      const sourceOrderId = input.sourceOrderId ?? deferredFulfillment?.order.id;
      const effectiveInput = sourceOrderId ? { ...input, sourceOrderId } : input;

      const sourceOrderOwnsInventory = this.assertSourceOrderOwnership(
        effectiveInput,
        db,
      );

      const saleItems: SaleItem[] = input.items.map((inputItem) => {
        const { inventoryQuantity, ...item } = inputItem;
        void inventoryQuantity;

        return {
          ...item,
          id: this.id("sale-item"),
          saleId,
        };
      });

      const sale: Sale = {
        id: saleId,
        tenantId: input.tenantId,
        branchId: input.branchId,
        customerId: input.customerId,
        sourceOrderId,
        confirmationId: input.confirmationId,
        confirmationFingerprint: fingerprint,
        cashShiftId: input.cashShiftId,
        items: saleItems,
        number: saleNumber,
        status: SaleStatus.completed,
        document: input.document,
        subtotal: input.subtotal,
        discountTotal: input.discountTotal,
        taxTotal: input.taxTotal,
        total: input.total,
        createdByUserId: input.cashierUserId,
        createdAt: now,
        updatedAt: now,
      };

      const plannedInventoryMovements = sourceOrderOwnsInventory
        ? []
        : this.planInventoryMovements(input, sale, saleItems, db);
      const payments = input.payments.map<Payment>((paymentInput) => ({
        id: this.id("payments"),
        tenantId: input.tenantId,
        saleId,
        orderId: sourceOrderId,
        method: paymentInput.method,
        status: paymentInput.status ?? PaymentStatus.approved,
        amount: paymentInput.amount,
        currency: paymentInput.currency,
        bankAccountId: paymentInput.bankAccountId,
        reference: paymentInput.reference,
        manualVerification: paymentInput.manualVerification
          ? {
              ...paymentInput.manualVerification,
              verifiedAt: now,
            }
          : undefined,
        createdAt: now,
      }));
      const cashTotal = payments
        .filter((payment) => payment.method === PaymentMethod.cash)
        .reduce((sum, payment) => sum + payment.amount, 0);
      const inventoryMovements = this.applyInventoryMovements(
        plannedInventoryMovements,
        input,
        sale,
        now,
        db,
      );
      db.sales.push(sale);
      db.saleItems.push(...saleItems);
      db.payments.push(...payments);
      const cashMovement =
        cashTotal > 0
          ? registerCashMovementInTransaction(
              db,
              {
                tenantId: input.tenantId,
                cashShiftId: input.cashShiftId,
                type: CashMovementType.in,
                amount: cashTotal,
                reason: `Venta ${sale.number}`,
                referenceType: "sale",
                referenceId: sale.id,
                createdByUserId: input.cashierUserId,
              },
              { createId: (prefix) => this.id(prefix), now: () => now },
            ).movement
          : undefined;

      return {
        sale,
        payments,
        inventoryMovements,
        cashMovement,
        order: deferredFulfillment?.order,
        pickingOrder: deferredFulfillment?.pickingOrder,
        idempotent: false,
        reservationChanges: deferredFulfillment?.reservationChanges ?? [],
        deferredFulfillmentCreated: Boolean(deferredFulfillment),
      };
    });

    this.emitAfterCommit(result);
    return result;
  }

  private findExistingConfirmation(
    tenantId: string,
    confirmationId: string,
    fingerprint: string,
  ): ConfirmSaleResult | null {
    return this.read((db) => {
      const sale = db.sales.find(
        (item) => item.tenantId === tenantId && item.confirmationId === confirmationId,
      );
      if (!sale) return null;
      if (sale.confirmationFingerprint !== fingerprint) {
        throw new Error(`La confirmacion ${confirmationId} ya fue usada con un payload distinto.`);
      }
      const payments = db.payments.filter((payment) => payment.saleId === sale.id);
      const inventoryMovements = db.inventoryMovements.filter(
        (movement) => movement.referenceType === "sale" && movement.referenceId === sale.id,
      );
      const cashMovement = db.cashMovements.find(
        (movement) => movement.referenceType === "sale" && movement.referenceId === sale.id,
      );
      const order = sale.sourceOrderId
        ? db.orders.find(
            (item) =>
              item.id === sale.sourceOrderId &&
              item.tenantId === sale.tenantId &&
              item.branchId === sale.branchId,
          )
        : undefined;
      const pickingOrder = order
        ? db.pickingOrders.find(
            (item) =>
              item.orderId === order.id &&
              item.tenantId === order.tenantId &&
              item.branchId === order.branchId,
          )
        : undefined;
      if (payments.length === 0) {
        throw new Error(`La confirmacion ${confirmationId} existe en estado incompleto.`);
      }
      if (sale.sourceOrderId && !order) {
        throw new Error(`La confirmacion ${confirmationId} no conserva su Order relacionada.`);
      }
      if (
        order?.source === OrderSource.pos &&
        order.orderNumber === sale.number &&
        order.deliveryMethod !== DeliveryMethod.immediate &&
        !pickingOrder
      ) {
        throw new Error(`La confirmacion ${confirmationId} no conserva su Picking relacionado.`);
      }
      return {
        sale,
        payments,
        inventoryMovements,
        cashMovement,
        order,
        pickingOrder,
        idempotent: true,
      };
    });
  }

  private createDeferredFulfillment(
    input: ConfirmSaleInput,
    saleNumber: string,
    now: string,
    db: MockDatabase,
  ): DeferredFulfillmentResult {
    const deferredOrder = input.deferredOrder;
    if (!deferredOrder) throw new Error("Deferred Order input is required.");
    const idempotencyKey = deferredOrder.idempotencyKey.trim();
    if (
      db.orders.some(
        (order) => order.tenantId === input.tenantId && order.idempotencyKey === idempotencyKey,
      )
    ) {
      throw new Error(`Order idempotency conflict: ${idempotencyKey}`);
    }
    if (
      db.orders.some(
        (order) => order.tenantId === input.tenantId && order.orderNumber === saleNumber,
      )
    ) {
      throw new Error(`Order number already exists: ${saleNumber}`);
    }

    const trackingToken = `pos-${idempotencyKey}`;
    if (
      db.orders.some(
        (order) => order.tenantId === input.tenantId && order.trackingToken === trackingToken,
      )
    ) {
      throw new Error(`Order tracking token already exists: ${trackingToken}`);
    }

    const orderId = this.id("order");
    const orderItems: OrderItem[] = input.items.map((item) => {
      const product = db.products.find(
        (entry) => entry.id === item.productId && entry.tenantId === input.tenantId,
      );
      if (!product) throw new Error(`Product not found for tenant: ${item.productId}`);
      const fulfillmentComponents =
        product.productType === ProductType.physical && product.tracking.stock
          ? [{
              productId: item.productId,
              quantity: item.inventoryQuantity ?? item.quantity,
            }]
          : product.productType === ProductType.kit
            ? expandKitDemand(
                db.productKitComponents.filter(
                  (component) =>
                    component.tenantId === input.tenantId &&
                    component.kitProductId === item.productId,
                ),
                item.inventoryQuantity ?? item.quantity,
              )
            : undefined;
      return {
        ...item,
        id: this.id("order-item"),
        orderId,
        fulfillmentComponents,
      };
    });
    const deliveryAddress = deferredOrder.deliveryAddress
      ? {
          ...deferredOrder.deliveryAddress,
          recipientName: deferredOrder.deliveryAddress.recipientName.trim(),
          recipientPhone: deferredOrder.deliveryAddress.recipientPhone?.trim(),
          line1: deferredOrder.deliveryAddress.line1.trim(),
          line2: deferredOrder.deliveryAddress.line2?.trim() || undefined,
          city: deferredOrder.deliveryAddress.city.trim(),
          stateOrDepartment: deferredOrder.deliveryAddress.stateOrDepartment?.trim() || undefined,
          postalCode: deferredOrder.deliveryAddress.postalCode?.trim() || undefined,
          country: deferredOrder.deliveryAddress.country.trim(),
          references: deferredOrder.deliveryAddress.references?.trim() || undefined,
        }
      : undefined;
    const notificationContact =
      deferredOrder.notificationContact?.emailMode === "send"
        ? {
            emailMode: "send" as const,
            email: normalizeEmail(deferredOrder.notificationContact.email),
          }
        : deferredOrder.notificationContact;
    const storePickupContact = deferredOrder.storePickupContact
      ? {
          recipientName: deferredOrder.storePickupContact.recipientName.trim(),
          recipientPhone: deferredOrder.storePickupContact.recipientPhone.trim(),
        }
      : undefined;
    const order: Order = {
      id: orderId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      orderNumber: saleNumber,
      source: OrderSource.pos,
      customerId: input.customerId,
      items: orderItems,
      status: OrderStatus.confirmed,
      deliveryMethod: deferredOrder.deliveryMethod,
      transportMode: deferredOrder.transportMode,
      deliveryAddress,
      storePickupContact,
      notificationContact,
      subtotal: input.subtotal,
      discountTotal: input.discountTotal,
      shippingTotal: 0,
      total: input.total,
      trackingToken,
      idempotencyKey,
      idempotencyFingerprint: getDeferredOrderFingerprint(input, saleNumber),
      createdAt: now,
      updatedAt: now,
    };
    db.orders.push(order);
    const fulfillment = scheduleDeferredFulfillmentInTransaction(order, db, {
      id: (prefix) => this.id(prefix),
      now: () => now,
    });
    if (!fulfillment.pickingOrder) {
      throw new Error(`Deferred Order has no physical fulfillment: ${order.id}`);
    }
    if (!fulfillment.pickingCreated) {
      throw new Error(`PickingOrder already exists for new Order: ${order.id}`);
    }
    this.testHooks.afterDeferredPickingCreated?.();
    return {
      order,
      pickingOrder: fulfillment.pickingOrder,
      reservationChanges: fulfillment.reservationChanges,
    };
  }

  private assertBasicInput(input: ConfirmSaleInput): void {
    if (!input.confirmationId.trim()) throw new Error("confirmationId es requerido.");
    if (!input.tenantId) throw new Error("tenantId es requerido.");
    if (!input.branchId) throw new Error("branchId es requerido.");
    if (!input.cashierUserId) throw new Error("cashierUserId es requerido.");
    if (!input.cashShiftId) throw new Error("cashShiftId es requerido.");
    if (input.items.length === 0) throw new Error("La venta debe tener al menos un item.");
    if (input.payments.length === 0) throw new Error("La venta debe tener al menos un pago.");
    if (input.sourceOrderId && input.deferredOrder) {
      throw new Error("La venta no puede recibir sourceOrderId y deferredOrder simultaneamente.");
    }
    if (input.deferredOrder) {
      if (!input.deferredOrder.idempotencyKey.trim()) {
        throw new Error("Deferred Order idempotencyKey es requerido.");
      }
      assertOrderDeliveryMethodAllowed(OrderSource.pos, input.deferredOrder.deliveryMethod);
      if (input.deferredOrder.deliveryMethod === DeliveryMethod.immediate) {
        throw new Error("Immediate POS delivery must not create an Order.");
      }
      this.assertDeferredContact(input.deferredOrder);
    }
    input.items.forEach((item) => {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error(`Cantidad invalida para ${item.productId}.`);
      }
    });
    input.payments.forEach((payment) => {
      if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
        throw new Error("Cada pago debe tener amount mayor a cero.");
      }
    });
  }

  private assertDeferredContact(input: NonNullable<ConfirmSaleInput["deferredOrder"]>): void {
    if (input.deliveryMethod === DeliveryMethod.home_delivery) {
      const address = input.deliveryAddress;
      if (
        !address?.recipientName.trim() ||
        !address.recipientPhone?.trim() ||
        !address.line1.trim() ||
        !address.city.trim() ||
        !address.country.trim()
      ) {
        throw new Error("Home delivery requires a complete delivery address.");
      }
      const phoneError = validatePhoneNumber(address.recipientPhone);
      if (phoneError) throw new Error(phoneError);
    } else if (input.deliveryAddress !== undefined) {
      throw new Error("Only home delivery can persist a delivery address.");
    }
    if (input.deliveryMethod === DeliveryMethod.store_pickup) {
      const contact = input.storePickupContact;
      if (!contact?.recipientName?.trim()) {
        throw new Error("Store pickup recipientName is required.");
      }
      if (!contact.recipientPhone?.trim()) {
        throw new Error("Store pickup recipientPhone is required.");
      }
      const phoneError = validatePhoneNumber(contact.recipientPhone);
      if (phoneError) throw new Error(phoneError);
    } else if (input.storePickupContact !== undefined) {
      throw new Error("Only store pickup can persist storePickupContact.");
    }
    if (input.notificationContact?.emailMode === "send") {
      const emailError = validateEmail(input.notificationContact.email);
      if (emailError) throw new Error(emailError);
    } else if (
      input.notificationContact?.emailMode === "not_applicable" &&
      "email" in input.notificationContact &&
      input.notificationContact.email !== undefined
    ) {
      throw new Error("Order notificationContact not_applicable cannot include email");
    }
  }

  private assertReferences(input: ConfirmSaleInput, db: MockDatabase): void {
    const branch = db.branches.find((item) => item.id === input.branchId);
    if (!branch || branch.tenantId !== input.tenantId) {
      throw new Error(`Branch not found for tenant: ${input.branchId}`);
    }
    const user = db.users.find((item) => item.id === input.cashierUserId);
    if (!user || user.tenantId !== input.tenantId) {
      throw new Error(`User not found for tenant: ${input.cashierUserId}`);
    }
    const shift = db.cashShifts.find((item) => item.id === input.cashShiftId);
    if (
      !shift ||
      shift.tenantId !== input.tenantId ||
      shift.branchId !== input.branchId ||
      shift.userId !== input.cashierUserId ||
      shift.status !== CashShiftStatus.open
    ) {
      throw new Error("No existe un turno abierto para usuario y sucursal.");
    }
    if (input.customerId) {
      const customer = db.customers.find((item) => item.id === input.customerId);
      if (!customer || customer.tenantId !== input.tenantId) {
        throw new Error(`Customer not found for tenant: ${input.customerId}`);
      }
    }
  }

  private assertSourceOrderOwnership(input: ConfirmSaleInput, db: MockDatabase): boolean {
    if (!input.sourceOrderId) return false;

    const order = db.orders.find(
      (item) => item.id === input.sourceOrderId && item.tenantId === input.tenantId,
    );
    if (!order || order.branchId !== input.branchId) {
      throw new Error(`Order not found for tenant/branch: ${input.sourceOrderId}`);
    }
    if (
      db.sales.some(
        (sale) => sale.tenantId === input.tenantId && sale.sourceOrderId === input.sourceOrderId,
      )
    ) {
      throw new Error(`Order already has a confirmed Sale: ${order.id}`);
    }
    if (order.status === OrderStatus.cancelled) {
      throw new Error(`Cancelled Order cannot be linked to Sale: ${order.id}`);
    }

    assertSaleMatchesOrder(input.items, order.items, order.id);

    const orderItemIds = new Set<string>();
    const ownedRemainingByBalance = new Map<string, number>();
    order.items.forEach((orderItem) => {
      if (orderItemIds.has(orderItem.id)) {
        throw new Error(`Duplicate OrderItem id: ${orderItem.id}`);
      }
      orderItemIds.add(orderItem.id);
      const product = db.products.find(
        (item) => item.id === orderItem.productId && item.tenantId === input.tenantId,
      );
      if (!product) {
        throw new Error(`Product not found for OrderItem: ${orderItem.id}`);
      }
      if (product.productType === ProductType.kit) {
        const demands = orderItem.fulfillmentComponents;
        if (!demands?.length) throw new Error(`Kit fulfillment snapshot missing: ${orderItem.id}`);
        demands.forEach((demand) => {
          const reservation = db.inventoryReservations.find(
            (item) =>
              item.tenantId === input.tenantId &&
              item.orderItemId === orderItem.id &&
              item.productId === demand.productId,
          );
          if (
            !reservation ||
            reservation.branchId !== input.branchId ||
            reservation.orderId !== order.id
          ) {
            throw new Error(`Kit component reservation missing: ${orderItem.id}`);
          }
          if (
            reservation.status !== InventoryReservationStatus.active &&
            reservation.status !== InventoryReservationStatus.consumed
          ) {
            throw new Error(
              `Kit component reservation does not own fulfillment: ${reservation.id}`,
            );
          }
          const committed = reservation.allocations.reduce(
            (sum, allocation) => sum + allocation.reservedQuantity,
            0,
          );
          if (committed !== demand.quantity) {
            throw new Error(`Kit component reservation quantity conflict: ${reservation.id}`);
          }
        });
        return;
      }
      if (product.productType !== ProductType.physical || !product.tracking.stock) return;
      if (product.tracking.expiration && !product.tracking.lot) {
        throw new Error(
          `La Order ${order.id} contiene ${product.name} con trazabilidad pendiente de lote/serie.`,
        );
      }

      const reservations = db.inventoryReservations.filter(
        (reservation) =>
          reservation.tenantId === input.tenantId && reservation.orderItemId === orderItem.id,
      );
      if (reservations.length !== 1) {
        throw new Error(`InventoryReservation ownership conflict for OrderItem: ${orderItem.id}`);
      }
      const [reservation] = reservations;
      if (
        reservation.branchId !== input.branchId ||
        reservation.orderId !== order.id ||
        reservation.productId !== orderItem.productId
      ) {
        throw new Error(`InventoryReservation context conflict for OrderItem: ${orderItem.id}`);
      }
      if (
        reservation.status !== InventoryReservationStatus.active &&
        reservation.status !== InventoryReservationStatus.consumed
      ) {
        throw new Error(`InventoryReservation does not own fulfillment: ${reservation.id}`);
      }

      let committedQuantity = 0;
      let remainingQuantity = 0;
      reservation.allocations.forEach((allocation) => {
        const remaining = getInventoryReservationAllocationRemaining(allocation);
        findInventoryReservationBalance(reservation, allocation, db);
        committedQuantity += allocation.reservedQuantity;
        remainingQuantity += remaining;
        ownedRemainingByBalance.set(
          allocation.balanceId,
          (ownedRemainingByBalance.get(allocation.balanceId) ?? 0) + remaining,
        );
      });
      if (committedQuantity !== (orderItem.inventoryQuantity ?? orderItem.quantity)) {
        throw new Error(`InventoryReservation quantity conflict for OrderItem: ${orderItem.id}`);
      }
      if (
        (reservation.status === InventoryReservationStatus.active && remainingQuantity <= 0) ||
        (reservation.status === InventoryReservationStatus.consumed && remainingQuantity !== 0)
      ) {
        throw new Error(`InventoryReservation status conflict: ${reservation.id}`);
      }
    });
    ownedRemainingByBalance.forEach((remaining, balanceId) => {
      const balance = db.inventoryBalances.find((item) => item.id === balanceId);
      if (!balance || balance.reservedQuantity < remaining) {
        throw new Error(`InventoryReservation balance ownership conflict: ${balanceId}`);
      }
    });

    return true;
  }

  private assertPaymentMethods(input: ConfirmSaleInput, db: MockDatabase): void {
    const config = db.businessCapabilities.find((item) => item.tenantId === input.tenantId);
    if (!config?.allowedPosPaymentMethods?.length) {
      throw new Error("No existe configuracion POS de metodos de pago.");
    }
    input.payments.forEach((payment) => {
      if (!config.allowedPosPaymentMethods?.includes(payment.method)) {
        throw new Error(`Metodo de pago no habilitado: ${payment.method}`);
      }
    });
  }

  private assertPayments(input: ConfirmSaleInput, db: MockDatabase): void {
    const paidTotal = input.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (roundMoney(paidTotal) !== roundMoney(input.total)) {
      throw new Error("La suma de pagos debe coincidir con el total de la venta.");
    }

    input.payments.forEach((payment) => {
      if (payment.method !== PaymentMethod.transfer) return;
      if (!payment.bankAccountId) throw new Error("La transferencia requiere cuenta bancaria.");
      if (!payment.reference?.trim()) throw new Error("La transferencia requiere referencia.");
      if (!payment.manualVerification?.externallyVerified) {
        throw new Error("La transferencia requiere verificacion externa manual del cajero.");
      }
      if (payment.manualVerification.verifiedByUserId !== input.cashierUserId) {
        throw new Error("La verificacion manual debe corresponder al cajero actual.");
      }
      const bankAccount = db.bankAccounts.find((item) => item.id === payment.bankAccountId);
      if (
        !bankAccount ||
        bankAccount.tenantId !== input.tenantId ||
        bankAccount.status !== "active" ||
        !isBranchScopedResourceAvailable(bankAccount.branchIds, input.branchId)
      ) {
        throw new Error("La cuenta bancaria seleccionada no esta activa para esta sucursal.");
      }
    });
  }

  private planInventoryMovements(
    input: ConfirmSaleInput,
    sale: Sale,
    saleItems: SaleItem[],
    db: MockDatabase,
  ): PlannedInventoryMovement[] {
    const plannedMovements: PlannedInventoryMovement[] = [];
    const plannedQuantities = new Map<string, number>();

    const inventoryQuantityByProduct = new Map(
      input.items.map((item) => [item.productId, item.inventoryQuantity]),
    );
    const fulfillmentItems = saleItems.flatMap((saleItem) => {
      const commercialProduct = db.products.find((item) => item.id === saleItem.productId);
      if (commercialProduct?.productType !== ProductType.kit) {
        return [{ ...saleItem, quantity: inventoryQuantityByProduct.get(saleItem.productId) ?? saleItem.quantity }];
      }
      return expandKitDemand(
        db.productKitComponents.filter(
          (component) =>
            component.tenantId === input.tenantId &&
            component.kitProductId === commercialProduct.id,
        ),
        inventoryQuantityByProduct.get(saleItem.productId) ?? saleItem.quantity,
      ).map((demand) => ({ ...saleItem, productId: demand.productId, quantity: demand.quantity }));
    });

    fulfillmentItems.forEach((saleItem) => {
      const product = db.products.find((item) => item.id === saleItem.productId);
      if (!product || product.tenantId !== input.tenantId) {
        throw new Error(`Producto no encontrado para venta: ${saleItem.productId}`);
      }
      if (product.productType !== ProductType.physical || !product.tracking.stock) return;
      if (product.tracking.expiration && !product.tracking.lot) {
        throw new Error(
          `La venta ${sale.number} contiene ${product.name} con trazabilidad pendiente de lote/serie.`,
        );
      }

      const settings = db.productInventorySettings.find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId &&
          item.productId === saleItem.productId,
      );
      let allocations;
      try {
        allocations = planInventoryAllocation({
          tenantId: input.tenantId,
          branchId: input.branchId,
          productId: saleItem.productId,
          quantity: saleItem.quantity,
          balances: (product.tracking.lot && product.tracking.serial
            ? getLotSerialAwareBalances(db, {
                tenantId: input.tenantId,
                branchId: input.branchId,
                productId: saleItem.productId,
                expirationTracked: product.tracking.expiration,
                at: this.now(),
              })
            : product.tracking.lot
              ? getLotAwareBalances(db, {
                  tenantId: input.tenantId,
                  branchId: input.branchId,
                  productId: saleItem.productId,
                  expirationTracked: product.tracking.expiration,
                  at: this.now(),
                })
              : product.tracking.serial
                ? getSerialAwareBalances(db, {
                    tenantId: input.tenantId,
                    branchId: input.branchId,
                    productId: saleItem.productId,
                  })
                : db.inventoryBalances
          ).map((balance) => {
            const plannedQuantity = plannedQuantities.get(balance.id);
            return plannedQuantity === undefined
              ? balance
              : { ...balance, quantity: plannedQuantity };
          }),
          locations: db.storageLocations,
          preferredLocationId: settings?.defaultLocationId,
        });
      } catch {
        throw new Error(`Stock insuficiente para ${product.name}.`);
      }

      allocations.forEach((allocation) => {
        plannedQuantities.set(allocation.balanceId, allocation.quantityAfter);
        plannedMovements.push({
          balanceId: allocation.balanceId,
          productId: allocation.productId,
          quantity: allocation.quantity,
          quantityBefore: allocation.quantityBefore,
          quantityAfter: allocation.quantityAfter,
          fromLocationId: allocation.locationId,
          lotAllocations:
            product.tracking.lot && !product.tracking.serial
              ? planStockLotConsumption(
                  db,
                  {
                    tenantId: input.tenantId,
                    branchId: input.branchId,
                    productId: saleItem.productId,
                    locationId: allocation.locationId,
                    expirationTracked: product.tracking.expiration,
                    at: this.now(),
                  },
                  allocation.quantity,
                )
              : [],
          serialNumbers:
            product.tracking.serial && !product.tracking.lot
              ? planSerialConsumption(
                  db,
                  {
                    tenantId: input.tenantId,
                    branchId: input.branchId,
                    productId: saleItem.productId,
                    locationId: allocation.locationId,
                  },
                  allocation.quantity,
                )
              : [],
          lotSerialAllocations:
            product.tracking.lot && product.tracking.serial
              ? planLotSerialConsumption(
                  db,
                  {
                    tenantId: input.tenantId,
                    branchId: input.branchId,
                    productId: saleItem.productId,
                    locationId: allocation.locationId,
                    expirationTracked: product.tracking.expiration,
                    at: this.now(),
                  },
                  allocation.quantity,
                )
              : [],
        });
      });
    });

    return plannedMovements;
  }

  private applyInventoryMovements(
    plannedMovements: PlannedInventoryMovement[],
    input: ConfirmSaleInput,
    sale: Sale,
    now: string,
    db: MockDatabase,
  ): InventoryMovement[] {
    const movements: InventoryMovement[] = [];

    plannedMovements.forEach((planned) => {
      const balance = db.inventoryBalances.find((item) => item.id === planned.balanceId);
      if (!balance) throw new Error(`Balance not found: ${planned.balanceId}`);
      if (planned.quantityAfter < balance.reservedQuantity) {
        throw new Error(`Stock reservado protegido para ${planned.productId}.`);
      }

      balance.quantity = planned.quantityAfter;
      balance.updatedAt = now;
      const createMovement = (
        quantity: number,
        quantityBefore: number,
        quantityAfter: number,
        lotId?: string,
        serialNumberId?: string,
      ): InventoryMovement => ({
        id: this.id("movement"),
        tenantId: input.tenantId,
        branchId: input.branchId,
        productId: planned.productId,
        lotId,
        serialNumberId,
        type: InventoryMovementType.out,
        reason: `Venta ${sale.number}`,
        quantity,
        quantityBefore,
        quantityAfter,
        fromLocationId: planned.fromLocationId,
        referenceType: "sale",
        referenceId: sale.id,
        performedByUserId: input.cashierUserId,
        createdAt: now,
      });
      if (planned.lotSerialAllocations.length > 0) {
        consumePlannedStockLots(planned.lotSerialAllocations.map((item) => item.lotAllocation));
        consumePlannedSerials(
          planned.lotSerialAllocations.flatMap((item) => item.serialNumbers),
          now,
        );
        let before = planned.quantityBefore;
        planned.lotSerialAllocations.forEach(({ lotAllocation, serialNumbers }) => {
          serialNumbers.forEach((serial) => {
            const after = before - 1;
            const movement = createMovement(1, before, after, lotAllocation.lot.id, serial.id);
            before = after;
            db.inventoryMovements.push(movement);
            movements.push(movement);
          });
        });
      } else if (planned.serialNumbers.length > 0) {
        consumePlannedSerials(planned.serialNumbers, now);
        let before = planned.quantityBefore;
        planned.serialNumbers.forEach((serial) => {
          const after = before - 1;
          const movement = createMovement(1, before, after, undefined, serial.id);
          before = after;
          db.inventoryMovements.push(movement);
          movements.push(movement);
        });
      } else if (planned.lotAllocations.length === 0) {
        const movement = createMovement(
          planned.quantity,
          planned.quantityBefore,
          planned.quantityAfter,
        );
        db.inventoryMovements.push(movement);
        movements.push(movement);
      } else {
        consumePlannedStockLots(planned.lotAllocations);
        let before = planned.quantityBefore;
        planned.lotAllocations.forEach(({ lot, quantity }) => {
          const after = before - quantity;
          const movement = createMovement(quantity, before, after, lot.id);
          before = after;
          db.inventoryMovements.push(movement);
          movements.push(movement);
        });
      }
    });

    return movements;
  }

  private emitAfterCommit(result: SaleConfirmationMutationResult): void {
    this.emitSafely("sale.changed", {
      entityId: result.sale.id,
      tenantId: result.sale.tenantId,
      branchId: result.sale.branchId,
      action: "created",
    });
    result.payments.forEach((payment) => {
      this.emitSafely("payment.changed", {
        entityId: payment.id,
        tenantId: payment.tenantId,
        action: "created",
      });
    });
    result.inventoryMovements.forEach((movement) => {
      this.emitSafely("inventory.changed", {
        entityId: movement.id,
        tenantId: movement.tenantId,
        branchId: movement.branchId,
        productId: movement.productId,
        action: "created",
      });
      this.emitSafely("stock.changed", {
        tenantId: movement.tenantId,
        branchId: movement.branchId,
        productId: movement.productId,
        action: "updated",
      });
    });
    if (result.cashMovement) {
      this.emitSafely("cash-shift.changed", {
        entityId: result.cashMovement.cashShiftId,
        tenantId: result.sale.tenantId,
        branchId: result.sale.branchId,
        action: "updated",
      });
    }
    result.reservationChanges
      .filter((change) => change.changed)
      .forEach((change) => {
        this.emitSafely("stock.changed", {
          entityId: change.reservation.id,
          tenantId: change.reservation.tenantId,
          branchId: change.reservation.branchId,
          productId: change.reservation.productId,
          action: "updated",
          metadata: { entity: "InventoryReservation", status: change.reservation.status },
        });
      });
    if (result.deferredFulfillmentCreated && result.order && result.pickingOrder) {
      this.emitSafely("order.changed", {
        entityId: result.order.id,
        tenantId: result.order.tenantId,
        branchId: result.order.branchId,
        orderId: result.order.id,
        action: "created",
      });
      this.emitSafely("picking.changed", {
        entityId: result.pickingOrder.id,
        tenantId: result.pickingOrder.tenantId,
        branchId: result.pickingOrder.branchId,
        orderId: result.order.id,
        pickingOrderId: result.pickingOrder.id,
        action: "created",
      });
    }
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload): void {
    try {
      this.emit(event, payload);
    } catch {
      // Persistence is already committed; refresh/listener failures must not fail confirmation.
    }
  }
}

function nextSaleNumber(sales: Sale[], tenantId: string): string {
  const prefix = "POS-";
  const next =
    sales
      .filter((sale) => sale.tenantId === tenantId && sale.number.startsWith(prefix))
      .map((sale) => Number(sale.number.slice(prefix.length)))
      .filter((value) => Number.isInteger(value))
      .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

interface PlannedInventoryMovement {
  balanceId: string;
  productId: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  fromLocationId?: string;
  lotAllocations: StockLotAllocation[];
  serialNumbers: import("@/core/entities").SerialNumber[];
  lotSerialAllocations: import("@/infrastructure/mock/repositories/serialNumberMutations").LotSerialAllocation[];
}

function assertSaleMatchesOrder(
  saleItems: ConfirmSaleInput["items"],
  orderItems: OrderItem[],
  orderId: string,
): void {
  const saleQuantities = aggregateProductQuantities(saleItems);
  const orderQuantities = aggregateProductQuantities(orderItems);
  if (saleQuantities.size !== orderQuantities.size) {
    throw new Error(`Sale items do not match Order: ${orderId}`);
  }
  orderQuantities.forEach((quantity, productId) => {
    if (saleQuantities.get(productId) !== quantity) {
      throw new Error(`Sale quantity does not match Order for product: ${productId}`);
    }
  });
}

function aggregateProductQuantities(
  items: Array<{ productId: string; quantity: number }>,
): Map<string, number> {
  const quantities = new Map<string, number>();
  items.forEach((item) => {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  });
  return quantities;
}

function getConfirmationFingerprint(input: ConfirmSaleInput): string {
  return JSON.stringify({
    tenantId: input.tenantId,
    branchId: input.branchId,
    cashierUserId: input.cashierUserId,
    cashShiftId: input.cashShiftId,
    customerId: input.customerId ?? null,
    sourceOrderId: input.sourceOrderId ?? null,
    ...(input.deferredOrder
      ? {
          deferredOrder: {
            idempotencyKey: input.deferredOrder.idempotencyKey.trim(),
            deliveryMethod: input.deferredOrder.deliveryMethod,
            transportMode: input.deferredOrder.transportMode,
            deliveryAddress: input.deferredOrder.deliveryAddress
              ? {
                  recipientName: input.deferredOrder.deliveryAddress.recipientName.trim(),
                  recipientPhone:
                    input.deferredOrder.deliveryAddress.recipientPhone?.trim() ?? null,
                  line1: input.deferredOrder.deliveryAddress.line1.trim(),
                  line2: input.deferredOrder.deliveryAddress.line2?.trim() || null,
                  city: input.deferredOrder.deliveryAddress.city.trim(),
                  stateOrDepartment:
                    input.deferredOrder.deliveryAddress.stateOrDepartment?.trim() || null,
                  postalCode: input.deferredOrder.deliveryAddress.postalCode?.trim() || null,
                  country: input.deferredOrder.deliveryAddress.country.trim(),
                  references: input.deferredOrder.deliveryAddress.references?.trim() || null,
                }
              : null,
            ...(input.deferredOrder.storePickupContact
              ? {
                  storePickupContact: {
                    recipientName: input.deferredOrder.storePickupContact.recipientName.trim(),
                    recipientPhone: input.deferredOrder.storePickupContact.recipientPhone.trim(),
                  },
                }
              : {}),
            notificationContact:
              input.deferredOrder.notificationContact?.emailMode === "send"
                ? {
                    emailMode: "send",
                    email: normalizeEmail(input.deferredOrder.notificationContact.email),
                  }
                : (input.deferredOrder.notificationContact ?? null),
          },
        }
      : {}),
    document: input.document ?? null,
    subtotal: roundMoney(input.subtotal),
    discountTotal: roundMoney(input.discountTotal),
    taxTotal: roundMoney(input.taxTotal),
    total: roundMoney(input.total),
    items: input.items
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        inventoryQuantity: item.inventoryQuantity,
        unitPrice: roundMoney(item.unitPrice),
        discount: roundMoney(item.discount),
        subtotal: roundMoney(item.subtotal),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    payments: input.payments
      .map((payment) => ({
        method: payment.method,
        amount: roundMoney(payment.amount),
        currency: payment.currency,
        status: payment.status ?? PaymentStatus.approved,
        bankAccountId: payment.bankAccountId ?? null,
        reference: payment.reference ?? null,
        manualVerification: payment.manualVerification
          ? {
              externallyVerified: payment.manualVerification.externallyVerified,
              verifiedByUserId: payment.manualVerification.verifiedByUserId,
            }
          : null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

function getDeferredOrderFingerprint(input: ConfirmSaleInput, saleNumber: string): string {
  const deferredOrder = input.deferredOrder
    ? {
        ...input.deferredOrder,
        storePickupContact: input.deferredOrder.storePickupContact
          ? {
              recipientName: input.deferredOrder.storePickupContact.recipientName.trim(),
              recipientPhone: input.deferredOrder.storePickupContact.recipientPhone.trim(),
            }
          : undefined,
      }
    : null;
  return JSON.stringify({
    tenantId: input.tenantId,
    branchId: input.branchId,
    orderNumber: saleNumber,
    source: OrderSource.pos,
    customerId: input.customerId ?? null,
    deferredOrder,
    subtotal: roundMoney(input.subtotal),
    discountTotal: roundMoney(input.discountTotal),
    shippingTotal: 0,
    total: roundMoney(input.total),
    items: input.items
      .map((item) => ({
        productId: item.productId,
        skuSnapshot: item.skuSnapshot,
        nameSnapshot: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: roundMoney(item.unitPrice),
        discount: roundMoney(item.discount),
        subtotal: roundMoney(item.subtotal),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}
