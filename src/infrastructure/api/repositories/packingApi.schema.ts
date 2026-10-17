import { z } from "zod";
import type {
  FinalizePackingCommandResult,
  PackingCommandActionResult,
  PackingDetailReadModel,
  PackingQueueReadModel,
  PackingVersionedApiCommand,
  RegisterPackingLabelPrintApiCommand,
  SavePackingPreparationApiCommand,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, { message: "UUID de backend invalido." });
const nullableUuidSchema = apiUuidSchema.nullable();
const instantSchema = z.string().datetime({ offset: true });
const nullableInstantSchema = instantSchema.nullable();
const localDateSchema = z.iso.date();
const decimalSchema = z.number().finite();
const nonNegativeVersionSchema = z.number().int().nonnegative();
const operationIdSchema = z.string().trim().min(1).max(128);

const storePickupContactSchema = z.object({
  recipientName: z.string(),
  recipientPhone: z.string(),
});

const optionalSnapshotStringSchema = z.string().nullable().optional()
  .transform((value) => value ?? undefined);

const addressSchema = z.object({
  recipientName: z.string(),
  recipientPhone: optionalSnapshotStringSchema,
  line1: z.string(),
  line2: optionalSnapshotStringSchema,
  city: z.string(),
  stateOrDepartment: optionalSnapshotStringSchema,
  postalCode: optionalSnapshotStringSchema,
  country: z.string(),
  references: optionalSnapshotStringSchema,
});

const checklistSchema = z.object({
  packageProtectionChecked: z.boolean(),
  documentIncludedChecked: z.boolean(),
  recipientVerifiedChecked: z.boolean(),
});

const trackingSelectionSchema = z.object({
  locationId: nullableUuidSchema,
  lotId: nullableUuidSchema,
  lotNumber: z.string().nullable(),
  expirationDate: localDateSchema.nullable(),
  quantity: decimalSchema.nonnegative(),
  serialNumbers: z.array(z.string()),
});

const preparedContentSchema = z.object({
  productId: apiUuidSchema,
  sku: z.string(),
  name: z.string(),
  quantity: decimalSchema.nonnegative(),
  serialNumbers: z.array(z.string()),
  trackingSelections: z.array(trackingSelectionSchema),
});

const queueItemSchema = z
  .object({
    packingId: apiUuidSchema,
    orderId: nullableUuidSchema,
    orderReference: z.string().nullable(),
    customerName: z.string().nullable(),
    storePickupContact: storePickupContactSchema.nullable(),
    deliveryMethod: z.enum(["immediate", "store_pickup", "home_delivery"]).nullable(),
    sourceType: z.enum(["order", "transfer"]),
    sourceId: apiUuidSchema,
    status: z.enum(["in_progress", "finalized"]),
    version: nonNegativeVersionSchema,
    startedAt: instantSchema,
    updatedAt: instantSchema,
    sourceReference: z.string().min(1),
  })
  .superRefine((item, context) => {
    if (
      item.sourceType === "order" &&
      (!item.orderId || !item.orderReference || !item.customerName || !item.deliveryMethod)
    ) {
      context.addIssue({ code: "custom", message: "La fuente order de Packing esta incompleta." });
    }
    if (
      item.sourceType === "transfer" &&
      (item.orderId !== null || item.orderReference !== null || item.customerName !== null ||
        item.deliveryMethod !== null || item.storePickupContact !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "La fuente transfer de Packing contiene datos de Order.",
      });
    }
  });

const detailSchema = queueItemSchema.safeExtend({
  pickingOrderId: apiUuidSchema,
  orderStatus: z
    .enum([
      "pending",
      "confirmed",
      "preparing",
      "picking",
      "packing",
      "ready_for_pickup",
      "ready_for_dispatch",
      "dispatched",
      "delivered",
      "cancelled",
    ])
    .nullable(),
  deliveryAddress: addressSchema.nullable(),
  checklist: checklistSchema,
  totalWeight: decimalSchema.positive().nullable(),
  packageCount: z.number().int().min(1).nullable(),
  labelGenerationId: z.string().nullable(),
  labelCode: z.string().nullable(),
  labelGeneratedAt: nullableInstantSchema,
  labelPrintedAt: nullableInstantSchema,
  finalizedAt: nullableInstantSchema,
  preparedContents: z.array(preparedContentSchema),
});

const actionSchema = z.object({
  packing: detailSchema,
  idempotent: z.boolean(),
});

const finalizeSchema = actionSchema.extend({
  orderStatus: detailSchema.shape.orderStatus,
  transferStatus: z.enum(["preparing", "inTransit", "received", "cancelled"]).nullable(),
});

const versionedCommandSchema = z.object({
  expectedVersion: nonNegativeVersionSchema,
  operationId: operationIdSchema,
});

const weightSchema = decimalSchema
  .positive()
  .max(999_999_999.999)
  .refine(hasAtMostThreeDecimals, { message: "El peso admite maximo tres decimales." });

const savePreparationCommandSchema = versionedCommandSchema.extend({
  checklist: checklistSchema,
  totalWeight: weightSchema.optional(),
  packageCount: z.number().int().min(1).optional(),
});

const registerPrintCommandSchema = versionedCommandSchema.extend({
  labelGenerationId: z.string().trim().min(1).max(128),
});

export function parseApiPackingQueue(value: unknown): PackingQueueReadModel[] {
  return parseResponse(z.array(queueItemSchema), value, "cola") as unknown as PackingQueueReadModel[];
}

export function parseApiPackingDetail(value: unknown): PackingDetailReadModel {
  return parseResponse(detailSchema, value, "detalle") as unknown as PackingDetailReadModel;
}

export function parseApiPackingAction(value: unknown): PackingCommandActionResult {
  return parseResponse(actionSchema, value, "accion") as unknown as PackingCommandActionResult;
}

export function parseApiPackingFinalize(value: unknown): FinalizePackingCommandResult {
  return parseResponse(finalizeSchema, value, "finalizacion") as unknown as FinalizePackingCommandResult;
}

export function parsePackingVersionedCommand(value: unknown): PackingVersionedApiCommand {
  return parseRequest(versionedCommandSchema, value) as PackingVersionedApiCommand;
}

export function parseSavePackingPreparationCommand(
  value: unknown,
): SavePackingPreparationApiCommand {
  return parseRequest(savePreparationCommandSchema, value) as SavePackingPreparationApiCommand;
}

export function parseRegisterPackingLabelPrintCommand(
  value: unknown,
): RegisterPackingLabelPrintApiCommand {
  return parseRequest(registerPrintCommandSchema, value) as RegisterPackingLabelPrintApiCommand;
}

function parseResponse<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  resource: string,
) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `Respuesta de Packing (${resource}) invalida:`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  throw new BackendRequestError(
    `El backend devolvio un ${resource} de Packing invalido.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}

function parseRequest<TSchema extends z.ZodType>(schema: TSchema, value: unknown) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new BackendRequestError(
    "La operacion de Packing contiene datos invalidos.",
    400,
    "INVALID_PACKING_REQUEST",
    Object.fromEntries(
      parsed.error.issues.map((issue) => [issue.path.join(".") || "request", issue.message]),
    ),
  );
}

function hasAtMostThreeDecimals(value: number): boolean {
  return Math.abs(value * 1_000 - Math.round(value * 1_000)) < 1e-7;
}
