import { BusinessPreset, PaymentMethod } from "@/core/enums";
import type { BusinessCapabilitiesConfig } from "@/core/entities";

type BusinessDefaults = Record<
  Exclude<BusinessPreset, BusinessPreset.custom>,
  Omit<BusinessCapabilitiesConfig, "tenantId">
>;

const baseDefaults = {
  supportsUnitsAndPackaging: true,
  supportsProductAttributes: true,
  supportsKits: true,
  supportsServices: true,
  allowedPosPaymentMethods: [PaymentMethod.cash, PaymentMethod.card, PaymentMethod.transfer] as PaymentMethod[],
};

export const businessDefaultsConfig: BusinessDefaults = {
  [BusinessPreset.hardware_store]: {
    preset: BusinessPreset.hardware_store,
    supportsInventory: true,
    supportsLots: false,
    supportsExpiration: false,
    supportsSerials: true,
    supportsMultipleLocations: true,
    ...baseDefaults,
    defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
  },
  [BusinessPreset.pharmacy]: {
    preset: BusinessPreset.pharmacy,
    supportsInventory: true,
    supportsLots: true,
    supportsExpiration: true,
    supportsSerials: false,
    supportsMultipleLocations: true,
    ...baseDefaults,
    defaultProductTracking: { stock: true, lot: true, expiration: true, serial: false },
  },
  [BusinessPreset.grocery]: {
    preset: BusinessPreset.grocery,
    supportsInventory: true,
    supportsLots: true,
    supportsExpiration: true,
    supportsSerials: false,
    supportsMultipleLocations: true,
    ...baseDefaults,
    defaultProductTracking: { stock: true, lot: true, expiration: true, serial: false },
  },
  [BusinessPreset.services]: {
    preset: BusinessPreset.services,
    supportsInventory: false,
    supportsLots: false,
    supportsExpiration: false,
    supportsSerials: false,
    supportsMultipleLocations: false,
    ...baseDefaults,
    defaultProductTracking: { stock: false, lot: false, expiration: false, serial: false },
  },
};
