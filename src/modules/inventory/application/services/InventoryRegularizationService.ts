import { ProductType } from "@/core/enums";
import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationResult,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  RegularizationDestination,
  RegularizationProductOption,
} from "@/modules/inventory/application/dto/InventoryRegularizationDto";
import {
  ensureCanCreateAdjustment,
  ensureCanReadStock,
  ensureTenantCanUseInventory,
  ensureUserCanOperateInventoryBranch,
  InventoryServiceError,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";
import {
  REGULARIZATION_ASSIGN_PERMISSION,
  REGULARIZATION_FINGERPRINT_LENGTH,
  validateRegularizationReason,
} from "@/modules/inventory/validation/inventoryRegularization.validation";

const PRODUCT_SEARCH_PAGE_SIZE = 20;
const ACTIVE_LOCATION_STATUS = "active";

export const REGULARIZATION_API_ONLY_MESSAGE =
  "La regularización de ubicaciones solo está disponible con el backend conectado.";

export const REGULARIZATION_ASSIGN_PERMISSION_MESSAGE =
  "No dispone de permisos para asignar ubicaciones de inventario: se requieren ajustes de inventario y actualización de productos.";

/**
 * Regularizacion administrativa del inventario heredado sin ubicacion. Solo modo API: no existe un
 * equivalente mock y no hay fallback silencioso. Tenant, permisos, capacidad y alcance de sucursal
 * se resuelven desde la sesion; el backend vuelve a autorizar cada operacion.
 */
export class InventoryRegularizationService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  /** Productos fisicos con control de stock; el catalogo ya viene acotado al negocio actual. */
  async searchProducts(branchId: string, search: string): Promise<RegularizationProductOption[]> {
    const { tenantId } = await this.authorizeRead(branchId);
    const page = await this.repositories.products.getPageScoped(tenantId, {
      page: 1,
      pageSize: PRODUCT_SEARCH_PAGE_SIZE,
      search: search.trim() || undefined,
      productType: ProductType.physical,
    });
    return page.items
      .filter(
        (product) =>
          product.tenantId === tenantId &&
          product.productType === ProductType.physical &&
          product.tracking.stock,
      )
      .map((product) => ({ id: product.id, name: product.name, sku: product.sku }));
  }

  /**
   * Destino REAL de la regularizacion a partir de GET .../options (permiso inventory.stock.read):
   * ya no depende de catalog.locations.read. Con ubicacion asignada se usa esa (nunca se ofrece
   * otra); sin ella se entregan las activas que el backend considera asignables.
   */
  async resolveDestination(
    branchId: string,
    productId: string,
  ): Promise<RegularizationDestination> {
    await this.authorizeRead(branchId);
    const options = await this.repositories.inventoryAdjustments.getLocationRegularizationOptions({
      branchId,
      productId,
    });
    if (options.branchId !== branchId || options.productId !== productId) {
      throw new InventoryServiceError(
        "La información recibida no corresponde al producto y la sucursal seleccionados.",
      );
    }
    if (!options.locationsEnabled) return { kind: "locations_disabled" };
    if (options.assignedLocationId) {
      const assigned = options.assignedLocation;
      if (!assigned || assigned.id !== options.assignedLocationId) {
        return { kind: "unavailable", locationId: options.assignedLocationId };
      }
      return {
        kind: "assigned",
        locationId: assigned.id,
        locationName: assigned.name,
        locationCode: assigned.code,
        active: assigned.status.toLowerCase() === ACTIVE_LOCATION_STATUS,
      };
    }
    return {
      kind: "unassigned",
      assignableLocations: options.assignableLocations
        .filter((location) => location.status.toLowerCase() === ACTIVE_LOCATION_STATUS)
        .map((location) => ({ id: location.id, code: location.code, name: location.name })),
    };
  }

  async preview(
    branchId: string,
    productId: string,
    locationId: string,
    assign = false,
  ): Promise<LegacyBalanceRegularizationPreview> {
    await this.authorizeRead(branchId);
    return this.repositories.inventoryAdjustments.previewLocationRegularization({
      branchId,
      productId,
      locationId,
      ...(assign ? { assign: true } : {}),
    });
  }

  /**
   * Un solo POST con el cuerpo recibido, tal cual. Las comprobaciones previas fallan como
   * InventoryServiceError (definitivas: nada se envio); cualquier error posterior viene del envio.
   */
  async regularize(input: RegularizeLocationBalanceInput): Promise<LocationRegularizationResult> {
    await this.authorizeExecute(input);
    return this.repositories.inventoryAdjustments.regularizeLocationBalance(input);
  }

  private ensureApiMode() {
    if (this.repositories.inventoryStockDataSource !== "api") {
      throw new InventoryServiceError(REGULARIZATION_API_ONLY_MESSAGE);
    }
  }

  private async authorizeRead(branchId: string) {
    this.ensureApiMode();
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureTenantCanUseInventory(this.repositories, tenantId);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, branchId);
    return { tenantId };
  }

  private async authorizeExecute(input: RegularizeLocationBalanceInput) {
    try {
      this.ensureApiMode();
      const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
      ensureCanCreateAdjustment(permissions);
      // La asignacion inicial modifica la configuracion del producto: exige ademas actualizarlo.
      if (input.assignDestination === true && !permissions.includes(REGULARIZATION_ASSIGN_PERMISSION)) {
        throw new InventoryServiceError(REGULARIZATION_ASSIGN_PERMISSION_MESSAGE);
      }
      await ensureTenantCanUseInventory(this.repositories, tenantId);
      await ensureUserCanOperateInventoryBranch(this.repositories, user, input.branchId);
      const reasonError = validateRegularizationReason(input.reason);
      if (reasonError) throw new InventoryServiceError(reasonError);
      if (input.snapshotFingerprint.length !== REGULARIZATION_FINGERPRINT_LENGTH) {
        throw new InventoryServiceError("La vista previa no es válida. Vuelve a consultarla.");
      }
    } catch (error) {
      if (error instanceof InventoryServiceError) throw error;
      throw new InventoryServiceError(
        error instanceof Error ? error.message : "No se pudo validar la operación.",
      );
    }
  }
}
