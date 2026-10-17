import type { InventoryAdjustment, InventoryMovement } from "@/core/entities";
import type { InventoryAdjustmentType } from "@/core/enums";
import type { SerialValidationResult } from "@/core/repositories/ReceiptRepository";

export interface InventoryAdjustmentFilters {
  tenantId?: string;
  branchId?: string;
  productId?: string;
}

export interface CreateInventoryAdjustmentInput {
  tenantId: string;
  branchId: string;
  productId: string;
  locationId?: string;
  type: InventoryAdjustmentType;
  reason: string;
  notes?: string;
  quantityBefore: number;
  quantityAfter: number;
  performedByUserId?: string;
}

export interface RegisterInventoryAdjustmentStockInput extends CreateInventoryAdjustmentInput {
  /** Snapshot fisico previo: solo se envia para un conteo exacto, nunca para entradas/salidas manuales. */
  expectedQuantity?: number;
  lotId?: string;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string[];
}

export interface RegisterInventoryAdjustmentStockResult {
  adjustment: InventoryAdjustment;
  movements: InventoryMovement[];
}

export interface AdjustmentLotOption {
  lotId: string;
  lotNumber: string;
  expirationDate?: string;
  quantity: number;
  reservedQuantity: number;
  /** Capacidad real de salida: nunca la cantidad fisica. */
  availableQuantity: number;
  locationId?: string;
}

export interface AdjustmentSerialOption {
  serialId: string;
  serialNumber: string;
  lotId?: string;
  locationId?: string;
}

export interface ListAdjustmentLotsInput {
  branchId: string;
  productId: string;
  locationId?: string;
}

export interface ListAdjustmentSerialsInput extends ListAdjustmentLotsInput {
  lotId?: string;
}

export interface ValidateNewSerialsInput {
  productId: string;
  serialNumbers: string[];
}

export interface CountSerialItem {
  serialId: string;
  serialNumber: string;
  /** AVAILABLE o RESERVED: ambos siguen fisicamente presentes. */
  status: string;
}

export interface CountSnapshotLot {
  lotId: string;
  lotNumber: string;
  expirationDate?: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  serials: CountSerialItem[];
}

export interface InventoryCountSnapshot {
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  branchName: string;
  locationId?: string;
  locationName: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  tracking: { lot: boolean; expiration: boolean; serial: boolean };
  lots: CountSnapshotLot[];
  /** Series sin lote. */
  serials: CountSerialItem[];
}

export interface GetCountSnapshotInput {
  branchId: string;
  productId: string;
  locationId?: string;
}

export interface ReconcileCountLotInput {
  lotId: string;
  /** Cantidad registrada del lote en el snapshot original (no se recalcula). */
  expectedQuantity: number;
  countedQuantity?: number;
  /** Composicion serial del lote en el snapshot original (anti-stale); [] es valido. */
  expectedSerialNumbers?: string[];
  foundSerialNumbers?: string[];
}

export interface ReconcileCountAdditionInput {
  quantity: number;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string[];
}

export interface ReconcileCountInput {
  branchId: string;
  productId: string;
  locationId?: string;
  reason: string;
  /** Existencia registrada que vio el usuario: solo detecta snapshot vencido. */
  expectedQuantity: number;
  lots?: ReconcileCountLotInput[];
  /** Composicion serial sin lote del snapshot original (anti-stale); [] es valido. */
  expectedSerialNumbers?: string[];
  foundSerialNumbers?: string[];
  additions?: ReconcileCountAdditionInput[];
}

export interface InventoryCountLotResult {
  lotId?: string;
  lotNumber: string;
  expirationDate?: string;
  quantityBefore: number;
  countedQuantity: number;
  delta: number;
  foundSerialNumbers: string[];
  missingSerialNumbers: string[];
  addedSerialNumbers: string[];
}

export interface InventoryCountResult {
  countId: string;
  createdAt: string;
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  branchName: string;
  locationName: string;
  performedByName: string;
  quantityBefore: number;
  countedQuantity: number;
  quantityAfter: number;
  delta: number;
  lots: InventoryCountLotResult[];
  movementIds: string[];
}

export interface LegacyBalanceRegularizationBlocker {
  /** Codigo del backend (p. ej. INVENTORY_REGULARIZATION_THIRD_LOCATION_STOCK). */
  code: string;
  message: string;
}

export interface PreviewLocationRegularizationInput {
  branchId: string;
  productId: string;
  /**
   * Ubicacion destino: la operativa ya asignada al producto o, con `assign`, la que se asignara en
   * la misma operacion cuando el producto aun no tiene ninguna.
   */
  locationId: string;
  /** assign=true: evalua la asignacion inicial del destino. Ausente equivale a false. */
  assign?: boolean;
}

export interface GetLocationRegularizationOptionsInput {
  branchId: string;
  productId: string;
}

/** Ubicacion de la sucursal tal como la entrega /options (status: nombre del enum del backend). */
export interface LocationRegularizationLocationOption {
  id: string;
  code: string;
  name: string;
  status: string;
}

/** Respuesta de GET /inventory/location-regularizations/options. */
export interface LocationRegularizationOptions {
  branchId: string;
  productId: string;
  productName: string;
  sku: string;
  /** false: el control de ubicaciones esta apagado y no hay regularizacion posible. */
  locationsEnabled: boolean;
  assignedLocationId?: string;
  /** Detalle de la asignada si pertenece a la sucursal. */
  assignedLocation?: LocationRegularizationLocationOption;
  assignableLocations: LocationRegularizationLocationOption[];
}

/** Vista previa read-only de GET /inventory/location-regularizations/preview. */
export interface LegacyBalanceRegularizationPreview {
  branchId: string;
  productId: string;
  productName: string;
  sku: string;
  locationId: string;
  locationName: string;
  eligible: boolean;
  blockers: LegacyBalanceRegularizationBlocker[];
  sourceQuantity: number;
  sourceReservedQuantity: number;
  destinationQuantity: number;
  destinationReservedQuantity: number;
  resultingQuantity: number;
  resultingReservedQuantity: number;
  activeReservations: number;
  emptyAllocationReservations: number;
  lotBalances: number;
  serials: number;
  snapshotFingerprint: string;
  /** Ubicacion operativa asignada hoy al producto en la sucursal (ausente si no tiene). */
  assignedLocationId?: string;
  /** El destino aun no esta asignado: asignarlo exige el modo assignDestination. */
  assignmentRequired: boolean;
  /** Con ese modo, la politica y los permisos del usuario permitirian asignarlo. */
  assignmentAllowed: boolean;
}

/** Cuerpo exacto de POST /inventory/location-regularizations (idempotencyKey va en el cuerpo). */
export interface RegularizeLocationBalanceInput {
  branchId: string;
  productId: string;
  locationId: string;
  idempotencyKey: string;
  reason: string;
  expectedSourceQuantity: number;
  expectedSourceReservedQuantity: number;
  expectedDestinationQuantity: number;
  snapshotFingerprint: string;
  /**
   * Modo de asignacion inicial del destino (debe coincidir con la vista previa usada). Ausente
   * equivale a false; el repositorio API siempre lo envia de forma explicita.
   */
  assignDestination?: boolean;
}

export interface LocationRegularizationResult {
  regularizationId: string;
  /** true cuando es el reintento idempotente de una regularizacion ya aplicada (HTTP 200). */
  idempotent: boolean;
  createdAt: string;
  branchId: string;
  productId: string;
  fromLocationId?: string;
  toLocationId: string;
  movedQuantity: number;
  movedReservedQuantity: number;
  destinationQuantityBefore: number;
  destinationQuantityAfter: number;
  destinationReservedQuantityAfter: number;
  reservationsReassigned: number;
  lotBalancesMerged: number;
  serialsRelocated: number;
  movementId: string;
  /** Esta operacion asigno la ubicacion operativa inicial del producto. */
  assignmentApplied: boolean;
  /** Asignacion que tenia antes (ausente cuando no tenia ninguna). */
  previousAssignedLocationId?: string;
}

export interface InventoryAdjustmentRepository {
  getById(id: string): Promise<InventoryAdjustment | null>;
  getByNumber(tenantId: string, number: string): Promise<InventoryAdjustment | null>;
  query(filters?: InventoryAdjustmentFilters): Promise<InventoryAdjustment[]>;
  create(input: CreateInventoryAdjustmentInput): Promise<InventoryAdjustment>;
  registerStockAdjustment(
    input: RegisterInventoryAdjustmentStockInput,
  ): Promise<RegisterInventoryAdjustmentStockResult>;
  /** Solo modo API: lotes existentes con disponibilidad real (lookup bajo demanda). */
  listAvailableLots(input: ListAdjustmentLotsInput): Promise<AdjustmentLotOption[]>;
  /** Solo modo API: series AVAILABLE existentes. */
  listAvailableSerials(input: ListAdjustmentSerialsInput): Promise<AdjustmentSerialOption[]>;
  /** Solo modo API: precheck UX de series NUEVAS (una request batch). */
  validateNewSerials(input: ValidateNewSerialsInput): Promise<SerialValidationResult>;
  /** Solo modo API: estado FISICO para un conteo trazable. */
  getCountSnapshot(input: GetCountSnapshotInput): Promise<InventoryCountSnapshot>;
  /** Solo modo API: una unica request que aplica el conteo trazable. */
  reconcileCount(input: ReconcileCountInput): Promise<InventoryCountResult>;
  /** Solo modo API: ubicacion asignada y ubicaciones activas elegibles como destino. */
  getLocationRegularizationOptions(
    input: GetLocationRegularizationOptionsInput,
  ): Promise<LocationRegularizationOptions>;
  /** Solo modo API: vista previa read-only de la regularizacion del balance heredado sin ubicacion. */
  previewLocationRegularization(
    input: PreviewLocationRegularizationInput,
  ): Promise<LegacyBalanceRegularizationPreview>;
  /** Solo modo API: consolida el balance heredado en la ubicacion operativa (una sola solicitud). */
  regularizeLocationBalance(
    input: RegularizeLocationBalanceInput,
  ): Promise<LocationRegularizationResult>;
}
