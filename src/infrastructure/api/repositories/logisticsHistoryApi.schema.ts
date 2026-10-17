import { z } from "zod";
import { DispatchStatus } from "@/core/enums";
import type {
  LogisticsHistoryDetailReadModel,
  LogisticsHistoryRowReadModel,
} from "@/core/repositories";
import type { PaginatedResult } from "@/core/types/pagination.types";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const uuidSchema = z.string().refine(isApiUuid, { message: "UUID de backend invalido." });
const instantSchema = z.iso.datetime({ offset: true });
const nullable = <T extends z.ZodType>(schema: T) =>
  schema.nullable().optional().transform((value) => value ?? null);
// Sin coerción: `null` significa "sin información" y nunca debe convertirse en 0.
const quantitySchema = z.number();

export const logisticsHistoryDeliveryMethodSchema = z.enum([
  "immediate",
  "store_pickup",
  "home_delivery",
  "transfer",
]);

const rowSchema = z.object({
  sourceType: z.enum(["order", "transfer"]),
  sourceId: uuidSchema,
  orderId: nullable(uuidSchema),
  orderReference: z.string().min(1),
  deliveryMethod: logisticsHistoryDeliveryMethodSchema,
  operationalStatus: z.string().min(1),
  contactName: nullable(z.string()),
  contactPhone: nullable(z.string()),
  pickingOrderId: nullable(uuidSchema),
  packingId: nullable(uuidSchema),
  dispatchId: nullable(uuidSchema),
  storePickupDeliveryId: nullable(uuidSchema),
  pickingCompletedAt: nullable(instantSchema),
  packingFinalizedAt: nullable(instantSchema),
  dispatchedAt: nullable(instantSchema),
  deliveredAt: nullable(instantSchema),
  responsibleUserId: nullable(uuidSchema),
  responsibleUserName: nullable(z.string()),
  totalWeight: nullable(quantitySchema),
  packageCount: nullable(z.number().int().nonnegative()),
  dispatchStatus: nullable(z.enum(DispatchStatus)),
  carrierName: nullable(z.string()),
  trackingNumber: nullable(z.string()),
}) satisfies z.ZodType<LogisticsHistoryRowReadModel>;

const pageSchema = z.object({
  items: z.array(rowSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

const detailSchema = z.object({
  summary: rowSchema,
  lines: z.array(
    z.object({
      productId: uuidSchema,
      productName: z.string(),
      requestedQuantity: quantitySchema,
      pickedQuantity: quantitySchema,
      packedQuantity: nullable(quantitySchema),
      dispatchedQuantity: nullable(quantitySchema),
      trackingSelections: z.array(
        z.object({
          locationId: uuidSchema,
          lotId: nullable(uuidSchema),
          lotNumber: nullable(z.string()),
          expirationDate: nullable(z.iso.date()),
          quantity: quantitySchema,
          serialNumbers: nullable(z.array(z.string())).transform((value) => value ?? []),
        }),
      ),
    }),
  ),
  packages: nullable(
    z.array(
      z.object({
        id: uuidSchema,
        number: z.string(),
        weight: nullable(quantitySchema),
        description: nullable(z.string()),
      }),
    ),
  ).transform((value) => value ?? []),
}) satisfies z.ZodType<LogisticsHistoryDetailReadModel>;

export function parseLogisticsHistoryPage(
  value: unknown,
): PaginatedResult<LogisticsHistoryRowReadModel> {
  return parseResponse(pageSchema, value, "El backend devolvio un historial logistico invalido.");
}

export function parseLogisticsHistoryDetail(value: unknown): LogisticsHistoryDetailReadModel {
  return parseResponse(
    detailSchema,
    value,
    "El backend devolvio un detalle de historial logistico invalido.",
  );
}

function parseResponse<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  message: string,
): z.output<TSchema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Solo ruta y motivo de cada campo: nunca valores, que pueden incluir datos de contacto.
  const fields = Object.fromEntries(
    parsed.error.issues.map((issue) => [issue.path.join(".") || "response", issue.message]),
  );
  console.error(`[Logistics History API] ${message}`, fields);
  throw new BackendRequestError(message, 502, "INVALID_BACKEND_RESPONSE", fields);
}
