import { z } from "zod";
import {
  CashMovementType,
  CashShiftStatus,
  DeliveryMethod,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SaleStatus,
  TransportMode,
} from "@/core/enums";
import type {
  PosApiCashMovement,
  PosApiCashShift,
  PosApiCashShiftSummary,
  PosApiConfirmSaleCommand,
  PosApiReturnEligibility,
  PosApiReversalEffect,
  PosApiSaleConfirmation,
  PosApiSaleDetail,
  PosApiSalesHistoryPage,
  PosApiVoidResult,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const uuidSchema = z.string().refine(isApiUuid, { message: "UUID de backend invalido." });
const dateSchema = z.iso.datetime({ offset: true });
const moneySchema = z.coerce.number();
const optionalUuidSchema = uuidSchema.nullable().transform((value) => value ?? undefined);
const optionalTextSchema = z
  .string()
  .nullable()
  .transform((value) => value ?? undefined);
const optionalDateSchema = dateSchema.nullable().transform((value) => value ?? undefined);
const optionalMoneySchema = moneySchema.nullable().transform((value) => value ?? undefined);

const cashShiftSchema = z.object({
  id: uuidSchema,
  branchId: uuidSchema,
  userId: uuidSchema,
  registerCode: z.string(),
  status: z.enum(CashShiftStatus),
  openedAt: dateSchema,
  openingAmount: moneySchema,
  closedAt: optionalDateSchema,
  expectedAmount: optionalMoneySchema,
  countedAmount: optionalMoneySchema,
  difference: optionalMoneySchema,
  createdAt: dateSchema,
  updatedAt: dateSchema,
});

const cashMovementSchema = z.object({
  id: uuidSchema,
  cashShiftId: uuidSchema,
  type: z.enum(CashMovementType),
  amount: moneySchema,
  reason: z.string(),
  referenceType: optionalTextSchema,
  referenceId: optionalUuidSchema,
  createdByUserId: uuidSchema,
  createdAt: dateSchema,
  saleNumber: optionalTextSchema,
});

const cashShiftSummarySchema = z.object({
  cashShiftId: uuidSchema,
  branchId: uuidSchema,
  cashierId: uuidSchema,
  registerCode: z.string(),
  status: z.enum(CashShiftStatus),
  openedAt: dateSchema,
  closedAt: optionalDateSchema,
  openingAmount: moneySchema,
  cashIn: moneySchema,
  cashOut: moneySchema,
  manualCashIn: moneySchema,
  manualCashOut: moneySchema,
  salesCashIn: moneySchema,
  voidCashOut: moneySchema,
  returnCashOut: moneySchema,
  expectedAmount: moneySchema,
  countedAmount: optionalMoneySchema,
  difference: optionalMoneySchema,
});

const trackingDetailSchema = z.object({
  productId: uuidSchema,
  locationId: uuidSchema,
  lotId: optionalUuidSchema,
  lotNumber: optionalTextSchema,
  quantity: moneySchema,
  serialNumbers: z.array(z.string()),
});

const saleItemSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  promotionId: optionalUuidSchema,
  sku: z.string(),
  name: z.string(),
  quantity: moneySchema,
  unitPrice: moneySchema,
  discount: moneySchema,
  subtotal: moneySchema,
  trackingDetails: z.array(trackingDetailSchema),
});

const paymentSchema = z.object({
  id: uuidSchema,
  saleId: optionalUuidSchema,
  orderId: optionalUuidSchema,
  method: z.enum([PaymentMethod.cash, PaymentMethod.card, PaymentMethod.transfer]),
  amount: moneySchema,
  reference: optionalTextSchema,
  status: z.enum(PaymentStatus),
  currency: z.enum(["GTQ", "USD"]),
  bankAccountId: optionalUuidSchema,
  externallyVerified: z
    .boolean()
    .nullable()
    .transform((value) => value ?? undefined),
  verifiedByUserId: optionalUuidSchema,
  verifiedAt: optionalDateSchema,
});

const saleDocumentSchema = z.object({
  type: z.enum(["ticket", "invoice"]),
  taxId: optionalTextSchema,
  legalName: optionalTextSchema,
  fiscalAddress: optionalTextSchema,
});

const saleSummarySchema = z.object({
  id: uuidSchema,
  number: z.string(),
  branchId: uuidSchema,
  cashShiftId: uuidSchema,
  subtotal: moneySchema,
  discountTotal: moneySchema,
  taxTotal: moneySchema,
  total: moneySchema,
  createdAt: dateSchema,
  status: z.enum(SaleStatus),
  customerId: optionalUuidSchema,
  sourceOrderId: optionalUuidSchema,
  document: saleDocumentSchema,
});

const saleConfirmationSchema = saleSummarySchema.extend({
  items: z.array(saleItemSchema),
  payments: z.array(paymentSchema),
  // Tras un 201 la venta ya existe: solo se exigen los campos de efectos que el frontend usa, para
  // que un dato accesorio (p. ej. un timestamp aun no generado) no la presente como fallida.
  inventoryEffects: z.array(z.object({ id: uuidSchema })),
  cashMovement: z
    .object({ id: uuidSchema, cashShiftId: uuidSchema, amount: moneySchema })
    .nullable()
    .transform((value) => value ?? undefined),
  order: z
    .object({ id: uuidSchema, orderNumber: z.string() })
    .loose()
    .nullable()
    .transform((value) => value ?? undefined),
  pickingOrder: z
    .object({ id: uuidSchema, orderId: uuidSchema })
    .loose()
    .nullable()
    .transform((value) => value ?? undefined),
  idempotent: z.boolean(),
});

const saleDetailSchema = z.object({
  sale: saleSummarySchema,
  items: z.array(saleItemSchema),
  payments: z.array(paymentSchema),
});

const salesHistoryPageSchema = z.object({
  items: z.array(
    z.object({
      saleId: uuidSchema,
      saleNumber: z.string(),
      createdAt: dateSchema,
      customerDisplayName: z.string(),
      total: moneySchema,
      status: z.enum(SaleStatus),
      sourceOrderId: optionalUuidSchema,
      deliveryMethod: z.enum(DeliveryMethod).nullable().transform((value) => value ?? undefined),
      operationalStatus: z
        .enum(OrderStatus)
        .nullable()
        .transform((value) => value ?? undefined),
    }),
  ),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    partiallyReturned: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
  }),
});

const traceOptionSchema = z.object({
  productId: uuidSchema,
  locationId: uuidSchema,
  lotId: optionalUuidSchema,
  lotNumber: optionalTextSchema,
  returnableQuantity: moneySchema,
  serialNumbers: z.array(z.string()),
});

const returnEligibilitySchema = z.object({
  sale: z.object({
    id: uuidSchema,
    documentNumber: z.string(),
    createdAt: dateSchema,
    customerDisplayName: z.string(),
    total: moneySchema,
    status: z.enum(SaleStatus),
  }),
  items: z.array(
    z.object({
      saleItemId: uuidSchema,
      productId: uuidSchema,
      sku: z.string(),
      name: z.string(),
      soldQuantity: moneySchema,
      returnedQuantity: moneySchema,
      returnableQuantity: moneySchema,
      unitPrice: moneySchema,
      discount: moneySchema,
      subtotal: moneySchema,
      canReturn: z.boolean(),
      blockedReason: optionalTextSchema,
      traceOptions: z.array(traceOptionSchema),
    }),
  ),
  payments: z.array(
    z.object({
      id: uuidSchema,
      method: z.enum(PaymentMethod),
      status: z.enum(PaymentStatus),
      amount: moneySchema,
      currency: z.enum(["GTQ", "USD"]),
    }),
  ),
  previouslyReturnedAmount: moneySchema,
  cashRefundRecordedAmount: moneySchema,
  originalCashShiftOpen: z.boolean(),
  actorHasOpenCashShift: z.boolean(),
  allowedOperations: z.object({
    voidTotal: z.boolean(),
    partialReturn: z.boolean(),
    voidBlockedReason: optionalTextSchema,
    returnBlockedReason: optionalTextSchema,
  }),
});

const inventoryEffectSchema = z.object({
  inventoryRestored: z.boolean(),
  movementIds: z.array(uuidSchema),
  reservationsReleased: z.number().int().nonnegative().optional(),
});

const cashMovementEffectSchema = z.object({
  recorded: z.boolean(),
  movementIds: z.array(uuidSchema),
  amount: optionalMoneySchema,
});

const saleReturnSchema = z.object({
  id: uuidSchema,
  saleId: uuidSchema,
  branchId: uuidSchema,
  reason: z.string(),
  refundAmount: moneySchema,
  createdAt: dateSchema,
  lines: z.array(
    z.object({
      id: uuidSchema,
      saleItemId: uuidSchema,
      productId: uuidSchema,
      quantity: moneySchema,
      refundAmount: moneySchema,
      trackingDetails: z.array(trackingDetailSchema),
    }),
  ),
});

const returnOperationSchema = z.object({
  operationId: uuidSchema,
  idempotent: z.boolean(),
  reason: z.string(),
  saleStatus: z.enum(SaleStatus),
  saleReturn: saleReturnSchema,
  commercialRefundAmount: moneySchema,
  inventory: inventoryEffectSchema,
  cashMovement: cashMovementEffectSchema,
});

const voidOperationSchema = z.object({
  operationId: uuidSchema,
  idempotent: z.boolean(),
  reason: z.string(),
  sale: saleSummarySchema,
  inventory: inventoryEffectSchema,
  cashMovement: cashMovementEffectSchema,
});

const addressSchema = z.object({
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  stateOrDepartment: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().min(1),
  references: z.string().optional(),
});

const notificationSchema = z.discriminatedUnion("emailMode", [
  z.object({ emailMode: z.literal("send"), email: z.email() }),
  z.object({ emailMode: z.literal("not_applicable") }),
]);

const confirmSaleCommandSchema = z.object({
  branchId: uuidSchema,
  cashShiftId: uuidSchema,
  customerId: uuidSchema.optional(),
  taxTotal: z.literal(0),
  items: z
    .array(
      z.object({
        productId: uuidSchema,
        quantity: z.number().positive(),
        discount: z.number().nonnegative(),
        trackingSelections: z.tuple([]),
      }),
    )
    .min(1),
  payments: z
    .array(
      z.object({
        method: z.enum([PaymentMethod.cash, PaymentMethod.card, PaymentMethod.transfer]),
        amount: z.number().positive(),
        bankAccountId: uuidSchema.optional(),
        reference: z.string().optional(),
        externallyVerified: z.boolean().optional(),
      }),
    )
    .min(1),
  confirmationId: uuidSchema,
  document: z
    .object({
      type: z.enum(["ticket", "invoice"]),
      taxId: z.string().optional(),
      legalName: z.string().optional(),
      fiscalAddress: z.string().optional(),
    })
    .optional(),
  sourceOrderId: z.null(),
  deferredOrder: z
    .object({
      idempotencyKey: z.string().min(1),
      deliveryMethod: z.enum(DeliveryMethod),
      transportMode: z.enum(TransportMode),
      deliveryAddress: addressSchema.optional(),
      notificationContact: notificationSchema.optional(),
      storePickupContact: z
        .object({
          recipientName: z.string().trim().min(1).max(200),
          recipientPhone: z.string().trim().min(1).max(30),
        })
        .optional(),
    })
    .refine(
      (order) => order.deliveryMethod !== DeliveryMethod.store_pickup || order.storePickupContact,
      { message: "El retiro en tienda requiere storePickupContact.", path: ["storePickupContact"] },
    )
    .refine(
      (order) => order.deliveryMethod !== DeliveryMethod.home_delivery || order.deliveryAddress,
      { message: "La entrega a domicilio requiere deliveryAddress.", path: ["deliveryAddress"] },
    )
    .optional(),
});

const openCashShiftCommandSchema = z.object({
  branchId: uuidSchema,
  registerCode: z.string().trim().min(1).max(50),
  openingAmount: z.number().nonnegative(),
});
const closeCashShiftCommandSchema = z.object({
  cashShiftId: uuidSchema,
  countedAmount: z.number().nonnegative(),
});
const cashMovementCommandSchema = z.object({
  cashShiftId: uuidSchema,
  type: z.enum(CashMovementType),
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(500),
});
const returnCommandSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  lines: z
    .array(
      z.object({
        saleItemId: uuidSchema,
        quantity: z.number().positive(),
        trackingSelections: z.tuple([]),
      }),
    )
    .min(1),
});
const voidCommandSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

function parse<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Solo ruta y motivo de cada campo: nunca valores, que pueden incluir datos de clientes o pagos.
    const fields = Object.fromEntries(
      result.error.issues.map((issue) => [issue.path.join(".") || "response", issue.message]),
    );
    console.error(`[POS API] ${message}`, fields);
    throw new BackendRequestError(message, 502, "INVALID_BACKEND_RESPONSE", fields);
  }
  return result.data;
}

function parseRequest<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new BackendRequestError(
    message,
    400,
    "INVALID_POS_REQUEST",
    Object.fromEntries(
      result.error.issues.map((issue) => [issue.path.join(".") || "request", issue.message]),
    ),
  );
}

export const parsePosCashShift = (value: unknown): PosApiCashShift =>
  parse(cashShiftSchema, value, "El backend devolvio un turno de caja invalido.");
export const parsePosCashShiftSummary = (value: unknown): PosApiCashShiftSummary =>
  parse(cashShiftSummarySchema, value, "El backend devolvio un resumen de caja invalido.");
export const parsePosCashMovements = (value: unknown): PosApiCashMovement[] =>
  parse(z.array(cashMovementSchema), value, "El backend devolvio movimientos de caja invalidos.");
export const parsePosCashMovement = (value: unknown): PosApiCashMovement =>
  parse(cashMovementSchema, value, "El backend devolvio un movimiento de caja invalido.");

export function parsePosSaleConfirmation(value: unknown): PosApiSaleConfirmation {
  const parsed = parse(
    saleConfirmationSchema,
    value,
    "El backend devolvio una confirmacion de venta invalida.",
  );
  return {
    ...parsed,
    inventoryEffects: parsed.inventoryEffects.map(({ id }) => ({ id })),
  };
}

export const parsePosSalesHistoryPage = (value: unknown): PosApiSalesHistoryPage =>
  parse(
    salesHistoryPageSchema,
    value,
    "El backend devolvio un historial de ventas invalido.",
  );

export const parsePosSaleDetail = (value: unknown): PosApiSaleDetail =>
  parse(saleDetailSchema, value, "El backend devolvio un detalle de venta invalido.");

export const parsePosReturnEligibility = (value: unknown): PosApiReturnEligibility =>
  parse(
    returnEligibilitySchema,
    value,
    "El backend devolvio una elegibilidad de devolucion invalida.",
  );

export function parsePosReturnOperation(value: unknown): PosApiReversalEffect {
  const parsed = parse(
    returnOperationSchema,
    value,
    "El backend devolvio una devolucion invalida.",
  );
  return parsed;
}

export function parsePosVoidOperation(value: unknown): PosApiVoidResult {
  const parsed = parse(voidOperationSchema, value, "El backend devolvio una anulacion invalida.");
  return {
    operationId: parsed.operationId,
    idempotent: parsed.idempotent,
    reason: parsed.reason,
    inventory: parsed.inventory,
    cashMovement: parsed.cashMovement,
    sale: {
      id: parsed.sale.id,
      number: parsed.sale.number,
      status: parsed.sale.status,
      total: parsed.sale.total,
    },
  };
}

export const parseConfirmSaleCommand = (
  value: PosApiConfirmSaleCommand,
): PosApiConfirmSaleCommand =>
  parseRequest(
    confirmSaleCommandSchema,
    value,
    "La confirmacion de venta contiene datos invalidos.",
  ) as PosApiConfirmSaleCommand;
export const parseOpenCashShiftCommand = (value: unknown) =>
  parseRequest(openCashShiftCommandSchema, value, "La apertura de caja contiene datos invalidos.");
export const parseCloseCashShiftCommand = (value: unknown) =>
  parseRequest(closeCashShiftCommandSchema, value, "El cierre de caja contiene datos invalidos.");
export const parseCashMovementCommand = (value: unknown) =>
  parseRequest(cashMovementCommandSchema, value, "El movimiento de caja contiene datos invalidos.");
export const parseReturnCommand = (value: unknown) =>
  parseRequest(returnCommandSchema, value, "La devolucion contiene datos invalidos.");
export const parseVoidCommand = (value: unknown) =>
  parseRequest(voidCommandSchema, value, "La anulacion contiene datos invalidos.");
