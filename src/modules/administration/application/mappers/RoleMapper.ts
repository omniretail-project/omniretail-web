import type { Role } from "@/core/entities";
import type { RoleDto } from "@/modules/administration/application/dto/RoleDto";

export function toRoleDto(role: Role): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissions: [...role.permissions],
    branchScope: role.branchScope,
    status: role.status,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
