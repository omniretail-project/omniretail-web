import type {
  Branch,
  Category,
  Product,
  ProductInventorySettings,
  StockLot,
  StorageLocation,
  Unit,
} from "@/core/entities";
import type { InventoryTransferReason, InventoryTransferRequestStatus } from "@/core/enums";
import type {
  InventoryProductMode,
  InventoryStockDisplayStatus,
  InventoryStockProductType,
} from "@/core/repositories";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";

export type InventoryStatus = "normal" | "near_minimum" | "critical" | "out_of_stock";
export type AlertPanelMode = "alerts" | "product-detail";
export type InventoryAlertType = "low_stock" | "expiration" | "available_elsewhere";

export interface InventoryProductRow {
  productType: InventoryStockProductType;
  /**
   * Autoridad sobre como se muestra y opera el producto: solo TRACKED tiene stock propio y admite
   * ajustes, traslados y reposicion. NONE (servicio) y DERIVED_KIT no.
   */
  inventoryMode: InventoryProductMode;
  /** Estado a mostrar; para TRACKED equivale a `status`, para servicio/kit es su propio estado. */
  displayStatus: InventoryStockDisplayStatus;
  productId: string;
  tenantId: string;
  sku: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  unitId: string;
  unitName: string;
  unitAllowsDecimals: boolean;
  saleUnitId: string;
  saleUnitName: string;
  sellableQuantity: number;
  sellableReservedQuantity: number;
  sellableAvailableQuantity: number;
  inventoryUnitId: string;
  inventoryUnitName: string;
  inventoryPresentationQuantity: number;
  inventoryPresentationAvailableQuantity: number;
  inventoryToBaseFactor: number;
  /**
   * Nombre de la presentacion (inventario/venta) configurada en el producto cuando el backend no
   * trae su equivalencia a la unidad base: la fila queda en unidad base y no se inventa un factor.
   */
  inventoryConversionUnavailableUnitName?: string;
  saleConversionUnavailableUnitName?: string;
  adjustmentUnits: InventoryAdjustmentUnitOption[];
  branchId: string;
  branchName: string;
  defaultLocationId?: string | null;
  defaultLocationName: string;
  locationQuantities: Record<string, number>;
  locationAvailableQuantities: Record<string, number>;
  /**
   * Saldo heredado sin ubicacion (locationId NULL) de la sucursal. null = no determinable con los
   * datos cargados (modo API: /inventory/stock solo trae el balance operativo); nunca se fabrica.
   */
  unlocatedQuantity: number | null;
  unlocatedAvailableQuantity: number | null;
  /** Existencia fisica total de la sucursal (todos los balances). null = no determinable aun. */
  physicalQuantity?: number | null;
  /**
   * Balance operativo: ubicacion asignada y activa (o saldo heredado si no hay asignacion).
   * `quantity`, `reservedQuantity` y `availableQuantity` de la fila son estos mismos valores.
   */
  operationalQuantity?: number | null;
  operationalReservedQuantity?: number | null;
  operationalAvailableQuantity?: number | null;
  /**
   * El producto conserva existencias fuera de su balance operativo y necesita una regularizacion
   * explicita. null = por determinar (solo se conoce al consultar los balances fisicos).
   */
  requiresRegularization?: boolean | null;
  /**
   * Solo modo API, tras abrir el ajuste: el producto conserva existencias o reservas fuera de su
   * balance operativo. Entradas y conteos quedan bloqueados porque el saldo seria ambiguo.
   */
  hasStockOutsideOperationalBalance?: boolean;
  tracking: ProductTrackingConfig;
  availableLots: Array<{
    id: string;
    lotNumber: string;
    expirationDate?: string;
    quantity: number;
    locationId?: string;
  }>;
  availableSerials: Array<{ serialNumber: string; lotId?: string; locationId?: string }>;
  // Solo significativos con inventoryMode TRACKED (y availableQuantity/quantity para DERIVED_KIT, la
  // disponibilidad derivada). Para un servicio (NONE) valen 0 como relleno de tipo y NUNCA se
  // muestran: la UI ramifica por inventoryMode para no presentar un "sin existencias" falso.
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minStock: number;
  reorderPoint?: number;
  /** Estado FISICO; null para servicio y kit (usar `displayStatus`). */
  status: InventoryStatus | null;
  statusLabel: string;
  tracksExpiration: boolean;
  nextExpirationDate?: string;
  nextExpirationLabel: string;
  activeAlerts: InventoryAlert[];
  otherBranchStocks: BranchStockSummary[];
  isDerivedKit?: boolean;
}

export interface BranchStockSummary {
  branchId: string;
  branchName: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

export interface InventoryAlert {
  id: string;
  type: InventoryAlertType;
  productId: string;
  title: string;
  message: string;
  tone: "warning" | "danger" | "info";
  suggestedReorder?: number;
  row?: InventoryProductRow;
}

export interface InventoryKpis {
  activeProducts: number;
  lowStock: number;
  expiringSoon: number;
  outOfStock: number;
}

export interface InventoryAlertsData {
  /** Capacidad "Multiples ubicaciones" del negocio; apagada, los ajustes no llevan ubicacion. */
  supportsMultipleLocations: boolean;
  rows: InventoryProductRow[];
  alerts: InventoryAlert[];
  alertTotalItems: number;
  transferRequests: InventoryTransferRequestRow[];
  kpis: InventoryKpis;
  visibility: InventoryAlertsVisibility;
  branches: Branch[];
  categories: Category[];
  locations: StorageLocation[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface InventoryAlertsVisibility {
  supportsExpiration: boolean;
  hasExpirationProducts: boolean;
  showExpirationFeatures: boolean;
}

export interface InventoryTransferRequestRow {
  id: string;
  context: "received" | "response";
  productId: string;
  productName: string;
  sku: string;
  requestingBranchId: string;
  requestingBranchName: string;
  sourceBranchId: string;
  sourceBranchName: string;
  requestedQuantity: number;
  availableQuantity?: number;
  reason: InventoryTransferReason;
  notes?: string;
  status: InventoryTransferRequestStatus;
  rejectionReason?: string;
  requestedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  reviewedAt?: string;
}

export interface InventoryLookupMaps {
  categories: Map<string, Category>;
  units: Map<string, Unit>;
  branches: Map<string, Branch>;
  locations: Map<string, StorageLocation>;
  settingsByProduct: Map<string, ProductInventorySettings | null>;
  /** Ubicacion operativa por `${branchId}:${productId}`; null = sin asignacion. */
  assignedLocationIds: Map<string, string | null>;
  lotsByProduct: Map<string, StockLot[]>;
}

export function assignedLocationKey(branchId: string, productId: string) {
  return `${branchId}:${productId}`;
}

export interface AdjustStockDto {
  productId: string;
  branchId: string;
  locationId: string;
  unitId: string;
  movementKind: "in" | "out" | "waste" | "count";
  quantity: number;
  reason: string;
  notes: string;
  lotId?: string;
  lotNumber?: string;
  expirationDate?: string;
  serialNumbers?: string[];
  performedByUserId?: string;
}

export interface InventoryAdjustmentUnitOption {
  unitId: string;
  unitName: string;
  unitAllowsDecimals: boolean;
  toBaseFactor: number;
  label: string;
}

export interface TransferRequestDto {
  productId: string;
  requesterBranchId: string;
  providerBranchId: string;
  quantity: number;
  reason: InventoryTransferReason;
  notes: string;
}

export type ProductWithStock = Product & { tracking: Product["tracking"] & { stock: true } };
