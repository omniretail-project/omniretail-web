import type { BusinessConfigDto } from "@/modules/administration/application/dto/BusinessConfigDto";

export interface BusinessConfigValidationErrors {
  inventory?: string;
  tracking?: string;
}

export function enforceBusinessConfigCoherence(dto: BusinessConfigDto): BusinessConfigDto {
  const coherentDto: BusinessConfigDto = {
    ...dto,
    defaultProductTracking: { ...dto.defaultProductTracking },
  };

  if (!coherentDto.supportsInventory) {
    coherentDto.supportsLots = false;
    coherentDto.supportsExpiration = false;
    coherentDto.supportsSerials = false;
    coherentDto.supportsMultipleLocations = false;
    coherentDto.defaultProductTracking = {
      stock: false,
      lot: false,
      expiration: false,
      serial: false,
    };
    return coherentDto;
  }

  const supportsTraceability = coherentDto.supportsLots || coherentDto.supportsExpiration;
  coherentDto.supportsLots = supportsTraceability;
  coherentDto.supportsExpiration = supportsTraceability;
  const defaultTraceability =
    coherentDto.defaultProductTracking.lot || coherentDto.defaultProductTracking.expiration;
  coherentDto.defaultProductTracking.lot = defaultTraceability;
  coherentDto.defaultProductTracking.expiration = defaultTraceability;

  if (!coherentDto.supportsLots) coherentDto.defaultProductTracking.lot = false;
  if (!coherentDto.supportsExpiration) coherentDto.defaultProductTracking.expiration = false;
  if (!coherentDto.supportsSerials) coherentDto.defaultProductTracking.serial = false;

  return coherentDto;
}

export function validateBusinessConfigDto(dto: BusinessConfigDto): BusinessConfigValidationErrors {
  const errors: BusinessConfigValidationErrors = {};
  const hasInventoryCapabilities =
    dto.supportsLots ||
    dto.supportsExpiration ||
    dto.supportsSerials ||
    dto.supportsMultipleLocations;
  const hasTracking = Object.values(dto.defaultProductTracking).some(Boolean);

  if (!dto.supportsInventory && hasInventoryCapabilities) {
    errors.inventory =
      "Las capacidades de inventario no pueden permanecer activas sin control de inventario.";
  }

  if (
    (!dto.supportsInventory && hasTracking) ||
    (dto.defaultProductTracking.lot && !dto.supportsLots) ||
    (dto.defaultProductTracking.expiration && !dto.supportsExpiration) ||
    (dto.defaultProductTracking.serial && !dto.supportsSerials)
  ) {
    errors.tracking = "La trazabilidad por defecto requiere activar sus capacidades relacionadas.";
  }

  return errors;
}

export function hasBusinessConfigValidationErrors(errors: BusinessConfigValidationErrors) {
  return Object.values(errors).some(Boolean);
}
