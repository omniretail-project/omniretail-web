import { PlanStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { TenantSubscriptionDetailsDto } from "@/modules/administration/application/dto/SubscriptionDto";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import {
  AdministrationServiceError,
  ensureCanManagePlans,
  ensurePlanActor,
  ensurePlanTenant,
} from "@/modules/administration/application/services/serviceHelpers";

/**
 * Única mutación de Plan/Subscription expuesta desde la UI (feature/tenant-plan-selection). El
 * único write real es `tenantSubscriptions.update(tenantId, { planId })` -- nunca toca
 * `BusinessCapabilitiesConfig`/`EcommerceConfig` ni archiva/borra `User`/`Branch`, aunque el
 * nuevo plan tenga límites menores que el uso actual del negocio (`docs/SOURCE_OF_TRUTH.md`: un
 * downgrade de Plan nunca muta BusinessConfig ni empleados/sucursales existentes -- solo bloquea
 * la PRÓXIMA alta).
 *
 * El evento `tenant-subscription.changed` NO se emite acá -- lo emite
 * `MockTenantSubscriptionRepository.update` (infraestructura), mismo criterio que los 34 eventos
 * ya existentes en el codebase: cero Application Services referencian `DataEventBus` directamente.
 * Por construcción, el no-op de "mismo plan" nunca llama `update`, así que tampoco puede emitir.
 *
 * El paso final (12) reutiliza `GetTenantSubscriptionDetailsService`, que vuelve a correr
 * `ensureCanReadPlans` -- el actor necesita sostener TANTO `admin.plans.read` como
 * `admin.plans.manage`. Esto es fail-closed deliberado (no se relaja `ensureCanReadPlans`) y es
 * inalcanzable desde la UI real porque el picker solo se muestra cuando `canRead` ya es true.
 */
export class ChangeTenantPlanService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    targetPlanId: string,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<TenantSubscriptionDetailsDto> {
    ensureCanManagePlans(permissions);
    ensurePlanTenant(tenantId);
    ensurePlanActor(actorUserId);

    const subscription = await this.repositories.tenantSubscriptions.getByTenantId(tenantId);
    if (!subscription) {
      throw new AdministrationServiceError(
        "El negocio activo no tiene una suscripción configurada.",
      );
    }
    if (subscription.tenantId !== tenantId) {
      throw new AdministrationServiceError(
        "La suscripción no está disponible para el negocio activo.",
      );
    }

    const targetPlan = await this.repositories.plans.getById(targetPlanId);
    if (!targetPlan) {
      throw new AdministrationServiceError("El plan seleccionado no existe.");
    }
    if (targetPlan.status !== PlanStatus.active) {
      throw new AdministrationServiceError("El plan seleccionado ya no está disponible.");
    }

    // No-op: mismo plan -- sin write, sin AuditLog, sin evento. Un doble click no debe forjar
    // historial de auditoría.
    if (subscription.planId === targetPlanId) {
      return new GetTenantSubscriptionDetailsService(this.repositories).execute(
        tenantId,
        permissions,
      );
    }

    // El plan vigente puede haber sido archivado mientras tanto -- se tolera null en vez de
    // bloquear el cambio: un plan actual roto nunca debe impedir *arreglarlo*.
    const previousPlan = await this.repositories.plans.getById(subscription.planId);

    const updated = await this.repositories.tenantSubscriptions.update(tenantId, {
      planId: targetPlanId,
    });

    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "tenant_subscription.plan_changed",
      entityType: "TenantSubscription",
      entityId: updated.id,
      metadata: {
        previousPlanId: subscription.planId,
        newPlanId: updated.planId,
        previousPlanCode: previousPlan?.code ?? null,
        newPlanCode: targetPlan.code,
      },
    });

    return new GetTenantSubscriptionDetailsService(this.repositories).execute(
      tenantId,
      permissions,
    );
  }
}
