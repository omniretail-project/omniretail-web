import { InventoryMovementType, InventoryReservationStatus, LocationStatus } from "@/core/enums";
import type { InventoryBalance, InventoryReservation, ProductInventorySettings } from "@/core/entities";
import type {
  GetLocationRegularizationOptionsInput,
  LegacyBalanceRegularizationBlocker,
  LegacyBalanceRegularizationPreview,
  LocationRegularizationOptions,
  LocationRegularizationResult,
  PreviewLocationRegularizationInput,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";

/**
 * Regularizacion explicita del saldo heredado (locationId NULL) hacia la ubicacion operativa, en
 * el store Mock. Reproduce el contrato del backend con sus mismos codigos; nunca se ejecuta sola
 * ni al hidratar el store. Los productos con lote o serie quedan bloqueados en modo local porque
 * el contrato de trazabilidad (lotes, series y reservas trazables) no esta definido para el Mock.
 */
const PREFIX = "INVENTORY_REGULARIZATION_";
export const MOCK_REGULARIZATION_TRACEABLE_MESSAGE =
  "La regularización de productos con lote o serie no está disponible en modo local.";

interface Scope {
  tenantId: string;
  branchId: string;
  productId: string;
}

function fail(status: number, code: string, message: string): never {
  throw new BackendRequestError(message, status, code);
}

function resolveScope(db: MockDatabase, branchId: string, productId: string) {
  const branch = db.branches.find((item) => item.id === branchId);
  if (!branch) fail(404, "BRANCH_NOT_FOUND", "Sucursal no encontrada.");
  const product = db.products.find((item) => item.id === productId && item.tenantId === branch.tenantId);
  if (!product) fail(404, "PRODUCT_NOT_FOUND", "Producto no encontrado.");
  return { scope: { tenantId: branch.tenantId, branchId, productId } satisfies Scope, product };
}

function scopedBalances(db: MockDatabase, scope: Scope): InventoryBalance[] {
  return db.inventoryBalances.filter(
    (item) =>
      item.tenantId === scope.tenantId &&
      item.branchId === scope.branchId &&
      item.productId === scope.productId,
  );
}

function assignedLocationOf(db: MockDatabase, scope: Scope): string | undefined {
  return (
    db.productInventorySettings.find(
      (item) =>
        item.tenantId === scope.tenantId &&
        item.branchId === scope.branchId &&
        item.productId === scope.productId,
    )?.defaultLocationId ?? undefined
  );
}

function locationsEnabled(db: MockDatabase, tenantId: string) {
  return (
    db.businessCapabilities.find((item) => item.tenantId === tenantId)?.supportsMultipleLocations ??
    false
  );
}

function toLocationOption(location: MockDatabase["storageLocations"][number]) {
  return { id: location.id, code: location.code, name: location.name, status: location.status };
}

export function getMockRegularizationOptions(
  db: MockDatabase,
  input: GetLocationRegularizationOptionsInput,
): LocationRegularizationOptions {
  const { scope, product } = resolveScope(db, input.branchId, input.productId);
  const branchLocations = db.storageLocations.filter(
    (item) => item.tenantId === scope.tenantId && item.branchId === scope.branchId,
  );
  const assignedLocationId = assignedLocationOf(db, scope);
  const assigned = assignedLocationId
    ? branchLocations.find((item) => item.id === assignedLocationId)
    : undefined;
  return {
    branchId: scope.branchId,
    productId: scope.productId,
    productName: product.name,
    sku: product.sku,
    locationsEnabled: locationsEnabled(db, scope.tenantId),
    ...(assignedLocationId ? { assignedLocationId } : {}),
    ...(assigned ? { assignedLocation: toLocationOption(assigned) } : {}),
    assignableLocations: branchLocations
      .filter((item) => item.status === LocationStatus.active)
      .map(toLocationOption),
  };
}

function activeSourceReservations(db: MockDatabase, scope: Scope, sourceBalanceId: string | undefined) {
  if (!sourceBalanceId) return [];
  return db.inventoryReservations.filter(
    (item) =>
      item.tenantId === scope.tenantId &&
      item.branchId === scope.branchId &&
      item.productId === scope.productId &&
      item.status === InventoryReservationStatus.active &&
      item.allocations.some((allocation) => allocation.balanceId === sourceBalanceId),
  );
}

function remaining(allocation: InventoryReservation["allocations"][number]) {
  return allocation.reservedQuantity - allocation.consumedQuantity;
}

/** Huella determinista (no criptografica) del estado evaluado: solo detecta datos obsoletos. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hex = "";
  for (let seed = 0; seed < 8; seed += 1) {
    let hash = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hex += hash.toString(16).padStart(8, "0");
  }
  return hex;
}

export function previewMockRegularization(
  db: MockDatabase,
  input: PreviewLocationRegularizationInput,
): LegacyBalanceRegularizationPreview {
  const { scope, product } = resolveScope(db, input.branchId, input.productId);
  const location = db.storageLocations.find((item) => item.id === input.locationId);
  if (!location || location.tenantId !== scope.tenantId) {
    fail(404, "LOCATION_NOT_FOUND", "Ubicación no encontrada.");
  }
  if (location.branchId !== scope.branchId) {
    fail(400, "LOCATION_BRANCH_MISMATCH", "La ubicación no pertenece a la sucursal.");
  }

  const balances = scopedBalances(db, scope);
  const source = balances.find((item) => !item.locationId);
  const destination = balances.find((item) => item.locationId === location.id);
  const sourceQuantity = source?.quantity ?? 0;
  const sourceReserved = source?.reservedQuantity ?? 0;
  const destinationQuantity = destination?.quantity ?? 0;
  const destinationReserved = destination?.reservedQuantity ?? 0;
  const assignedLocationId = assignedLocationOf(db, scope);
  const assignmentRequired = !assignedLocationId;
  const wantsAssignment = input.assign === true;
  const reservations = activeSourceReservations(db, scope, source?.id);
  const blockers: LegacyBalanceRegularizationBlocker[] = [];
  const block = (code: string, message: string) =>
    blockers.push({ code: `${PREFIX}${code}`, message });

  if (!locationsEnabled(db, scope.tenantId)) {
    block("LOCATIONS_DISABLED", "El control de ubicaciones está desactivado.");
  }
  if (!product.tracking.stock || product.tracking.lot || product.tracking.serial) {
    block(
      "PRODUCT_NOT_ELIGIBLE",
      product.tracking.lot || product.tracking.serial
        ? MOCK_REGULARIZATION_TRACEABLE_MESSAGE
        : "El producto no controla existencias.",
    );
  }
  if (location.status !== LocationStatus.active) {
    block("DESTINATION_INACTIVE", "La ubicación destino está inactiva.");
  }
  if (assignedLocationId && assignedLocationId !== location.id) {
    block("DESTINATION_NOT_ASSIGNED", "El destino no es la ubicación operativa asignada.");
  } else if (assignmentRequired && !wantsAssignment) {
    block("DESTINATION_NOT_ASSIGNED", "El producto aún no tiene una ubicación operativa asignada.");
  }
  if (sourceQuantity <= 0 && sourceReserved <= 0) {
    block("NOT_REQUIRED", "No hay saldo heredado que regularizar.");
  }
  const thirdLocation = balances.some(
    (item) =>
      item.locationId &&
      item.locationId !== location.id &&
      (item.quantity > 0 || item.reservedQuantity > 0),
  );
  if (thirdLocation) {
    block("THIRD_LOCATION_STOCK", "El producto conserva existencias en otra ubicación.");
  }
  if (
    reservations.some((reservation) =>
      reservation.allocations.some((allocation) => allocation.balanceId !== source?.id),
    )
  ) {
    block("RESERVATION_OTHER_BALANCE", "Hay reservas que también afectan a otros balances.");
  }
  const reservedByAllocations = reservations
    .flatMap((reservation) => reservation.allocations)
    .filter((allocation) => allocation.balanceId === source?.id)
    .reduce((total, allocation) => total + remaining(allocation), 0);
  if (reservedByAllocations !== sourceReserved) {
    block("RESERVATION_DRIFT", "Las reservas no coinciden con el saldo reservado.");
  }
  if (
    source &&
    db.pickingItems.some((item) =>
      (item.pickedAllocations ?? []).some((allocation) => allocation.balanceId === source.id),
    )
  ) {
    block("PICKING_CONFLICT", "Hay picking en curso sobre el saldo heredado.");
  }

  const state = {
    branchId: scope.branchId,
    productId: scope.productId,
    locationId: location.id,
    sourceQuantity,
    sourceReserved,
    destinationQuantity,
    destinationReserved,
    assignedLocationId: assignedLocationId ?? null,
    reservations: reservations
      .map((item) => `${item.id}:${item.updatedAt}`)
      .sort((a, b) => a.localeCompare(b)),
  };

  return {
    branchId: scope.branchId,
    productId: scope.productId,
    productName: product.name,
    sku: product.sku,
    locationId: location.id,
    locationName: location.name,
    eligible: blockers.length === 0,
    blockers,
    sourceQuantity,
    sourceReservedQuantity: sourceReserved,
    destinationQuantity,
    destinationReservedQuantity: destinationReserved,
    resultingQuantity: destinationQuantity + sourceQuantity,
    resultingReservedQuantity: destinationReserved + sourceReserved,
    activeReservations: reservations.length,
    emptyAllocationReservations: 0,
    lotBalances: 0,
    serials: 0,
    snapshotFingerprint: fingerprint(state),
    ...(assignedLocationId ? { assignedLocationId } : {}),
    assignmentRequired,
    assignmentAllowed: assignmentRequired && locationsEnabled(db, scope.tenantId),
  };
}

export interface MockRegularizationDependencies {
  id(prefix: string): string;
  now(): string;
}

/** Debe ejecutarse dentro de una transaccion del store: o se aplica todo o no cambia nada. */
export function applyMockRegularization(
  db: MockDatabase,
  input: RegularizeLocationBalanceInput,
  dependencies: MockRegularizationDependencies,
): { result: LocationRegularizationResult; changed: boolean; tenantId: string } {
  const { scope } = resolveScope(db, input.branchId, input.productId);
  if (!input.idempotencyKey.trim()) {
    fail(400, "INVALID_REGULARIZATION_REQUEST", "La clave de idempotencia es requerida.");
  }
  const requestFingerprint = fingerprint({
    branchId: input.branchId,
    productId: input.productId,
    locationId: input.locationId,
    reason: input.reason.trim(),
    expectedSourceQuantity: input.expectedSourceQuantity,
    expectedSourceReservedQuantity: input.expectedSourceReservedQuantity,
    expectedDestinationQuantity: input.expectedDestinationQuantity,
    snapshotFingerprint: input.snapshotFingerprint,
    assignDestination: input.assignDestination === true,
  });
  const existing = db.inventoryLocationRegularizations.find(
    (item) => item.tenantId === scope.tenantId && item.idempotencyKey === input.idempotencyKey,
  );
  if (existing) {
    if (existing.requestFingerprint !== requestFingerprint) {
      fail(409, `${PREFIX}KEY_REUSED`, "La clave de operación ya se usó con otros datos.");
    }
    return {
      result: { ...existing.result, idempotent: true },
      changed: false,
      tenantId: scope.tenantId,
    };
  }

  const assign = input.assignDestination === true;
  const preview = previewMockRegularization(db, {
    branchId: input.branchId,
    productId: input.productId,
    locationId: input.locationId,
    ...(assign ? { assign: true } : {}),
  });
  if (assign && !preview.assignmentRequired) {
    fail(
      409,
      `${PREFIX}ASSIGNMENT_CONFLICT`,
      "El producto ya tiene una ubicación operativa asignada.",
    );
  }
  if (
    preview.snapshotFingerprint !== input.snapshotFingerprint ||
    preview.sourceQuantity !== input.expectedSourceQuantity ||
    preview.sourceReservedQuantity !== input.expectedSourceReservedQuantity ||
    preview.destinationQuantity !== input.expectedDestinationQuantity
  ) {
    fail(409, `${PREFIX}STALE_SNAPSHOT`, "El inventario cambió; vuelve a consultar la vista previa.");
  }
  const blocker = preview.blockers[0];
  if (!preview.eligible && blocker) fail(409, blocker.code, blocker.message);

  const now = dependencies.now();
  const balances = scopedBalances(db, scope);
  const source = balances.find((item) => !item.locationId);
  if (!source) fail(409, `${PREFIX}NOT_REQUIRED`, "No hay saldo heredado que regularizar.");
  const existingDestination = balances.find((item) => item.locationId === input.locationId);
  const destination: InventoryBalance = existingDestination ?? {
    id: dependencies.id("balance"),
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    productId: scope.productId,
    locationId: input.locationId,
    quantity: 0,
    reservedQuantity: 0,
    updatedAt: now,
  };
  if (!existingDestination) db.inventoryBalances.push(destination);

  const movedQuantity = source.quantity;
  const movedReserved = source.reservedQuantity;
  const destinationBefore = destination.quantity;
  let reservationsReassigned = 0;
  for (const reservation of activeSourceReservations(db, scope, source.id)) {
    reservation.allocations.forEach((allocation) => {
      if (allocation.balanceId !== source.id) return;
      allocation.balanceId = destination.id;
      allocation.locationId = input.locationId;
    });
    reservation.updatedAt = now;
    reservationsReassigned += 1;
  }
  destination.quantity += movedQuantity;
  destination.reservedQuantity += movedReserved;
  destination.updatedAt = now;
  source.quantity = 0;
  source.reservedQuantity = 0;
  source.updatedAt = now;

  const regularizationId = dependencies.id("location-regularization");
  const movementId = dependencies.id("movement");
  db.inventoryMovements.push({
    id: movementId,
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    productId: scope.productId,
    type: InventoryMovementType.transfer,
    reason: input.reason.trim(),
    quantity: movedQuantity,
    quantityBefore: destinationBefore,
    quantityAfter: destination.quantity,
    toLocationId: input.locationId,
    referenceType: "location-regularization",
    referenceId: regularizationId,
    createdAt: now,
  });

  let assignmentApplied = false;
  if (assign && preview.assignmentRequired) {
    const settings = db.productInventorySettings.find(
      (item) =>
        item.tenantId === scope.tenantId &&
        item.branchId === scope.branchId &&
        item.productId === scope.productId,
    );
    if (settings) {
      settings.defaultLocationId = input.locationId;
      settings.updatedAt = now;
    } else {
      const created: ProductInventorySettings = {
        id: `product-inventory-settings-${scope.tenantId}-${scope.productId}-${scope.branchId}`,
        tenantId: scope.tenantId,
        productId: scope.productId,
        branchId: scope.branchId,
        minStock: 0,
        defaultLocationId: input.locationId,
        createdAt: now,
        updatedAt: now,
      };
      db.productInventorySettings.push(created);
    }
    assignmentApplied = true;
  }

  const result: LocationRegularizationResult = {
    regularizationId,
    idempotent: false,
    createdAt: now,
    branchId: scope.branchId,
    productId: scope.productId,
    toLocationId: input.locationId,
    movedQuantity,
    movedReservedQuantity: movedReserved,
    destinationQuantityBefore: destinationBefore,
    destinationQuantityAfter: destination.quantity,
    destinationReservedQuantityAfter: destination.reservedQuantity,
    reservationsReassigned,
    lotBalancesMerged: 0,
    serialsRelocated: 0,
    movementId,
    assignmentApplied,
  };
  db.inventoryLocationRegularizations.push({
    id: regularizationId,
    tenantId: scope.tenantId,
    idempotencyKey: input.idempotencyKey,
    requestFingerprint,
    result,
    createdAt: now,
  });
  return { result, changed: true, tenantId: scope.tenantId };
}
