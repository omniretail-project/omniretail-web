import { z } from "zod";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const uuid = z.string().refine(isApiUuid, { message: "UUID de backend invalido." });
const instant = z.iso.datetime({ offset: true });
const quantity = z.number().finite().nonnegative();
const positiveQuantity = z.number().finite().positive();
const transferStatus = z.enum(["preparing", "inTransit", "received", "cancelled"]);
const requestStatus = z.enum(["requested", "approved", "rejected", "cancelled"]);
const reason = z.enum([
  "replenishment",
  "demandCoverage",
  "urgentRequest",
  "inventoryBalancing",
  "other",
]);

const transferItem = z.object({
  id: uuid,
  productId: uuid,
  sourceRequestId: uuid.nullable(),
  requestedQuantity: quantity,
  dispatchedQuantity: quantity,
  receivedQuantity: quantity,
});

const transfer = z.object({
  id: uuid,
  number: z.string().min(1),
  sourceBranchId: uuid,
  destinationBranchId: uuid,
  status: transferStatus,
  reason,
  notes: z.string().nullable(),
  items: z.array(transferItem),
  preparedByUserId: uuid.nullable(),
  preparedAt: instant.nullable(),
  dispatchedByUserId: uuid.nullable(),
  dispatchedAt: instant.nullable(),
  receivedByUserId: uuid.nullable(),
  receivedAt: instant.nullable(),
  cancelledByUserId: uuid.nullable(),
  cancelledAt: instant.nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int().nullable(),
  createdAt: instant,
  updatedAt: instant,
});

const transferRequest = z.object({
  id: uuid,
  requestingBranchId: uuid,
  sourceBranchId: uuid,
  productId: uuid,
  requestedQuantity: positiveQuantity,
  reason,
  notes: z.string().nullable(),
  persistedStatus: requestStatus,
  effectiveStatus: z.enum([
    "requested",
    "approved",
    "rejected",
    "inTransit",
    "received",
    "cancelled",
  ]),
  requestedByUserId: uuid.nullable(),
  requestedAt: instant.nullable(),
  reviewedByUserId: uuid.nullable(),
  reviewedAt: instant.nullable(),
  reviewNotes: z.string().nullable(),
  transferId: uuid.nullable(),
  version: z.number().int().nullable(),
  createdAt: instant,
  updatedAt: instant,
});

const page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  });

export type ApiInventoryTransfer = z.infer<typeof transfer>;
export type ApiInventoryTransferRequest = z.infer<typeof transferRequest>;

export function parseApiInventoryTransfer(value: unknown): ApiInventoryTransfer {
  return parse(transfer, value, "traslado");
}

export function parseApiInventoryTransferPage(value: unknown) {
  return parse(page(transfer), value, "pagina de traslados");
}

export function parseApiInventoryTransferRequest(value: unknown): ApiInventoryTransferRequest {
  return parse(transferRequest, value, "solicitud de traslado");
}

export function parseApiInventoryTransferRequestPage(value: unknown) {
  return parse(page(transferRequest), value, "pagina de solicitudes de traslado");
}

function parse<TSchema extends z.ZodType>(schema: TSchema, value: unknown, resource: string) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new BackendRequestError(
    `El backend devolvio un ${resource} de inventario invalido.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
