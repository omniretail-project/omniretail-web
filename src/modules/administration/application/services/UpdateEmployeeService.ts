import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EmployeeDto, EmployeeInputDto } from "@/modules/administration/application/dto/EmployeeDto";
import { toEmployeeDto } from "@/modules/administration/application/mappers/EmployeeMapper";
import {
  AdministrationServiceError,
  ensureCanManageEmployees,
  ensureEmployeeActor,
  ensureEmployeeBelongsToTenant,
  ensureEmployeeBranchIds,
  ensureEmployeeTenant,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  ensureDelegatableRole,
  ensureRoleAssignable,
  normalizeEmployeeInput,
  validateEmployeeInput,
} from "@/modules/administration/validation/employee.validation";

function sameBranchSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
}

/**
 * Edición de empleado. Campos permitidos: `name`, `employeeCode`, `phone`, `roleId`,
 * `allowedBranchIds`, `status` (§13). `email` se valida por formato pero DELIBERADAMENTE no se persiste acá: `User.
 * email` y `AuthAccount.email` son campos separados (ver AuthAccount.ts) y no existe ningún
 * contrato que los mantenga sincronizados -- cambiar uno sin el otro dejaría el login
 * inconsistente (la cuenta seguiría respondiendo al email viejo). Sin un contrato de Auth
 * explícito para esto, no se asume que administration puede tocarlo -- se ignora el valor
 * recibido en vez of adivinar. password/MFA secret/AuthAccount.status/lockout counters nunca
 * aparecen en `EmployeeInputDto`, así que no hay forma de que esta llamada los toque.
 */
export class UpdateEmployeeService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    employeeId: string,
    dto: EmployeeInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<EmployeeDto> {
    ensureCanManageEmployees(permissions);
    ensureEmployeeTenant(tenantId);
    ensureEmployeeActor(actorUserId);

    const current = ensureEmployeeBelongsToTenant(
      await this.repositories.users.getByIdScoped(tenantId, employeeId),
      tenantId,
    );

    const normalizedInput = normalizeEmployeeInput(dto);
    validateEmployeeInput(normalizedInput);

    const employeeCodeChanged = current.employeeCode !== normalizedInput.employeeCode;
    if (employeeCodeChanged) {
      const employeeWithCode = await this.repositories.users.getByEmployeeCodeScoped(
        tenantId,
        normalizedInput.employeeCode,
      );
      if (employeeWithCode && employeeWithCode.id !== current.id) {
        throw new AdministrationServiceError(
          "Ya existe un empleado con ese código en este negocio.",
        );
      }
    }

    const role = ensureRoleAssignable(
      await this.repositories.roles.getByIdScoped(tenantId, normalizedInput.roleId),
      tenantId,
    );
    ensureDelegatableRole(permissions, role);

    const tenantBranches = await this.repositories.branches.getActiveByTenant(tenantId);
    ensureEmployeeBranchIds(
      normalizedInput.allowedBranchIds,
      tenantBranches,
      current.allowedBranchIds ?? [],
    );

    const statusChanged = current.status !== normalizedInput.status;
    const roleChanged = current.roleId !== role.id;
    const branchesChanged = !sameBranchSet(
      current.allowedBranchIds ?? [],
      normalizedInput.allowedBranchIds,
    );
    // Cambios de seguridad relevantes -- cualquiera de estos exige que el empleado vuelva a
    // autenticarse con su contexto/permisos actuales (§14). Un update que solo toca
    // name/phone NO revoca nada.
    const securitySensitive = statusChanged || roleChanged || branchesChanged;

    const updated = await this.repositories.users.updateScoped(tenantId, employeeId, {
      name: normalizedInput.name,
      employeeCode: normalizedInput.employeeCode,
      phone: normalizedInput.phone,
      roleId: role.id,
      allowedBranchIds: normalizedInput.allowedBranchIds,
      status: normalizedInput.status,
    });

    // El PUT ya se confirmo: un fallo al revocar sesiones no debe abortar el resto (auditoria) ni
    // reportar la edicion como fallida.
    const sessionsRevoked =
      securitySensitive &&
      (await this.repositories.auth
        .revokeAllSessionsByUserId(tenantId, employeeId)
        .then(
          () => true,
          () => false,
        ));

    // Una sola entrada de auditoría por edición (no una por cada campo tocado): la metadata deja
    // explícito qué cambió y si se revocaron sesiones, así que sigue siendo consultable como
    // employee.role_changed/branches_changed/status_changed sin escribir múltiples filas para una
    // sola acción del usuario.
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "employee.updated",
      entityType: "User",
      entityId: updated.id,
      metadata: {
        statusChanged,
        employeeCodeChanged,
        roleChanged,
        branchesChanged,
        sessionsRevoked,
        previousStatus: current.status,
        status: updated.status,
        previousRoleId: current.roleId,
        roleId: updated.roleId,
      },
    });

    return toEmployeeDto(updated, undefined);
  }
}
