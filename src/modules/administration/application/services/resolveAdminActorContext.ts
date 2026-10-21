import { RoleStatus, TenantStatus, UserStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

export interface AdminActorContext {
  tenantId: string;
  actorUserId: string;
  permissions: readonly string[];
}

/**
 * Sesión, usuario, negocio y rol activos de quien administra. Cada configuración tenant-wide
 * verifica después su propio permiso sobre `permissions` (capa de aplicación, no solo la pantalla).
 */
export async function resolveAdminActorContext(
  repositories: Pick<RepositoryRegistry, "auth" | "users" | "tenants" | "roles">,
): Promise<AdminActorContext> {
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

  return { tenantId: actor.tenantId, actorUserId: actor.id, permissions: role.permissions };
}
