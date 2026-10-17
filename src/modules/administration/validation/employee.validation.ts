import type { Role } from "@/core/entities";
import { RoleStatus, UserStatus } from "@/core/enums";
import type { EmployeeInputDto } from "@/modules/administration/application/dto/EmployeeDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import {
  ADMIN_FIELD_LIMITS,
  isValidGuatemalaPhone,
  normalizeGuatemalaPhone,
} from "@/modules/administration/validation/adminFieldConstraints";

const EDITABLE_STATUSES: readonly UserStatus[] = [
  UserStatus.active,
  UserStatus.inactive,
  UserStatus.blocked,
];
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_CODE_FORMAT = /^[A-Za-z0-9_-]+$/;
const LIMITS = ADMIN_FIELD_LIMITS.employee;

/**
 * Valida el DTO recibido antes de normalizarlo. Una UI oculta no impide que otro consumidor
 * invoque el service con datos inválidos.
 */
export function validateEmployeeInput(dto: EmployeeInputDto) {
  const name = dto.name.trim();
  if (!name) {
    throw new AdministrationServiceError("El nombre del empleado es obligatorio.");
  }
  if (name.length > LIMITS.name) {
    throw new AdministrationServiceError("El nombre del empleado no puede exceder 120 caracteres.");
  }
  const email = dto.email.trim();
  if (!email || email.length > LIMITS.email || !EMAIL_FORMAT.test(email)) {
    throw new AdministrationServiceError("El correo del empleado no es válido.");
  }
  const employeeCode = dto.employeeCode.trim();
  if (!employeeCode) {
    throw new AdministrationServiceError("El código de empleado es obligatorio.");
  }
  if (employeeCode.length > LIMITS.employeeCode) {
    throw new AdministrationServiceError("El código de empleado no puede exceder 20 caracteres.");
  }
  if (!EMPLOYEE_CODE_FORMAT.test(employeeCode)) {
    throw new AdministrationServiceError(
      "El código de empleado solo puede contener letras, números, guión y guión bajo.",
    );
  }
  const phone = dto.phone?.trim();
  if (phone && !isValidGuatemalaPhone(phone)) {
    throw new AdministrationServiceError("El teléfono del empleado debe tener 8 dígitos.");
  }
  if (!dto.roleId.trim()) {
    throw new AdministrationServiceError("Seleccione un rol para el empleado.");
  }
  if (!EDITABLE_STATUSES.includes(dto.status)) {
    throw new AdministrationServiceError(
      dto.status === UserStatus.archived
        ? "Un empleado no se archiva editando su estado."
        : "El estado del empleado no es válido.",
    );
  }
  if (!Array.isArray(dto.allowedBranchIds)) {
    throw new AdministrationServiceError("Las sucursales asignadas no son válidas.");
  }
}

export function normalizeEmployeeInput(dto: EmployeeInputDto): EmployeeInputDto {
  return {
    name: dto.name.trim(),
    email: dto.email.trim().toLowerCase(),
    phone: dto.phone?.trim() ? normalizeGuatemalaPhone(dto.phone) : undefined,
    employeeCode: dto.employeeCode.trim().toUpperCase(),
    roleId: dto.roleId.trim(),
    allowedBranchIds: Array.from(
      new Set(dto.allowedBranchIds.map((id) => id.trim()).filter(Boolean)),
    ),
    status: dto.status,
  };
}

/**
 * PR #88 ya estableció esta regla para Roles (`ensureDelegatablePermissions` en
 * role.validation.ts): un actor nunca puede otorgar más de lo que él mismo tiene. Acá aplica lo
 * mismo a la ASIGNACIÓN de un Role completo -- un actor con `admin.users.manage` no puede asignar
 * un Role cuyos permisos excedan los propios (`targetRole.permissions ⊆
 * actorEffectivePermissions`), sin importar si el Role es `isSystem` o no. Misma filosofía: no
 * existe (se buscó explícitamente en PR #88 y de nuevo acá) un concepto autoritativo de "super
 * admin"/bypass en el código, así que no se inventa ninguno -- ni siquiera para asignar roles.
 *
 * Mensaje deliberadamente genérico (ticket "FIXES FOCALIZADOS" §3, mismo criterio que
 * `ensureDelegatablePermissions` en role.validation.ts): las permission keys crudas no son
 * vocabulario de negocio -- no viajan en el mensaje que llega a la UI.
 */
export function ensureDelegatableRole(
  actorPermissions: readonly string[],
  targetRole: Pick<Role, "permissions">,
) {
  const actorPermissionSet = new Set(actorPermissions);
  const nonDelegable = targetRole.permissions.filter((key) => !actorPermissionSet.has(key));
  if (nonDelegable.length > 0) {
    throw new AdministrationServiceError(
      "El rol seleccionado otorga permisos que la cuenta actual no puede asignar. Seleccione otro rol o solicite el ajuste de permisos.",
    );
  }
}

/**
 * `archived` nunca es asignable. `inactive` tampoco -- preferencia explícita del ticket (§8):
 * "preferir NO asignar nuevos users a un Role inactive salvo contrato explícito", y acá no existe
 * ese contrato todavía. `isSystem` NO excluye un rol de ser asignado (solo de editarse/archivarse,
 * ver PR #88 `ensureRoleNotSystem`) -- role-admin, role-cashier, etc. siguen siendo asignables.
 */
export function ensureRoleAssignable(role: Role | null, tenantId: string): Role {
  if (!role || role.tenantId !== tenantId) {
    throw new AdministrationServiceError(
      "El rol seleccionado no está disponible para el negocio activo.",
    );
  }
  if (role.status !== RoleStatus.active) {
    throw new AdministrationServiceError(
      "Solo se pueden asignar roles activos. Active el rol o seleccione otro.",
    );
  }
  return role;
}
