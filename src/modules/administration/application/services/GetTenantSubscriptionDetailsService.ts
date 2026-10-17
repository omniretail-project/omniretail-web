import { SaasCapabilityKey, SaasLimitKey } from "@/core/enums";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { ensureCurrentSubscriptionInvoice } from "@/modules/administration/application/services/subscriptionBilling";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  SelectablePlanDto,
  SubscriptionCapabilityDto,
  TenantSubscriptionDetailsDto,
} from "@/modules/administration/application/dto/SubscriptionDto";
import { GetTenantUsageService } from "@/modules/administration/application/services/GetTenantUsageService";
import {
  AdministrationServiceError,
  ensureCanReadPlans,
  ensurePlanTenant,
} from "@/modules/administration/application/services/serviceHelpers";

/**
 * Read model único para la pantalla "Planes y Suscripción" (§10 del ticket foundation) -- la UI
 * consume ESTE contrato, nunca recalcula entitlements/usage/downgrade eligibility por su cuenta
 * (§15). Distingue explícitamente ENTITLEMENT ("el Tenant tiene derecho comercial a usar X",
 * plan.capabilities) de BUSINESS CONFIG ("el negocio decidió configurar/activar X",
 * EcommerceConfig.enabled) -- ver §8: `operationalStatus` es SOLO presentación, nunca convierte
 * un entitlement=false en derecho comercial ni viceversa.
 */
export class GetTenantSubscriptionDetailsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    permissions: readonly string[],
  ): Promise<TenantSubscriptionDetailsDto> {
    ensureCanReadPlans(permissions);
    ensurePlanTenant(tenantId);

    const subscription = await this.repositories.tenantSubscriptions.getByTenantId(tenantId);
    if (!subscription) {
      throw new AdministrationServiceError(
        "El negocio activo no tiene una suscripción configurada.",
      );
    }

    const plan = await this.repositories.plans.getById(subscription.planId);
    if (!plan) {
      throw new AdministrationServiceError(
        "El plan asociado a la suscripción del negocio ya no existe.",
      );
    }

    const usage = await new GetTenantUsageService(this.repositories).execute(tenantId);
    const entitlements = await new ResolveTenantEntitlementsService(this.repositories).execute(tenantId);
    const addonCodes = subscription.addonCodes ?? [];
    const { nextRenewalAt } = await ensureCurrentSubscriptionInvoice(this.repositories, subscription);
    const invoices = await this.repositories.tenantSubscriptions.listInvoices(tenantId);
    const activePlans = await this.repositories.plans.listActive();
    const availablePlans: SelectablePlanDto[] = activePlans.map((activePlan) => ({
      id: activePlan.id,
      code: activePlan.code,
      name: activePlan.name,
      description: activePlan.description,
      capabilities: [...activePlan.capabilities],
    }));

    // Ecommerce: entitlement (plan.capabilities) Y business config (EcommerceConfig.enabled) son
    // ejes INDEPENDIENTES -- solo se lee EcommerceConfig para mostrar el estado operacional
    // cuando el plan efectivamente incluye la capability; un entitlement=false nunca consulta ni
    // depende de EcommerceConfig.enabled (§8: enforcement cross-module queda para otro PR).
    const includesEcommerce = entitlements.capabilities.includes(SaasCapabilityKey.ecommerce);
    const ecommerceConfig = includesEcommerce
      ? await this.repositories.businessConfig.getEcommerceConfig(tenantId)
      : null;

    const capabilities: SubscriptionCapabilityDto[] = Object.values(SaasCapabilityKey).map(
      (key) => {
        const included = entitlements.capabilities.includes(key);
        if (key === SaasCapabilityKey.ecommerce && included) {
          return {
            key,
            included,
            operationalStatus: ecommerceConfig?.enabled ? "Tienda activada" : "Tienda desactivada",
          };
        }
        return { key, included };
      },
    );

    return {
      tenantId,
      addonCodes: [...addonCodes],
      nextRenewalAt,
      invoices,
      subscription: { status: subscription.status, startedAt: subscription.startedAt },
      plan: { id: plan.id, code: plan.code, name: plan.name, description: plan.description },
      capabilities,
      availablePlans,
      usage: [
        {
          key: SaasLimitKey.maxEmployees,
          current: usage.employees.current,
          limit: usage.employees.limit,
        },
        {
          key: SaasLimitKey.maxBranches,
          current: usage.branches.current,
          limit: usage.branches.limit,
        },
      ],
    };
  }
}
