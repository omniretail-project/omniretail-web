import { BranchStatus, RoleStatus, SaasCapabilityKey, UserStatus, UserType } from "@/core/enums";
import { canUserAccessBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ensureTenantCapability } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

export interface ReturnOperationContext {
  tenantId: string;
  branchId: string;
  actorUserId: string;
}

export async function requireReturnOperationContext(
  repositories: Pick<RepositoryRegistry, "branches" | "roles" | "users" | "plans" | "tenantSubscriptions">,
  context: ReturnOperationContext,
  permission: "pos.returns.read" | "pos.returns.create" | "pos.sales.void",
) {
  const tenantId = context.tenantId.trim();
  const branchId = context.branchId.trim();
  const actorUserId = context.actorUserId.trim();
  if (!tenantId || !branchId || !actorUserId) {
    throw new Error("No se pudo resolver el contexto operativo de devoluciones.");
  }
  const [user, branch] = await Promise.all([
    repositories.users.getById(actorUserId),
    repositories.branches.getById(branchId),
  ]);
  if (
    !user ||
    user.tenantId !== tenantId ||
    user.type !== UserType.employee ||
    user.status !== UserStatus.active
  ) {
    throw new Error("El usuario activo no es valido para este negocio.");
  }
  if (!branch || branch.tenantId !== tenantId || branch.status !== BranchStatus.active) {
    throw new Error("La sucursal no esta activa para este negocio.");
  }
  const role = user.roleId ? await repositories.roles.getByIdScoped(tenantId, user.roleId) : null;
  if (!role || role.status !== RoleStatus.active || !role.permissions.includes(permission)) {
    throw new Error("No dispone de permisos para realizar esta operación.");
  }
  if (!canUserAccessBranch(user, role, branch)) {
    throw new Error("No dispone de acceso a la sucursal seleccionada.");
  }
  // Entitlement SaaS (auditoría §10/§14): solo gatea mutaciones reales (crear devolución, anular
  // venta) -- `pos.returns.read` (búsqueda de la venta a devolver) permanece como lectura.
  if (permission !== "pos.returns.read") {
    const entitlements = await new ResolveTenantEntitlementsService(
      repositories as RepositoryRegistry,
    ).execute(tenantId);
    ensureTenantCapability(entitlements, SaasCapabilityKey.pos);
  }
  return { tenantId, branchId, actorUserId, user, role, branch };
}
