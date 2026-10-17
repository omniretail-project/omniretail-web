import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EmployeeInvitationResult } from "@/modules/administration/application/dto/EmployeeDto";
import { toEmployeeDto } from "@/modules/administration/application/mappers/EmployeeMapper";
import {
  ensureCanManageEmployees,
  ensureEmployeeActor,
  ensureEmployeeBelongsToTenant,
  ensureEmployeeTenant,
  AdministrationServiceError,
} from "@/modules/administration/application/services/serviceHelpers";

/**
 * Reintento explícito de invitación (ticket "FIXES FOCALIZADOS", §1): cubre tanto al empleado que
 * quedó "Sin cuenta" porque `inviteEmployee` falló al crearlo (ver CreateEmployeeService) como al
 * que tiene una invitación vencida y nunca la aceptó. Reutiliza `AuthRepository.inviteEmployee` tal
 * cual -- NO se extiende el contrato de Auth ni se escribe sobre `authAccounts`/
 * `employeeInvitations` desde acá, porque `inviteEmployee` YA es idempotente/seguro para
 * reintentar según su propio contrato documentado (sin `AuthAccount`: crea una; en
 * `password_reset_required`: reutiliza la misma cuenta y emite una invitación nueva; `active` o
 * cualquier otro estado: rechaza con un mensaje ya legible, sin mutar nada).
 *
 * GAP cerrado acá (no en `inviteEmployee`): `AuthRepository.inviteEmployee(userId)` no recibe
 * `tenantId` y no valida tenant internamente -- hoy es seguro porque `CreateEmployeeService` solo
 * lo llama justo después de crear el User (ya tenant-scoped por construcción). Este service, en
 * cambio, recibe un `employeeId` elegido desde la tabla (potencialmente cualquier id), así que
 * ANTES de tocar Auth resuelve el empleado con `users.getByIdScoped(tenantId, employeeId)` --
 * mismo patrón que `UpdateEmployeeService.ensureEmployeeBelongsToTenant` -- y solo si pertenece al
 * tenant activo invoca `auth.inviteEmployee(employee.id)`. Un id de otro tenant o inexistente se
 * resuelve igual (rechazado), sin distinguir el motivo -- mismo criterio de no-oráculo que el
 * resto del módulo.
 */
export class ResendInvitationService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    employeeId: string,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<EmployeeInvitationResult> {
    // 1. permiso del actor
    ensureCanManageEmployees(permissions);
    // 2. tenant confiable + actor
    ensureEmployeeTenant(tenantId);
    ensureEmployeeActor(actorUserId);

    // 3. resolver el empleado DENTRO del tenant activo antes de tocar Auth -- cierra el gap
    // cross-tenant de inviteEmployee(userId) descrito arriba.
    const employee = ensureEmployeeBelongsToTenant(
      await this.repositories.users.getByIdScoped(tenantId, employeeId),
      tenantId,
    );

    // 4. reintento -- ver el contrato de inviteEmployee para el detalle de cada estado. Los
    // mensajes que lanza ya son legibles para un usuario de negocio (no exponen internals), así
    // que se re-lanzan tal cual como AdministrationServiceError en vez de inventar uno nuevo o
    // genérico -- mismo criterio de §3 del ticket: nunca ocultar información útil que ya es segura
    // de mostrar, solo ocultar la que no lo es (permission keys crudas, eso no aplica acá).
    let invitationToken: string | null;
    try {
      // Capturado -- invitation-scoped (ver EmployeeInvitationResult), no se relee después.
      invitationToken = (await this.repositories.auth.inviteEmployee(employee.id)).invitationToken;
    } catch (caughtError) {
      throw new AdministrationServiceError(
        caughtError instanceof Error
          ? caughtError.message
          : "No se pudo enviar la invitación. Inténtelo nuevamente en unos momentos.",
      );
    }

    // 5. auditoría -- acción explícita y deliberada del admin (distinta de la invitación implícita
    // de employee.created), queda su propia entrada consultable.
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "employee.invitation_resent",
      entityType: "User",
      entityId: employee.id,
      metadata: {
        email: employee.email,
      },
    });

    const [summary] = await this.repositories.auth.getEmployeeAuthSummariesByUserIds(tenantId, [
      employee.id,
    ]);
    return { employee: toEmployeeDto(employee, summary), invitationToken };
  }
}
