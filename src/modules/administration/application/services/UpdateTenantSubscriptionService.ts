import { PlanStatus } from "@/core/enums";
import { isSubscriptionAddonCode } from "@/core/subscription/catalog";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { ensureCurrentSubscriptionInvoice } from "@/modules/administration/application/services/subscriptionBilling";
import {
  AdministrationServiceError,
  ensureCanManagePlans,
  ensurePlanActor,
  ensurePlanTenant,
} from "@/modules/administration/application/services/serviceHelpers";

export class UpdateTenantSubscriptionService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, requestedCodes: readonly string[], permissions: readonly string[], actorUserId: string) {
    ensureCanManagePlans(permissions);
    ensurePlanTenant(tenantId);
    ensurePlanActor(actorUserId);
    if (requestedCodes.some((code) => !isSubscriptionAddonCode(code)) || new Set(requestedCodes).size !== requestedCodes.length) {
      throw new AdministrationServiceError("La selección de complementos no es válida.");
    }
    const subscription = await this.repositories.tenantSubscriptions.getByTenantId(tenantId);
    if (!subscription || subscription.tenantId !== tenantId) {
      throw new AdministrationServiceError("La suscripción no está disponible para el negocio activo.");
    }
    const plan = await this.repositories.plans.getById(subscription.planId);
    if (!plan || plan.status !== PlanStatus.active) {
      throw new AdministrationServiceError("El plan base no está disponible.");
    }
    const next = [...requestedCodes].sort();
    const previous = [...(subscription.addonCodes ?? [])].sort();
    if (next.join("|") === previous.join("|")) {
      return new GetTenantSubscriptionDetailsService(this.repositories).execute(tenantId, permissions);
    }
    // Snapshot del ciclo vigente ANTES del cambio; el nuevo precio inicia en el próximo ciclo.
    await ensureCurrentSubscriptionInvoice(this.repositories, subscription);
    await this.repositories.tenantSubscriptions.update(tenantId, { addonCodes: next });
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "tenant_subscription.addons_changed",
      entityType: "TenantSubscription",
      entityId: subscription.id,
      metadata: { previousAddonCodes: previous, newAddonCodes: next },
    });
    return new GetTenantSubscriptionDetailsService(this.repositories).execute(tenantId, permissions);
  }
}
