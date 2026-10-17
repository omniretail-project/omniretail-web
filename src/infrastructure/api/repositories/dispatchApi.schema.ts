import { z } from "zod";
import type {
  ConfirmDispatchApiCommand,
  ConfirmTransferDispatchApiCommand,
  DispatchQueueReadModel,
  DispatchResultReadModel,
  PreparedDispatchReadModel,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, { message: "UUID de backend invalido." });
const instantSchema = z.string().datetime({ offset: true });
const transportModeSchema = z.enum(["own_fleet", "third_party"]);
const operationIdSchema = z.string().trim().min(1).max(128);

const addressSchema = z.object({
  recipientName: z.string().nullable().optional().transform((value) => value ?? null),
  recipientPhone: z.string().nullable().optional().transform((value) => value ?? null),
  line1: z.string().nullable().optional().transform((value) => value ?? null),
  line2: z.string().nullable().optional().transform((value) => value ?? null),
  city: z.string().nullable().optional().transform((value) => value ?? null),
  stateOrDepartment: z.string().nullable().optional().transform((value) => value ?? null),
  postalCode: z.string().nullable().optional().transform((value) => value ?? null),
  country: z.string().nullable().optional().transform((value) => value ?? null),
  references: z.string().nullable().optional().transform((value) => value ?? null),
}).passthrough();

const notificationContactSchema = z.record(z.string(), z.unknown());

const queueItemSchema = z
  .object({
    orderId: apiUuidSchema.nullable(),
    orderReference: z.string().min(1).nullable(),
    createdAt: instantSchema,
    transportMode: transportModeSchema,
    packingId: apiUuidSchema,
    packingFinalizedAt: instantSchema,
    sourceType: z.enum(["order", "transfer"]),
    sourceId: apiUuidSchema,
    sourceReference: z.string().min(1),
  })
  .superRefine((item, context) => {
    if (item.sourceType === "order" && (!item.orderId || !item.orderReference)) {
      context.addIssue({ code: "custom", message: "La fuente order de Dispatch esta incompleta." });
    }
    if (item.sourceType === "transfer" && (item.orderId !== null || item.orderReference !== null)) {
      context.addIssue({ code: "custom", message: "La fuente transfer contiene datos de Order." });
    }
  });

const preparedDetailSchema = z.object({
  orderId: apiUuidSchema,
  orderReference: z.string().min(1),
  createdAt: instantSchema,
  orderStatus: z.literal("ready_for_dispatch"),
  recipientName: z.string().nullable(),
  recipientPhone: z.string().nullable(),
  deliveryAddress: addressSchema.nullable(),
  notificationContact: notificationContactSchema.nullable(),
  transportMode: transportModeSchema,
  pickingOrderId: apiUuidSchema,
  pickingStatus: z.literal("completed"),
  pickingCompletedAt: instantSchema,
  packingId: apiUuidSchema,
  packingStatus: z.literal("finalized"),
  packingFinalizedAt: instantSchema,
  packageCount: z.number().int().min(1),
  totalWeight: z.number().finite().positive(),
  labelCode: z.string().min(1),
});

const dispatchPackageSchema = z.object({
  id: apiUuidSchema,
  number: z.string().min(1),
  weight: z.number().finite().positive().nullable(),
  description: z.string().nullable(),
});

const dispatchResultSchema = z.object({
  orderId: apiUuidSchema.nullable(),
  orderStatus: z.enum(["dispatched", "delivered"]).nullable(),
  dispatchId: apiUuidSchema,
  dispatchStatus: z.enum(["dispatched", "delivered"]),
  transportMode: transportModeSchema,
  carrierName: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  dispatchedAt: instantSchema,
  packages: z.array(dispatchPackageSchema),
  idempotent: z.boolean(),
  sourceType: z.enum(["order", "transfer"]),
  sourceId: apiUuidSchema,
  sourceReference: z.string().min(1).nullable(),
  transferStatus: z.enum(["preparing", "inTransit", "received", "cancelled"]).nullable(),
}).superRefine((result, context) => {
  if (result.sourceType === "order" && (!result.orderId || !result.orderStatus || result.transferStatus !== null)) {
    context.addIssue({ code: "custom", message: "La respuesta order de Dispatch es incompatible." });
  }
  if (result.sourceType === "transfer" && (
    result.orderId !== null || result.orderStatus !== null || result.transferStatus === null
  )) {
    context.addIssue({ code: "custom", message: "La respuesta transfer de Dispatch es incompatible." });
  }
});

const packageCommandSchema = z.object({
  number: z.string().trim().min(1).max(80),
  weight: z.number().finite().positive().optional(),
  description: z.string().trim().min(1).max(500).optional(),
});

const confirmDispatchCommandSchema = z.object({
  operationId: operationIdSchema,
  carrierName: z.string().trim().min(1).max(200).optional(),
  trackingNumber: z.string().trim().min(1).max(200).optional(),
  packages: z.array(packageCommandSchema).optional(),
});

const confirmTransferDispatchCommandSchema = z.object({
  operationId: operationIdSchema,
});

export function parseApiDispatchQueue(value: unknown): DispatchQueueReadModel[] {
  return parseResponse(z.array(queueItemSchema), value, "cola") as DispatchQueueReadModel[];
}

export function parseApiPreparedDispatch(value: unknown): PreparedDispatchReadModel {
  return parseResponse(preparedDetailSchema, value, "detalle preparado") as PreparedDispatchReadModel;
}

export function parseApiDispatchResult(value: unknown): DispatchResultReadModel {
  return parseResponse(dispatchResultSchema, value, "resultado") as DispatchResultReadModel;
}

export function parseConfirmDispatchCommand(value: unknown): ConfirmDispatchApiCommand {
  return confirmDispatchCommandSchema.parse(value);
}

export function parseConfirmTransferDispatchCommand(value: unknown): ConfirmTransferDispatchApiCommand {
  return confirmTransferDispatchCommandSchema.parse(value);
}

function parseResponse<TSchema extends z.ZodType>(schema: TSchema, value: unknown, resource: string) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `Respuesta de Dispatch (${resource}) invalida:`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  throw new BackendRequestError(
    `El backend devolvio un ${resource} de Dispatch invalido.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
