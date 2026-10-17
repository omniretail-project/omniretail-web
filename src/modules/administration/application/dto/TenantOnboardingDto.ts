/**
 * Input MÍNIMO del onboarding de un Tenant nuevo (feature/tenant-onboarding, auditoría §7) --
 * ningún campo aquí es de autoridad: `tenantId`, `roleId`, la lista de permisos,
 * `allowedBranchIds`, el status de la Subscription/AuthAccount, `isSystem` o cualquier branch id
 * preexistente se derivan SIEMPRE server-side en `TenantOnboardingService`/
 * `TenantOnboardingRepository` (auditoría §6). `defaultCurrency`/`timezone` son opcionales
 * porque `Tenant` ya los soporta y así el caller puede fijarlos; si se omiten, el service aplica
 * los mismos defaults ya usados en el resto de la base (GTQ / America/Guatemala).
 */
export interface TenantOnboardingInputDto {
  tenantName: string;
  tenantSlug: string;
  adminName: string;
  adminEmail: string;
  adminPasswordMock: string;
  planId: string;
  /** Optional for existing internal callers; public contracting always supplies it. */
  businessPreset?: BusinessPreset;
  defaultCurrency?: "GTQ" | "USD";
  timezone?: string;
}

/**
 * Salida de TenantOnboardingService.execute() -- entidades ya persistidas de forma atómica.
 * `authAccountId` en vez del `AuthAccount` completo: nada, ni siquiera internamente, necesita
 * `passwordHashMock` fuera de Auth.
 */
export interface TenantOnboardingResultDto {
  tenantId: string;
  tenantSlug: string;
  branchId: string;
  roleId: string;
  userId: string;
  authAccountId: string;
  subscriptionId: string;
  planId: string;
}
import type { BusinessPreset } from "@/core/enums";
