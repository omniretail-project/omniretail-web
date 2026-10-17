import { RoleStatus, SaasCapabilityKey, TenantStatus, UserStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { ensureTenantCapability } from "@/shared/application/services/entitlementGuards";
import {
  AdministrationServiceError,
  ensureCanManageEcommerceConfig,
} from "@/modules/administration/application/services/serviceHelpers";

export interface EcommerceConfigAdminContext {
  tenantId: string;
  actorUserId: string;
}

export async function resolveEcommerceConfigAdminContext(
  repositories: RepositoryRegistry,
): Promise<EcommerceConfigAdminContext> {
  const sessionId = await repositories.auth.getCurrentSessionId();
  if (!sessionId) throw new AdministrationServiceError("No se pudo resolver la sesion actual.");

  const session = await repositories.auth.getSession(sessionId);
  if (!session) throw new AdministrationServiceError("No se pudo resolver la sesion actual.");

  const actor = await repositories.users.getById(session.userId);
  if (!actor || actor.status !== UserStatus.active || !actor.tenantId.trim()) {
    throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
  }

  const [tenant, role] = await Promise.all([
    repositories.tenants.getById(actor.tenantId),
    actor.roleId
      ? repositories.roles.getByIdScoped(actor.tenantId, actor.roleId)
      : Promise.resolve(null),
  ]);
  if (!tenant || tenant.status !== TenantStatus.active || tenant.id !== actor.tenantId) {
    throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
  }
  if (!role || role.status !== RoleStatus.active) {
    throw new AdministrationServiceError("No se pudo resolver el rol del usuario actual.");
  }

  ensureCanManageEcommerceConfig(role.permissions);
  ensureTenantCapability(
    await new ResolveTenantEntitlementsService(repositories).execute(actor.tenantId),
    SaasCapabilityKey.ecommerce,
  );
  return { tenantId: actor.tenantId, actorUserId: actor.id };
}
