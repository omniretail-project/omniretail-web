import { BranchStatus, RoleStatus, UserStatus, UserType } from "@/core/enums";
import { canUserAccessBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export class DispatchAuthorizationError extends Error {
  constructor(message = "Dispatch access denied.") {
    super(message);
    this.name = "DispatchAuthorizationError";
  }
}

type DispatchContextRepositories = Pick<
  RepositoryRegistry,
  "auth" | "users" | "roles" | "branches"
>;

export interface TrustedDispatchContext {
  tenantId: string;
  branchId: string;
  actorUserId: string;
  permissions: readonly string[];
}

/** Rebuilds authority from Session -> active employee -> same-tenant Role -> authorized Branch. */
export async function resolveTrustedDispatchContext(
  repositories: DispatchContextRepositories,
  selectedBranchId: string,
  requiredPermission: string,
): Promise<TrustedDispatchContext> {
  const sessionId = await repositories.auth.getCurrentSessionId();
  if (!sessionId) throw new DispatchAuthorizationError();
  const session = await repositories.auth.getSession(sessionId);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new DispatchAuthorizationError();
  }
  const user = await repositories.users.getById(session.userId);
  if (
    !user ||
    user.status !== UserStatus.active ||
    user.type !== UserType.employee ||
    !user.roleId
  ) {
    throw new DispatchAuthorizationError();
  }
  const role = await repositories.roles.getByIdScoped(user.tenantId, user.roleId);
  if (
    !role ||
    role.status !== RoleStatus.active ||
    !role.permissions.includes(requiredPermission)
  ) {
    throw new DispatchAuthorizationError();
  }
  const branch = await repositories.branches.getById(selectedBranchId);
  if (
    !branch ||
    branch.status !== BranchStatus.active ||
    branch.tenantId !== user.tenantId ||
    !canUserAccessBranch(user, role, branch)
  ) {
    throw new DispatchAuthorizationError();
  }
  return {
    tenantId: user.tenantId,
    branchId: branch.id,
    actorUserId: user.id,
    permissions: role.permissions,
  };
}
