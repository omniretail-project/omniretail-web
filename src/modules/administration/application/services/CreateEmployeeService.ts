import { UserStatus, UserType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  EmployeeInputDto,
  EmployeeInvitationResult,
} from "@/modules/administration/application/dto/EmployeeDto";
import { toEmployeeDto } from "@/modules/administration/application/mappers/EmployeeMapper";
import {
  ensureCanManageEmployees,
  ensureEmployeeActor,
  ensureEmployeeBranchIds,
  ensureEmployeeTenant,
  ensureTenantCanCreateEmployee,
  AdministrationServiceError,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  ensureDelegatableRole,
  ensureRoleAssignable,
  normalizeEmployeeInput,
  validateEmployeeInput,
} from "@/modules/administration/validation/employee.validation";

/**
 * Alta de empleado. Reutiliza el Auth existente (`AuthRepository.inviteEmployee`) -- nunca crea
 * `AuthAccount`/`EmployeeInvitation`/tokens acá (§2/§12 del ticket). Sin boundary atómico
 * cross-repository real: `users.create` y `auth.inviteEmployee` son dos repositorios distintos,
 * cada uno con su propia transacción interna (`store.mutate`), y los application services solo
 * reciben las interfaces de esos repositorios, no el `store` crudo -- no hay forma de envolver
 * ambas mutaciones en una sola transacción sin romper el aislamiento de módulos (administration
 * no debe escribir directamente sobre las tablas de Auth).
 *
 * Estrategia de falla elegida (reportada explícitamente, no improvisada): esto NO necesita
 * compensación destructiva porque el propio contrato ya es fail-closed sin ayuda. Un User sin
 * `AuthAccount` es simplemente no-loggeable -- `login()` no encuentra ninguna cuenta candidata
 * para ese email, sin importar `User.status`. Si `inviteEmployee` falla después de crear el User,
 * el User queda visible en la tabla (así el admin lo ve y puede reintentar) pero sin ningún
 * acceso posible; no se borra automáticamente (ningún delete destructivo) ni se inventa un
 * mecanismo de rollback nuevo. Reintentar la invitación de ESE mismo empleado es seguro porque
 * `inviteEmployee` ya es idempotente para un userId sin `AuthAccount` (crea uno nuevo) o con uno
 * en `password_reset_required` (reutiliza el mismo, según su propio contrato documentado).
 */
export class CreateEmployeeService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    dto: EmployeeInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<EmployeeInvitationResult> {
    // 1. permiso del actor
    ensureCanManageEmployees(permissions);
    // 2. tenant confiable (llega ya resuelto por el caller, no por el DTO)
    ensureEmployeeTenant(tenantId);
    ensureEmployeeActor(actorUserId);
    // 3. validar input
    const normalizedInput = normalizeEmployeeInput(dto);
    validateEmployeeInput(normalizedInput);

    // 3.5. límite SaaS del Plan (auditoría §23) -- ANTES de email/Role/Branch para no hacer
    // trabajo de más cuando el Tenant ya está en el límite.
    await ensureTenantCanCreateEmployee(this.repositories, tenantId);

    // 4. email según la política REAL de Auth: login()/UserRepository.getByEmail ya tratan el
    // email como único globalmente para Employee/Admin (ver getByEmail en UserRepository -- sin
    // tenantId a propósito, misma fuente que usa el login). No se inventa una regla tenant-scoped
    // distinta que dejaría el login ambiguo entre dos empleados de tenants distintos.
    const existing = await this.repositories.users.getByEmail(normalizedInput.email);
    if (existing) {
      throw new AdministrationServiceError("Ya existe una cuenta con ese correo electrónico.");
    }

    // 4.5. employeeCode único por tenant
    const existingCode = await this.repositories.users.getByEmployeeCodeScoped(
      tenantId,
      normalizedInput.employeeCode,
    );
    if (existingCode) {
      throw new AdministrationServiceError(
        "Ya existe un empleado con ese código en este negocio.",
      );
    }

    // 5. validar Role destino
    const role = ensureRoleAssignable(
      await this.repositories.roles.getByIdScoped(tenantId, normalizedInput.roleId),
      tenantId,
    );
    // 6. delegación de privilegios -- el actor no puede asignar un rol con permisos que él mismo
    // no tiene, sin excepción por isSystem (misma filosofía de PR #88).
    ensureDelegatableRole(permissions, role);

    // 7. validar sucursales
    const tenantBranches = await this.repositories.branches.getActiveByTenant(tenantId);
    ensureEmployeeBranchIds(normalizedInput.allowedBranchIds, tenantBranches);

    // 8. crear User Employee (nunca password: el admin no la ve ni la define, R-A11)
    const user = await this.repositories.users.create({
      tenantId,
      name: normalizedInput.name,
      email: normalizedInput.email,
      phone: normalizedInput.phone,
      employeeCode: normalizedInput.employeeCode,
      type: UserType.employee,
      status: normalizedInput.status ?? UserStatus.active,
      roleId: role.id,
      allowedBranchIds: normalizedInput.allowedBranchIds,
    });

    // 9. invitación -- reutiliza Auth existente, nunca crea AuthAccount/token a mano. El token se
    // captura del resultado de ESTA llamada (invitation-scoped, ver EmployeeInvitationResult) --
    // nunca se vuelve a pedir después ni se guarda en el User.
    let invited = true;
    let invitationToken: string | null = null;
    let invitationError: string | undefined;
    try {
      const inviteResult = await this.repositories.auth.inviteEmployee(user.id);
      invitationToken = inviteResult.invitationToken;
    } catch (caughtError) {
      invited = false;
      invitationError = caughtError instanceof Error ? caughtError.message : "error desconocido";
    }

    // 10. auditoría -- incluye si la invitación falló, para que quede visible que este empleado
    // necesita un reintento manual, sin ocultarlo silenciosamente.
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "employee.created",
      entityType: "User",
      entityId: user.id,
      metadata: {
        email: user.email,
        roleId: role.id,
        roleName: role.name,
        status: user.status,
        invited,
        ...(invitationError ? { invitationError } : {}),
      },
    });

    if (!invited) {
      throw new AdministrationServiceError(
        `El empleado se creó, pero no se pudo enviar la invitación (${invitationError}). Reintente la invitación para este empleado.`,
      );
    }

    // 11. user.changed ya lo emite MockUserRepository.create() -- no hace falta duplicarlo acá.
    return { employee: toEmployeeDto(user, undefined), invitationToken };
  }
}
