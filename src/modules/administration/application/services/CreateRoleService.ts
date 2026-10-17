import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { RoleDto, RoleInputDto } from "@/modules/administration/application/dto/RoleDto";
import { toRoleDto } from "@/modules/administration/application/mappers/RoleMapper";
import {
  ensureCanManageRoles,
  ensureRoleActor,
  ensureRoleTenant,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  ensureDelegatablePermissions,
  normalizeRoleInput,
  validateRoleInput,
} from "@/modules/administration/validation/role.validation";

/**
 * Un rol creado desde esta pantalla nace con `branchScope: "assigned"` -- el valor mas
 * restrictivo del contrato actual (`isBranchIdInUserScope`: sin coincidencia exacta de
 * `user.branchId`, deniega). `branchScope` ya no es una decision que se tome aca (ver
 * RoleInputDto); hasta que exista `admin-users` y la sucursal quede del lado de `User`, un rol
 * nuevo no debe otorgar acceso amplio a sucursales por defecto -- fail-closed, no fail-open.
 */
const DEFAULT_ROLE_BRANCH_SCOPE = "assigned" as const;

export class CreateRoleService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    dto: RoleInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<RoleDto> {
    ensureCanManageRoles(permissions);
    ensureRoleTenant(tenantId);
    ensureRoleActor(actorUserId);
    const normalizedInput = normalizeRoleInput(dto);
    validateRoleInput(normalizedInput);
    ensureDelegatablePermissions(permissions, normalizedInput.permissions);

    // isSystem nunca viene del DTO: un rol creado desde esta pantalla nunca es un rol de plataforma.
    const role = await this.repositories.roles.create({
      tenantId,
      isSystem: false,
      branchScope: DEFAULT_ROLE_BRANCH_SCOPE,
      ...normalizedInput,
    });
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "role.created",
      entityType: "Role",
      entityId: role.id,
      metadata: {
        name: role.name,
        permissionCount: role.permissions.length,
        status: role.status,
      },
    });

    return toRoleDto(role);
  }
}
