import { z } from "zod";
import type {
  AdjustmentLotOption,
  AdjustmentSerialOption,
  SerialValidationResult,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend invalido.",
});
const nullableUuidSchema = apiUuidSchema.nullable().optional();
const finiteNumberSchema = z.number().finite();

const lotSchema = z.object({
  lotId: apiUuidSchema,
  lotNumber: z.string(),
  expirationDate: z.string().nullable().optional(),
  quantity: finiteNumberSchema,
  reservedQuantity: finiteNumberSchema,
  availableQuantity: finiteNumberSchema,
  locationId: nullableUuidSchema,
});

const serialSchema = z.object({
  serialId: apiUuidSchema,
  serialNumber: z.string(),
  lotId: nullableUuidSchema,
  branchId: nullableUuidSchema,
  locationId: nullableUuidSchema,
});

const serialValidationSchema = z.object({
  duplicates: z.array(z.string()),
  repeatedInRequest: z.array(z.string()),
});

/** Acepta tanto un arreglo directo como una pagina con `items`. */
function unwrapItems(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: unknown[] }).items;
  }
  return value;
}

export function parseApiAdjustmentLots(value: unknown): AdjustmentLotOption[] {
  const parsed = z.array(lotSchema).safeParse(unwrapItems(value));
  if (!parsed.success) throw invalidResponse("lotes");
  return parsed.data.map((lot) => ({
    lotId: lot.lotId,
    lotNumber: lot.lotNumber,
    ...(lot.expirationDate ? { expirationDate: lot.expirationDate } : {}),
    quantity: lot.quantity,
    reservedQuantity: lot.reservedQuantity,
    availableQuantity: lot.availableQuantity,
    ...(lot.locationId ? { locationId: lot.locationId } : {}),
  }));
}

export function parseApiAdjustmentSerials(value: unknown): AdjustmentSerialOption[] {
  const parsed = z.array(serialSchema).safeParse(unwrapItems(value));
  if (!parsed.success) throw invalidResponse("series");
  return parsed.data.map((serial) => ({
    serialId: serial.serialId,
    serialNumber: serial.serialNumber,
    ...(serial.lotId ? { lotId: serial.lotId } : {}),
    ...(serial.locationId ? { locationId: serial.locationId } : {}),
  }));
}

export function parseApiSerialValidationResult(value: unknown): SerialValidationResult {
  const parsed = serialValidationSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("validacion de series");
  return parsed.data;
}

function invalidResponse(resource: string) {
  return new BackendRequestError(
    `El backend devolvio una respuesta de ${resource} invalida.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
