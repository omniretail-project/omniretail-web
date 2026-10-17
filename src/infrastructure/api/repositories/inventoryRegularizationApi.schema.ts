import { z } from "zod";
import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationOptions,
  LocationRegularizationResult,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

/**
 * Contrato de /inventory/location-regularizations (LegacyBalanceRegularizationPreviewResponse y
 * LegacyBalanceRegularizationResultResponse del backend). Todo el aislamiento del contrato vive aqui:
 * si el backend cambia nombres o tipos, solo se corrige este archivo y el repositorio API.
 */

const apiUuidSchema = z.string().refine(isApiUuid, { message: "UUID de backend invalido." });
const MAX_DECIMALS = 3;
const DECIMAL_TEXT = /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/** Cantidad exacta con a lo sumo 3 decimales, o null si no es representable sin perder valor. */
export function parseBackendDecimal(value: unknown): number | null {
  let parsed: number;
  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && DECIMAL_TEXT.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(parsed)) return null;
  // Mas de 3 decimales (o un valor que no sobrevive a la representacion con 3): se rechaza, no se
  // redondea. toFixed es exacto para el rango del backend (9 enteros + 3 decimales).
  const rounded = Number(parsed.toFixed(MAX_DECIMALS));
  if (rounded !== parsed) return null;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** BigDecimal puede llegar como numero o como cadena segun la configuracion de Jackson. */
const quantitySchema = z.union([z.number(), z.string()]).transform((value, context) => {
  const parsed = parseBackendDecimal(value);
  if (parsed === null || parsed < 0) {
    context.addIssue({ code: "custom", message: "Cantidad invalida." });
    return z.NEVER;
  }
  return parsed;
});
const countSchema = z.number().int().nonnegative();

const blockerSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
});

const previewSchema = z.object({
  branchId: apiUuidSchema,
  productId: apiUuidSchema,
  productName: z.string(),
  sku: z.string(),
  locationId: apiUuidSchema,
  locationName: z.string(),
  eligible: z.boolean(),
  blockers: z.array(blockerSchema),
  sourceQuantity: quantitySchema,
  sourceReservedQuantity: quantitySchema,
  destinationQuantity: quantitySchema,
  destinationReservedQuantity: quantitySchema,
  resultingQuantity: quantitySchema,
  resultingReservedQuantity: quantitySchema,
  activeReservations: countSchema,
  emptyAllocationReservations: countSchema,
  lotBalances: countSchema,
  serials: countSchema,
  // SHA-256 en hexadecimal: el backend exige exactamente 64 caracteres.
  snapshotFingerprint: z.string().length(64),
  assignedLocationId: apiUuidSchema.nullable().optional(),
  assignmentRequired: z.boolean(),
  assignmentAllowed: z.boolean(),
});

const locationOptionSchema = z.object({
  id: apiUuidSchema,
  code: z.string(),
  name: z.string(),
  status: z.string().min(1),
});

const optionsSchema = z.object({
  branchId: apiUuidSchema,
  productId: apiUuidSchema,
  productName: z.string(),
  sku: z.string(),
  locationsEnabled: z.boolean(),
  assignedLocationId: apiUuidSchema.nullable().optional(),
  assignedLocation: locationOptionSchema.nullable().optional(),
  assignableLocations: z.array(locationOptionSchema),
});

const resultSchema = z.object({
  regularizationId: apiUuidSchema,
  idempotent: z.boolean(),
  createdAt: z.string().min(1),
  branchId: apiUuidSchema,
  productId: apiUuidSchema,
  fromLocationId: apiUuidSchema.nullable().optional(),
  toLocationId: apiUuidSchema,
  movedQuantity: quantitySchema,
  movedReservedQuantity: quantitySchema,
  destinationQuantityBefore: quantitySchema,
  destinationQuantityAfter: quantitySchema,
  destinationReservedQuantityAfter: quantitySchema,
  reservationsReassigned: countSchema,
  lotBalancesMerged: countSchema,
  serialsRelocated: countSchema,
  movementId: apiUuidSchema,
  assignmentApplied: z.boolean(),
  previousAssignedLocationId: apiUuidSchema.nullable().optional(),
});

export function parseApiLocationRegularizationOptions(
  value: unknown,
): LocationRegularizationOptions {
  const parsed = optionsSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("lista de ubicaciones de regularizacion");
  const { assignedLocationId, assignedLocation, ...data } = parsed.data;
  return {
    ...data,
    ...(assignedLocationId ? { assignedLocationId } : {}),
    ...(assignedLocation ? { assignedLocation } : {}),
  };
}

export function parseApiLocationRegularizationPreview(
  value: unknown,
): LegacyBalanceRegularizationPreview {
  const parsed = previewSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("vista previa de regularizacion");
  const { assignedLocationId, ...data } = parsed.data;
  return { ...data, ...(assignedLocationId ? { assignedLocationId } : {}) };
}

export function parseApiLocationRegularizationResult(value: unknown): LocationRegularizationResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("resultado de regularizacion");
  const { fromLocationId, previousAssignedLocationId, ...data } = parsed.data;
  return {
    ...data,
    ...(fromLocationId ? { fromLocationId } : {}),
    ...(previousAssignedLocationId ? { previousAssignedLocationId } : {}),
  };
}

/**
 * 502: ante un POST ya aplicado una respuesta ilegible no es un fallo definitivo. El llamador la
 * trata como resultado incierto y reintenta con la misma clave (el backend devuelve lo persistido).
 */
function invalidResponse(resource: string) {
  return new BackendRequestError(
    `El backend devolvio una ${resource} invalida.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
