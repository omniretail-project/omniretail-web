import type { Tenant } from "@/core/entities";
export interface TenantRepository {
  getAll(): Promise<Tenant[]>;
  getById(id: string): Promise<Tenant | null>;
  getBySlug(slug: string): Promise<Tenant | null>;
  /**
   * Alta directa de un Tenant fuera del onboarding atómico -- foundation contract requerido por
   * la auditoría (feature/tenant-onboarding): antes de este PR, `TenantRepository` era de solo
   * lectura y no existía forma alguna de crear un Tenant en runtime. El flujo de onboarding real
   * (`TenantOnboardingService` + `TenantOnboardingRepository`) NO usa este método: necesita que
   * Tenant/Branch/Role/User/AuthAccount/Subscription se persistan en una única unidad atómica, y
   * este `create` abre su propio `store.mutate()` independiente (ver docstring de
   * `MockTenantOnboardingRepository`). Se agrega igual porque la auditoría lo pide como capacidad
   * mínima de foundation, coherente con el mismo patrón `create` de Branch/Role/User.
   */
  create(input: Omit<Tenant, "id" | "createdAt" | "updatedAt">): Promise<Tenant>;
}
