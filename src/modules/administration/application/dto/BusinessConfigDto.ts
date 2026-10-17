import type { BusinessCapabilitiesConfig } from "@/core/entities";

export type BusinessConfigDto = Omit<BusinessCapabilitiesConfig, "tenantId">;
