import { RoleStatus, TenantStatus, UserStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  AdministrationServiceError,
  ensureCanManageShippingConfig,
} from "@/modules/administration/application/services/serviceHelpers";

export interface ShippingConfigAdminContext {
  tenantId: string;
  actorUserId: string;
}

/**
 * El permiso se verifica aquí (capa de aplicación), no solo en la pantalla: el costo de envío
 * cambia lo que cobran la tienda en línea y el POS de todo el tenant.
 */
export async function resolveShippingConfigAdminContext(
  repositories: RepositoryRegistry,
): Promise<ShippingConfigAdminContext> {
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

  ensureCanManageShippingConfig(role.permissions);

  return { tenantId: actor.tenantId, actorUserId: actor.id };
}
