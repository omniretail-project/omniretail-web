import { z } from "zod";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend invalido.",
});
const nullableUuidSchema = apiUuidSchema.nullable();
const instantSchema = z.string().datetime({ offset: true });
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const finiteNumberSchema = z.coerce.number().finite();
const purchaseOrderMutationRequestSchema = z.object({
  branchId: apiUuidSchema,
  supplierId: apiUuidSchema,
  expectedDate: localDateSchema.nullable(),
  notes: z.string().max(1000).nullable(),
  items: z.array(
    z.object({
      productId: apiUuidSchema,
      quantity: z.number().finite().positive(),
      unitCost: z.number().finite().nonnegative(),
    }),
  ),
});
const purchaseOrderCancellationRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
const purchaseOrderStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "partially_received",
  "received",
  "cancelled",
]);

const purchaseOrderItemSchema = z.object({
  id: apiUuidSchema,
  supplierProductId: apiUuidSchema,
  productId: apiUuidSchema,
  productName: z.string(),
  productSku: z.string(),
  supplierSku: z.string().nullable(),
  quantity: finiteNumberSchema.nonnegative(),
  unitId: apiUuidSchema,
  unitSymbol: z.string(),
  purchaseToBaseFactor: finiteNumberSchema.positive(),
  unitCost: finiteNumberSchema.nonnegative(),
  suggestedUnitCost: finiteNumberSchema.nonnegative().nullable(),
  subtotal: finiteNumberSchema.nonnegative(),
});

const purchaseOrderSchema = z.object({
  id: apiUuidSchema,
  branchId: apiUuidSchema,
  number: z.string(),
  supplierId: apiUuidSchema,
  supplierName: z.string(),
  status: purchaseOrderStatusSchema,
  expectedDate: localDateSchema.nullable(),
  notes: z.string().nullable(),
  subtotal: finiteNumberSchema.nonnegative(),
  total: finiteNumberSchema.nonnegative(),
  createdByUserId: apiUuidSchema,
  approvedByUserId: nullableUuidSchema,
  approvedAt: instantSchema.nullable(),
  cancellationReason: z.string().nullable(),
  cancelledByUserId: nullableUuidSchema,
  cancelledAt: instantSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  items: z.array(purchaseOrderItemSchema),
});

const purchaseOrderPageSchema = z.object({
  items: z.array(purchaseOrderSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type ApiPurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export type ApiPurchaseOrderMutationRequest = z.infer<
  typeof purchaseOrderMutationRequestSchema
>;

export function parseApiPurchaseOrder(value: unknown): ApiPurchaseOrder {
  const parsed = purchaseOrderSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("orden de compra");
  return parsed.data;
}

export function parseApiPurchaseOrderPage(value: unknown) {
  const parsed = purchaseOrderPageSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("pagina de ordenes de compra");
  return parsed.data;
}

export function parsePurchaseOrderMutationRequest(
  value: unknown,
): ApiPurchaseOrderMutationRequest {
  const parsed = purchaseOrderMutationRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest("orden de compra");
  return parsed.data;
}

export function parsePurchaseOrderCancellationRequest(value: unknown) {
  const parsed = purchaseOrderCancellationRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest("cancelacion de orden de compra");
  return parsed.data;
}

function invalidResponse(resource: string) {
  return new BackendRequestError(
    `El backend devolvio una ${resource} invalida.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}

function invalidRequest(resource: string) {
  return new BackendRequestError(
    `Los datos de ${resource} no son validos.`,
    400,
    "INVALID_REQUEST",
  );
}
