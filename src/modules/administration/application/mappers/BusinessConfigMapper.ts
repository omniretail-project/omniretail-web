import type { BusinessCapabilitiesConfig } from "@/core/entities";
import type { BusinessConfigDto } from "@/modules/administration/application/dto/BusinessConfigDto";

export function toBusinessConfigDto(config: BusinessCapabilitiesConfig): BusinessConfigDto {
  return {
    preset: config.preset,
    supportsInventory: config.supportsInventory,
    supportsLots: config.supportsLots,
    supportsExpiration: config.supportsExpiration,
    supportsSerials: config.supportsSerials,
    supportsMultipleLocations: config.supportsMultipleLocations,
    supportsUnitsAndPackaging: config.supportsUnitsAndPackaging,
    supportsProductAttributes: config.supportsProductAttributes,
    supportsKits: config.supportsKits,
    supportsServices: config.supportsServices,
    allowedPosPaymentMethods: [...(config.allowedPosPaymentMethods ?? [])],
    defaultProductTracking: { ...config.defaultProductTracking },
  };
}
