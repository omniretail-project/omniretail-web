import { BranchStatus, RoleStatus, UserStatus, UserType } from "@/core/enums";
import { canUserAccessBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

type HistoryContextRepositories = Pick<
  RepositoryRegistry,
  "auth" | "users" | "roles" | "branches"
>;

export interface TrustedLogisticsHistoryContext {
  tenantId: string;
  branchId: string;
  actorUserId: string;
}

export async function resolveTrustedLogisticsHistoryContext(
  repositories: HistoryContextRepositories,
  selectedBranchId: string,
): Promise<TrustedLogisticsHistoryContext> {
  const sessionId = await repositories.auth.getCurrentSessionId();
  if (!sessionId) throw new Error("Logistics history access denied.");
  const session = await repositories.auth.getSession(sessionId);
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw new Error("Logistics history access denied.");
  }
  const user = await repositories.users.getById(session.userId);
  if (!user || user.status !== UserStatus.active || user.type !== UserType.employee || !user.roleId) {
    throw new Error("Logistics history access denied.");
  }
  const role = await repositories.roles.getByIdScoped(user.tenantId, user.roleId);
  if (!role || role.status !== RoleStatus.active || !role.permissions.includes("logistics.history.read")) {
    throw new Error("Logistics history access denied.");
  }
  const branch = await repositories.branches.getById(selectedBranchId);
  if (
    !branch ||
    branch.status !== BranchStatus.active ||
    branch.tenantId !== user.tenantId ||
    !canUserAccessBranch(user, role, branch)
  ) {
    throw new Error("Logistics history access denied.");
  }
  return { tenantId: user.tenantId, branchId: branch.id, actorUserId: user.id };
}
