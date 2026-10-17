import type { Branch, CashShift, SaleDocumentSnapshot, User } from "@/core/entities";
import { KIT_DEFERRED_MESSAGE, isKitDeferredSale } from "@/modules/pos/validation/kitDelivery";
import {
  CashShiftStatus,
  DeliveryMethod,
  PaymentMethod,
  PaymentStatus,
  ProductType,
  SalesChannel,
} from "@/core/enums";
import {
  getAvailableQuantity,
  getBranchAvailableQuantity,
  planInventoryAllocation,
} from "@/core/inventory/stockAvailability";
import { calculateEffectivePrice, resolveQuantityPrice } from "@/core/pricing";
import { toBaseQuantity } from "@/core/units";
import type {
  ConfirmSaleResult,
  PosApiCashShift,
  SaleConfirmationDeferredOrderInput,
  SaleConfirmationPaymentMethod,
  SaleConfirmationPaymentInput,
} from "@/core/repositories";
import { isBranchScopedResourceAvailable } from "@/core/scopes/branchScope";
import type { CurrencyCode } from "@/core/types/common.types";
import type { OrderNotificationContact } from "@/core/types/orderNotification.types";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { isStockLotEligible } from "@/infrastructure/mock/repositories/stockLotMutations";
import type { CheckoutDto } from "@/modules/pos/application/dto/CheckoutDto";
import type { SaleTicketDto, SaleTicketItemDto } from "@/modules/pos/application/dto/SaleTicketDto";
import type { PosSaleConfirmationDto } from "@/modules/pos/application/dto/PosSaleConfirmationDto";
import {
  getApprovedCardTerminalReference,
  validateCheckout,
} from "@/modules/pos/validation/checkout.validation";
import {
  POS_SALES_CREATE_PERMISSION,
  ensureOwnedOpenCashShift,
  ensurePosBranchAccess,
  ensurePosPermission,
  ensureTenantCanUsePos,
  resolvePosSessionContext,
  requirePosApi,
} from "@/modules/pos/application/services/posServiceContext";

export interface ConfirmPosSaleInput {
  confirmationId: string;
  branchId: string;
  cashShiftId: string;
  ticket: SaleTicketDto;
  checkout: CheckoutDto;
  customerId?: string;
  sourceOrderId?: string;
  orderIdempotencyKey?: string;
  /**
   * Se invoca justo antes del POST (modo API), cuando ya no queda ninguna validacion local. Si
   * lanza, la venta no se envia: sirve para persistir la solicitud antes de que pueda perderse.
   */
  beforeSend?: () => void;
  /** @deprecated POS now derives this snapshot from checkout.notificationContact. */
  notificationContact?: OrderNotificationContact;
}

interface AuthorizedConfirmPosSaleInput extends ConfirmPosSaleInput {
  user: User;
  currentBranch: Branch;
  cashShift: PosApiCashShift | CashShift;
  currency: CurrencyCode;
}

interface ValidatedSaleItem {
  productId: string;
  skuSnapshot: string;
  nameSnapshot: string;
  quantity: number;
  inventoryQuantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
  baseSubtotalCents: number;
  discountTotalCents: number;
  totalCents: number;
}

export class ConfirmSaleService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: ConfirmPosSaleInput): Promise<PosSaleConfirmationDto> {
    const context = await this.resolveOperationalContext(input.branchId, input.cashShiftId);
    const authorizedInput: AuthorizedConfirmPosSaleInput = {
      ...input,
      user: context.user,
      currentBranch: context.branch,
      cashShift: context.cashShift,
      currency: context.currency,
    };
    const confirmationId = authorizedInput.confirmationId.trim();
    if (!confirmationId) throw new Error("No se pudo identificar el intento de confirmación.");
    if (authorizedInput.ticket.items.length === 0) throw new Error("El ticket está vacío.");
    if (authorizedInput.ticket.hasUnsupportedTraceability) {
      throw new Error("El ticket contiene lote, serial o kit no soportado para confirmación.");
    }
    // El backend rechaza los kits diferidos (KIT_FULFILLMENT_NOT_SUPPORTED): se bloquea antes de
    // validar el cobro y de enviar nada.
    const kit = authorizedInput.ticket.items.find((item) => item.isKit);
    if (
      this.repositories.posDataSource === "api" &&
      kit &&
      isKitDeferredSale(authorizedInput.checkout.deliveryMethod, true)
    ) {
      throw new Error(`${kit.name}: ${KIT_DEFERRED_MESSAGE}`);
    }
    if (this.repositories.posDataSource === "api" && authorizedInput.sourceOrderId) {
      throw new Error(
        "La confirmación de pedidos existentes todavía no está soportada en modo API.",
      );
    }

    const capabilities = await this.repositories.businessConfig.getCapabilities(
      authorizedInput.currentBranch.tenantId,
    );
    if (!capabilities?.allowedPosPaymentMethods?.length) {
      throw new Error("No existe configuración de métodos de pago para POS.");
    }

    const checkoutValidation = validateCheckout(
      authorizedInput.checkout,
      authorizedInput.ticket.total,
    );
    if (!checkoutValidation.isValid) {
      throw new Error("El documento o los datos de pago deben revisarse antes de confirmar.");
    }

    await this.validateOptionalReferences(authorizedInput);
    if (this.repositories.posDataSource === "api") {
      return this.confirmWithApi(
        authorizedInput,
        confirmationId,
        capabilities.allowedPosPaymentMethods,
      );
    }
    const items = await this.validateAndBuildItems(authorizedInput);
    const totals = calculateValidatedTotals(items);
    assertTicketTotals(authorizedInput.ticket, totals);

    const payments = await this.validateAndBuildPayments(authorizedInput);
    assertAllowedPaymentMethods(payments, capabilities.allowedPosPaymentMethods);
    assertPaymentsMatchTotal(payments, totals.totalCents);

    const document = createDocumentSnapshot(authorizedInput.checkout);
    const currentShift = await this.requireCurrentCashShift(authorizedInput);
    const deferredOrder = authorizedInput.sourceOrderId
      ? undefined
      : this.createDeferredOrderInput(authorizedInput);

    return toSaleConfirmationDto(
      await this.repositories.saleConfirmations.confirm({
        confirmationId,
        tenantId: authorizedInput.currentBranch.tenantId,
        branchId: authorizedInput.currentBranch.id,
        cashierUserId: authorizedInput.user.id,
        cashShiftId: currentShift.id,
        customerId: authorizedInput.customerId,
        sourceOrderId: authorizedInput.sourceOrderId,
        deferredOrder,
        items: items.map((item) => ({
          productId: item.productId,
          skuSnapshot: item.skuSnapshot,
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          inventoryQuantity: item.inventoryQuantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal: item.subtotal,
        })),
        document,
        subtotal: fromCents(totals.subtotalCents),
        discountTotal: fromCents(totals.discountTotalCents),
        taxTotal: 0,
        total: fromCents(totals.totalCents),
        payments,
      }),
    );
  }

  private async confirmWithApi(
    input: AuthorizedConfirmPosSaleInput,
    confirmationId: string,
    allowedMethods: PaymentMethod[],
  ): Promise<PosSaleConfirmationDto> {
    const seenProductIds = new Set<string>();
    input.ticket.items.forEach((item) => validateTicketItem(item, seenProductIds));
    const payments = await this.validateAndBuildPayments(input);
    assertAllowedPaymentMethods(payments, allowedMethods);
    assertPaymentsMatchTotal(payments, toCents(input.ticket.total));
    const currentShift = await this.requireCurrentCashShift(input);
    const deferredOrder = this.createDeferredOrderInput(input);
    input.beforeSend?.();
    const result = await requirePosApi(this.repositories).confirmSale({
      branchId: input.currentBranch.id,
      cashShiftId: currentShift.id,
      customerId: input.customerId,
      taxTotal: 0,
      items: input.ticket.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        discount: item.discount,
        trackingSelections: [],
      })),
      payments: payments.map((payment) => ({
        method: payment.method,
        amount: payment.amount,
        bankAccountId: payment.bankAccountId,
        reference: payment.reference,
        externallyVerified: payment.manualVerification?.externallyVerified,
      })),
      confirmationId,
      document: createDocumentSnapshot(input.checkout),
      sourceOrderId: null,
      deferredOrder,
    });
    return {
      sale: {
        id: result.id,
        number: result.number,
        total: result.total,
        sourceOrderId: result.sourceOrderId,
      },
      payments: result.payments.map((payment) => ({ currency: payment.currency })),
      inventoryMovements: result.inventoryEffects,
      idempotent: result.idempotent,
    };
  }

  private createDeferredOrderInput(
    input: AuthorizedConfirmPosSaleInput,
  ): SaleConfirmationDeferredOrderInput | undefined {
    if (input.checkout.deliveryMethod === DeliveryMethod.immediate) return undefined;
    const idempotencyKey = input.orderIdempotencyKey?.trim();
    if (!idempotencyKey) throw new Error("No se pudo identificar el intento de pedido diferido.");
    if (input.checkout.deliveryMethod === DeliveryMethod.home_delivery) {
      const address = input.checkout.deliveryAddress;
      if (
        !address?.recipientName.trim() ||
        !address.recipientPhone?.trim() ||
        !address.line1.trim() ||
        !address.city.trim()
      ) {
        throw new Error("La entrega a domicilio requiere contacto, teléfono, dirección y ciudad.");
      }
    }
    if (input.checkout.deliveryMethod === DeliveryMethod.store_pickup) {
      const contact = input.checkout.storePickupContact;
      if (!contact?.recipientName?.trim() || !contact.recipientPhone?.trim()) {
        throw new Error("El retiro en tienda requiere nombre y teléfono de quien retira.");
      }
    }
    const deliveryAddress =
      input.checkout.deliveryMethod === DeliveryMethod.home_delivery
        ? {
            recipientName: input.checkout.deliveryAddress!.recipientName.trim(),
            recipientPhone: input.checkout.deliveryAddress!.recipientPhone!.trim(),
            line1: input.checkout.deliveryAddress!.line1.trim(),
            city: input.checkout.deliveryAddress!.city.trim(),
            country: "Guatemala",
            references: input.checkout.deliveryAddress!.references?.trim() || undefined,
          }
        : undefined;
    const notificationContact =
      input.checkout.deliveryMethod === DeliveryMethod.home_delivery
        ? input.checkout.notificationContact.emailMode === "send"
          ? {
              emailMode: "send" as const,
              email: input.checkout.notificationContact.email.trim(),
            }
          : { emailMode: "not_applicable" as const }
        : undefined;

    const storePickupContact =
      input.checkout.deliveryMethod === DeliveryMethod.store_pickup
        ? {
            recipientName: input.checkout.storePickupContact!.recipientName.trim(),
            recipientPhone: input.checkout.storePickupContact!.recipientPhone.trim(),
          }
        : undefined;

    return {
      idempotencyKey,
      deliveryMethod: input.checkout.deliveryMethod,
      transportMode: input.checkout.transportMode,
      notificationContact,
      deliveryAddress,
      storePickupContact,
    };
  }

  private async resolveOperationalContext(branchId: string, cashShiftId: string) {
    const { tenant, tenantId, actorUserId, user, permissions } = await resolvePosSessionContext(
      this.repositories,
    );
    ensurePosPermission(permissions, POS_SALES_CREATE_PERMISSION);
    await ensureTenantCanUsePos(this.repositories, tenantId);
    const branch = await ensurePosBranchAccess(this.repositories, user, branchId);
    const cashShift = await ensureOwnedOpenCashShift(this.repositories, {
      tenantId,
      actorUserId,
      branchId: branch.id,
      cashShiftId,
    });
    return { tenantId, actorUserId, user, branch, cashShift, currency: tenant.defaultCurrency };
  }

  private async requireCurrentCashShift(input: AuthorizedConfirmPosSaleInput) {
    const shift =
      this.repositories.posDataSource === "api"
        ? await requirePosApi(this.repositories).getOpenCashShift(input.currentBranch.id)
        : await this.repositories.cashShifts.getOpenByUserAndBranch(
            input.currentBranch.tenantId,
            input.user.id,
            input.currentBranch.id,
          );
    if (
      !shift ||
      shift.id !== input.cashShift.id ||
      shift.status !== CashShiftStatus.open ||
      shift.userId !== input.user.id ||
      shift.branchId !== input.currentBranch.id ||
      ("tenantId" in shift && shift.tenantId !== input.currentBranch.tenantId) ||
      input.user.tenantId !== input.currentBranch.tenantId
    ) {
      throw new Error("No hay un turno de caja abierto y vigente para esta sucursal.");
    }
    return shift;
  }

  private async validateOptionalReferences(input: AuthorizedConfirmPosSaleInput) {
    if (input.customerId) {
      const customer = await this.repositories.customers.getById(input.customerId);
      if (!customer || customer.tenantId !== input.currentBranch.tenantId) {
        throw new Error("El cliente seleccionado ya no está disponible.");
      }
    }
    if (input.sourceOrderId) {
      const order = await this.repositories.orders.getById(input.sourceOrderId);
      if (
        !order ||
        order.tenantId !== input.currentBranch.tenantId ||
        order.branchId !== input.currentBranch.id
      ) {
        throw new Error("El pedido de origen ya no es válido para esta sucursal.");
      }
    }
  }

  private async validateAndBuildItems(
    input: AuthorizedConfirmPosSaleInput,
  ): Promise<ValidatedSaleItem[]> {
    const availableProducts = await this.repositories.products.getAvailableForPos();
    const productsById = new Map(
      availableProducts
        .filter((product) => product.tenantId === input.currentBranch.tenantId)
        .map((product) => [product.id, product]),
    );
    const locations = await this.repositories.inventory.getLocations(input.currentBranch.id);
    const at = new Date().toISOString();
    const seenProductIds = new Set<string>();

    return Promise.all(
      input.ticket.items.map(async (ticketItem): Promise<ValidatedSaleItem> => {
        validateTicketItem(ticketItem, seenProductIds);
        const product = productsById.get(ticketItem.productId);
        if (!product) {
          throw new Error(`${ticketItem.name} ya no está disponible para venta en POS.`);
        }
        if (product.sku !== ticketItem.sku || product.name !== ticketItem.name) {
          throw new Error(`Los datos de ${ticketItem.name} cambiaron; actualiza el ticket.`);
        }
        if (
          product.productType !== ProductType.kit &&
          product.tracking.stock !== ticketItem.tracksStock
        ) {
          throw new Error(
            `El control de inventario de ${product.name} cambió; actualiza el ticket.`,
          );
        }
        if (product.tracking.expiration && !product.tracking.lot) {
          throw new Error(`${product.name} requiere trazabilidad no soportada en Terminal.`);
        }

        const [promotion, salesPriceTiers] = await Promise.all([
          this.repositories.promotions.getApplicable({
            tenantId: input.currentBranch.tenantId,
            productId: product.id,
            at,
            channel: SalesChannel.pos,
            branchId: input.currentBranch.id,
          }),
          this.repositories.productSalesPriceTiers.getByProduct(product.id),
        ]);
        const quantityPrice = resolveQuantityPrice({
          basePrice: product.salePrice,
          quantity: ticketItem.quantity,
          tiers: salesPriceTiers.filter(
            (tier) =>
              tier.tenantId === input.currentBranch.tenantId && tier.productId === product.id,
          ),
        });
        const price = calculateEffectivePrice(quantityPrice, promotion);
        assertPriceSnapshot(ticketItem, price);
        const saleUnitId = product.saleUnitId ?? product.baseUnitId;
        const conversions = await this.repositories.units.getConversionsByProductScoped(
          input.currentBranch.tenantId,
          product.id,
        );
        const inventoryQuantity = toBaseQuantity(ticketItem.quantity, {
          sourceUnitId: saleUnitId,
          baseUnitId: product.baseUnitId,
          conversions,
          requireInteger: product.tracking.stock,
        });

        if (
          product.productType === ProductType.physical &&
          product.tracking.stock &&
          !input.sourceOrderId &&
          input.checkout.deliveryMethod === DeliveryMethod.immediate
        ) {
          const [balances, settings, lots, serials] = await Promise.all([
            this.repositories.inventory.getBalanceByProduct(product.id, input.currentBranch.id),
            this.repositories.inventory.getProductInventorySettings(
              product.id,
              input.currentBranch.id,
            ),
            product.tracking.lot
              ? this.repositories.inventory.getLots(product.id)
              : Promise.resolve([]),
            product.tracking.serial
              ? this.repositories.inventory.getSerialNumbers(product.id)
              : Promise.resolve([]),
          ]);
          const sellableBalances = product.tracking.lot
            ? balances.map((balance) => ({
                ...balance,
                quantity: Math.min(
                  balance.quantity,
                  lots
                    .filter(
                      (lot) =>
                        lot.tenantId === input.currentBranch.tenantId &&
                        lot.branchId === input.currentBranch.id &&
                        lot.productId === product.id &&
                        lot.locationId === balance.locationId &&
                        isStockLotEligible(
                          lot,
                          product.tracking.expiration,
                          new Date().toISOString(),
                        ),
                    )
                    .reduce(
                      (sum, lot) =>
                        sum +
                        (product.tracking.serial
                          ? Math.min(
                              lot.quantity,
                              serials.filter(
                                (serial) =>
                                  serial.lotId === lot.id && serial.status === "available",
                              ).length,
                            )
                          : lot.quantity),
                      0,
                    ),
                ),
              }))
            : product.tracking.serial
              ? balances.map((balance) => ({
                  ...balance,
                  quantity: Math.min(
                    balance.quantity,
                    serials.filter(
                      (serial) =>
                        serial.tenantId === input.currentBranch.tenantId &&
                        serial.branchId === input.currentBranch.id &&
                        serial.productId === product.id &&
                        serial.locationId === balance.locationId &&
                        serial.status === "available",
                    ).length,
                  ),
                }))
              : balances;
          const balancesWithAvailability = sellableBalances.filter(
            (balance) => getAvailableQuantity(balance) > 0,
          );
          const availableQuantity = getBranchAvailableQuantity({
            tenantId: input.currentBranch.tenantId,
            branchId: input.currentBranch.id,
            productId: product.id,
            balances: product.tracking.lot ? sellableBalances : balancesWithAvailability,
            locations,
          });
          if (availableQuantity < inventoryQuantity) {
            throw new Error(`El stock disponible de ${product.name} cambió; actualiza el ticket.`);
          }
          try {
            planInventoryAllocation({
              tenantId: input.currentBranch.tenantId,
              branchId: input.currentBranch.id,
              productId: product.id,
              quantity: inventoryQuantity,
              balances: sellableBalances,
              locations,
              preferredLocationId: settings?.defaultLocationId,
            });
          } catch {
            throw new Error(`El stock de ${product.name} no puede asignarse completamente.`);
          }
        }

        const quantity = ticketItem.quantity;
        const baseSubtotalCents = multiplyMoney(price.basePrice, quantity);
        const discountTotalCents = multiplyMoney(price.discountAmount, quantity);
        const totalCents = multiplyMoney(price.effectivePrice, quantity);
        return {
          productId: product.id,
          skuSnapshot: product.sku,
          nameSnapshot: product.name,
          quantity,
          inventoryQuantity,
          unitPrice: price.effectivePrice,
          discount: price.discountAmount,
          subtotal: fromCents(totalCents),
          baseSubtotalCents,
          discountTotalCents,
          totalCents,
        };
      }),
    );
  }

  private async validateAndBuildPayments(
    input: AuthorizedConfirmPosSaleInput,
  ): Promise<SaleConfirmationPaymentInput[]> {
    const payments = createPaymentInputs(input.checkout, input.currency, input.user.id);
    const transfer = payments.find((payment) => payment.method === PaymentMethod.transfer);
    if (!transfer) return payments;

    const bankAccount = await this.repositories.bankAccounts.getById(transfer.bankAccountId ?? "");
    if (
      !bankAccount ||
      bankAccount.tenantId !== input.currentBranch.tenantId ||
      bankAccount.status !== "active" ||
      bankAccount.currency !== input.currency ||
      !isBranchScopedResourceAvailable(bankAccount.branchIds, input.currentBranch.id)
    ) {
      throw new Error("La cuenta bancaria ya no está activa para esta sucursal y moneda.");
    }
    return payments;
  }
}

function toSaleConfirmationDto(result: ConfirmSaleResult): PosSaleConfirmationDto {
  return {
    sale: {
      id: result.sale.id,
      number: result.sale.number,
      total: result.sale.total,
      sourceOrderId: result.sale.sourceOrderId,
    },
    payments: result.payments.map((payment) => ({ currency: payment.currency })),
    inventoryMovements: result.inventoryMovements,
    order: result.order,
    pickingOrder: result.pickingOrder,
    idempotent: result.idempotent,
  };
}

function validateTicketItem(item: SaleTicketItemDto, seenProductIds: Set<string>) {
  if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
    throw new Error(`La cantidad de ${item.name} no es válida.`);
  }
  if (item.requiresUnsupportedTraceability) {
    throw new Error(`${item.name} requiere trazabilidad no soportada en Terminal.`);
  }
  if (seenProductIds.has(item.productId)) {
    throw new Error(`El producto ${item.name} está duplicado en el ticket.`);
  }
  seenProductIds.add(item.productId);
}

function assertPriceSnapshot(
  item: SaleTicketItemDto,
  price: ReturnType<typeof calculateEffectivePrice>,
) {
  if (
    toCents(item.baseUnitPrice) !== toCents(price.basePrice) ||
    toCents(item.unitPrice) !== toCents(price.effectivePrice) ||
    toCents(item.discount) !== toCents(price.discountAmount) ||
    toCents(item.subtotal) !== multiplyMoney(price.effectivePrice, item.quantity)
  ) {
    throw new Error(`El precio o promoción de ${item.name} cambió; actualiza el ticket.`);
  }
}

function calculateValidatedTotals(items: ValidatedSaleItem[]) {
  const subtotalCents = items.reduce((total, item) => total + item.baseSubtotalCents, 0);
  const discountTotalCents = items.reduce((total, item) => total + item.discountTotalCents, 0);
  const totalCents = items.reduce((total, item) => total + item.totalCents, 0);
  if (subtotalCents - discountTotalCents !== totalCents) {
    throw new Error("Los totales recalculados de la venta no son consistentes.");
  }
  return { subtotalCents, discountTotalCents, totalCents };
}

function assertTicketTotals(
  ticket: SaleTicketDto,
  totals: ReturnType<typeof calculateValidatedTotals>,
) {
  if (
    toCents(ticket.subtotal) !== totals.subtotalCents ||
    toCents(ticket.discountTotal) !== totals.discountTotalCents ||
    toCents(ticket.total) !== totals.totalCents
  ) {
    throw new Error("Los totales del ticket cambiaron; actualiza el ticket antes de confirmar.");
  }
}

function createDocumentSnapshot(checkout: CheckoutDto): SaleDocumentSnapshot {
  if (checkout.documentType === "ticket") return { type: "ticket" };

  const taxId = checkout.invoiceData.taxId.trim();
  const legalName = checkout.invoiceData.legalName.trim();
  const fiscalAddress = checkout.invoiceData.fiscalAddress.trim();
  if (!taxId || !legalName || !fiscalAddress) {
    throw new Error("La factura requiere NIT, nombre o razón social y dirección fiscal.");
  }
  return { type: "invoice", taxId, legalName, fiscalAddress };
}

function createPaymentInputs(
  checkout: CheckoutDto,
  currency: CurrencyCode,
  cashierUserId: string,
): SaleConfirmationPaymentInput[] {
  const components = getPaymentComponents(checkout.paymentMode);

  return components.flatMap<SaleConfirmationPaymentInput>((method) => {
    const amount = getPaymentAmount(checkout, method);
    if (toCents(amount) <= 0) return [];
    const normalizedAmount = fromCents(toCents(amount));
    if (method === PaymentMethod.cash) {
      return [{ method, amount: normalizedAmount, currency }];
    }
    if (method === PaymentMethod.card) {
      const reference = getApprovedCardTerminalReference(
        checkout.cardTerminalResult,
        normalizedAmount,
      );
      return [
        {
          method,
          amount: normalizedAmount,
          currency,
          status: PaymentStatus.approved,
          reference,
        },
      ];
    }
    if (!checkout.transferExternallyVerified) {
      throw new Error("Debes confirmar que verificaste externamente la transferencia.");
    }
    return [
      {
        method,
        amount: normalizedAmount,
        currency,
        bankAccountId: checkout.bankAccountId,
        reference: checkout.transferReference.trim(),
        manualVerification: {
          externallyVerified: true,
          verifiedByUserId: cashierUserId,
        },
      },
    ];
  });
}

function getPaymentComponents(
  paymentMode: CheckoutDto["paymentMode"],
): SaleConfirmationPaymentMethod[] {
  switch (paymentMode) {
    case "cash":
      return [PaymentMethod.cash];
    case "card":
      return [PaymentMethod.card];
    case "transfer":
      return [PaymentMethod.transfer];
    case "mixed":
      return [PaymentMethod.cash, PaymentMethod.card, PaymentMethod.transfer];
    default:
      return assertNeverCheckoutPaymentMode(paymentMode);
  }
}

function assertNeverCheckoutPaymentMode(paymentMode: never): never {
  throw new Error(`Modalidad de pago POS no soportada: ${String(paymentMode)}`);
}

function getPaymentAmount(checkout: CheckoutDto, method: SaleConfirmationPaymentMethod) {
  if (method === PaymentMethod.cash) return checkout.cashAmount;
  if (method === PaymentMethod.card) return checkout.cardAmount;
  return checkout.transferAmount;
}

function assertAllowedPaymentMethods(
  payments: SaleConfirmationPaymentInput[],
  allowedMethods: PaymentMethod[],
) {
  payments.forEach((payment) => {
    if (!allowedMethods.includes(payment.method)) {
      throw new Error(`El método de pago ${payment.method} ya no está habilitado para POS.`);
    }
  });
}

function assertPaymentsMatchTotal(payments: SaleConfirmationPaymentInput[], totalCents: number) {
  if (payments.length === 0) throw new Error("La venta debe tener al menos un pago.");
  const paidCents = payments.reduce((total, payment) => total + toCents(payment.amount), 0);
  if (paidCents !== totalCents) {
    throw new Error("La suma de pagos no coincide con el total de la venta.");
  }
}

function multiplyMoney(unitAmount: number, quantity: number) {
  return Math.round(toCents(unitAmount) * quantity);
}

function toCents(value: number) {
  if (!Number.isFinite(value)) throw new Error("Se encontró un importe monetario inválido.");
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(value: number) {
  return value / 100;
}
