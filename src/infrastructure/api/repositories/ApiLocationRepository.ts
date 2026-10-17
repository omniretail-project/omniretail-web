import { LocationStatus } from "@/core/enums";
import type { StorageLocation } from "@/core/entities";
import type { InventoryRepository, ProductRepository } from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  fetchAllApiPages,
  type ApiLocation,
} from "@/infrastructure/api/repositories/catalogMasterDataApi";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  apiInventorySettingsSchema,
  parseApi,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";

type LocationCreate = Omit<StorageLocation, "id" | "createdAt" | "updatedAt">;
type LocationUpdate = Partial<LocationCreate>;

export class ApiLocationRepository {
  constructor(
    private readonly eventBus: DataEventBus,
    private readonly products?: ProductRepository,
  ) {}

  withInventoryDelegate(delegate: InventoryRepository): InventoryRepository {
    const getLocations = this.getLocations.bind(this);
    const createLocation = this.createLocation.bind(this);
    const updateLocation = this.updateLocation.bind(this);
    const getProductInventorySettings = this.getProductInventorySettings.bind(this);
    const upsertProductInventorySettings = this.upsertProductInventorySettings.bind(this);
    return new Proxy(delegate, {
      get: (target, property) => {
        if (property === "getLocations") return getLocations;
        if (property === "createLocation") return createLocation;
        if (property === "updateLocation") return updateLocation;
        if (this.products && property === "getProductInventorySettings") {
          return getProductInventorySettings;
        }
        if (this.products && property === "upsertProductInventorySettings") {
          return upsertProductInventorySettings;
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  async getLocations(branchId?: string) {
    assertOptionalApiUuid(branchId, "branchId");
    const locations = await fetchAllApiPages<ApiLocation>("/catalog/locations", { branchId });
    return locations.map(toLocation);
  }

  async createLocation(input: LocationCreate) {
    assertApiUuid(input.branchId, "branchId");
    assertOptionalApiUuid(input.parentId, "parentId");
    if (!isApiLocationType(input.type)) {
      throw new BackendRequestError("El tipo de ubicación no es compatible con el backend.", 400);
    }
    const location = toLocation(
      await backendFetch<ApiLocation>("/catalog/locations", {
        method: "POST",
        body: {
          branchId: input.branchId,
          parentId: input.parentId || null,
          code: input.code,
          name: input.name,
          type: input.type,
          status: input.status,
        },
      }),
    );
    this.emit(location, "created");
    return location;
  }

  async updateLocation(id: string, input: LocationUpdate) {
    assertApiUuid(id, "locationId");
    const current = await this.getById(id);
    if (!current)
      throw new BackendRequestError("Ubicación no encontrada.", 404, "LOCATION_NOT_FOUND");

    if (input.status === LocationStatus.archived && Object.keys(input).length === 1) {
      await backendFetch<void>(`/catalog/locations/${id}`, { method: "DELETE" });
      const archived = { ...current, status: LocationStatus.archived };
      this.emit(archived, "archived");
      return archived;
    }

    const location = toLocation(
      await backendFetch<ApiLocation>(`/catalog/locations/${id}`, {
        method: "PUT",
        body: {
          name: input.name ?? current.name,
          status: input.status ?? current.status,
        },
      }),
    );
    this.emit(location, "updated");
    return location;
  }

  async getProductInventorySettings(productId: string, branchId: string) {
    assertApiUuid(productId, "productId");
    assertApiUuid(branchId, "branchId");
    const product = await this.products?.getById(productId);
    if (!product) return null;
    const item = await this.getApiProductInventorySettings(productId, branchId);
    if (!item) return null;
    return {
      ...item,
      tenantId: product.tenantId,
      minStock: Number(item.minStock),
      reorderPoint: item.reorderPoint == null ? undefined : Number(item.reorderPoint),
      defaultLocationId: item.defaultLocationId ?? undefined,
    };
  }

  async upsertProductInventorySettings(
    input: Parameters<InventoryRepository["upsertProductInventorySettings"]>[0],
  ) {
    assertApiUuid(input.productId, "productId");
    assertApiUuid(input.branchId, "branchId");
    assertOptionalApiUuid(input.defaultLocationId, "defaultLocationId");
    const needsCurrent = input.reorderPoint === undefined || input.defaultLocationId === undefined;
    const current = needsCurrent
      ? await this.getApiProductInventorySettings(input.productId, input.branchId)
      : null;
    const item = parseApi(
      apiInventorySettingsSchema,
      await backendFetch<unknown>(`/inventory/settings/${input.productId}`, {
        method: "PUT",
        query: { branchId: input.branchId },
        body: {
          minStock: input.minStock,
          reorderPoint:
            input.reorderPoint === undefined ? (current?.reorderPoint ?? null) : input.reorderPoint,
          defaultLocationId:
            input.defaultLocationId === undefined
              ? (current?.defaultLocationId ?? null)
              : input.defaultLocationId,
        },
      }),
      "El backend devolvió configuración de inventario inválida.",
    );
    const settings = {
      ...item,
      tenantId: input.tenantId,
      minStock: Number(item.minStock),
      reorderPoint: item.reorderPoint == null ? undefined : Number(item.reorderPoint),
      defaultLocationId: item.defaultLocationId ?? undefined,
    };
    this.eventBus.emit("inventory.changed", {
      entityId: settings.id,
      tenantId: settings.tenantId,
      branchId: settings.branchId,
      productId: settings.productId,
      action: "updated",
      metadata: { entity: "ProductInventorySettings" },
    });
    return settings;
  }

  private async getApiProductInventorySettings(productId: string, branchId: string) {
    const response = await backendFetch<unknown>(`/inventory/settings/${productId}`, {
      query: { branchId },
    });
    if (response === undefined) return null;
    return parseApi(
      apiInventorySettingsSchema,
      response,
      "El backend devolvió configuración de inventario inválida.",
    );
  }

  private async getById(id: string) {
    assertApiUuid(id, "locationId");
    try {
      return toLocation(await backendFetch<ApiLocation>(`/catalog/locations/${id}`));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  private emit(location: StorageLocation, action: "created" | "updated" | "archived") {
    this.eventBus.emit("inventory.changed", {
      entityId: location.id,
      tenantId: location.tenantId,
      branchId: location.branchId,
      action,
      metadata: { entity: "StorageLocation" },
    });
  }
}

function toLocation(location: ApiLocation): StorageLocation {
  return {
    ...location,
    parentId: location.parentId ?? undefined,
  };
}

function isApiLocationType(type: StorageLocation["type"]): type is ApiLocation["type"] {
  return type === "warehouse" || type === "aisle" || type === "shelf" || type === "level";
}
