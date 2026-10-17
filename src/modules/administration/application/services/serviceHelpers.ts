import type { BankAccount, Branch, Role, Supplier, User } from "@/core/entities";
import { BranchStatus, BranchType, SaasLimitKey, UserStatus, UserType } from "@/core/enums";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BranchInputDto } from "@/modules/administration/application/dto/BranchDto";
import {
  ADMIN_FIELD_LIMITS,
  isValidGuatemalaPhone,
  normalizeGuatemalaPhone,
} from "@/modules/administration/validation/adminFieldConstraints";
import {
  BUSINESS_CONFIG_MANAGE_PERMISSION,
  CASH_READ_PERMISSION,
  DASHBOARD_READ_PERMISSION,
  EMAIL_CONFIG_MANAGE_PERMISSION,
  EMAIL_CONFIG_READ_PERMISSION,
  PLANS_MANAGE_PERMISSION,
  PLANS_READ_PERMISSION,
  REPORTS_EXPORT_PERMISSION,
  REPORTS_READ_PERMISSION,
} from "@/modules/administration/permissions";
import { ensureTenantLimit, SaasEntitlementError } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

export class AdministrationServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdministrationServiceError";
  }
}

/**
 * Guardado incompleto: parte de la operacion quedo confirmada en el backend y otra parte fallo.
 * `persisted` es el estado que el backend devolvio por ultima vez, para que la UI muestre lo que
 * realmente quedo guardado en lugar de conservar datos desactualizados.
 */
export class PartialSaveError<TPersisted> extends AdministrationServiceError {
  constructor(
    message: string,
    readonly persisted: TPersisted,
  ) {
    super(message);
    this.name = "PartialSaveError";
  }
}

/**
 * El permiso se verifica en la capa de aplicacion, no en la pantalla: ocultar el menu o el boton no
 * es enforcement, y la configuracion afecta a todo el tenant.
 */
export function ensureCanManageBusinessConfig(permissions: readonly string[]) {
  if (permissions.includes(BUSINESS_CONFIG_MANAGE_PERMISSION)) return;

  throw new AdministrationServiceError(
    "No dispone de permisos para modificar la configuración del negocio.",
  );
}

export function ensureCanReadEmailSender(permissions: readonly string[]) {
  if (
    permissions.includes(EMAIL_CONFIG_READ_PERMISSION) ||
    permissions.includes(EMAIL_CONFIG_MANAGE_PERMISSION)
  ) {
    return;
  }

  throw new AdministrationServiceError("No dispone de permisos para consultar el correo remitente.");
}

export function ensureCanManageEmailSender(permissions: readonly string[]) {
  if (permissions.includes(EMAIL_CONFIG_MANAGE_PERMISSION)) return;

  throw new AdministrationServiceError("No dispone de permisos para gestionar el correo remitente.");
}

export function ensureCanReadCustomers(permissions: readonly string[]) {
  if (permissions.includes("admin.customers.read")) return;

  throw new AdministrationServiceError("No dispone de permisos para consultar clientes.");
}

export function ensureCustomerTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureCanReadCash(permissions: readonly string[]) {
  if (permissions.includes(CASH_READ_PERMISSION)) return;

  throw new AdministrationServiceError("No dispone de permisos para consultar los turnos de caja.");
}

export function ensureCashTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureCashActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

export function ensureCanReadDashboard(permissions: readonly string[]) {
  if (permissions.includes(DASHBOARD_READ_PERMISSION)) return;

  throw new AdministrationServiceError("No dispone de permisos para consultar el dashboard.");
}

export function ensureDashboardTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureCanReadReports(permissions: readonly string[]) {
  if (permissions.includes(REPORTS_READ_PERMISSION)) return;

  throw new AdministrationServiceError("No dispone de permisos para consultar los reportes.");
}

export function ensureCanExportReports(permissions: readonly string[]) {
  if (permissions.includes(REPORTS_EXPORT_PERMISSION)) return;

  throw new AdministrationServiceError("No dispone de permisos para exportar reportes.");
}

export function ensureCanManageEcommerceConfig(permissions: readonly string[]) {
  if (permissions.includes("admin.ecommerce_config.manage")) return;

  throw new AdministrationServiceError(
    "No dispone de permisos para gestionar la configuración de e-commerce.",
  );
}

export function ensureEcommerceConfigTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureEcommerceConfigActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

/**
 * La sucursal predeterminada del e-commerce es el punto operacional desde donde se preparan los
 * pedidos online (Picking/Dispatch). Se valida en el service, no solo en el selector del
 * formulario, y siempre que venga informada -- no solo mientras la tienda está habilitada -- para
 * que no se pueda persistir una sucursal inexistente, de otro tenant o inactiva con la tienda
 * deshabilitada y despues "activarla" sin volver a pasar por esta validación.
 */
export function ensureEcommerceDefaultBranch(
  enabled: boolean,
  defaultBranchId: string | undefined,
  branch: Branch | null,
  tenantId: string,
) {
  if (defaultBranchId) {
    if (!branch || branch.tenantId !== tenantId) {
      throw new AdministrationServiceError(
        "La sucursal predeterminada no existe o no pertenece al negocio activo.",
      );
    }
    if (branch.status !== BranchStatus.active) {
      throw new AdministrationServiceError("La sucursal predeterminada debe estar activa.");
    }
    return;
  }

  if (enabled) {
    throw new AdministrationServiceError(
      "Seleccione una sucursal predeterminada para habilitar el e-commerce.",
    );
  }
}

/**
 * La autorización de proveedores pertenece a la capa de aplicación. Una UI oculta no impide que
 * otro consumidor invoque directamente estos servicios.
 */
export function ensureCanManageSuppliers(permissions: readonly string[]) {
  if (permissions.includes("admin.suppliers.manage")) return;

  throw new AdministrationServiceError("No dispone de permisos para gestionar proveedores.");
}

export function ensureSupplierTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureSupplierActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

export function ensureSupplierBelongsToTenant(
  supplier: Supplier | null,
  tenantId: string,
): Supplier {
  if (supplier?.tenantId === tenantId) return supplier;

  throw new AdministrationServiceError("El proveedor no está disponible para el negocio activo.");
}

/**
 * La autorización de sucursales pertenece a la capa de aplicación. Una UI oculta no impide que
 * otro consumidor invoque directamente estos servicios.
 */
export function ensureCanManageBranches(permissions: readonly string[]) {
  if (permissions.includes("admin.branches.manage")) return;

  throw new AdministrationServiceError("No dispone de permisos para gestionar sucursales.");
}

export function ensureCanReadBranches(permissions: readonly string[]) {
  if (
    permissions.includes("admin.branches.read") ||
    permissions.includes("admin.branches.manage")
  ) {
    return;
  }

  throw new AdministrationServiceError("No dispone de permisos para consultar sucursales.");
}

export function ensureBranchTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureBranchActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

export function ensureBranchBelongsToTenant(branch: Branch | null, tenantId: string): Branch {
  if (branch?.tenantId === tenantId) return branch;

  throw new AdministrationServiceError("La sucursal no está disponible para el negocio activo.");
}

/**
 * Valida el DTO recibido antes de normalizarlo. Así las reglas observan exactamente lo que envió
 * el consumidor y la normalización posterior no puede ocultar un valor inválido.
 */
export function ensureValidBranchInput(dto: BranchInputDto) {
  const limits = ADMIN_FIELD_LIMITS.branch;
  const code = dto.code.trim();
  const name = dto.name.trim();
  if (!code) {
    throw new AdministrationServiceError("El código de la sucursal es obligatorio.");
  }
  if (code.length > limits.code) {
    throw new AdministrationServiceError(
      "El código de la sucursal no puede exceder 16 caracteres.",
    );
  }
  if (!name) {
    throw new AdministrationServiceError("El nombre de la sucursal es obligatorio.");
  }
  if (name.length > limits.name) {
    throw new AdministrationServiceError(
      "El nombre de la sucursal no puede exceder 120 caracteres.",
    );
  }
  if (dto.address && dto.address.trim().length > limits.address) {
    throw new AdministrationServiceError(
      "La dirección de la sucursal no puede exceder 180 caracteres.",
    );
  }
  if (!Object.values(BranchType).includes(dto.type)) {
    throw new AdministrationServiceError("El tipo de sucursal no es válido.");
  }
  if (!Object.values(BranchStatus).includes(dto.status)) {
    throw new AdministrationServiceError("El estado de la sucursal no es válido.");
  }
  const phone = dto.phone?.trim();
  if (phone && !isValidGuatemalaPhone(phone)) {
    throw new AdministrationServiceError("El teléfono de la sucursal debe tener 8 dígitos.");
  }
  const email = dto.email?.trim();
  if (email && (email.length > limits.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new AdministrationServiceError("El correo de la sucursal no es válido.");
  }
}

export function normalizeBranchInput(dto: BranchInputDto): BranchInputDto {
  return {
    code: dto.code.trim().toUpperCase(),
    name: dto.name.trim(),
    type: dto.type,
    address: normalizeOptionalText(dto.address),
    phone: dto.phone?.trim() ? normalizeGuatemalaPhone(dto.phone) : undefined,
    email: normalizeOptionalText(dto.email)?.toLowerCase(),
    status: dto.status,
  };
}

function normalizeOptionalText(value?: string) {
  const normalized = value?.trim();
  return normalized || undefined;
}

/**
 * La autorización de cuentas bancarias pertenece a la capa de aplicación. El repositorio expone
 * un único permiso `admin.bank_accounts.manage`: sin él no se consulta ni se modifica el maestro.
 */
export function ensureCanManageBankAccounts(permissions: readonly string[]) {
  if (permissions.includes("admin.bank_accounts.manage")) return;

  throw new AdministrationServiceError("No dispone de permisos para gestionar cuentas bancarias.");
}

export function ensureBankAccountTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureBankAccountActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

export function ensureBankAccountBelongsToTenant(
  account: BankAccount | null,
  tenantId: string,
): BankAccount {
  if (account?.tenantId === tenantId) return account;

  throw new AdministrationServiceError(
    "La cuenta bancaria no está disponible para el negocio activo.",
  );
}

/**
 * Valida las sucursales habilitadas contra el maestro real. La UI ofrece solo sucursales activas,
 * pero otro consumidor podría invocar el service con una sucursal de otro tenant, inactiva o
 * inexistente. `tenantBranches` ya viene acotado al negocio activo. Las sucursales que la cuenta
 * ya tenía asignadas (`previousBranchIds`) se conservan aunque hoy estén inactivas; las nuevas
 * deben existir, pertenecer al tenant y estar activas.
 */
export function ensureBankAccountBranchIds(
  branchIds: readonly string[],
  tenantBranches: readonly Branch[],
  previousBranchIds: readonly string[] = [],
) {
  const branchById = new Map(tenantBranches.map((branch) => [branch.id, branch]));
  const alreadyAssigned = new Set(previousBranchIds);

  for (const branchId of branchIds) {
    const branch = branchById.get(branchId);
    if (!branch) {
      throw new AdministrationServiceError(
        "Alguna de las sucursales habilitadas no existe o no pertenece al negocio.",
      );
    }
    if (!alreadyAssigned.has(branchId) && branch.status !== BranchStatus.active) {
      throw new AdministrationServiceError(
        "No se puede habilitar una sucursal inactiva para la cuenta bancaria.",
      );
    }
  }
}

/**
 * Leer roles acepta `admin.roles.read` o `admin.roles.manage`, mismo criterio defensivo que
 * Sucursales. La navegación se protege con `manage` porque es la audiencia real de la pantalla
 * (ver "Sucursales" en README.md); este camino de solo lectura queda como capa defensiva para un
 * futuro rol read-only.
 */
export function ensureCanReadRoles(permissions: readonly string[]) {
  if (permissions.includes("admin.roles.read") || permissions.includes("admin.roles.manage")) {
    return;
  }

  throw new AdministrationServiceError("No dispone de permisos para consultar roles.");
}

export function ensureCanManageRoles(permissions: readonly string[]) {
  if (permissions.includes("admin.roles.manage")) return;

  throw new AdministrationServiceError("No dispone de permisos para gestionar roles.");
}

export function ensureRoleTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureRoleActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

export function ensureRoleBelongsToTenant(role: Role | null, tenantId: string): Role {
  if (role?.tenantId === tenantId) return role;

  throw new AdministrationServiceError("El rol no está disponible para el negocio activo.");
}

/**
 * Los roles `isSystem` (los que trae la plataforma en el seed) nunca se editan ni archivan desde
 * esta pantalla: evita que alguien se quite sin querer el permiso de administrar roles, o rompa un
 * rol del que dependen otras cuentas. El repositorio en sí no protege esto (es CRUD genérico,
 * igual que Branch/Supplier) -- la invariante vive acá, en la capa de aplicación.
 */
export function ensureRoleNotSystem(role: Role) {
  if (role.isSystem) {
    throw new AdministrationServiceError("Los roles del sistema no se pueden editar ni archivar.");
  }
}

/**
 * Leer empleados acepta `admin.users.read` o `admin.users.manage`, mismo criterio defensivo que
 * Roles/Sucursales. La navegación se protege con `manage` (audiencia real de la pantalla).
 */
export function ensureCanReadEmployees(permissions: readonly string[]) {
  if (permissions.includes("admin.users.read") || permissions.includes("admin.users.manage")) {
    return;
  }

  throw new AdministrationServiceError("No dispone de permisos para consultar empleados.");
}

export function ensureCanManageEmployees(permissions: readonly string[]) {
  if (permissions.includes("admin.users.manage")) return;

  throw new AdministrationServiceError("No dispone de permisos para gestionar empleados.");
}

export function ensureEmployeeTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

export function ensureEmployeeActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

/**
 * admin-users administra EMPLOYEES, nunca Customers -- ni para leerlos ni, mucho menos, para
 * asignarles un Role operacional. Un `userId` que resuelve a un Customer se trata como
 * inexistente para esta pantalla (mismo criterio "no distinguir el motivo" que el resto del
 * módulo), no como un error especial que revele que existe pero es del tipo equivocado.
 */
export function ensureEmployeeBelongsToTenant(user: User | null, tenantId: string): User {
  if (user?.tenantId === tenantId && user.type === UserType.employee) return user;

  throw new AdministrationServiceError("El empleado no está disponible para el negocio activo.");
}

/**
 * Mismo patrón que `ensureBankAccountBranchIds`: las sucursales ya asignadas se conservan aunque
 * hoy estén inactivas (`previousBranchIds`), las nuevas deben existir, pertenecer al tenant y
 * estar activas. Un array vacío es válido y conserva su semántica ya existente en `User`: sin
 * `branchScope` (eso quedó en el Role hasta admin-users, y ahora esto ES admin-users) la
 * autorización por sucursal de un Employee todavía depende de `Role.branchScope` combinado con
 * `user.branchId`/`allowedBranchIds` (`core/scopes/userBranchAccess.ts`) -- no se inventa acá un
 * significado nuevo de "acceso a todas las sucursales" para un array vacío de
 * `allowedBranchIds`; se preserva el que ya tenía `isBranchIdInUserScope` antes de esta feature.
 */
export function ensureEmployeeBranchIds(
  branchIds: readonly string[],
  tenantBranches: readonly Branch[],
  previousBranchIds: readonly string[] = [],
) {
  const branchById = new Map(tenantBranches.map((branch) => [branch.id, branch]));
  const alreadyAssigned = new Set(previousBranchIds);

  for (const branchId of branchIds) {
    const branch = branchById.get(branchId);
    if (!branch) {
      throw new AdministrationServiceError(
        "Alguna de las sucursales asignadas no existe o no pertenece al negocio.",
      );
    }
    if (!alreadyAssigned.has(branchId) && branch.status !== BranchStatus.active) {
      throw new AdministrationServiceError(
        "No se puede asignar una sucursal inactiva a un empleado nuevo.",
      );
    }
  }
}

/**
 * La lectura de plan/suscripción pertenece a la capa de aplicación, no a la pantalla: ocultar el
 * menú no es enforcement. La mutación de Plan se protege aparte con `ensureCanManagePlans`.
 */
export function ensureCanReadPlans(permissions: readonly string[]) {
  if (permissions.includes(PLANS_READ_PERMISSION)) return;

  throw new AdministrationServiceError("No dispone de permisos para consultar el plan del negocio.");
}

export function ensurePlanTenant(tenantId: string) {
  if (tenantId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el negocio activo.");
}

/**
 * Cambiar el plan contratado es una mutación tenant-wide de alto impacto (dispara/retira
 * capabilities comerciales completas) -- requiere su propio permiso, separado de
 * `PLANS_READ_PERMISSION`, mismo criterio que el resto del módulo (leer != gestionar).
 */
export function ensureCanManagePlans(permissions: readonly string[]) {
  if (permissions.includes(PLANS_MANAGE_PERMISSION)) return;

  throw new AdministrationServiceError("No dispone de permisos para cambiar el plan del negocio.");
}

export function ensurePlanActor(actorUserId: string) {
  if (actorUserId.trim()) return;

  throw new AdministrationServiceError("No se pudo resolver el usuario actual.");
}

/**
 * Mensajes de negocio (servicio, entitlement SaaS, ApiError del backend) se muestran tal cual;
 * cualquier otro error es inesperado: se registra y se muestra un mensaje generico.
 */
export function cleanError(error: unknown): string {
  if (error instanceof AdministrationServiceError) return error.message;
  if (error instanceof SaasEntitlementError) return error.message;
  if (error instanceof BackendRequestError) return error.message;
  console.error("[Administration Error]:", error);
  return "No se pudo completar la operación. Inténtalo de nuevo.";
}

/**
 * Límites SaaS (feature/saas-entitlement-enforcement, auditoría §23/§32) -- Administration NO
 * tiene una capability general (sigue gobernado por `admin.*` permissions), pero SÍ aplica los
 * límites numéricos del Plan en sus dos creation services. Uso existente, mismo criterio que
 * `GetTenantUsageService`: `User.type === employee && status !== archived` cuenta contra
 * `maxEmployees` (un empleado `inactive`/`blocked` sigue contando; solo `archived` no).
 * `undefined` en el límite del Plan significa sin límite (nunca 0 implícito) -- ver
 * `ensureTenantLimit`. No archiva empleados existentes si un downgrade deja al Tenant por encima
 * del límite -- solo bloquea la PRÓXIMA alta.
 */
export async function ensureTenantCanCreateEmployee(
  repositories: RepositoryRegistry,
  tenantId: string,
): Promise<void> {
  const [entitlements, users] = await Promise.all([
    new ResolveTenantEntitlementsService(repositories).execute(tenantId),
    repositories.users.listByTenant(tenantId),
  ]);
  const currentEmployees = users.filter(
    (user) => user.type === UserType.employee && user.status !== UserStatus.archived,
  ).length;
  ensureTenantLimit(entitlements, SaasLimitKey.maxEmployees, currentEmployees);
}

/**
 * Mismo criterio que `ensureTenantCanCreateEmployee`, para `maxBranches`. Uso existente: `Branch.
 * status !== archived` cuenta (una sucursal `inactive` sigue contando; solo `archived` no).
 */
export async function ensureTenantCanCreateBranch(
  repositories: RepositoryRegistry,
  tenantId: string,
): Promise<void> {
  const [entitlements, branches] = await Promise.all([
    new ResolveTenantEntitlementsService(repositories).execute(tenantId),
    repositories.branches.listByTenant(tenantId),
  ]);
  const currentBranches = branches.filter((branch) => branch.status !== BranchStatus.archived).length;
  ensureTenantLimit(entitlements, SaasLimitKey.maxBranches, currentBranches);
}
