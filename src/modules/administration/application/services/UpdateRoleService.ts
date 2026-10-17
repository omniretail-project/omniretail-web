import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { RoleDto, RoleInputDto } from "@/modules/administration/application/dto/RoleDto";
import { toRoleDto } from "@/modules/administration/application/mappers/RoleMapper";
import {
  ensureCanManageRoles,
  ensureRoleActor,
  ensureRoleBelongsToTenant,
  ensureRoleNotSystem,
  ensureRoleTenant,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  ensureDelegatablePermissions,
  normalizeRoleInput,
  validateRoleInput,
} from "@/modules/administration/validation/role.validation";

export class UpdateRoleService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    roleId: string,
    dto: RoleInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<RoleDto> {
    ensureCanManageRoles(permissions);
    ensureRoleTenant(tenantId);
    ensureRoleActor(actorUserId);
    const current = ensureRoleBelongsToTenant(
      await this.repositories.roles.getByIdScoped(tenantId, roleId),
      tenantId,
    );
    ensureRoleNotSystem(current);
    const normalizedInput = normalizeRoleInput(dto);
    validateRoleInput(normalizedInput);
    ensureDelegatablePermissions(permissions, normalizedInput.permissions);

    const role = ensureRoleBelongsToTenant(
      await this.repositories.roles.updateScoped(tenantId, current.id, normalizedInput),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "role.updated",
      entityType: "Role",
      entityId: role.id,
      metadata: {
        name: role.name,
        permissionCount: role.permissions.length,
        previousStatus: current.status,
        status: role.status,
      },
    });

    return toRoleDto(role);
  }
}
