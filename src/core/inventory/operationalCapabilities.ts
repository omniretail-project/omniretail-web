import type { BusinessCapabilitiesConfig } from "@/core/entities";

type InventoryLocationCapabilities = Pick<
  BusinessCapabilitiesConfig,
  "supportsInventory" | "supportsMultipleLocations"
>;

export const INVALID_INVENTORY_LOCATION_CAPABILITIES_MESSAGE =
  "Las ubicaciones operativas solo pueden estar activas junto con el control de inventario.";

/** Contrato del backend: false/true es invalido y no se normaliza en silencio al escribir. */
export function hasInvalidInventoryLocationCapabilities(
  config: InventoryLocationCapabilities,
): boolean {
  return !config.supportsInventory && config.supportsMultipleLocations;
}

/**
 * `supportsInventory` implica `supportsMultipleLocations`: true/false se normaliza a true/true.
 * La capacidad de ubicaciones es derivada, nunca un ajuste independiente.
 */
export function withDerivedInventoryLocations<T extends InventoryLocationCapabilities>(
  config: T,
): T {
  return config.supportsMultipleLocations === config.supportsInventory
    ? config
    : { ...config, supportsMultipleLocations: config.supportsInventory };
}

/** Normaliza y rechaza combinaciones invalidas antes de persistir una configuracion. */
export function normalizeInventoryLocationCapabilities<T extends InventoryLocationCapabilities>(
  config: T,
): T {
  if (hasInvalidInventoryLocationCapabilities(config)) {
    throw new Error(INVALID_INVENTORY_LOCATION_CAPABILITIES_MESSAGE);
  }
  return withDerivedInventoryLocations(config);
}
