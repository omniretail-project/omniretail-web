import type { BranchScope, Role } from "@/core/entities";
import type { RoleStatus } from "@/core/enums";

/** RoleResponse del backend (`/administration/roles`). */
export interface ApiRole {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  isSystem: boolean | null;
  permissions: string[] | null;
  branchScope: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * CreateRoleRequest / UpdateRoleRequest: la tienda sale del JWT, nunca del body. `branchScope` e
 * `isSystem` tampoco viajan: el backend los fija (un rol nuevo nace `assigned` y nunca es de sistema).
 */
export interface ApiRoleRequest {
  name: string;
  description?: string;
  permissions: string[];
  status: RoleStatus;
}

type RoleInput = Pick<Role, "name" | "description" | "permissions" | "status">;

export function toRole(role: ApiRole): Role {
  return {
    id: role.id,
    tenantId: role.tenantId,
    name: role.name,
    description: role.description ?? undefined,
    isSystem: role.isSystem ?? false,
    permissions: role.permissions ?? [],
    branchScope: role.branchScope as BranchScope,
    status: role.status as RoleStatus,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

/**
 * El PUT exige `name` y `permissions` (un update sin permisos falla en vez de vaciarlos), por eso
 * se envia siempre el rol completo.
 */
export function toRoleRequest(input: RoleInput): ApiRoleRequest {
  return {
    name: input.name,
    description: input.description,
    permissions: input.permissions,
    status: input.status,
  };
}
