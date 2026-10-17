import { z } from "zod";
import type { InventoryCountResult, InventoryCountSnapshot } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend invalido.",
});
const nullableUuidSchema = apiUuidSchema.nullable().optional();
const nullableTextSchema = z.string().nullable().optional();
// Un snapshot incompleto debe fallar; null o texto no representan una cantidad cero.
const numberSchema = z.number().finite();

const serialSchema = z.object({
  serialId: apiUuidSchema,
  serialNumber: z.string(),
  status: z.string(),
});

const snapshotLotSchema = z.object({
  lotId: apiUuidSchema,
  lotNumber: z.string(),
  expirationDate: nullableTextSchema,
  quantity: numberSchema,
  reservedQuantity: numberSchema,
  availableQuantity: numberSchema,
  serials: z.array(serialSchema).nullable().optional(),
});

const snapshotSchema = z.object({
  productId: apiUuidSchema,
  productName: z.string(),
  sku: z.string(),
  branchId: apiUuidSchema,
  branchName: nullableTextSchema,
  locationId: nullableUuidSchema,
  locationName: nullableTextSchema,
  quantity: numberSchema,
  reservedQuantity: numberSchema,
  availableQuantity: numberSchema,
  tracking: z.object({
    lot: z.boolean(),
    expiration: z.boolean(),
    serial: z.boolean(),
  }),
  lots: z.array(snapshotLotSchema).nullable().optional(),
  serials: z.array(serialSchema).nullable().optional(),
});

const resultLotSchema = z.object({
  lotId: nullableUuidSchema,
  lotNumber: nullableTextSchema,
  expirationDate: nullableTextSchema,
  quantityBefore: numberSchema,
  countedQuantity: numberSchema,
  delta: numberSchema,
  foundSerialNumbers: z.array(z.string()).nullable().optional(),
  missingSerialNumbers: z.array(z.string()).nullable().optional(),
  addedSerialNumbers: z.array(z.string()).nullable().optional(),
});

const resultSchema = z.object({
  countId: apiUuidSchema,
  createdAt: z.string(),
  productId: apiUuidSchema,
  productName: z.string(),
  sku: z.string(),
  branchId: apiUuidSchema,
  branchName: nullableTextSchema,
  locationId: nullableUuidSchema,
  locationName: nullableTextSchema,
  performedByUserId: nullableUuidSchema,
  performedByName: nullableTextSchema,
  quantityBefore: numberSchema,
  countedQuantity: numberSchema,
  quantityAfter: numberSchema,
  delta: numberSchema,
  lots: z.array(resultLotSchema).nullable().optional(),
  movementIds: z.array(apiUuidSchema).nullable().optional(),
});

export function parseApiCountSnapshot(value: unknown): InventoryCountSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("snapshot de conteo");
  const data = parsed.data;
  return {
    productId: data.productId,
    productName: data.productName,
    sku: data.sku,
    branchId: data.branchId,
    branchName: data.branchName ?? "",
    ...(data.locationId ? { locationId: data.locationId } : {}),
    locationName: data.locationName ?? "",
    quantity: data.quantity,
    reservedQuantity: data.reservedQuantity,
    availableQuantity: data.availableQuantity,
    tracking: data.tracking,
    lots: (data.lots ?? []).map((lot) => ({
      lotId: lot.lotId,
      lotNumber: lot.lotNumber,
      ...(lot.expirationDate ? { expirationDate: lot.expirationDate } : {}),
      quantity: lot.quantity,
      reservedQuantity: lot.reservedQuantity,
      availableQuantity: lot.availableQuantity,
      serials: lot.serials ?? [],
    })),
    serials: data.serials ?? [],
  };
}

export function parseApiCountResult(value: unknown): InventoryCountResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("resultado de conteo");
  const data = parsed.data;
  return {
    countId: data.countId,
    createdAt: data.createdAt,
    productId: data.productId,
    productName: data.productName,
    sku: data.sku,
    branchId: data.branchId,
    branchName: data.branchName ?? "",
    locationName: data.locationName ?? "",
    performedByName: data.performedByName ?? "",
    quantityBefore: data.quantityBefore,
    countedQuantity: data.countedQuantity,
    quantityAfter: data.quantityAfter,
    delta: data.delta,
    lots: (data.lots ?? []).map((lot) => ({
      ...(lot.lotId ? { lotId: lot.lotId } : {}),
      lotNumber: lot.lotNumber ?? "",
      ...(lot.expirationDate ? { expirationDate: lot.expirationDate } : {}),
      quantityBefore: lot.quantityBefore,
      countedQuantity: lot.countedQuantity,
      delta: lot.delta,
      foundSerialNumbers: lot.foundSerialNumbers ?? [],
      missingSerialNumbers: lot.missingSerialNumbers ?? [],
      addedSerialNumbers: lot.addedSerialNumbers ?? [],
    })),
    movementIds: data.movementIds ?? [],
  };
}

function invalidResponse(resource: string) {
  return new BackendRequestError(
    `El backend devolvio un ${resource} invalido.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
