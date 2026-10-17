import { z } from "zod";
import type { PickingDetailReadModel, PickingQueueReadModel } from "@/core/repositories";
import type {
  PickingCommandActionResult,
  PickingIncidentReadModel,
  PickingReadLine,
  PickingReleaseReadModel,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, { message: "UUID de backend invalido." });
const nullableUuidSchema = apiUuidSchema.nullable();
const instantSchema = z.string().datetime({ offset: true });
const localDateSchema = z.iso.date();
const decimalSchema = z.number().finite();
const nonNegativeDecimalSchema = decimalSchema.refine((value) => value >= 0);

const progressSchema = z.object({
  requiredQuantity: nonNegativeDecimalSchema,
  pickedQuantity: nonNegativeDecimalSchema,
  remainingQuantity: nonNegativeDecimalSchema,
  percentage: z.number().int().min(0).max(100),
});

const storePickupContactSchema = z.object({
  recipientName: z.string(),
  recipientPhone: z.string(),
});

const queueItemSchema = z
  .object({
    pickingOrderId: apiUuidSchema,
    orderId: nullableUuidSchema,
    orderReference: z.string().nullable(),
    customerName: z.string().nullable(),
    storePickupContact: storePickupContactSchema.nullable(),
    deliveryMethod: z.enum(["immediate", "store_pickup", "home_delivery"]).nullable(),
    branchId: apiUuidSchema,
    status: z.enum(["pending", "assigned", "in_progress", "completed", "cancelled"]),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    assignedUserId: nullableUuidSchema,
    progress: progressSchema,
    startedAt: instantSchema.nullable(),
    createdAt: instantSchema,
    updatedAt: instantSchema,
    sourceType: z.enum(["order", "transfer"]),
    sourceId: apiUuidSchema,
    sourceReference: z.string().min(1),
  })
  .superRefine((item, context) => {
    if (
      item.sourceType === "order" &&
      (!item.orderId || !item.orderReference || !item.deliveryMethod)
    ) {
      context.addIssue({ code: "custom", message: "La fuente order esta incompleta." });
    }
    if (
      item.sourceType === "transfer" &&
      (item.orderId !== null || item.orderReference !== null || item.deliveryMethod !== null)
    ) {
      context.addIssue({ code: "custom", message: "La fuente transfer contiene datos de Order." });
    }
  });

const inventoryLotSchema = z.object({
  lotId: apiUuidSchema,
  lotNumber: z.string(),
  expirationDate: localDateSchema.nullable(),
  physicalQuantity: nonNegativeDecimalSchema,
  serialNumbers: z.array(z.object({ id: apiUuidSchema, serialNumber: z.string() })),
});

const inventoryLocationSchema = z.object({
  balanceId: apiUuidSchema,
  locationId: nullableUuidSchema,
  locationCode: z.string().nullable(),
  locationName: z.string().nullable(),
  physicalQuantity: nonNegativeDecimalSchema,
  ownReservedQuantity: nonNegativeDecimalSchema,
  otherReservedQuantity: nonNegativeDecimalSchema,
  freeQuantity: nonNegativeDecimalSchema,
  usableQuantity: nonNegativeDecimalSchema,
  lots: z.array(inventoryLotSchema),
  serialNumbers: z.array(
    z.object({ id: apiUuidSchema, serialNumber: z.string(), lotId: nullableUuidSchema }),
  ),
});

const inventoryAvailabilitySchema = z.object({
  tenantId: apiUuidSchema,
  branchId: apiUuidSchema,
  pickingOrderId: apiUuidSchema,
  orderId: nullableUuidSchema,
  productId: apiUuidSchema,
  physicalQuantity: nonNegativeDecimalSchema,
  ownReservedQuantity: nonNegativeDecimalSchema,
  otherReservedQuantity: nonNegativeDecimalSchema,
  freeQuantity: nonNegativeDecimalSchema,
  usableQuantity: nonNegativeDecimalSchema,
  locations: z.array(inventoryLocationSchema),
});

const pickingLineSchema = z.object({
  pickingLineId: apiUuidSchema,
  orderItemId: nullableUuidSchema,
  productId: apiUuidSchema,
  sku: z.string(),
  name: z.string(),
  requiredQuantity: nonNegativeDecimalSchema,
  pickedQuantity: nonNegativeDecimalSchema,
  remainingQuantity: nonNegativeDecimalSchema,
  status: z.enum(["pending", "partial", "completed", "incident"]),
  location: z.object({ id: apiUuidSchema, code: z.string(), name: z.string() }).nullable(),
  lot: z.object({ id: apiUuidSchema, number: z.string() }).nullable(),
  serialNumbers: z.array(z.string()),
  availableLocations: z.array(
    z.object({
      id: nullableUuidSchema,
      code: z.string().nullable(),
      name: z.string().nullable(),
      ownReservedQuantity: nonNegativeDecimalSchema,
      usableQuantity: nonNegativeDecimalSchema,
    }),
  ),
  availableLots: z.array(
    z.object({
      id: apiUuidSchema,
      number: z.string(),
      expirationDate: localDateSchema.nullable(),
      physicalQuantity: nonNegativeDecimalSchema,
    }),
  ),
  availableSerialNumbers: z.array(z.string()),
  tracking: z.object({
    stock: z.boolean(),
    lot: z.boolean(),
    expiration: z.boolean(),
    serial: z.boolean(),
  }),
  inventory: inventoryAvailabilitySchema,
  sourceLineId: apiUuidSchema,
  trackingSelections: z.array(
    z.object({
      locationId: nullableUuidSchema,
      lotId: nullableUuidSchema,
      lotNumber: z.string().nullable(),
      expirationDate: localDateSchema.nullable(),
      quantity: nonNegativeDecimalSchema,
      serialNumbers: z.array(z.string()),
    }),
  ),
});

const incidentSchema = z.object({
  id: apiUuidSchema,
  pickingOrderId: apiUuidSchema,
  pickingLineId: nullableUuidSchema,
  type: z.enum([
    "missing",
    "damaged",
    "invalid_lot_serial",
    "quantity_difference",
    "location_empty",
  ]),
  quantityAffected: nonNegativeDecimalSchema.nullable(),
  comment: z.string(),
  status: z.enum(["open", "resolved"]),
  createdBy: apiUuidSchema,
  createdAt: instantSchema,
  resolvedBy: nullableUuidSchema,
  resolvedAt: instantSchema.nullable(),
});

const releaseSchema = z.object({
  id: apiUuidSchema,
  pickingOrderId: apiUuidSchema,
  actorUserId: apiUuidSchema,
  reason: z.string(),
  releasedAt: instantSchema,
});

const actionSchema = z.object({
  pickingOrderId: apiUuidSchema,
  orderId: nullableUuidSchema,
  status: z.enum(["pending", "assigned", "in_progress", "completed", "cancelled"]),
  assignedUserId: nullableUuidSchema,
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
  updatedAt: instantSchema,
  idempotent: z.boolean(),
  sourceType: z.enum(["order", "transfer"]),
  sourceId: apiUuidSchema,
  sourceReference: z.string().nullable(),
});

const detailSchema = queueItemSchema.safeExtend({
  completedAt: instantSchema.nullable(),
  lines: z.array(pickingLineSchema),
  incidents: z.array(incidentSchema),
  releases: z.array(releaseSchema),
});

export function parseApiPickingQueue(value: unknown): PickingQueueReadModel[] {
  return parse(z.array(queueItemSchema), value, "cola") as unknown as PickingQueueReadModel[];
}

export function parseApiPickingDetail(value: unknown): PickingDetailReadModel {
  return parse(detailSchema, value, "detalle") as unknown as PickingDetailReadModel;
}

export function parseApiPickingAction(value: unknown): PickingCommandActionResult {
  return parse(actionSchema, value, "accion") as unknown as PickingCommandActionResult;
}

export function parseApiPickingLine(value: unknown): PickingReadLine {
  return parse(pickingLineSchema, value, "linea") as unknown as PickingReadLine;
}

export function parseApiPickingIncident(value: unknown): PickingIncidentReadModel {
  return parse(incidentSchema, value, "incidencia") as unknown as PickingIncidentReadModel;
}

export function parseApiPickingRelease(value: unknown): PickingReleaseReadModel {
  return parse(releaseSchema, value, "liberacion") as unknown as PickingReleaseReadModel;
}

function parse<TSchema extends z.ZodType>(schema: TSchema, value: unknown, resource: string) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `Respuesta de Picking (${resource}) invalida:`,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  throw new BackendRequestError(
    `El backend devolvio un ${resource} de Picking invalido.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
