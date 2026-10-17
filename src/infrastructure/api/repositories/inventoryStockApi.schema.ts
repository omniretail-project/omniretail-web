import { z } from "zod";
import type {
  InventoryAlertPageResult,
  InventoryKitAvailability,
  InventoryStockBatchResult,
  OtherBranchAvailability,
  InventoryStockPageResult,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend invalido.",
});
const nullableUuidSchema = apiUuidSchema.nullable();
// BigDecimal del backend se serializa como JSON number. No usar coerce: null/"" no son cero.
const finiteNumberSchema = z.number().finite();
const inventoryStockStatusSchema = z.enum(["out_of_stock", "critical", "near_minimum", "normal"]);
const inventoryAlertStatusSchema = z.enum(["out_of_stock", "critical", "near_minimum"]);

// Producto fisico con stock propio. /inventory/alerts sigue siendo SOLO fisico: su schema parte de
// este y no admite nulls ni otros tipos.
const physicalStockItemSchema = z.object({
  productId: apiUuidSchema,
  branchId: apiUuidSchema,
  sku: z.string(),
  productName: z.string(),
  categoryId: apiUuidSchema,
  categoryName: z.string(),
  baseUnitId: apiUuidSchema,
  quantity: finiteNumberSchema,
  reservedQuantity: finiteNumberSchema,
  availableQuantity: finiteNumberSchema,
  minStock: finiteNumberSchema,
  reorderPoint: finiteNumberSchema.nullable(),
  defaultLocationId: nullableUuidSchema,
  defaultLocationName: z.string().nullable(),
  status: inventoryStockStatusSchema,
  suggestedReorder: finiteNumberSchema,
});

const inventoryAlertItemSchema = physicalStockItemSchema
  .omit({
    categoryId: true,
    categoryName: true,
    defaultLocationName: true,
  })
  .extend({ status: inventoryAlertStatusSchema });

const nullableNumberSchema = finiteNumberSchema.nullable();
const positiveFactorSchema = finiteNumberSchema.refine((value) => value > 0).nullable();
const physicalDisplayStatuses = ["NORMAL", "NEAR_MINIMUM", "CRITICAL", "OUT_OF_STOCK"] as const;
const kitDisplayStatuses = ["KIT_AVAILABLE", "KIT_UNAVAILABLE"] as const;
// status fisico (snake_case minuscula) -> displayStatus (MAYUSCULA): se valida con un mapping
// explicito, no comparando strings.
const physicalDisplayStatusByStatus = {
  normal: "NORMAL",
  near_minimum: "NEAR_MINIMUM",
  critical: "CRITICAL",
  out_of_stock: "OUT_OF_STOCK",
} as const;

// Read model mixto de GET /inventory/stock (physical, service, kit). Cada modo exige su forma exacta
// en superRefine para no aceptar un servicio con existencias ni un fisico sin ellas.
const inventoryStockItemSchema = z
  .object({
    productId: apiUuidSchema,
    branchId: apiUuidSchema,
    sku: z.string(),
    productName: z.string(),
    categoryId: apiUuidSchema,
    categoryName: z.string(),
    baseUnitId: apiUuidSchema,
    productType: z.enum(["physical", "service", "kit"]),
    inventoryMode: z.enum(["TRACKED", "NONE", "DERIVED_KIT"]),
    displayStatus: z.enum([...physicalDisplayStatuses, "NOT_CONTROLLED", ...kitDisplayStatuses]),
    quantity: nullableNumberSchema,
    reservedQuantity: nullableNumberSchema,
    availableQuantity: nullableNumberSchema,
    minStock: nullableNumberSchema,
    reorderPoint: nullableNumberSchema,
    defaultLocationId: nullableUuidSchema,
    defaultLocationName: z.string().nullable(),
    status: inventoryStockStatusSchema.nullable(),
    suggestedReorder: nullableNumberSchema,
    // Presentaciones (solo fisicos): ids UUID; factor positivo, o null si el dato historico no tiene
    // equivalencia (no se rechaza el producto por eso).
    inventoryUnitId: nullableUuidSchema.nullish(),
    saleUnitId: nullableUuidSchema.nullish(),
    inventoryToBaseFactor: positiveFactorSchema.nullish(),
    saleToBaseFactor: positiveFactorSchema.nullish(),
  })
  .superRefine((item, context) => {
    const fail = (message: string) => context.addIssue({ code: "custom", message });
    const noPropertyStock =
      item.inventoryUnitId == null &&
      item.saleUnitId == null &&
      item.inventoryToBaseFactor == null &&
      item.saleToBaseFactor == null &&
      item.quantity === null &&
      item.reservedQuantity === null &&
      item.minStock === null &&
      item.reorderPoint === null &&
      item.defaultLocationId === null &&
      item.defaultLocationName === null &&
      item.status === null &&
      item.suggestedReorder === null;

    if (item.inventoryMode === "TRACKED") {
      // reorderPoint y la ubicacion predeterminada SI pueden ser null en un fisico real.
      const complete =
        item.inventoryUnitId != null &&
        item.saleUnitId != null &&
        item.quantity !== null &&
        item.reservedQuantity !== null &&
        item.availableQuantity !== null &&
        item.minStock !== null &&
        item.suggestedReorder !== null &&
        item.status !== null;
      if (item.productType !== "physical" || !complete) fail("TRACKED exige un fisico con stock.");
      else if (
        item.status === null ||
        item.displayStatus !== physicalDisplayStatusByStatus[item.status]
      ) {
        fail("displayStatus no corresponde al estado fisico.");
      }
      return;
    }
    if (item.inventoryMode === "NONE") {
      if (
        item.productType !== "service" ||
        item.displayStatus !== "NOT_CONTROLLED" ||
        item.availableQuantity !== null ||
        !noPropertyStock
      ) {
        fail("NONE exige un servicio sin ninguna cantidad.");
      }
      return;
    }
    if (
      item.productType !== "kit" ||
      !(kitDisplayStatuses as readonly string[]).includes(item.displayStatus) ||
      item.availableQuantity === null ||
      !noPropertyStock
    ) {
      fail("DERIVED_KIT exige un kit con solo disponibilidad derivada.");
    }
  });

const pageMetadataSchema = {
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
};

const inventoryStockPageSchema = z.object({
  items: z.array(inventoryStockItemSchema),
  ...pageMetadataSchema,
  summary: z.object({
    activeProducts: z.number().int().nonnegative(),
    lowStock: z.number().int().nonnegative(),
    outOfStock: z.number().int().nonnegative(),
  }),
});

const inventoryAlertPageSchema = z.object({
  items: z.array(inventoryAlertItemSchema),
  ...pageMetadataSchema,
});

export function parseApiInventoryStockPage(value: unknown): InventoryStockPageResult {
  const parsed = inventoryStockPageSchema.safeParse(value);
  if (!parsed.success) {
    // Solo rutas y mensajes de Zod (nunca los valores recibidos), y unicamente fuera de produccion.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "Respuesta de /inventory/stock invalida:",
        parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      );
    }
    throw invalidResponse("stock");
  }
  return parsed.data as unknown as InventoryStockPageResult;
}

export function parseApiInventoryAlertPage(value: unknown): InventoryAlertPageResult {
  const parsed = inventoryAlertPageSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("alertas");
  return parsed.data as unknown as InventoryAlertPageResult;
}

// POST /inventory/stock/batch: solo fisicos con stock; nada nullable salvo reorderPoint.
const inventoryStockBatchSchema = z.object({
  branchId: apiUuidSchema,
  items: z.array(
    z.object({
      productId: apiUuidSchema,
      quantity: finiteNumberSchema,
      reservedQuantity: finiteNumberSchema,
      availableQuantity: finiteNumberSchema,
      minStock: finiteNumberSchema,
      reorderPoint: nullableNumberSchema,
      status: inventoryStockStatusSchema,
      suggestedReorder: finiteNumberSchema,
    }),
  ),
});

export function parseApiInventoryStockBatch(value: unknown): InventoryStockBatchResult {
  const parsed = inventoryStockBatchSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("stock por lote");
  return parsed.data;
}

// GET /inventory/balances: un balance por (producto, ubicacion); locationId null = balance sin
// ubicacion (concepto distinto de una cantidad numerica nula).
const inventoryBalancePageSchema = z.object({
  items: z.array(
    z.object({
      id: apiUuidSchema,
      tenantId: apiUuidSchema,
      branchId: apiUuidSchema,
      productId: apiUuidSchema,
      locationId: nullableUuidSchema.optional(),
      quantity: finiteNumberSchema,
      reservedQuantity: finiteNumberSchema,
      updatedAt: z.string().optional(),
    }),
  ),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export function parseApiInventoryBalancePage(value: unknown) {
  const parsed = inventoryBalancePageSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("balances");
  return parsed.data;
}

const inventoryKitAvailabilitySchema = z.object({
  kitProductId: apiUuidSchema,
  branchId: apiUuidSchema,
  availableKits: z.number().int().nonnegative(),
  components: z.array(
    z.object({
      componentProductId: apiUuidSchema,
      sku: z.string(),
      productName: z.string(),
      quantityPerKit: finiteNumberSchema.refine((value) => value > 0),
      availableQuantity: finiteNumberSchema.refine((value) => value >= 0),
      kitCapacity: z.number().int().nonnegative(),
      limiting: z.boolean(),
    }),
  ),
});

export function parseApiInventoryKitAvailability(value: unknown): InventoryKitAvailability {
  const parsed = inventoryKitAvailabilitySchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("disponibilidad de kit");
  return parsed.data;
}

const otherBranchAvailabilitySchema = z.array(
  z.object({
    branchId: apiUuidSchema,
    branchName: z.string(),
    availableQuantity: finiteNumberSchema,
  }),
);

/** Solo branchId, branchName y availableQuantity; nada de quantity/reserved inventados. */
export function parseApiOtherBranchesAvailability(value: unknown): OtherBranchAvailability[] {
  const parsed = otherBranchAvailabilitySchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("existencias por sucursal");
  return parsed.data.map((item) => ({
    branchId: item.branchId,
    branchName: item.branchName,
    availableQuantity: item.availableQuantity,
  }));
}

function invalidResponse(resource: string) {
  return new BackendRequestError(
    `El backend devolvio una pagina de ${resource} de inventario invalida.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
