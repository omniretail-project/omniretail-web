import type { BusinessPreset, PaymentMethod } from "@/core/enums";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";

export interface BusinessCapabilitiesConfig {
  tenantId: string;
  preset: BusinessPreset;
  supportsInventory: boolean;
  supportsLots: boolean;
  supportsExpiration: boolean;
  supportsSerials: boolean;
  supportsMultipleLocations: boolean;
  supportsUnitsAndPackaging: boolean;
  supportsProductAttributes: boolean;
  supportsKits: boolean;
  supportsServices: boolean;
  allowedPosPaymentMethods?: PaymentMethod[];
  defaultProductTracking: ProductTrackingConfig;
}
