import { BranchStatus, RoleStatus, UserStatus, UserType } from "@/core/enums";
import { canUserAccessBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export class PickingAuthorizationError extends Error {
  constructor(message = "Picking access denied.") {
    super(message);
    this.name = "PickingAuthorizationError";
  }
}

type PickingContextRepositories = Pick<RepositoryRegistry, "auth" | "users" | "roles" | "branches">;

export interface TrustedPickingContext {
  tenantId: string;
  branchId: string;
  actorUserId: string;
  permissions: readonly string[];
}

/** Rebuilds all authority from Session -> active User -> same-tenant Role -> allowed Branch. */
export async function resolveTrustedPickingContext(
  repositories: PickingContextRepositories,
  selectedBranchId: string,
  requiredPermission: string,
): Promise<TrustedPickingContext> {
  const sessionId = await repositories.auth.getCurrentSessionId();
  if (!sessionId) throw new PickingAuthorizationError();
  const session = await repositories.auth.getSession(sessionId);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new PickingAuthorizationError();
  }
  const user = await repositories.users.getById(session.userId);
  if (!user || user.status !== UserStatus.active || user.type !== UserType.employee) {
    throw new PickingAuthorizationError();
  }
  if (!user.roleId) throw new PickingAuthorizationError();
  const role = await repositories.roles.getByIdScoped(user.tenantId, user.roleId);
  if (!role || role.status !== RoleStatus.active) throw new PickingAuthorizationError();
  if (!role.permissions.includes(requiredPermission)) throw new PickingAuthorizationError();
  const branch = await repositories.branches.getById(selectedBranchId);
  if (
    !branch ||
    branch.status !== BranchStatus.active ||
    branch.tenantId !== user.tenantId ||
    !canUserAccessBranch(user, role, branch)
  ) {
    throw new PickingAuthorizationError();
  }
  return {
    tenantId: user.tenantId,
    branchId: branch.id,
    actorUserId: user.id,
    permissions: role.permissions,
  };
}
