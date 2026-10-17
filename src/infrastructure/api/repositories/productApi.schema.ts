import { z } from "zod";
import type { Product } from "@/core/entities";
import type { PaginatedResult } from "@/core/types/pagination.types";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isBackendManagedMediaUrl } from "@/infrastructure/api/mediaUrl";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend inválido.",
});
const nullableText = z.string().nullable();
const trackingSchema = z.object({
  stock: z.boolean(),
  lot: z.boolean(),
  expiration: z.boolean(),
  serial: z.boolean(),
});
const channelsSchema = z.object({
  ecommerce: z.boolean(),
  pos: z.boolean(),
  mobileApp: z.boolean(),
});
const productWriteSchema = z.object({
  sku: z.string().trim().min(1).max(50),
  barcode: z.string().max(50).nullable(),
  name: z.string().trim().min(1).max(300),
  description: z.string().nullable(),
  brand: z.string().max(100).nullable(),
  productType: z.enum(["physical", "service", "kit"]),
  categoryId: apiUuidSchema,
  baseUnitId: apiUuidSchema,
  inventoryUnitId: apiUuidSchema.nullable(),
  saleUnitId: apiUuidSchema.nullable(),
  tracking: trackingSchema,
  channels: channelsSchema,
});

export const productCreateRequestSchema = productWriteSchema.extend({
  salePrice: z.number().finite().nonnegative(),
  status: z.enum(["published", "archived"]),
});

export const productUpdateRequestSchema = productWriteSchema;

export const apiProductSchema = z.object({
  id: apiUuidSchema,
  tenantId: apiUuidSchema,
  sku: z.string(),
  barcode: nullableText,
  name: z.string(),
  description: nullableText,
  brand: nullableText,
  productType: z.enum(["physical", "service", "kit"]),
  categoryId: apiUuidSchema,
  baseUnitId: apiUuidSchema,
  inventoryUnitId: apiUuidSchema.nullable(),
  saleUnitId: apiUuidSchema.nullable(),
  salePrice: z.coerce.number().finite().nonnegative(),
  status: z.enum(["published", "archived"]),
  tracking: trackingSchema,
  channels: channelsSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

const primaryImageUrlSchema = z
  .string()
  .refine(
    (value) => isBackendManagedMediaUrl(value) || /^https?:\/\//i.test(value),
    { message: "URL de imagen principal inválida." },
  )
  .nullable();

export const apiProductListSchema = apiProductSchema.extend({
  primaryImageUrl: primaryImageUrlSchema,
});

const apiProductPageSchema = z.object({
  items: z.array(apiProductListSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export interface ApiProduct extends Omit<
  Product,
  "barcode" | "description" | "brand" | "inventoryUnitId" | "saleUnitId"
> {
  barcode: string | null;
  description: string | null;
  brand: string | null;
  inventoryUnitId: string | null;
  saleUnitId: string | null;
}

export interface ApiProductList extends ApiProduct {
  primaryImageUrl: string | null;
}

function invalidResponse(): BackendRequestError {
  return new BackendRequestError(
    "El backend devolvio una respuesta de producto invalida.",
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}

function invalidPayload(): BackendRequestError {
  return new BackendRequestError(
    "Los datos basicos del producto no son validos.",
    400,
    "INVALID_PRODUCT_PAYLOAD",
  );
}

export function parseApiProduct(value: unknown): ApiProduct {
  const parsed = apiProductSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data as unknown as ApiProduct;
}

export function parseApiProductPage(value: unknown): PaginatedResult<ApiProductList> {
  const parsed = apiProductPageSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data as unknown as PaginatedResult<ApiProductList>;
}

export function parseProductCreateRequest(value: unknown) {
  const parsed = productCreateRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidPayload();
  return parsed.data;
}

export function parseProductUpdateRequest(value: unknown) {
  const parsed = productUpdateRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidPayload();
  return parsed.data;
}
