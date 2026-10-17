import { UnitStatus } from "@/core/enums";
import type { Unit } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { UnitEditorDto } from "@/modules/catalog/application/dto/UnitEditorDto";
import {
  CatalogServiceError,
  ensureCanManageUnits,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";
import { getReferenceDataCache, referenceDataPrefixes } from "@/shared/utils/requestCache";

export class SaveUnitService {
  private readonly referenceCache;

  constructor(private readonly repositories: RepositoryRegistry) {
    this.referenceCache = getReferenceDataCache(repositories);
  }

  async create(dto: UnitEditorDto): Promise<Unit> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageUnits(permissions);
    if (!tenantId) throw new CatalogServiceError("No se pudo resolver el negocio activo.");

    const saved = await this.repositories.units.create({
      tenantId,
      code: buildUnitCode(dto.symbol, dto.name),
      name: dto.name.trim(),
      symbol: dto.symbol.trim(),
      category: dto.category,
      allowsDecimals: dto.allowsDecimals,
      status: dto.status,
    });
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.units);
    return saved;
  }

  async update(unitId: string, dto: UnitEditorDto): Promise<Unit> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageUnits(permissions);
    const saved = await this.repositories.units.updateScoped(tenantId, unitId, {
      name: dto.name.trim(),
      symbol: dto.symbol.trim(),
      category: dto.category,
      allowsDecimals: dto.allowsDecimals,
      status: dto.status,
    });
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.units);
    return saved;
  }

  async archive(unitId: string): Promise<Unit> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageUnits(permissions);
    const saved = await this.repositories.units.updateScoped(tenantId, unitId, {
      status: UnitStatus.archived,
    });
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.units);
    return saved;
  }

  async restore(unitId: string): Promise<Unit> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanManageUnits(permissions);
    const saved = await this.repositories.units.updateScoped(tenantId, unitId, {
      status: UnitStatus.active,
    });
    this.referenceCache.invalidatePrefix(referenceDataPrefixes.units);
    return saved;
  }
}

function buildUnitCode(symbol: string, fallbackName: string) {
  const source = symbol.trim() || fallbackName.trim();
  const normalized = source
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "UNIDAD";
}
