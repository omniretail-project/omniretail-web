import { BranchStatus, RoleStatus, UserStatus, UserType } from "@/core/enums";
import { canUserAccessBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

type PackingContextRepositories = Pick<RepositoryRegistry, "auth" | "users" | "roles" | "branches">;

export interface TrustedPackingContext {
  tenantId: string;
  branchId: string;
  actorUserId: string;
}

export async function resolveTrustedPackingContext(
  repositories: PackingContextRepositories,
  selectedBranchId: string,
  requiredPermission: string,
): Promise<TrustedPackingContext> {
  const sessionId = await repositories.auth.getCurrentSessionId();
  if (!sessionId) throw new Error("Packing access denied.");
  const session = await repositories.auth.getSession(sessionId);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new Error("Packing access denied.");
  }
  const user = await repositories.users.getById(session.userId);
  if (
    !user ||
    user.status !== UserStatus.active ||
    user.type !== UserType.employee ||
    !user.roleId
  ) {
    throw new Error("Packing access denied.");
  }
  const role = await repositories.roles.getByIdScoped(user.tenantId, user.roleId);
  if (
    !role ||
    role.status !== RoleStatus.active ||
    !role.permissions.includes(requiredPermission)
  ) {
    throw new Error("Packing access denied.");
  }
  const branch = await repositories.branches.getById(selectedBranchId);
  if (
    !branch ||
    branch.status !== BranchStatus.active ||
    branch.tenantId !== user.tenantId ||
    !canUserAccessBranch(user, role, branch)
  ) {
    throw new Error("Packing access denied.");
  }
  return { tenantId: user.tenantId, branchId: branch.id, actorUserId: user.id };
}
