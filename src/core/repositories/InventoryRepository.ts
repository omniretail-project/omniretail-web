import type {
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
  InventoryReservationConsumedAllocation,
  ProductInventorySettings,
  SerialNumber,
  StockLot,
  StorageLocation,
} from "@/core/entities";
import type { InventoryMovementType } from "@/core/enums";

export type InventoryMovementDisplayType =
  "purchase_in" | "sale" | "return" | "void" | "dispatch" | "in" | "out" | "transfer";

export type InventoryMovementSort =
  | "createdAt,asc"
  | "createdAt,desc"
  | "quantity,asc"
  | "quantity,desc"
  | "type,asc"
  | "type,desc"
  | "productId,asc"
  | "productId,desc"
  | "branchId,asc"
  | "branchId,desc";

export interface InventoryMovementPageParams {
  branchId?: string;
  productId?: string;
  type?: InventoryMovementType;
  from?: string;
  to?: string;
  search?: string;
  displayType?: InventoryMovementDisplayType;
  page: number;
  pageSize: number;
  sort?: InventoryMovementSort;
}

export interface InventoryMovementListItem {
  id: string;
  tenantId: string;
  branchId: string;
  branchName: string | null;
  productId: string;
  productName: string | null;
  sku: string | null;
  type: InventoryMovementType;
  displayType: InventoryMovementDisplayType;
  reason: string;
  quantity: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  fromLocationId: string | null;
  fromLocationName: string | null;
  toLocationId: string | null;
  toLocationName: string | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceLabel: string | null;
  performedByUserId: string | null;
  userLabel: string | null;
  createdAt: string;
}

export interface InventoryMovementPageResult {
  items: InventoryMovementListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  summary: {
    incoming: number;
    outgoing: number;
    net: number;
  };
}

export type InventoryStockStatus = "out_of_stock" | "critical" | "near_minimum" | "normal";

export type InventoryStockSort =
  | "productName,asc"
  | "productName,desc"
  | "sku,asc"
  | "sku,desc"
  | "categoryName,asc"
  | "categoryName,desc"
  | "availableQuantity,asc"
  | "availableQuantity,desc"
  | "status,asc"
  | "status,desc";

/** Disponibilidad operacional (quantity - reserved) de otra sucursal; NO existencia fisica. */
export interface OtherBranchAvailability {
  branchId: string;
  branchName: string;
  availableQuantity: number;
}

/** Componente de un Kit con su aporte a la disponibilidad derivada (calculado por el backend). */
export interface InventoryKitAvailabilityComponent {
  componentProductId: string;
  sku: string;
  productName: string;
  quantityPerKit: number;
  availableQuantity: number;
  kitCapacity: number;
  /** true en TODOS los componentes cuya capacidad iguala la disponibilidad del Kit. */
  limiting: boolean;
}

export interface InventoryKitAvailability {
  kitProductId: string;
  branchId: string;
  availableKits: number;
  components: InventoryKitAvailabilityComponent[];
}

export interface GetInventoryKitAvailabilityInput {
  kitProductId: string;
  branchId: string;
}

export interface GetOtherBranchesAvailabilityInput {
  productId: string;
  /** Sucursal activa: el backend la excluye y filtra por acceso. */
  branchId: string;
}

/** Tipos de producto que GET /inventory/stock puede devolver (parametro `productTypes`). */
export type InventoryStockProductType = "physical" | "service" | "kit";

/** Como participa un producto en el inventario: stock propio, ninguno, o derivado de componentes. */
export type InventoryProductMode = "TRACKED" | "NONE" | "DERIVED_KIT";

export type InventoryStockDisplayStatus =
  | "NORMAL"
  | "NEAR_MINIMUM"
  | "CRITICAL"
  | "OUT_OF_STOCK"
  | "NOT_CONTROLLED"
  | "KIT_AVAILABLE"
  | "KIT_UNAVAILABLE";

export interface InventoryStockPageParams {
  branchId: string;
  search?: string;
  categoryId?: string;
  status?: InventoryStockStatus;
  /** critical + near_minimum en una sola consulta paginada. Incompatible con `status`. */
  lowStock?: boolean;
  /** Sin este parametro el backend devuelve solo productos fisicos. */
  productTypes?: InventoryStockProductType[];
  page: number;
  pageSize: number;
  sort?: InventoryStockSort;
}

interface InventoryStockItemBase {
  productId: string;
  branchId: string;
  sku: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  baseUnitId: string;
}

/** Producto fisico con stock propio: unico caso con cantidades, minimos y estado fisico. */
export interface TrackedInventoryStockItem extends InventoryStockItemBase {
  productType: "physical";
  inventoryMode: "TRACKED";
  displayStatus: "NORMAL" | "NEAR_MINIMUM" | "CRITICAL" | "OUT_OF_STOCK";
  /**
   * Presentaciones del producto. Las cantidades de abajo siguen expresadas en UNIDAD BASE; el factor
   * es "1 <unidad> = factor <base>" y es null si un dato historico no tiene equivalencia.
   */
  inventoryUnitId: string;
  saleUnitId: string;
  inventoryToBaseFactor: number | null;
  saleToBaseFactor: number | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minStock: number;
  reorderPoint: number | null;
  defaultLocationId: string | null;
  defaultLocationName: string | null;
  status: InventoryStockStatus;
  suggestedReorder: number;
}

/** Servicio: no controla inventario; el backend no envia ninguna cantidad. */
export interface ServiceInventoryStockItem extends InventoryStockItemBase {
  productType: "service";
  inventoryMode: "NONE";
  displayStatus: "NOT_CONTROLLED";
  inventoryUnitId: null;
  saleUnitId: null;
  inventoryToBaseFactor: null;
  saleToBaseFactor: null;
  quantity: null;
  reservedQuantity: null;
  availableQuantity: null;
  minStock: null;
  reorderPoint: null;
  defaultLocationId: null;
  defaultLocationName: null;
  status: null;
  suggestedReorder: null;
}

/** Kit: solo `availableQuantity` (derivada de sus componentes); sin stock propio. */
export interface DerivedKitInventoryStockItem extends InventoryStockItemBase {
  productType: "kit";
  inventoryMode: "DERIVED_KIT";
  displayStatus: "KIT_AVAILABLE" | "KIT_UNAVAILABLE";
  inventoryUnitId: null;
  saleUnitId: null;
  inventoryToBaseFactor: null;
  saleToBaseFactor: null;
  quantity: null;
  reservedQuantity: null;
  availableQuantity: number;
  minStock: null;
  reorderPoint: null;
  defaultLocationId: null;
  defaultLocationName: null;
  status: null;
  suggestedReorder: null;
}

export type InventoryStockListItem =
  TrackedInventoryStockItem | ServiceInventoryStockItem | DerivedKitInventoryStockItem;

export interface InventoryStockPageResult {
  items: InventoryStockListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  summary: {
    activeProducts: number;
    lowStock: number;
    outOfStock: number;
  };
}

/** Una sola lectura de existencias de varios productos de UNA sucursal (POST /inventory/stock/batch). */
export interface GetInventoryStockBatchInput {
  branchId: string;
  /** Solo productos fisicos con control de stock; sin duplicados. */
  productIds: string[];
}

export interface InventoryStockBatchItem {
  productId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minStock: number;
  reorderPoint: number | null;
  status: InventoryStockStatus;
  suggestedReorder: number;
}

export interface InventoryStockBatchResult {
  branchId: string;
  items: InventoryStockBatchItem[];
}

export interface InventoryAlertPageParams {
  branchId: string;
  status?: Exclude<InventoryStockStatus, "normal">;
  page: number;
  pageSize: number;
}

export interface InventoryAlertListItem {
  productId: string;
  branchId: string;
  sku: string;
  productName: string;
  baseUnitId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minStock: number;
  reorderPoint: number | null;
  defaultLocationId: string | null;
  status: Exclude<InventoryStockStatus, "normal">;
  suggestedReorder: number;
}

export interface InventoryAlertPageResult {
  items: InventoryAlertListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PickingInventoryLotAvailability {
  lotId: string;
  lotNumber: string;
  expirationDate?: string;
  physicalQuantity: number;
  serialNumbers: Array<{ id: string; serialNumber: string }>;
}

export interface PickingInventoryLocationAvailability {
  balanceId: string;
  locationId?: string;
  locationCode?: string;
  locationName?: string;
  physicalQuantity: number;
  ownReservedQuantity: number;
  otherReservedQuantity: number;
  freeQuantity: number;
  usableQuantity: number;
  lots: PickingInventoryLotAvailability[];
  serialNumbers: Array<{ id: string; serialNumber: string; lotId?: string }>;
}

export interface PickingInventoryAvailability {
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  orderId?: string;
  productId: string;
  physicalQuantity: number;
  ownReservedQuantity: number;
  otherReservedQuantity: number;
  freeQuantity: number;
  usableQuantity: number;
  locations: PickingInventoryLocationAvailability[];
}

export interface GetPickingInventoryAvailabilityInput {
  tenantId: string;
  branchId: string;
  pickingOrderId: string;
  pickingItemId?: string;
  orderId?: string;
  sourceType?: "order" | "transfer";
  sourceId?: string;
  productId: string;
  at?: string;
}

export interface PickingFulfillmentTraceLocation {
  id: string;
  code: string;
  name: string;
}

export interface PickingFulfillmentTraceLot {
  id: string;
  number: string;
  expiresAt?: string;
}

export interface PickingFulfillmentTraceSerial {
  id: string;
  number: string;
}

export interface PickingFulfillmentTraceAllocation {
  inventoryMovementId?: string;
  reservationId: string;
  quantity: number;
  location?: PickingFulfillmentTraceLocation;
  lot?: PickingFulfillmentTraceLot;
  serial?: PickingFulfillmentTraceSerial;
  consumedAt?: string;
}

export interface PickingFulfillmentItemTrace {
  pickingItemId: string;
  orderItemId: string;
  productId: string;
  requestedQuantity: number;
  pickedQuantity: number;
  allocations: PickingFulfillmentTraceAllocation[];
}

export interface GetPickingFulfillmentTraceInput {
  tenantId: string;
  branchId: string;
  orderId: string;
  pickingOrderId: string;
}
export interface RegisterInventoryMovementInput {
  tenantId: string;
  branchId: string;
  productId: string;
  lotId?: string;
  type: InventoryMovementType;
  reason: string;
  quantity: number;
  quantityBefore?: number;
  quantityAfter?: number;
  fromLocationId?: string;
  toLocationId?: string;
  referenceType?: string;
  referenceId?: string;
  performedByUserId?: string;
}

export interface ReserveOrderItemInput {
  tenantId: string;
  branchId: string;
  orderId?: string;
  orderItemId: string;
  productId: string;
  quantity: number;
  sourceType?: "order" | "transfer";
  sourceId?: string;
}

export interface ReleaseInventoryReservationInput {
  tenantId: string;
  branchId: string;
  reservationId: string;
}

export interface ConsumeInventoryReservationInput extends ReleaseInventoryReservationInput {
  allocationsConsumed: InventoryReservationConsumedAllocation[];
  serialNumbers?: string[];
  operationId: string;
  performedByUserId: string;
}

export interface ConsumeInventoryReservationResult {
  reservation: InventoryReservation;
  inventoryMovements: InventoryMovement[];
  idempotent: boolean;
}

export type UpsertProductInventorySettingsInput = Omit<
  ProductInventorySettings,
  "id" | "createdAt" | "updatedAt" | "reorderPoint"
> & {
  /** undefined conserva el valor actual (API); null lo deja sin configurar; 0 es valido. */
  reorderPoint?: number | null;
};

export interface GetProductBalancesOptions {
  /** Omite cache/deduplicacion: requerido antes de una mutacion que depende del saldo observado. */
  fresh?: boolean;
}

export interface InventoryRepository {
  getBalances(): Promise<InventoryBalance[]>;
  getReservationById(tenantId: string, reservationId: string): Promise<InventoryReservation | null>;
  getReservationByOrderItem(
    tenantId: string,
    orderItemId: string,
  ): Promise<InventoryReservation | null>;
  reserveForOrderItem(input: ReserveOrderItemInput): Promise<InventoryReservation>;
  releaseReservation(input: ReleaseInventoryReservationInput): Promise<InventoryReservation>;
  consumeReservation(
    input: ConsumeInventoryReservationInput,
  ): Promise<ConsumeInventoryReservationResult>;
  getPickingAvailability(
    input: GetPickingInventoryAvailabilityInput,
  ): Promise<PickingInventoryAvailability>;
  getPickingFulfillmentTrace(
    input: GetPickingFulfillmentTraceInput,
  ): Promise<PickingFulfillmentItemTrace[]>;
  getBalanceByProduct(productId: string, branchId?: string): Promise<InventoryBalance[]>;
  /** Balances por ubicacion, incluido locationId NULL, de un producto y sucursal concretos. */
  getProductBalances(
    productId: string,
    branchId: string,
    tenantId: string,
    options?: GetProductBalancesOptions,
  ): Promise<InventoryBalance[]>;
  getMovements(productId?: string): Promise<InventoryMovement[]>;
  getMovementPage(params: InventoryMovementPageParams): Promise<InventoryMovementPageResult>;
  getStockPage(params: InventoryStockPageParams): Promise<InventoryStockPageResult>;
  /** Solo modo API: existencias de varios productos en una sola peticion. */
  getStockBatch(input: GetInventoryStockBatchInput): Promise<InventoryStockBatchResult>;
  /** Solo modo API: una request on-demand a GET /inventory/stock/branches. */
  getOtherBranchesAvailability(
    input: GetOtherBranchesAvailabilityInput,
  ): Promise<OtherBranchAvailability[]>;
  /** Solo modo API: explicacion on-demand de la disponibilidad derivada de un Kit. */
  getKitAvailability(input: GetInventoryKitAvailabilityInput): Promise<InventoryKitAvailability>;
  getInventoryAlertPage(params: InventoryAlertPageParams): Promise<InventoryAlertPageResult>;
  getLots(productId?: string): Promise<StockLot[]>;
  getSerialNumbers(productId?: string): Promise<SerialNumber[]>;
  getLocations(branchId?: string): Promise<StorageLocation[]>;
  createLocation(
    input: Omit<StorageLocation, "id" | "createdAt" | "updatedAt">,
  ): Promise<StorageLocation>;
  updateLocation(
    id: string,
    input: Partial<Omit<StorageLocation, "id" | "createdAt" | "updatedAt">>,
  ): Promise<StorageLocation>;
  getProductInventorySettings(
    productId: string,
    branchId: string,
  ): Promise<ProductInventorySettings | null>;
  upsertProductInventorySettings(
    input: UpsertProductInventorySettingsInput,
  ): Promise<ProductInventorySettings>;
  registerMovement(input: RegisterInventoryMovementInput): Promise<InventoryMovement>;
  adjustStock(input: Omit<RegisterInventoryMovementInput, "type">): Promise<InventoryMovement>;
  transferStock(
    input: Omit<RegisterInventoryMovementInput, "type" | "quantity"> & {
      quantity: number;
      fromLocationId: string;
      toLocationId: string;
    },
  ): Promise<InventoryMovement>;
}
