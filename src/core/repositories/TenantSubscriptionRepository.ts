import type { SubscriptionInvoice, TenantSubscription } from "@/core/entities";

/**
 * Tenant-scoped -- `getByTenantId` nunca devuelve la Subscription de otro tenant. `update` es la
 * única mutación expuesta hoy y la usa `ChangeTenantPlanService` (cambio de Plan). `create` sigue
 * reservado a seed/onboarding.
 */
export interface TenantSubscriptionRepository {
  getByTenantId(tenantId: string): Promise<TenantSubscription | null>;
  listInvoices(tenantId: string): Promise<SubscriptionInvoice[]>;
  ensureInvoice(input: SubscriptionInvoice): Promise<SubscriptionInvoice>;
  create(
    input: Omit<TenantSubscription, "id" | "createdAt" | "updatedAt">,
  ): Promise<TenantSubscription>;
  update(
    tenantId: string,
    input: Partial<Omit<TenantSubscription, "id" | "tenantId" | "createdAt" | "updatedAt">>,
  ): Promise<TenantSubscription>;
}
