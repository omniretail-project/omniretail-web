import type {
  GetCountSnapshotInput,
  InventoryCountResult,
  InventoryCountSnapshot,
  ReconcileCountInput,
  SerialValidationResult,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanCreateAdjustment,
  ensureTenantCanUseInventory,
  ensureUserCanOperateInventoryBranch,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";
import { resolveOperationalInventoryLocation } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import {
  REFERENCE_DATA_TTL_MS,
  getReferenceDataCache,
  referenceDataKeys,
} from "@/shared/utils/requestCache";

export type CountErrorKind = "stale" | "reserved" | "generic";

export interface CountErrorInfo {
  kind: CountErrorKind;
  message: string;
}

const COUNT_ERROR_MESSAGES: Record<string, string> = {
  COUNT_SNAPSHOT_STALE:
    "El inventario cambio mientras realizabas el conteo. Actualiza el conteo antes de aplicarlo.",
  COUNT_BELOW_RESERVED:
    "El conteo no puede dejar una existencia menor a la cantidad reservada. Revisa las reservas antes de aplicar la correccion.",
  COUNT_RESERVED_SERIAL_MISSING:
    "Uno o mas seriales reservados no fueron marcados como encontrados.",
  COUNT_QUANTITY_EXCEEDS_REGISTERED:
    "El conteo de un lote supera su existencia registrada; registra el excedente como unidad adicional.",
  COUNT_QUANTITY_REQUIRED: "Declara el conteo de todos los lotes.",
  COUNT_EXPECTED_SERIALS_REQUIRED:
    "No se pudo validar la composicion original de seriales. Actualiza el conteo e intentalo nuevamente.",
  COUNT_PRODUCT_NOT_TRACEABLE: "Este producto no usa trazabilidad; usa el ajuste exacto.",
  SERIAL_NOT_FOUND: "Uno o mas seriales no existen en el inventario.",
  SERIAL_LOCATION_MISMATCH: "Uno o mas seriales pertenecen a otra ubicacion.",
  SERIAL_NOT_PRESENT: "Uno o mas seriales no estan presentes fisicamente en el inventario.",
  SERIAL_LOT_MISMATCH: "Uno o mas seriales pertenecen a otro lote.",
  SERIAL_COUNT_MISMATCH: "La cantidad de seriales no coincide con la cantidad declarada.",
  SERIAL_UNAVAILABLE: "Uno o mas seriales no estan disponibles.",
  DUPLICATE_SERIAL: "Uno o mas numeros de serie ya estan registrados.",
};

/** Traduce los codigos del backend a mensajes entendibles; conserva el formulario abierto. */
export function describeCountError(error: unknown): CountErrorInfo {
  if (error instanceof BackendRequestError && error.code) {
    const message = COUNT_ERROR_MESSAGES[error.code];
    if (message) {
      return {
        kind:
          error.code === "COUNT_SNAPSHOT_STALE" || error.code === "COUNT_EXPECTED_SERIALS_REQUIRED"
            ? "stale"
            : error.code === "COUNT_BELOW_RESERVED" ||
                error.code === "COUNT_RESERVED_SERIAL_MISSING"
              ? "reserved"
              : "generic",
        message,
      };
    }
  }
  return {
    kind: "generic",
    message: error instanceof Error ? error.message : "No se pudo aplicar el conteo.",
  };
}

/** Conteo fisico trazable (solo modo API): snapshot -> revision -> una unica reconciliacion. */
export class InventoryCountService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async getSnapshot(input: GetCountSnapshotInput): Promise<InventoryCountSnapshot> {
    const canonicalInput = await this.withOperationalLocation(input, false);
    return this.repositories.inventoryAdjustments.getCountSnapshot(canonicalInput);
  }

  async reconcile(input: ReconcileCountInput): Promise<InventoryCountResult> {
    const canonicalInput = await this.withOperationalLocation(input, true);
    if (!input.reason.trim()) throw new Error("El motivo es requerido.");
    return this.repositories.inventoryAdjustments.reconcileCount(canonicalInput);
  }

  async validateNewSerials(input: {
    productId: string;
    serialNumbers: string[];
  }): Promise<SerialValidationResult> {
    await this.ensureAllowed();
    return this.repositories.inventoryAdjustments.validateNewSerials(input);
  }

  private async ensureAllowed(branchId?: string) {
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanCreateAdjustment(permissions);
    await ensureTenantCanUseInventory(this.repositories, tenantId);
    if (branchId) await ensureUserCanOperateInventoryBranch(this.repositories, user, branchId);
    return { tenantId };
  }

  private async withOperationalLocation<
    T extends { branchId: string; productId: string; locationId?: string },
  >(input: T, fresh: boolean): Promise<T> {
    const { tenantId } = await this.ensureAllowed(input.branchId);
    const capabilities = await this.repositories.businessConfig.getCapabilities(tenantId);
    // Sin configuracion del negocio el backend interpreta false: no se asume true.
    const usesLocations = capabilities?.supportsMultipleLocations ?? false;
    if (!usesLocations) return { ...input, locationId: undefined };
    const [settings, locations] = await Promise.all([
      this.repositories.inventory.getProductInventorySettings(input.productId, input.branchId),
      fresh
        ? this.repositories.inventory.getLocations(input.branchId)
        : getReferenceDataCache(this.repositories).getOrLoad(
            referenceDataKeys.locations(tenantId, input.branchId),
            REFERENCE_DATA_TTL_MS,
            () => this.repositories.inventory.getLocations(input.branchId),
          ),
    ]);
    // Con asignacion explicita no hace falta leer balances para resolver la ubicacion. Solo el
    // camino legacy sin asignacion necesita comprobar que realmente existe un balance NULL.
    const balances = settings?.defaultLocationId
      ? []
      : await this.repositories.inventory.getProductBalances(
          input.productId,
          input.branchId,
          tenantId,
          fresh ? { fresh: true } : undefined,
        );
    const locationId = resolveOperationalInventoryLocation({
      tenantId,
      branchId: input.branchId,
      productId: input.productId,
      requestedLocationId: input.locationId,
      usesLocations,
      settings,
      locations,
      legacyNullBalance: balances.some(
        (balance) =>
          balance.tenantId === tenantId &&
          balance.branchId === input.branchId &&
          balance.productId === input.productId &&
          !balance.locationId,
      ),
    });
    return { ...input, locationId };
  }
}
