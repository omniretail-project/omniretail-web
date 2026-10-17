import type { InventoryReservation, Order, Payment } from "@/core/entities";
import { DeliveryMethod, OrderStatus, ProductType } from "@/core/enums";
import { validatePhoneNumber } from "@/config/contact-policy";
import { normalizeEmail, validateEmail } from "@/config/email-policy";
import {
  assertAllowedInitialOrderStatus,
  assertOrderStatusTransition,
} from "@/core/orders/orderStatusTransitions";
import { assertOrderDeliveryMethodAllowed } from "@/core/orders/orderDeliveryPolicy";
import type {
  CreateOrderInput,
  CreateOrderWithPaymentInput,
  CreateOrderWithPaymentResult,
  OrderRepository,
} from "@/core/repositories";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { expandKitDemand } from "@/core/kits/kitDemand";
import type { InventoryReservationMutationResult } from "@/infrastructure/mock/repositories/inventoryReservationMutations";
import {
  releaseOrderReservationsInDatabase,
  reserveStockTrackedOrderItemsInDatabase,
} from "@/infrastructure/mock/repositories/orderReservationMutations";

const logisticsStatuses = new Set<OrderStatus>([
  OrderStatus.confirmed,
  OrderStatus.preparing,
  OrderStatus.picking,
  OrderStatus.packing,
  OrderStatus.ready_for_dispatch,
]);

interface OrderLifecycleMutationResult {
  order: Order;
  orderChanged: boolean;
  reservationChanges: InventoryReservationMutationResult[];
}

interface OrderWithPaymentMutationResult extends OrderLifecycleMutationResult {
  payment: Payment;
  paymentChanged: boolean;
}

export class MockOrderRepository extends BaseMockRepository implements OrderRepository {
  async getAll() {
    return this.read((db) => db.orders);
  }

  async listByTenant(tenantId: string) {
    return this.read((db) => db.orders.filter((item) => item.tenantId === tenantId));
  }

  async listByBranch(tenantId: string, branchId: string) {
    if (!tenantId.trim() || !branchId.trim()) {
      throw new Error("Order tenantId and branchId are required");
    }
    return this.read((db) => {
      const branch = db.branches.find((item) => item.id === branchId && item.tenantId === tenantId);
      if (!branch) throw new Error(`Branch not found for tenant: ${branchId}`);
      return db.orders.filter((item) => item.tenantId === tenantId && item.branchId === branchId);
    });
  }

  async getByIdsScoped(tenantId: string, branchId: string, ids: string[]) {
    const requestedIds = new Set(ids);
    if (requestedIds.size === 0) return [];
    return this.read((db) =>
      db.orders.filter(
        (item) =>
          item.tenantId === tenantId && item.branchId === branchId && requestedIds.has(item.id),
      ),
    );
  }

  async getById(id: string) {
    return this.read((db) => db.orders.find((item) => item.id === id) ?? null);
  }

  async getByTrackingToken(tenantId: string, trackingToken: string) {
    return this.read(
      (db) =>
        db.orders.find(
          (item) => item.tenantId === tenantId && item.trackingToken === trackingToken,
        ) ?? null,
    );
  }

  async getByCustomer(tenantId: string, customerId: string) {
    // customerId por si solo no alcanza: se exige tenantId tambien, y el
    // filtro por customerId ya excluye pedidos guest (Order.customerId es
    // opcional y los guest orders no lo tienen seteado).
    return this.read((db) =>
      db.orders.filter((item) => item.tenantId === tenantId && item.customerId === customerId),
    );
  }

  async getPendingForLogistics() {
    return this.read((db) => db.orders.filter((item) => logisticsStatuses.has(item.status)));
  }

  async create(input: CreateOrderInput) {
    assertAllowedInitialOrderStatus("create", input.status);
    this.assertCreateInput(input);
    input = normalizeOrderCreationInput(input);
    const idempotencyKey = input.idempotencyKey?.trim();
    const fingerprint = getOrderCreationFingerprint(input);

    const result = this.store.transact<OrderLifecycleMutationResult>((db) => {
      if (idempotencyKey) {
        const existing = db.orders.find(
          (order) => order.tenantId === input.tenantId && order.idempotencyKey === idempotencyKey,
        );
        if (existing) {
          if (existing.idempotencyFingerprint !== fingerprint) {
            throw new Error(`Order idempotency conflict: ${idempotencyKey}`);
          }
          const reservationChanges =
            existing.status === OrderStatus.confirmed
              ? reserveStockTrackedOrderItemsInDatabase(existing, db, {
                  id: (prefix) => this.id(prefix),
                  now: () => this.now(),
                })
              : [];
          return { order: existing, orderChanged: false, reservationChanges };
        }
      }

      this.assertTrackingTokenAvailable(input, db);
      this.assertOrderReferences(input, db);

      const now = this.now();
      const orderId = this.id("order");
      const order: Order = {
        ...input,
        id: orderId,
        items: input.items.map((item) => ({
          ...item,
          orderId,
          fulfillmentComponents: this.resolveFulfillmentComponents(
            input.tenantId,
            item.productId,
            item.quantity,
            item.inventoryQuantity,
            db,
          ),
        })),
        idempotencyKey,
        idempotencyFingerprint: idempotencyKey ? fingerprint : undefined,
        createdAt: now,
        updatedAt: now,
      };
      db.orders.push(order);

      const reservationChanges =
        order.status === OrderStatus.confirmed
          ? reserveStockTrackedOrderItemsInDatabase(order, db, {
              id: (prefix) => this.id(prefix),
              now: () => this.now(),
            })
          : [];
      return { order, orderChanged: true, reservationChanges };
    });

    this.emitLifecycleChanges(result, "created");
    return result.order;
  }

  async createWithPayment(
    input: CreateOrderWithPaymentInput,
  ): Promise<CreateOrderWithPaymentResult> {
    assertAllowedInitialOrderStatus("createWithPayment", input.order.status);
    this.assertCreateInput(input.order);
    input = { ...input, order: normalizeOrderCreationInput(input.order) };

    const result = this.store.transact<OrderWithPaymentMutationResult>((db) => {
      const idempotencyKey = input.order.idempotencyKey?.trim();
      const fingerprint = getOrderCreationFingerprint(input.order);
      const existing = idempotencyKey
        ? db.orders.find(
            (order) =>
              order.tenantId === input.order.tenantId && order.idempotencyKey === idempotencyKey,
          )
        : undefined;

      if (existing) {
        if (existing.idempotencyFingerprint !== fingerprint) {
          throw new Error(`Order idempotency conflict: ${idempotencyKey}`);
        }
        const payments = db.payments.filter((payment) => payment.orderId === existing.id);
        if (payments.length > 1) {
          throw new Error(`Checkout has multiple payments: ${existing.id}`);
        }
        if (payments[0]) {
          const reservationChanges =
            existing.status === OrderStatus.confirmed
              ? reserveStockTrackedOrderItemsInDatabase(existing, db, {
                  id: (prefix) => this.id(prefix),
                  now: () => this.now(),
                })
              : [];
          return {
            order: existing,
            payment: payments[0],
            orderChanged: false,
            paymentChanged: false,
            reservationChanges,
          };
        }

        const payment = this.createPaymentInDatabase(existing, input.payment, db);
        const reservationChanges =
          existing.status === OrderStatus.confirmed
            ? reserveStockTrackedOrderItemsInDatabase(existing, db, {
                id: (prefix) => this.id(prefix),
                now: () => this.now(),
              })
            : [];
        return {
          order: existing,
          payment,
          orderChanged: false,
          paymentChanged: true,
          reservationChanges,
        };
      }

      this.assertTrackingTokenAvailable(input.order, db);
      this.assertOrderReferences(input.order, db);
      const now = this.now();
      const orderId = this.id("order");
      const order: Order = {
        ...input.order,
        id: orderId,
        items: input.order.items.map((item) => ({
          ...item,
          orderId,
          fulfillmentComponents: this.resolveFulfillmentComponents(
            input.order.tenantId,
            item.productId,
            item.quantity,
            item.inventoryQuantity,
            db,
          ),
        })),
        idempotencyKey,
        idempotencyFingerprint: idempotencyKey ? fingerprint : undefined,
        createdAt: now,
        updatedAt: now,
      };
      db.orders.push(order);

      const payment = this.createPaymentInDatabase(order, input.payment, db);
      const reservationChanges =
        order.status === OrderStatus.confirmed
          ? reserveStockTrackedOrderItemsInDatabase(order, db, {
              id: (prefix) => this.id(prefix),
              now: () => this.now(),
            })
          : [];
      return {
        order,
        payment,
        orderChanged: true,
        paymentChanged: true,
        reservationChanges,
      };
    });

    this.emitLifecycleChanges(result, "created");
    if (result.paymentChanged) {
      this.emitSafely("payment.changed", {
        entityId: result.payment.id,
        tenantId: result.payment.tenantId,
        action: "created",
      });
    }
    return { order: result.order, payment: result.payment };
  }

  async updateStatus(id: string, status: OrderStatus) {
    const result = this.store.transact<OrderLifecycleMutationResult>((db) => {
      const order = db.orders.find((item) => item.id === id);
      if (!order) throw this.missing("Order", id);

      if (order.status === status) {
        const reservationChanges =
          status === OrderStatus.confirmed
            ? reserveStockTrackedOrderItemsInDatabase(order, db, {
                id: (prefix) => this.id(prefix),
                now: () => this.now(),
              })
            : status === OrderStatus.cancelled
              ? releaseOrderReservationsInDatabase(order, db, { now: () => this.now() })
              : [];
        return { order, orderChanged: false, reservationChanges };
      }

      assertOrderStatusTransition(order.status, status, "generic");

      let reservationChanges: InventoryReservationMutationResult[] = [];
      if (status === OrderStatus.confirmed) {
        if (order.status !== OrderStatus.pending) {
          throw new Error(`Order cannot transition from ${order.status} to confirmed: ${order.id}`);
        }
        reservationChanges = reserveStockTrackedOrderItemsInDatabase(order, db, {
          id: (prefix) => this.id(prefix),
          now: () => this.now(),
        });
      } else if (status === OrderStatus.cancelled) {
        if (order.status === OrderStatus.delivered) {
          throw new Error(`Delivered order cannot be cancelled: ${order.id}`);
        }
        reservationChanges = releaseOrderReservationsInDatabase(order, db, {
          now: () => this.now(),
        });
      }

      order.status = status;
      order.updatedAt = this.now();
      return { order, orderChanged: true, reservationChanges };
    });

    this.emitLifecycleChanges(result, "status_changed");
    return result.order;
  }

  private createPaymentInDatabase(
    order: Order,
    input: CreateOrderWithPaymentInput["payment"],
    db: MockDatabase,
  ): Payment {
    if (input.tenantId !== order.tenantId) throw new Error("Payment tenant does not match order");
    if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount !== order.total) {
      throw new Error("Payment amount does not match order total");
    }

    const payment: Payment = {
      ...input,
      id: this.id("payments"),
      orderId: order.id,
      createdAt: this.now(),
    };
    db.payments.push(payment);
    return payment;
  }

  private resolveFulfillmentComponents(
    tenantId: string,
    productId: string,
    quantity: number,
    inventoryQuantity: number | undefined,
    db: MockDatabase,
  ) {
    const product = db.products.find((item) => item.id === productId && item.tenantId === tenantId);
    if (!product) throw new Error(`Product not found for tenant: ${productId}`);
    if (product.productType === ProductType.physical && product.tracking.stock)
      return [{ productId, quantity: inventoryQuantity ?? quantity }];
    if (product.productType !== ProductType.kit) return undefined;
    return expandKitDemand(
      db.productKitComponents.filter(
        (item) => item.tenantId === tenantId && item.kitProductId === productId,
      ),
      inventoryQuantity ?? quantity,
    );
  }

  private assertCreateInput(input: CreateOrderInput): void {
    if (!input.tenantId.trim()) throw new Error("Order tenantId is required");
    if (!input.branchId.trim()) throw new Error("Order branchId is required");
    if (!input.orderNumber.trim()) throw new Error("Order number is required");
    if (!input.trackingToken.trim()) throw new Error("Order trackingToken is required");
    if (input.idempotencyKey !== undefined && !input.idempotencyKey.trim()) {
      throw new Error("Order idempotencyKey cannot be blank");
    }
    if (input.items.length === 0) throw new Error("Order requires at least one item");
    assertOrderDeliveryMethodAllowed(input.source, input.deliveryMethod);
    if (input.deliveryMethod === DeliveryMethod.home_delivery) {
      const recipientPhone = input.deliveryAddress?.recipientPhone;
      if (recipientPhone === undefined || !recipientPhone.trim()) {
        throw new Error("Home delivery recipientPhone is required");
      }
      const phoneError = validatePhoneNumber(recipientPhone);
      if (phoneError) throw new Error(phoneError);
    } else if (input.deliveryAddress !== undefined) {
      throw new Error("Only home delivery can persist a delivery address");
    }
    if (input.deliveryMethod === DeliveryMethod.store_pickup) {
      const contact = input.storePickupContact;
      if (!contact?.recipientName?.trim()) {
        throw new Error("Store pickup recipientName is required");
      }
      if (!contact.recipientPhone?.trim()) {
        throw new Error("Store pickup recipientPhone is required");
      }
      const phoneError = validatePhoneNumber(contact.recipientPhone);
      if (phoneError) throw new Error(phoneError);
    } else if (input.storePickupContact !== undefined) {
      throw new Error("Only store pickup can persist storePickupContact");
    }
    if (input.notificationContact) {
      if (input.notificationContact.emailMode === "send") {
        const emailError = validateEmail(input.notificationContact.email);
        if (emailError) throw new Error(emailError);
      } else if (input.notificationContact.emailMode === "not_applicable") {
        if ("email" in input.notificationContact && input.notificationContact.email !== undefined) {
          throw new Error("Order notificationContact not_applicable cannot include email");
        }
      } else {
        throw new Error("Order notificationContact emailMode is invalid");
      }
    }
    input.items.forEach((item) => {
      if (!item.id.trim()) throw new Error("OrderItem id is required");
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error(`OrderItem quantity must be greater than 0: ${item.id}`);
      }
    });
  }

  private assertOrderReferences(input: CreateOrderInput, db: MockDatabase): void {
    const tenant = db.tenants.find((item) => item.id === input.tenantId);
    if (!tenant) throw this.missing("Tenant", input.tenantId);
    const branch = db.branches.find((item) => item.id === input.branchId);
    if (!branch || branch.tenantId !== input.tenantId) {
      throw new Error(`Branch not found for tenant: ${input.branchId}`);
    }
    if (input.customerId) {
      const customer = db.customers.find(
        (item) => item.id === input.customerId && item.tenantId === input.tenantId,
      );
      if (!customer) throw new Error(`Customer not found for tenant: ${input.customerId}`);
    }
    input.items.forEach((item) => {
      const product = db.products.find(
        (product) => product.id === item.productId && product.tenantId === input.tenantId,
      );
      if (!product) throw new Error(`Product not found for tenant: ${item.productId}`);
    });
  }

  private assertTrackingTokenAvailable(input: CreateOrderInput, db: MockDatabase): void {
    const exists = db.orders.some(
      (order) => order.tenantId === input.tenantId && order.trackingToken === input.trackingToken,
    );
    if (exists) {
      throw new Error(`Order tracking token already exists: ${input.trackingToken}`);
    }
  }

  private emitLifecycleChanges(
    result: OrderLifecycleMutationResult,
    orderAction: "created" | "status_changed",
  ): void {
    result.reservationChanges
      .filter((change) => change.changed)
      .forEach((change) => this.emitReservationChanged(change.reservation));
    if (!result.orderChanged) return;
    this.emitSafely("order.changed", {
      entityId: result.order.id,
      tenantId: result.order.tenantId,
      branchId: result.order.branchId,
      orderId: result.order.id,
      action: orderAction,
    });
  }

  private emitReservationChanged(reservation: InventoryReservation): void {
    this.emitSafely("stock.changed", {
      entityId: reservation.id,
      tenantId: reservation.tenantId,
      branchId: reservation.branchId,
      productId: reservation.productId,
      action: "updated",
      metadata: { entity: "InventoryReservation", status: reservation.status },
    });
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload): void {
    try {
      this.emit(event, payload);
    } catch {
      // The lifecycle transaction is already committed; listener failures cannot roll it back.
    }
  }
}

function getOrderCreationFingerprint(input: CreateOrderInput): string {
  return JSON.stringify({
    tenantId: input.tenantId,
    branchId: input.branchId,
    orderNumber: input.orderNumber,
    source: input.source,
    customerId: input.customerId ?? null,
    guestCustomer: input.guestCustomer
      ? { name: input.guestCustomer.name, email: input.guestCustomer.email }
      : null,
    status: input.status,
    deliveryMethod: input.deliveryMethod,
    transportMode: input.transportMode,
    deliveryAddress: input.deliveryAddress
      ? {
          recipientName: input.deliveryAddress.recipientName,
          recipientPhone: input.deliveryAddress.recipientPhone ?? null,
          line1: input.deliveryAddress.line1,
          line2: input.deliveryAddress.line2 ?? null,
          city: input.deliveryAddress.city,
          stateOrDepartment: input.deliveryAddress.stateOrDepartment ?? null,
          postalCode: input.deliveryAddress.postalCode ?? null,
          country: input.deliveryAddress.country,
          references: input.deliveryAddress.references ?? null,
        }
      : null,
    ...(input.storePickupContact
      ? {
          storePickupContact: {
            recipientName: input.storePickupContact.recipientName,
            recipientPhone: input.storePickupContact.recipientPhone,
          },
        }
      : {}),
    notificationContact:
      input.notificationContact === undefined
        ? null
        : input.notificationContact.emailMode === "send"
          ? { emailMode: "send", email: normalizeEmail(input.notificationContact.email) }
          : { emailMode: "not_applicable" },
    subtotal: input.subtotal,
    discountTotal: input.discountTotal,
    shippingTotal: input.shippingTotal,
    total: input.total,
    trackingToken: input.trackingToken,
    items: input.items
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        skuSnapshot: item.skuSnapshot,
        nameSnapshot: item.nameSnapshot,
        quantity: item.quantity,
        inventoryQuantity: item.inventoryQuantity ?? null,
        unitPrice: item.unitPrice,
        discount: item.discount,
        subtotal: item.subtotal,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

function normalizeOrderCreationInput(input: CreateOrderInput): CreateOrderInput {
  return {
    ...input,
    storePickupContact: input.storePickupContact
      ? {
          recipientName: input.storePickupContact.recipientName.trim(),
          recipientPhone: input.storePickupContact.recipientPhone.trim(),
        }
      : undefined,
    notificationContact:
      input.notificationContact?.emailMode === "send"
        ? {
            emailMode: "send",
            email: normalizeEmail(input.notificationContact.email),
          }
        : input.notificationContact,
  };
}
