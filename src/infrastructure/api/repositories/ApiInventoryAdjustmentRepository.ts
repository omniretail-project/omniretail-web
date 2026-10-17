import { InventoryAdjustmentType } from "@/core/enums";
import type {
  GetCountSnapshotInput,
  InventoryAdjustmentRepository,
  ListAdjustmentLotsInput,
  GetLocationRegularizationOptionsInput,
  ListAdjustmentSerialsInput,
  PreviewLocationRegularizationInput,
  ReconcileCountInput,
  RegularizeLocationBalanceInput,
  ReconcileCountLotInput,
  RegisterInventoryAdjustmentStockInput,
  ValidateNewSerialsInput,
} from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import {
  parseApiCountResult,
  parseApiCountSnapshot,
} from "@/infrastructure/api/repositories/inventoryCountApi.schema";
import {
  parseApiAdjustmentLots,
  parseApiAdjustmentSerials,
  parseApiSerialValidationResult,
} from "@/infrastructure/api/repositories/inventoryAdjustmentApi.schema";
import {
  parseApiLocationRegularizationOptions,
  parseApiLocationRegularizationPreview,
  parseApiLocationRegularizationResult,
  parseBackendDecimal,
} from "@/infrastructure/api/repositories/inventoryRegularizationApi.schema";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";

const QUANTITY_DECIMALS = 3;
const REGULARIZATION_PATH = "/inventory/location-regularizations";
const MAX_REGULARIZATION_QUANTITY = 999_999_999.999;
const FINGERPRINT_LENGTH = 64;

/**
 * Ajuste real de inventario: el backend solo conoce in/out. Entrada manual -> in; salida y merma
 * -> out; conteo -> delta calculado por el service (quantityAfter - quantityBefore). `notes` no
 * existe en el contrato, por eso no se envia.
 */
export class ApiInventoryAdjustmentRepository {
  /** Regularizaciones confirmadas ya notificadas: una actualizacion confirmada emite una sola vez. */
  private readonly announcedRegularizations = new Set<string>();

  constructor(private readonly eventBus: DataEventBus) {}

  withAdjustmentDelegate(delegate: InventoryAdjustmentRepository): InventoryAdjustmentRepository {
    const registerStockAdjustment = this.registerStockAdjustment.bind(this);
    const listAvailableLots = this.listAvailableLots.bind(this);
    const listAvailableSerials = this.listAvailableSerials.bind(this);
    const validateNewSerials = this.validateNewSerials.bind(this);
    const getCountSnapshot = this.getCountSnapshot.bind(this);
    const reconcileCount = this.reconcileCount.bind(this);
    const previewLocationRegularization = this.previewLocationRegularization.bind(this);
    const regularizeLocationBalance = this.regularizeLocationBalance.bind(this);
    const getLocationRegularizationOptions = this.getLocationRegularizationOptions.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getLocationRegularizationOptions") return getLocationRegularizationOptions;
        if (property === "previewLocationRegularization") return previewLocationRegularization;
        if (property === "regularizeLocationBalance") return regularizeLocationBalance;
        if (property === "registerStockAdjustment") return registerStockAdjustment;
        if (property === "listAvailableLots") return listAvailableLots;
        if (property === "listAvailableSerials") return listAvailableSerials;
        if (property === "validateNewSerials") return validateNewSerials;
        if (property === "getCountSnapshot") return getCountSnapshot;
        if (property === "reconcileCount") return reconcileCount;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async registerStockAdjustment(input: RegisterInventoryAdjustmentStockInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    assertOptionalApiUuid(input.locationId, "locationId");
    assertOptionalApiUuid(input.lotId, "lotId");
    const delta = roundQuantity(input.quantityAfter - input.quantityBefore);
    if (delta === 0) {
      throw new BackendRequestError(
        "La existencia ya coincide con el conteo ingresado.",
        400,
        "NO_ADJUSTMENT_NEEDED",
      );
    }
    const type = delta > 0 ? "in" : "out";
    const serialNumbers = input.serialNumbers?.map((serial) => serial.trim()).filter(Boolean);
    const body = {
      branchId: input.branchId,
      productId: input.productId,
      type,
      quantity: Math.abs(delta),
      reason: input.reason.trim(),
      // Metadata estructurada para el historial: el type del backend solo distingue in/out.
      referenceType: toAdjustmentReferenceType(input.type),
      ...(input.expectedQuantity !== undefined ? { expectedQuantity: input.expectedQuantity } : {}),
      ...(input.locationId ? { locationId: input.locationId } : {}),
      // IN crea tracking nuevo (lotNumber/expirationDate); OUT solo referencia existente (lotId).
      ...(type === "in" && input.lotNumber?.trim() ? { lotNumber: input.lotNumber.trim() } : {}),
      ...(type === "in" && input.expirationDate ? { expirationDate: input.expirationDate } : {}),
      ...(type === "out" && input.lotId ? { lotId: input.lotId } : {}),
      ...(serialNumbers && serialNumbers.length > 0 ? { serialNumbers } : {}),
    };
    await backendFetch<unknown>("/inventory/adjustments", { method: "POST", body });
    const payload = {
      entityId: input.productId,
      tenantId: input.tenantId,
      branchId: input.branchId,
      action: "updated" as const,
    };
    this.eventBus.emit("inventory.changed", payload);
    this.eventBus.emit("stock.changed", payload);
    // La fuente de verdad es el backend: el llamador recarga stock; no se fabrican entidades.
    return {
      adjustment: {
        id: "",
        tenantId: input.tenantId,
        number: "",
        branchId: input.branchId,
        productId: input.productId,
        locationId: input.locationId,
        type: input.type,
        reason: input.reason,
        quantityBefore: input.quantityBefore,
        quantityAfter: input.quantityAfter,
        delta,
        createdAt: new Date().toISOString(),
      },
      movements: [],
    };
  }

  async listAvailableLots(input: ListAdjustmentLotsInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    assertOptionalApiUuid(input.locationId, "locationId");
    return parseApiAdjustmentLots(
      await backendFetch<unknown>("/inventory/lots", {
        query: {
          branchId: input.branchId,
          productId: input.productId,
          locationId: input.locationId,
        },
      }),
    );
  }

  async listAvailableSerials(input: ListAdjustmentSerialsInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    assertOptionalApiUuid(input.locationId, "locationId");
    assertOptionalApiUuid(input.lotId, "lotId");
    return parseApiAdjustmentSerials(
      await backendFetch<unknown>("/inventory/serials", {
        query: {
          branchId: input.branchId,
          productId: input.productId,
          locationId: input.locationId,
          lotId: input.lotId,
        },
      }),
    );
  }

  async getCountSnapshot(input: GetCountSnapshotInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    assertOptionalApiUuid(input.locationId, "locationId");
    return parseApiCountSnapshot(
      await backendFetch<unknown>("/inventory/counts/snapshot", {
        query: {
          branchId: input.branchId,
          productId: input.productId,
          locationId: input.locationId,
        },
      }),
    );
  }

  async reconcileCount(input: ReconcileCountInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    assertOptionalApiUuid(input.locationId, "locationId");
    const result = parseApiCountResult(
      await backendFetch<unknown>("/inventory/counts/reconcile", {
        method: "POST",
        body: {
          branchId: input.branchId,
          productId: input.productId,
          ...(input.locationId ? { locationId: input.locationId } : {}),
          reason: input.reason.trim(),
          expectedQuantity: input.expectedQuantity,
          ...(input.lots ? { lots: input.lots.map(toLotBody) } : {}),
          // [] es valido y no se omite (solo undefined): el backend compara la composicion.
          ...(input.expectedSerialNumbers !== undefined
            ? { expectedSerialNumbers: input.expectedSerialNumbers }
            : {}),
          ...(input.foundSerialNumbers !== undefined
            ? { foundSerialNumbers: input.foundSerialNumbers }
            : {}),
          ...(input.additions && input.additions.length > 0 ? { additions: input.additions } : {}),
        },
      }),
    );
    const payload = {
      entityId: input.productId,
      branchId: input.branchId,
      action: "updated" as const,
    };
    this.eventBus.emit("inventory.changed", payload);
    this.eventBus.emit("stock.changed", payload);
    return result;
  }

  /** GET /inventory/location-regularizations/options: solo lectura (permiso inventory.stock.read). */
  async getLocationRegularizationOptions(input: GetLocationRegularizationOptionsInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    return parseApiLocationRegularizationOptions(
      await backendFetch<unknown>(`${REGULARIZATION_PATH}/options`, {
        query: { branchId: input.branchId, productId: input.productId },
      }),
    );
  }

  /**
   * GET /inventory/location-regularizations/preview: solo lectura, sin eventos ni efectos. `assign`
   * solo se envia cuando es true (el backend lo interpreta como false si falta).
   */
  async previewLocationRegularization(input: PreviewLocationRegularizationInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    assertApiUuid(input.locationId, "locationId");
    return parseApiLocationRegularizationPreview(
      await backendFetch<unknown>(`${REGULARIZATION_PATH}/preview`, {
        query: {
          branchId: input.branchId,
          productId: input.productId,
          locationId: input.locationId,
          ...(input.assign === true ? { assign: true } : {}),
        },
      }),
    );
  }

  /**
   * POST /inventory/location-regularizations. El cuerpo es exactamente el recibido: nunca se
   * regenera la clave ni se recalculan cantidades, para que un reintento sea la MISMA solicitud
   * (el backend liga la clave a la huella completa del cuerpo). 201 aplicada, 200 reintento.
   */
  async regularizeLocationBalance(input: RegularizeLocationBalanceInput) {
    assertApiUuid(input.branchId, "branchId");
    assertApiUuid(input.productId, "productId");
    assertApiUuid(input.locationId, "locationId");
    assertApiUuid(input.idempotencyKey, "idempotencyKey");
    const reason = input.reason.trim();
    if (!reason || reason.length > 200) {
      throw new BackendRequestError(
        "El motivo es obligatorio y admite hasta 200 caracteres.",
        400,
        "INVALID_REASON",
        { reason: "El motivo es obligatorio y admite hasta 200 caracteres." },
      );
    }
    if (input.snapshotFingerprint.length !== FINGERPRINT_LENGTH) {
      throw new BackendRequestError(
        "La vista previa no tiene una huella valida.",
        400,
        "INVALID_SNAPSHOT_FINGERPRINT",
      );
    }
    const body = {
      branchId: input.branchId,
      productId: input.productId,
      locationId: input.locationId,
      idempotencyKey: input.idempotencyKey,
      reason,
      expectedSourceQuantity: toWireQuantity(
        input.expectedSourceQuantity,
        "expectedSourceQuantity",
      ),
      expectedSourceReservedQuantity: toWireQuantity(
        input.expectedSourceReservedQuantity,
        "expectedSourceReservedQuantity",
      ),
      expectedDestinationQuantity: toWireQuantity(
        input.expectedDestinationQuantity,
        "expectedDestinationQuantity",
      ),
      snapshotFingerprint: input.snapshotFingerprint,
      // Siempre explicito: false conserva el flujo original (el backend lo trata igual que ausente).
      assignDestination: input.assignDestination === true,
    };
    const result = parseApiLocationRegularizationResult(
      await backendFetch<unknown>(REGULARIZATION_PATH, { method: "POST", body }),
    );
    // Una sola notificacion por regularizacion confirmada, aunque el reintento devuelva 200.
    if (!this.announcedRegularizations.has(result.regularizationId)) {
      this.announcedRegularizations.add(result.regularizationId);
      const payload = {
        entityId: input.productId,
        branchId: input.branchId,
        action: "updated" as const,
      };
      this.eventBus.emit("inventory.changed", payload);
      this.eventBus.emit("stock.changed", payload);
    }
    return result;
  }

  async validateNewSerials(input: ValidateNewSerialsInput) {
    assertApiUuid(input.productId, "productId");
    return parseApiSerialValidationResult(
      await backendFetch<unknown>("/inventory/serials/validate", {
        method: "POST",
        body: { productId: input.productId, serialNumbers: input.serialNumbers },
      }),
    );
  }
}

/**
 * Cantidad del cuerpo de regularizacion: como mucho 9 enteros y 3 decimales (@Digits del backend),
 * sin redondear en silencio y sin notacion cientifica (los valores con 3 decimales no la usan).
 */
function toWireQuantity(value: number, fieldName: string): number {
  const parsed = parseBackendDecimal(value);
  if (parsed === null || parsed < 0 || parsed > MAX_REGULARIZATION_QUANTITY) {
    throw new BackendRequestError(
      `${fieldName} debe ser una cantidad positiva con hasta 3 decimales.`,
      400,
      "INVALID_QUANTITY",
      { [fieldName]: "Cantidad invalida." },
    );
  }
  return parsed;
}

function roundQuantity(value: number) {
  return Number(value.toFixed(QUANTITY_DECIMALS));
}

/** Valores estables persistidos en InventoryMovement.referenceType (maximo 50 caracteres). */
export function toAdjustmentReferenceType(type: InventoryAdjustmentType) {
  if (type === InventoryAdjustmentType.manualIncrease) return "manual_in";
  if (type === InventoryAdjustmentType.manualDecrease) return "manual_out";
  if (type === InventoryAdjustmentType.waste) return "waste";
  return "count_correction";
}

/** Serializa cada lote campo por campo: un lote con series siempre lleva ambos arreglos. */
function toLotBody(lot: ReconcileCountLotInput) {
  if (lot.foundSerialNumbers !== undefined && lot.expectedSerialNumbers === undefined) {
    throw new Error("El conteo serializado requiere la composicion original de seriales del lote.");
  }
  return {
    lotId: lot.lotId,
    expectedQuantity: lot.expectedQuantity,
    ...(lot.countedQuantity !== undefined ? { countedQuantity: lot.countedQuantity } : {}),
    ...(lot.expectedSerialNumbers !== undefined
      ? { expectedSerialNumbers: lot.expectedSerialNumbers }
      : {}),
    ...(lot.foundSerialNumbers !== undefined ? { foundSerialNumbers: lot.foundSerialNumbers } : {}),
  };
}
