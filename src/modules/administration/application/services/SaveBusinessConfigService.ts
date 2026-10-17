import { BusinessPreset } from "@/core/enums";
import { businessDefaultsConfig } from "@/config/business-defaults";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BusinessConfigDto } from "@/modules/administration/application/dto/BusinessConfigDto";
import { toBusinessConfigDto } from "@/modules/administration/application/mappers/BusinessConfigMapper";
import {
  AdministrationServiceError,
  ensureCanManageBusinessConfig,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  hasBusinessConfigValidationErrors,
  validateBusinessConfigDto,
} from "@/modules/administration/validation/businessConfig.validation";
import {
  BUSINESS_CAPABILITY_TO_SAAS_CAPABILITY,
  type MappedBusinessCapabilityKey,
} from "@/shared/application/services/businessCapabilityEntitlement";
import { hasTenantCapability, SaasEntitlementError } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

export class SaveBusinessConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    dto: BusinessConfigDto,
    permissions: readonly string[],
  ): Promise<BusinessConfigDto> {
    ensureCanManageBusinessConfig(permissions);
    ensureCoherentDto(dto);
    await this.ensureNoUnentitledCapabilityEnabled(tenantId, dto);

    const config = await this.repositories.businessConfig.updateCapabilities(tenantId, {
      ...dto,
      preset: resolvePreset(dto),
      defaultProductTracking: { ...dto.defaultProductTracking },
    });

    return toBusinessConfigDto(config);
  }

  /**
   * Auditoría §18: habilitar (false -> true) una business capability cuyo SaaS Plan NO incluye
   * la capability equivalente => DENY. Deshabilitar (cualquier transición a false, o quedarse en
   * false) SIEMPRE se permite -- evita dejar al Tenant sin forma de apagar algo que ya no puede
   * prender (lockout). Comparar contra el valor YA PERSISTIDO, no asumir `false`: si la config
   * previa no existe todavía (alta inicial), toda capability pedida en `true` cuenta como "se
   * está habilitando".
   */
  private async ensureNoUnentitledCapabilityEnabled(
    tenantId: string,
    dto: BusinessConfigDto,
  ): Promise<void> {
    const keysBeingEnabled = (
      Object.keys(BUSINESS_CAPABILITY_TO_SAAS_CAPABILITY) as MappedBusinessCapabilityKey[]
    ).filter((key) => dto[key]);
    if (keysBeingEnabled.length === 0) return;

    const current = await this.repositories.businessConfig.getCapabilities(tenantId);
    const newlyEnabledKeys = keysBeingEnabled.filter((key) => !current?.[key]);
    if (newlyEnabledKeys.length === 0) return;

    const entitlements = await new ResolveTenantEntitlementsService(this.repositories).execute(
      tenantId,
    );
    for (const key of newlyEnabledKeys) {
      if (!hasTenantCapability(entitlements, BUSINESS_CAPABILITY_TO_SAAS_CAPABILITY[key])) {
        throw new SaasEntitlementError(
          "CAPABILITY_REQUIRED",
          "Tu plan actual no incluye esta funcionalidad. Actualiza tu plan para habilitarla.",
        );
      }
    }
  }
}

/**
 * La coherencia entre capacidades y trazabilidad es una invariante del negocio, no una regla de
 * formulario: cualquier consumidor del service debe respetarla, no solo la pantalla.
 */
function ensureCoherentDto(dto: BusinessConfigDto) {
  const errors = validateBusinessConfigDto(dto);
  if (!hasBusinessConfigValidationErrors(errors)) return;

  throw new AdministrationServiceError(
    errors.inventory ?? errors.tracking ?? "La configuración del negocio no es coherente.",
  );
}

function resolvePreset(dto: BusinessConfigDto): BusinessPreset {
  if (dto.preset === BusinessPreset.custom) return BusinessPreset.custom;

  const defaults = businessDefaultsConfig[dto.preset];
  const matchesPreset =
    dto.supportsInventory === defaults.supportsInventory &&
    dto.supportsLots === defaults.supportsLots &&
    dto.supportsExpiration === defaults.supportsExpiration &&
    dto.supportsSerials === defaults.supportsSerials &&
    dto.supportsMultipleLocations === defaults.supportsMultipleLocations &&
    dto.supportsUnitsAndPackaging === defaults.supportsUnitsAndPackaging &&
    dto.supportsProductAttributes === defaults.supportsProductAttributes &&
    dto.supportsKits === defaults.supportsKits &&
    dto.supportsServices === defaults.supportsServices &&
    dto.defaultProductTracking.stock === defaults.defaultProductTracking.stock &&
    dto.defaultProductTracking.lot === defaults.defaultProductTracking.lot &&
    dto.defaultProductTracking.expiration === defaults.defaultProductTracking.expiration &&
    dto.defaultProductTracking.serial === defaults.defaultProductTracking.serial;

  return matchesPreset ? dto.preset : BusinessPreset.custom;
}
