import { z } from "zod";
import type { InventoryMovementPageResult } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend invalido.",
});
const nullableUuidSchema = apiUuidSchema.nullable();
const nullableTextSchema = z.string().nullable();

const apiInventoryMovementSchema = z.object({
  id: apiUuidSchema,
  tenantId: apiUuidSchema,
  branchId: apiUuidSchema,
  branchName: nullableTextSchema,
  productId: apiUuidSchema,
  productName: nullableTextSchema,
  sku: nullableTextSchema,
  type: z.enum(["in", "out", "adjustment", "transfer"]),
  displayType: z.enum([
    "purchase_in",
    "sale",
    "return",
    "void",
    "dispatch",
    "in",
    "out",
    "transfer",
  ]),
  reason: z.string(),
  quantity: z.coerce.number().finite().nonnegative(),
  quantityBefore: z.coerce.number().finite().nullable(),
  quantityAfter: z.coerce.number().finite().nullable(),
  fromLocationId: nullableUuidSchema,
  fromLocationName: nullableTextSchema,
  toLocationId: nullableUuidSchema,
  toLocationName: nullableTextSchema,
  referenceType: nullableTextSchema,
  referenceId: nullableUuidSchema,
  referenceLabel: nullableTextSchema,
  performedByUserId: nullableUuidSchema,
  userLabel: nullableTextSchema,
  createdAt: z.string().datetime({ offset: true }),
});

const apiInventoryMovementPageSchema = z.object({
  items: z.array(apiInventoryMovementSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  summary: z.object({
    incoming: z.coerce.number().finite(),
    outgoing: z.coerce.number().finite(),
    net: z.coerce.number().finite(),
  }),
});

export function parseApiInventoryMovementPage(value: unknown): InventoryMovementPageResult {
  const parsed = apiInventoryMovementPageSchema.safeParse(value);
  if (!parsed.success) {
    throw new BackendRequestError(
      "El backend devolvio una pagina de movimientos invalida.",
      502,
      "INVALID_BACKEND_RESPONSE",
    );
  }
  return parsed.data as unknown as InventoryMovementPageResult;
}
