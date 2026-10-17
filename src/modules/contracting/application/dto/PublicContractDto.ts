/**
 * Únicos datos que una persona puede decidir al contratar MARJYM Base.
 * Deliberadamente no incluye tenant/branch/role IDs, plan, addons, permisos, capabilities,
 * límites ni estados. `confirmPassword` pertenece sólo al formulario y nunca cruza este boundary.
 */
export interface CreatePublicContractInputDto {
  businessName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  businessPreset?: BusinessPreset;
}

/** Resultado público mínimo; no expone la cuenta Auth ni IDs internos de rol/sucursal/usuario. */
export interface CreatePublicContractResultDto {
  tenantId: string;
  tenantSlug: string;
  planId: string;
}
import type { BusinessPreset } from "@/core/enums";
