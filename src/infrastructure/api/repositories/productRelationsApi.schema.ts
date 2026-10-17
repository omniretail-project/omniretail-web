import { z } from "zod";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend inválido.",
});
const nullableUuidSchema = apiUuidSchema.nullable();
const isoDateSchema = z.string().datetime({ offset: true });
const nullableIsoDateSchema = isoDateSchema.nullable();
const finiteNumberSchema = z.coerce.number().finite();

export const apiUnitConversionSchema = z.object({
  id: apiUuidSchema,
  tenantId: apiUuidSchema,
  productId: nullableUuidSchema,
  fromUnitId: apiUuidSchema,
  toUnitId: apiUuidSchema,
  factor: finiteNumberSchema.positive(),
  createdAt: isoDateSchema,
});

export const apiSalesPriceTierSchema = z.object({
  id: apiUuidSchema,
  productId: apiUuidSchema,
  minQuantity: z.number().int().min(2),
  unitPrice: finiteNumberSchema.positive(),
  active: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const apiPriceHistorySchema = z.object({
  id: apiUuidSchema,
  productId: apiUuidSchema,
  oldPrice: finiteNumberSchema.nonnegative(),
  newPrice: finiteNumberSchema.nonnegative(),
  changedByUserId: nullableUuidSchema,
  reason: z.string().nullable(),
  createdAt: isoDateSchema,
});

export const apiPriceHistoryPageSchema = z.object({
  items: z.array(apiPriceHistorySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const apiAttributeDefinitionSchema = z.object({
  id: apiUuidSchema,
  code: z.string(),
  name: z.string(),
  dataType: z.enum(["TEXT", "NUMBER", "BOOLEAN"]),
  status: z.enum(["active", "archived"]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const apiAttributeDefinitionPageSchema = z.object({
  items: z.array(apiAttributeDefinitionSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const apiProductAttributeValueSchema = z.object({
  attributeId: apiUuidSchema,
  code: z.string(),
  name: z.string(),
  dataType: z.enum(["TEXT", "NUMBER", "BOOLEAN"]),
  status: z.enum(["active", "archived"]),
  value: z.string(),
});

const promotionBaseSchema = z.object({
  id: apiUuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  discountType: z.enum(["percentage", "fixed_discount", "fixed_price"]),
  discountValue: finiteNumberSchema.positive(),
  startsAt: isoDateSchema,
  endsAt: nullableIsoDateSchema,
  status: z.enum(["scheduled", "active", "ended", "cancelled"]),
  channels: z.array(z.enum(["pos", "ecommerce", "mobileApp"])),
  untilStockEnds: z.boolean(),
  branchIds: z.array(apiUuidSchema),
  createdByUserId: nullableUuidSchema,
  cancelledByUserId: nullableUuidSchema,
  cancelledAt: nullableIsoDateSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const apiPromotionSummarySchema = promotionBaseSchema;
export const apiPromotionSchema = promotionBaseSchema.extend({
  products: z.array(
    z.object({ id: apiUuidSchema, sku: z.string(), name: z.string() }),
  ),
});
export const apiPromotionPageSchema = z.object({
  items: z.array(apiPromotionSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const apiSupplierCostTierSchema = z.object({
  id: apiUuidSchema,
  supplierProductId: apiUuidSchema,
  minQuantity: finiteNumberSchema.positive(),
  unitCost: finiteNumberSchema.nonnegative(),
});
export const apiSupplierProductSchema = z.object({
  id: apiUuidSchema,
  tenantId: apiUuidSchema,
  supplierId: apiUuidSchema,
  productId: apiUuidSchema,
  supplierSku: z.string().nullable(),
  purchaseUnitId: apiUuidSchema,
  purchaseToBaseFactor: finiteNumberSchema.positive(),
  lastCost: finiteNumberSchema.nonnegative(),
  leadTimeDays: z.number().int().nonnegative(),
  minimumOrderQuantity: finiteNumberSchema.positive(),
  preferred: z.boolean(),
  active: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  costTiers: z.array(apiSupplierCostTierSchema),
});
export const apiSupplierProductListSchema = z.array(apiSupplierProductSchema);
export const apiSupplierProductPageSchema = z.object({
  items: z.array(apiSupplierProductSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const apiInventorySettingsSchema = z.object({
  id: apiUuidSchema,
  branchId: apiUuidSchema,
  productId: apiUuidSchema,
  minStock: finiteNumberSchema.nonnegative(),
  reorderPoint: finiteNumberSchema.nonnegative().nullable(),
  defaultLocationId: nullableUuidSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const apiKitComponentSchema = z.object({
  id: apiUuidSchema,
  componentProductId: apiUuidSchema,
  sku: z.string(),
  name: z.string(),
  quantityPerKit: finiteNumberSchema.positive(),
});

export type ApiUnitConversion = z.infer<typeof apiUnitConversionSchema>;
export type ApiSalesPriceTier = z.infer<typeof apiSalesPriceTierSchema>;
export type ApiPriceHistory = z.infer<typeof apiPriceHistorySchema>;
export type ApiAttributeDefinition = z.infer<typeof apiAttributeDefinitionSchema>;
export type ApiProductAttributeValue = z.infer<typeof apiProductAttributeValueSchema>;
export type ApiPromotion = z.infer<typeof apiPromotionSchema>;
export type ApiSupplierProduct = z.infer<typeof apiSupplierProductSchema>;
export type ApiSupplierCostTier = z.infer<typeof apiSupplierCostTierSchema>;
export type ApiInventorySettings = z.infer<typeof apiInventorySettingsSchema>;
export type ApiKitComponent = z.infer<typeof apiKitComponentSchema>;

export function parseApi<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BackendRequestError(message, 502, "INVALID_BACKEND_RESPONSE");
  }
  return parsed.data;
}
