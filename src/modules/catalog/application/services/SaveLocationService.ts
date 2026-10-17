import { LocationStatus } from "@/core/enums";
import type { StorageLocation } from "@/core/entities";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { LocationEditorDto } from "@/modules/catalog/application/dto/LocationEditorDto";
import {
  CatalogServiceError,
  ensureCanManageLocations,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";
import { getReferenceDataCache, referenceDataPrefixes } from "@/shared/utils/requestCache";
import { normalizeLocationCode } from "@/modules/catalog/validation/location.validation";

export const ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE =
  "No se puede archivar ni inactivar una ubicacion asignada a productos. Desasigna los productos e intenta nuevamente.";

export class SaveLocationService {
  private readonly referenceCache;

  constructor(private readonly repositories: RepositoryRegistry) {
    this.referenceCache = getReferenceDataCache(repositories);
  }

  async create(dto: LocationEditorDto): Promise<StorageLocation> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageLocations(permissions);
    if (!tenantId) throw new CatalogServiceError("No se pudo resolver el negocio activo.");

    const saved = await this.repositories.inventory.createLocation({
      tenantId,
      branchId: dto.branchId,
      parentId: dto.parentId || undefined,
      code: resolveCode(dto),
      name: dto.name.trim(),
      type: dto.type,
      description: cleanDescription(dto.description),
      status: dto.status,
    });
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.locations);
    return saved;
  }

  async update(locationId: string, dto: LocationEditorDto): Promise<StorageLocation> {
    const { permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageLocations(permissions);
    const saved = await this.saveStatusAwareMutation(dto.status, () =>
      this.repositories.inventory.updateLocation(locationId, {
        branchId: dto.branchId,
        parentId: dto.parentId || undefined,
        code: resolveCode(dto),
        name: dto.name.trim(),
        description: cleanDescription(dto.description),
        status: dto.status,
      }),
    );
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.locations);
    return saved;
  }

  async archive(locationId: string): Promise<StorageLocation> {
    const { permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageLocations(permissions);
    const saved = await this.saveStatusAwareMutation(LocationStatus.archived, () =>
      this.repositories.inventory.updateLocation(locationId, {
        status: LocationStatus.archived,
      }),
    );
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.locations);
    return saved;
  }

  async restore(locationId: string): Promise<StorageLocation> {
    const { permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageLocations(permissions);
    const saved = await this.repositories.inventory.updateLocation(locationId, {
      status: LocationStatus.active,
    });
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.locations);
    return saved;
  }

  private async saveStatusAwareMutation(
    targetStatus: LocationStatus,
    mutation: () => Promise<StorageLocation>,
  ): Promise<StorageLocation> {
    try {
      return await mutation();
    } catch (error) {
      throw toLocationStatusMutationError(error, targetStatus);
    }
  }
}

export function toLocationStatusMutationError(error: unknown, targetStatus: LocationStatus): Error {
  if (targetStatus !== LocationStatus.active && isAssignedLocationConflict(error)) {
    return new CatalogServiceError(ASSIGNED_LOCATION_STATUS_CONFLICT_MESSAGE);
  }
  return error instanceof Error
    ? error
    : new CatalogServiceError("No se pudo actualizar la ubicacion.");
}

/**
 * Solo el conflicto "ubicacion asignada a productos" recibe el mensaje aprobado. Otros 409 (por
 * ejemplo LOCATION_HAS_STOCK: la ubicacion contiene inventario) conservan su propio mensaje. El mock
 * lanza un Error simple con el mismo texto de negocio, asi que se reconoce por su mensaje.
 */
function isAssignedLocationConflict(error: unknown): boolean {
  if (error instanceof BackendRequestError) {
    return error.status === 409 && /ASSIGNED/i.test(error.code ?? "");
  }
  return error instanceof Error && /asignada a productos/i.test(error.message);
}

function resolveCode(dto: LocationEditorDto) {
  return normalizeLocationCode(dto.code || dto.name);
}

function cleanDescription(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}
