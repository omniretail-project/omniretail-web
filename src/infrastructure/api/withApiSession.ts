import type { Branch, Role, Tenant, User } from "@/core/entities";
import { type BranchType, type PlanCode, UserType } from "@/core/enums";
import type {
  AddressRepository,
  BankAccountRepository,
  BranchRepository,
  BusinessConfigRepository,
  CustomerPaymentMethodRepository,
  CustomerRepository,
  EmailSenderConfigRepository,
  PlanRepository,
  RoleRepository,
  SupplierRepository,
  TenantSubscriptionRepository,
  UserRepository,
} from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { ApiAddressRepository } from "@/infrastructure/api/ApiAddressRepository";
import { ApiAuthRepository } from "@/infrastructure/api/ApiAuthRepository";
import { ApiBankAccountRepository } from "@/infrastructure/api/ApiBankAccountRepository";
import { ApiBranchRepository } from "@/infrastructure/api/ApiBranchRepository";
import { ApiBusinessConfigRepository } from "@/infrastructure/api/ApiBusinessConfigRepository";
import { ApiCustomerPaymentMethodRepository } from "@/infrastructure/api/ApiCustomerPaymentMethodRepository";
import { ApiCustomerRepository } from "@/infrastructure/api/ApiCustomerRepository";
import { ApiEmailSenderConfigRepository } from "@/infrastructure/api/ApiEmailSenderConfigRepository";
import { ApiPlanRepository } from "@/infrastructure/api/ApiPlanRepository";
import { ApiRoleRepository } from "@/infrastructure/api/ApiRoleRepository";
import {
  ApiSessionEntitlementsClient,
  isSessionPlanId,
  toSessionPlan,
  toSessionSubscription,
} from "@/infrastructure/api/ApiSessionEntitlementsClient";
import { ApiSupplierRepository } from "@/infrastructure/api/ApiSupplierRepository";
import { ApiTenantSubscriptionRepository } from "@/infrastructure/api/ApiTenantSubscriptionRepository";
import { ApiUserRepository } from "@/infrastructure/api/ApiUserRepository";
import { toRole, toTenant, toUser } from "@/infrastructure/api/apiSessionMapper";
import { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";

/**
 * Devuelve `target` con algunos metodos reemplazados; el resto se delega al objeto original
 * (enlazado a el, para que los repositorios mock sigan funcionando igual).
 */
function withOverrides<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(object, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return overrides[property as keyof T];
      }
      const value = Reflect.get(object, property, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

/**
 * Elige entre el repositorio del backend y el mock en cada llamada: el backend solo con sesion de
 * empleado, solo para la tienda de esa sesion (en los metodos que reciben `tenantId`) y, si se
 * indican `permissions`, solo cuando el rol de /auth/me tiene alguno de ellos. Asi el storefront
 * publico, las cuentas de cliente y los empleados sin el permiso del endpoint siguen leyendo el
 * mock (como antes de migrar) en vez de recibir un 403 seguro del backend.
 */
function employeeRouter<T>(
  mock: T,
  api: T,
  currentSession: CurrentSessionClient,
  permissions: readonly string[] = [],
) {
  return async (tenantId?: string): Promise<T> => {
    const current = await currentSession.get();
    if (current?.user.type !== UserType.employee) return mock;
    if (tenantId !== undefined && current.user.tenantId !== tenantId) return mock;
    const granted = current.role?.permissions ?? [];
    const allowed = permissions.length === 0 || permissions.some((key) => granted.includes(key));
    return allowed ? api : mock;
  };
}

/**
 * Igual que `employeeRouter`, pero para el autoservicio de "Mi cuenta": el backend solo con sesion
 * de cliente. Empleados, invitados y el storefront publico siguen en el mock. El repositorio del
 * backend vuelve a comprobar que tenantId/customerId sean los de la sesion.
 */
function customerRouter<T>(mock: T, api: T, currentSession: CurrentSessionClient) {
  return async (): Promise<T> => {
    const current = await currentSession.get();
    return current?.user.type === UserType.customer ? api : mock;
  };
}

/**
 * `/me/profile` (perfil del cliente autenticado). Los demas metodos (gestion administrativa de
 * clientes) no tienen endpoint de autoservicio y siguen en el mock.
 */
function apiCustomersForCustomers(
  mock: CustomerRepository,
  api: ApiCustomerRepository,
  currentSession: CurrentSessionClient,
): CustomerRepository {
  const resolve = customerRouter<Pick<CustomerRepository, "getByUserId" | "updateProfileForCustomer">>(
    mock,
    api,
    currentSession,
  );

  return withOverrides(mock, {
    getByUserId: async (userId: string) => (await resolve()).getByUserId(userId),
    updateProfileForCustomer: async (tenantId, customerId, input) =>
      (await resolve()).updateProfileForCustomer(tenantId, customerId, input),
  });
}

/** `/me/addresses` (direcciones del cliente autenticado). */
function apiAddressesForCustomers(
  mock: AddressRepository,
  api: AddressRepository,
  currentSession: CurrentSessionClient,
): AddressRepository {
  const resolve = customerRouter(mock, api, currentSession);

  return {
    getByCustomer: async (tenantId, customerId) =>
      (await resolve()).getByCustomer(tenantId, customerId),
    getById: async (tenantId, customerId, id) => (await resolve()).getById(tenantId, customerId, id),
    create: async (input) => (await resolve()).create(input),
    update: async (tenantId, customerId, id, input) =>
      (await resolve()).update(tenantId, customerId, id, input),
    remove: async (tenantId, customerId, id) => (await resolve()).remove(tenantId, customerId, id),
    setDefault: async (tenantId, customerId, addressId) =>
      (await resolve()).setDefault(tenantId, customerId, addressId),
  };
}

/** `/me/payment-methods` (tarjetas guardadas del cliente autenticado). */
function apiPaymentMethodsForCustomers(
  mock: CustomerPaymentMethodRepository,
  api: CustomerPaymentMethodRepository,
  currentSession: CurrentSessionClient,
): CustomerPaymentMethodRepository {
  const resolve = customerRouter(mock, api, currentSession);

  return {
    getByCustomer: async (tenantId, customerId) =>
      (await resolve()).getByCustomer(tenantId, customerId),
    getById: async (tenantId, customerId, id) => (await resolve()).getById(tenantId, customerId, id),
    create: async (input) => (await resolve()).create(input),
    update: async (tenantId, customerId, id, input) =>
      (await resolve()).update(tenantId, customerId, id, input),
    remove: async (tenantId, customerId, id) => (await resolve()).remove(tenantId, customerId, id),
    setDefault: async (tenantId, customerId, paymentMethodId) =>
      (await resolve()).setDefault(tenantId, customerId, paymentMethodId),
  };
}

const BRANCH_ADMIN_PERMISSIONS = ["admin.branches.read", "admin.branches.manage"] as const;

/**
 * Lectura de sucursales para un empleado SIN permiso administrativo: solo ve las sucursales activas
 * que tiene asignadas (`GET /auth/session/branches`). Mantiene el contrato de `BranchRepository`
 * para que los servicios operativos (inventario, compras, recepciones...) validen la sucursal sin
 * necesitar `admin.branches.read`. Una sucursal fuera de esa lista se trata como inexistente.
 * Crear y editar siguen exigiendo el permiso administrativo en el backend.
 */
function assignedBranchRepository(
  api: ApiBranchRepository,
  tenantId: string,
): BranchRepository {
  const assigned = () => api.getAssignedActive(tenantId);
  const forTenant = async (id: string) =>
    (await assigned()).find((branch) => branch.id === id && branch.tenantId === tenantId) ?? null;

  return {
    getAll: assigned,
    getById: forTenant,
    getByIdScoped: (scopedTenantId, id) =>
      scopedTenantId === tenantId ? forTenant(id) : Promise.resolve(null),
    getActive: assigned,
    getActiveByTenant: async (scopedTenantId) =>
      scopedTenantId === tenantId ? assigned() : [],
    listByTenant: async (scopedTenantId) => (scopedTenantId === tenantId ? assigned() : []),
    getActiveByTenantAndType: async (scopedTenantId, type) =>
      scopedTenantId === tenantId
        ? (await assigned()).filter((branch) => branch.type === type)
        : [],
    create: (input) => api.create(input),
    update: (id, input) => api.update(id, input),
  };
}

/**
 * `/administration/branches` exige `admin.branches.read`. Con ese permiso se usa el backend
 * administrativo; sin el, un empleado lee solo sus sucursales asignadas (nunca mock, nunca un 403).
 * Clientes y storefront publico siguen en el mock.
 */
export function apiBranchesForEmployees(
  mock: BranchRepository,
  api: ApiBranchRepository,
  currentSession: CurrentSessionClient,
): BranchRepository {
  const resolve = async (tenantId?: string): Promise<BranchRepository> => {
    const current = await currentSession.get();
    if (current?.user.type !== UserType.employee) return mock;
    if (tenantId !== undefined && current.user.tenantId !== tenantId) return mock;
    const granted = current.role?.permissions ?? [];
    const canReadAdministration = BRANCH_ADMIN_PERMISSIONS.some((key) => granted.includes(key));
    return canReadAdministration ? api : assignedBranchRepository(api, current.user.tenantId);
  };

  return {
    getAll: async (): Promise<Branch[]> => (await resolve()).getAll(),
    getById: async (id: string) => (await resolve()).getById(id),
    getByIdScoped: async (tenantId: string, id: string) =>
      (await resolve(tenantId)).getByIdScoped(tenantId, id),
    getActive: async () => (await resolve()).getActive(),
    getActiveByTenant: async (tenantId: string) =>
      (await resolve(tenantId)).getActiveByTenant(tenantId),
    listByTenant: async (tenantId: string) => (await resolve(tenantId)).listByTenant(tenantId),
    getActiveByTenantAndType: async (tenantId: string, type: BranchType) =>
      (await resolve(tenantId)).getActiveByTenantAndType(tenantId, type),
    create: async (input) => (await resolve(input.tenantId)).create(input),
    update: async (id, input) => (await resolve()).update(id, input),
  };
}

/**
 * `/administration/roles` exige `admin.roles.read`. El rol de la sesion actual sale siempre de
 * /auth/me, que no requiere ese permiso (un cajero tambien necesita resolver su propio rol).
 */
function apiRolesForEmployees(
  mock: RoleRepository,
  api: RoleRepository,
  currentSession: CurrentSessionClient,
): RoleRepository {
  const resolve = employeeRouter(mock, api, currentSession, ["admin.roles.read", "admin.roles.manage"]);

  return {
    listByTenant: async (tenantId: string) => (await resolve(tenantId)).listByTenant(tenantId),
    async getByIdScoped(tenantId: string, id: string): Promise<Role | null> {
      const current = await currentSession.get();
      if (current && current.user.tenantId === tenantId && current.role?.id === id) {
        return toRole(current);
      }
      return (await resolve(tenantId)).getByIdScoped(tenantId, id);
    },
    create: async (input) => (await resolve(input.tenantId)).create(input),
    updateScoped: async (tenantId, id, input) =>
      (await resolve(tenantId)).updateScoped(tenantId, id, input),
    archiveScoped: async (tenantId, id) => (await resolve(tenantId)).archiveScoped(tenantId, id),
  };
}

/**
 * `/administration/users` exige `admin.users.read` y solo devuelve empleados. El usuario de la
 * sesion actual sale siempre de /auth/me, que no requiere ese permiso.
 */
function apiUsersForEmployees(
  mock: UserRepository,
  api: UserRepository,
  currentSession: CurrentSessionClient,
): UserRepository {
  const resolve = employeeRouter(mock, api, currentSession, ["admin.users.read", "admin.users.manage"]);

  return {
    getAll: async () => (await resolve()).getAll(),
    async getById(id: string): Promise<User | null> {
      const current = await currentSession.get();
      return current && current.user.id === id ? toUser(current) : (await resolve()).getById(id);
    },
    getByEmail: async (email: string) => (await resolve()).getByEmail(email),
    listByTenant: async (tenantId: string) => (await resolve(tenantId)).listByTenant(tenantId),
    async getByIdScoped(tenantId: string, id: string): Promise<User | null> {
      const current = await currentSession.get();
      return current && current.user.id === id && current.user.tenantId === tenantId
        ? toUser(current)
        : (await resolve(tenantId)).getByIdScoped(tenantId, id);
    },
    getByEmployeeCodeScoped: async (tenantId: string, employeeCode: string) =>
      (await resolve(tenantId)).getByEmployeeCodeScoped(tenantId, employeeCode),
    create: async (input) => (await resolve(input.tenantId)).create(input),
    update: async (id, input) => (await resolve()).update(id, input),
    updateScoped: async (tenantId, id, input) =>
      (await resolve(tenantId)).updateScoped(tenantId, id, input),
    updateStatus: async (id, status) => (await resolve()).updateStatus(id, status),
  };
}

/**
 * Entitlements de la sesion para el empleado de `tenantId` que NO tiene `admin.plans.read`: la
 * lectura operativa de `GET /auth/session/entitlements`. Devuelve `undefined` cuando no aplica
 * (sin cliente, no empleado, otra tienda o con permiso administrativo) para seguir el flujo normal.
 */
async function sessionEntitlementsFor(
  currentSession: CurrentSessionClient,
  sessionEntitlements: ApiSessionEntitlementsClient | undefined,
  tenantId: string,
) {
  if (!sessionEntitlements) return undefined;
  const current = await currentSession.get();
  if (current?.user.type !== UserType.employee || current.user.tenantId !== tenantId) return undefined;
  if (current.role?.permissions.includes("admin.plans.read")) return undefined;
  return { entitlements: await sessionEntitlements.get() };
}

/**
 * `/admin/subscriptions` exige `admin.plans.read`. Un empleado sin ese permiso (Cajero, Inventario,
 * Bodeguero) obtiene su suscripcion derivada de `/auth/session/entitlements`, para que el resolver
 * de entitlements funcione igual que para un administrador.
 */
export function apiSubscriptionsForEmployees(
  mock: TenantSubscriptionRepository,
  api: TenantSubscriptionRepository,
  currentSession: CurrentSessionClient,
  sessionEntitlements?: ApiSessionEntitlementsClient,
): TenantSubscriptionRepository {
  const resolve = employeeRouter(mock, api, currentSession, ["admin.plans.read"]);

  return {
    getByTenantId: async (tenantId: string) => {
      const operational = await sessionEntitlementsFor(currentSession, sessionEntitlements, tenantId);
      if (operational) {
        return operational.entitlements ? toSessionSubscription(operational.entitlements) : null;
      }
      return (await resolve(tenantId)).getByTenantId(tenantId);
    },
    listInvoices: async (tenantId: string) => (await resolve(tenantId)).listInvoices(tenantId),
    ensureInvoice: async (input) => (await resolve(input.tenantId)).ensureInvoice(input),
    create: async (input) => (await resolve(input.tenantId)).create(input),
    update: async (tenantId, input) => (await resolve(tenantId)).update(tenantId, input),
  };
}

/**
 * `/admin/plans` exige `admin.plans.read`. Sin ese permiso (o sin sesion: alta publica de negocio)
 * se usa el catalogo mock, igual que antes.
 */
export function apiPlansForEmployees(
  mock: PlanRepository,
  api: PlanRepository,
  currentSession: CurrentSessionClient,
  sessionEntitlements?: ApiSessionEntitlementsClient,
): PlanRepository {
  const resolve = employeeRouter(mock, api, currentSession, ["admin.plans.read"]);

  return {
    listActive: async () => (await resolve()).listActive(),
    getById: async (id: string) => {
      // Plan sintetico de la suscripcion derivada: lleva el tenant en el id y solo es valido para
      // el empleado de esa misma tienda.
      if (isSessionPlanId(id)) {
        const tenantId = id.slice(id.lastIndexOf(":") + 1);
        const operational = await sessionEntitlementsFor(currentSession, sessionEntitlements, tenantId);
        return operational?.entitlements ? toSessionPlan(operational.entitlements) : null;
      }
      return (await resolve()).getById(id);
    },
    getByCode: async (code: PlanCode) => (await resolve()).getByCode(code),
  };
}

/**
 * Las mutaciones y el listado administrativo conservan `admin.bank_accounts.manage`. Las lecturas
 * activas y por id usadas por POS son operacionales y siempre consultan API, sin fallback a mock.
 */
function apiBankAccountsForEmployees(
  mock: BankAccountRepository,
  api: BankAccountRepository,
  currentSession: CurrentSessionClient,
): BankAccountRepository {
  const resolve = employeeRouter(mock, api, currentSession, ["admin.bank_accounts.manage"]);

  return {
    getAll: async () => (await resolve()).getAll(),
    getActive: async () => api.getActive(),
    getActiveByTenant: async (tenantId: string) => api.getActiveByTenant(tenantId),
    getById: async (id: string) => api.getById(id),
    create: async (input) => (await resolve(input.tenantId)).create(input),
    update: async (id, input) => (await resolve()).update(id, input),
  };
}

/**
 * Las mutaciones y lecturas administrativas conservan `admin.suppliers.manage`. La proyeccion
 * activa usada por Purchasing es operacional y el backend la autoriza con permisos de compras.
 */
function apiSuppliersForEmployees(
  mock: SupplierRepository,
  api: SupplierRepository,
  currentSession: CurrentSessionClient,
): SupplierRepository {
  const resolve = employeeRouter(mock, api, currentSession, ["admin.suppliers.manage"]);

  return {
    getAll: async () => (await resolve()).getAll(),
    getById: async (id: string) => (await resolve()).getById(id),
    getActive: async () => (await resolve()).getActive(),
    getActiveByTenant: async (tenantId: string) => api.getActiveByTenant(tenantId),
    // Lecturas operacionales de Compras: siempre API (sin fallback a mock), igual que
    // getActiveByTenant; el backend las autoriza con permisos de compras.
    getOperationalPage: async (params) => api.getOperationalPage(params),
    getOperationalById: async (id: string) => api.getOperationalById(id),
    getOperationalProducts: async (supplierId, params) =>
      api.getOperationalProducts(supplierId, params),
    getOperationalIncidents: async (supplierId, params) =>
      api.getOperationalIncidents(supplierId, params),
    listByTenant: async (tenantId: string) => (await resolve(tenantId)).listByTenant(tenantId),
    getProductsBySupplier: async (supplierId: string) =>
      (await resolve()).getProductsBySupplier(supplierId),
    create: async (input) => (await resolve(input.tenantId)).create(input),
    update: async (id, input) => (await resolve()).update(id, input),
    archive: async (id: string) => (await resolve()).archive(id),
  };
}

/**
 * `GET /administration/business-config` no exige permiso (POS, inventario, recepcion y catalogo la
 * leen); guardarla exige `admin.business_config.manage`. La config e-commerce y el carrusel exigen
 * `admin.ecommerce_config.manage`, asi que el storefront publico y los empleados sin ese permiso
 * siguen leyendo el mock.
 */
export function apiBusinessConfigForEmployees(
  mock: BusinessConfigRepository,
  api: BusinessConfigRepository,
  currentSession: CurrentSessionClient,
): BusinessConfigRepository {
  const readCapabilities = employeeRouter(mock, api, currentSession);
  const manageCapabilities = employeeRouter(mock, api, currentSession, [
    "admin.business_config.manage",
  ]);
  const manageEcommerce = employeeRouter(mock, api, currentSession, [
    "admin.ecommerce_config.manage",
  ]);

  return {
    getCapabilities: async (tenantId: string) =>
      (await readCapabilities(tenantId)).getCapabilities(tenantId),
    createCapabilities: async (input) =>
      (await manageCapabilities(input.tenantId)).createCapabilities(input),
    updateCapabilities: async (tenantId, input) =>
      (await manageCapabilities(tenantId)).updateCapabilities(tenantId, input),
    getEcommerceConfig: async (tenantId: string) =>
      (await manageEcommerce(tenantId)).getEcommerceConfig(tenantId),
    createEcommerceConfig: async (input) =>
      (await manageEcommerce(input.tenantId)).createEcommerceConfig(input),
    updateEcommerceConfig: async (tenantId, input) =>
      (await manageEcommerce(tenantId)).updateEcommerceConfig(tenantId, input),
    uploadEcommerceLogo: async (tenantId, file) =>
      (await manageEcommerce(tenantId)).uploadEcommerceLogo(tenantId, file),
    uploadHeroBannerImage: async (tenantId, index, file) =>
      (await manageEcommerce(tenantId)).uploadHeroBannerImage(tenantId, index, file),
    getHeroBanner: async (tenantId: string) =>
      (await manageEcommerce(tenantId)).getHeroBanner(tenantId),
    createHeroBanner: async (input) =>
      (await manageEcommerce(input.tenantId)).createHeroBanner(input),
    updateHeroBanner: async (tenantId, input) =>
      (await manageEcommerce(tenantId)).updateHeroBanner(tenantId, input),
  };
}

/**
 * `/administration/email-sender`: lectura exige `admin.email_config.read` y las mutaciones
 * `admin.email_config.manage`. Sin esos permisos (o fuera de sesion de empleado) se usa el mock, que
 * solo simula estado y nunca guarda la App Password.
 */
function apiEmailSenderForEmployees(
  mock: EmailSenderConfigRepository,
  api: EmailSenderConfigRepository,
  currentSession: CurrentSessionClient,
): EmailSenderConfigRepository {
  const read = employeeRouter(mock, api, currentSession, [
    "admin.email_config.read",
    "admin.email_config.manage",
  ]);
  const manage = employeeRouter(mock, api, currentSession, ["admin.email_config.manage"]);

  return {
    get: async (tenantId: string) => (await read(tenantId)).get(tenantId),
    save: async (tenantId, input) => (await manage(tenantId)).save(tenantId, input),
    sendTest: async (tenantId, recipient) => (await manage(tenantId)).sendTest(tenantId, recipient),
    disconnect: async (tenantId: string) => (await manage(tenantId)).disconnect(tenantId),
  };
}

/**
 * Modo api: reemplaza `auth` por ApiAuthRepository y enruta al backend la administracion
 * (`branches`, `roles`, `users`, `tenantSubscriptions`, `plans`, `bankAccounts`, `suppliers`,
 * `businessConfig`) para empleados con el permiso de
 * cada endpoint (ver `employeeRouter`), y "Mi cuenta" (`customers`, `addresses`,
 * `customerPaymentMethods`) solo para la sesion de cliente (ver `customerRouter`). La identidad de la sesion actual (usuario, rol con
 * permisos, tienda) sale de /auth/me. Cualquier otra lectura se delega al mock, asi los modulos no
 * migrados siguen igual.
 *
 * Asi `resolveCurrentSessionSnapshot`, `CurrentSessionProvider` y las pantallas no cambian: siguen
 * consumiendo los mismos contratos y no saben si los datos vienen del mock o del backend.
 */
export function withApiSession(repositories: RepositoryRegistry, eventBus: DataEventBus): RepositoryRegistry {
  const currentSession = new CurrentSessionClient();
  const sessionEntitlements = new ApiSessionEntitlementsClient(eventBus);
  // `savedPaymentMethods` es un alias de `customerPaymentMethods`: ambos apuntan al mismo objeto.
  const customerPaymentMethods = apiPaymentMethodsForCustomers(
    repositories.customerPaymentMethods,
    new ApiCustomerPaymentMethodRepository(currentSession, eventBus),
    currentSession,
  );

  const tenants = withOverrides(repositories.tenants, {
    async getById(id: string): Promise<Tenant | null> {
      const current = await currentSession.get();
      return current && current.tenant.id === id ? toTenant(current) : repositories.tenants.getById(id);
    },
  });

  return {
    ...repositories,
    auth: new ApiAuthRepository(currentSession, repositories.tenants, eventBus),
    tenants,
    users: apiUsersForEmployees(repositories.users, new ApiUserRepository(eventBus), currentSession),
    roles: apiRolesForEmployees(repositories.roles, new ApiRoleRepository(eventBus), currentSession),
    branches: apiBranchesForEmployees(
      repositories.branches,
      new ApiBranchRepository(eventBus),
      currentSession,
    ),
    tenantSubscriptions: apiSubscriptionsForEmployees(
      repositories.tenantSubscriptions,
      new ApiTenantSubscriptionRepository(eventBus),
      currentSession,
      sessionEntitlements,
    ),
    plans: apiPlansForEmployees(
      repositories.plans,
      new ApiPlanRepository(),
      currentSession,
      sessionEntitlements,
    ),
    bankAccounts: apiBankAccountsForEmployees(
      repositories.bankAccounts,
      new ApiBankAccountRepository(eventBus),
      currentSession,
    ),
    suppliers: apiSuppliersForEmployees(
      repositories.suppliers,
      new ApiSupplierRepository(eventBus),
      currentSession,
    ),
    businessConfig: apiBusinessConfigForEmployees(
      repositories.businessConfig,
      new ApiBusinessConfigRepository(eventBus),
      currentSession,
    ),
    emailSender: apiEmailSenderForEmployees(
      repositories.emailSender,
      new ApiEmailSenderConfigRepository(eventBus),
      currentSession,
    ),
    customers: apiCustomersForCustomers(
      repositories.customers,
      new ApiCustomerRepository(currentSession, eventBus),
      currentSession,
    ),
    addresses: apiAddressesForCustomers(
      repositories.addresses,
      new ApiAddressRepository(currentSession, eventBus),
      currentSession,
    ),
    customerPaymentMethods,
    savedPaymentMethods: customerPaymentMethods,
  };
}
