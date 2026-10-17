import type { RegularizeLocationBalanceInput } from "@/core/repositories";
import type {
  RegularizationAttemptSummary,
  RegularizationErrorInfo,
} from "@/modules/inventory/application/dto/InventoryRegularizationDto";

/**
 * Intento de regularizacion cuyo resultado se desconoce (o que se envio y aun no respondio).
 *
 * Vive en sessionStorage de la pestana (con copia en memoria del modulo para navegar dentro de la
 * app incluso sin storage). Contiene unicamente la solicitud congelada y datos de presentacion:
 * nunca tokens ni credenciales (el JWT esta en una cookie HttpOnly). Es UX de recuperacion, no
 * autorizacion: el backend vuelve a validar tenant, permisos y sucursal en cada llamada y la clave
 * idempotente evita aplicar dos veces la misma regularizacion.
 */
export const PENDING_REGULARIZATION_STORAGE_KEY =
  "omniretail:inventory:location-regularization-pending:v1";
const STORAGE_KEY = PENDING_REGULARIZATION_STORAGE_KEY;
const STORAGE_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUANTITY = 999_999_999.999;
const FINGERPRINT_LENGTH = 64;
const REASON_MAX = 200;

export type PendingRegularizationFailure = Pick<RegularizationErrorInfo, "message" | "code" | "status">;

export interface PendingRegularization {
  tenantId: string;
  userId: string;
  savedAt: number;
  request: Readonly<RegularizeLocationBalanceInput>;
  summary: RegularizationAttemptSummary;
  /** null: se envio y el usuario salio antes de conocer cualquier respuesta. */
  failure: PendingRegularizationFailure | null;
}

let memoryCopy: PendingRegularization | null = null;

function isQuantity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_QUANTITY &&
    Number(value.toFixed(3)) === value
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

/** Valida estructura y rangos; devuelve una copia normalizada o null si esta corrupto/incompatible. */
export function parsePendingRegularization(raw: unknown): PendingRegularization | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== STORAGE_VERSION) return null;
  if (!isText(value.tenantId) || !value.tenantId || !isText(value.userId) || !value.userId) {
    return null;
  }
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) return null;
  const request = value.request as Record<string, unknown> | null;
  if (typeof request !== "object" || request === null) return null;
  if (
    !isUuid(request.branchId) ||
    !isUuid(request.productId) ||
    !isUuid(request.locationId) ||
    !isUuid(request.idempotencyKey)
  ) {
    return null;
  }
  if (
    !isText(request.reason) ||
    request.reason.length === 0 ||
    request.reason !== request.reason.trim() ||
    request.reason.length > REASON_MAX
  ) {
    return null;
  }
  if (
    !isQuantity(request.expectedSourceQuantity) ||
    !isQuantity(request.expectedSourceReservedQuantity) ||
    !isQuantity(request.expectedDestinationQuantity)
  ) {
    return null;
  }
  if (
    !isText(request.snapshotFingerprint) ||
    request.snapshotFingerprint.length !== FINGERPRINT_LENGTH
  ) {
    return null;
  }
  // Registros anteriores a la asignacion inicial no traen el modo: se interpretan como false una vez
  // validado el resto. Un valor que no sea booleano invalida el registro.
  if (request.assignDestination !== undefined && typeof request.assignDestination !== "boolean") {
    return null;
  }
  const assignDestination = request.assignDestination === true;
  const summary = value.summary as Record<string, unknown> | null;
  if (
    typeof summary !== "object" ||
    summary === null ||
    !isText(summary.productName) ||
    !isText(summary.sku) ||
    !isText(summary.locationName)
  ) {
    return null;
  }
  let failure: PendingRegularizationFailure | null = null;
  if (value.failure !== null && value.failure !== undefined) {
    const rawFailure = value.failure as Record<string, unknown>;
    if (typeof rawFailure !== "object" || !isText(rawFailure.message)) return null;
    failure = {
      message: rawFailure.message,
      ...(isText(rawFailure.code) ? { code: rawFailure.code } : {}),
      ...(typeof rawFailure.status === "number" ? { status: rawFailure.status } : {}),
    };
  }
  return {
    tenantId: value.tenantId,
    userId: value.userId,
    savedAt: value.savedAt,
    request: Object.freeze({
      branchId: request.branchId,
      productId: request.productId,
      locationId: request.locationId,
      idempotencyKey: request.idempotencyKey,
      reason: request.reason,
      expectedSourceQuantity: request.expectedSourceQuantity,
      expectedSourceReservedQuantity: request.expectedSourceReservedQuantity,
      expectedDestinationQuantity: request.expectedDestinationQuantity,
      snapshotFingerprint: request.snapshotFingerprint,
      assignDestination,
    }),
    summary: {
      productName: summary.productName,
      sku: summary.sku,
      locationName: summary.locationName,
    },
    failure,
  };
}

export function savePendingRegularization(input: Omit<PendingRegularization, "savedAt">): void {
  const pending: PendingRegularization = { ...input, savedAt: Date.now() };
  memoryCopy = pending;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, ...pending }),
    );
  } catch {
    // Sin storage queda la copia en memoria: sobrevive a la navegacion interna, no a una recarga.
  }
}

export function readPendingRegularization(): PendingRegularization | null {
  if (memoryCopy) return memoryCopy;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = parsePendingRegularization(JSON.parse(raw));
    if (!parsed) {
      // Corrupto o de otra version: no se restaura y se elimina.
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    memoryCopy = parsed;
    return parsed;
  } catch {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nada que limpiar.
    }
    return null;
  }
}

/**
 * Limpia el intento. Con `idempotencyKey` solo lo hace si el guardado corresponde a esa clave, para
 * que limpiar un registro viejo nunca borre el de un intento posterior.
 */
export function clearPendingRegularization(idempotencyKey?: string): void {
  if (idempotencyKey !== undefined) {
    const current = memoryCopy ?? readFromStorageWithoutCaching();
    if (current && current.request.idempotencyKey !== idempotencyKey) return;
  }
  memoryCopy = null;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada que limpiar.
  }
}

function readFromStorageWithoutCaching(): PendingRegularization | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? parsePendingRegularization(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Solo se recupera un intento del mismo negocio, del mismo usuario y de una sucursal autorizada. */
export function isPendingRegularizationValidFor(
  pending: PendingRegularization,
  scope: { tenantId: string; userId: string; branchIds: readonly string[] },
): boolean {
  return (
    pending.tenantId === scope.tenantId &&
    pending.userId === scope.userId &&
    scope.branchIds.includes(pending.request.branchId)
  );
}
