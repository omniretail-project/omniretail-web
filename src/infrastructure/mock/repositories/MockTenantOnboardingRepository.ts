import type {
  AuthAccount,
  Branch,
  BusinessCapabilitiesConfig,
  EcommerceConfig,
  HeroBannerConfig,
  IncidentType,
  Role,
  Tenant,
  TenantSubscription,
  User,
} from "@/core/entities";
import {
  AccountStatus,
  BranchStatus,
  BranchType,
  BusinessPreset,
  RoleStatus,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import { businessDefaultsConfig } from "@/config/business-defaults";
import type {
  TenantOnboardingInput,
  TenantOnboardingRepository,
  TenantOnboardingResult,
} from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { buildPasswordHashMock } from "@/infrastructure/mock/shared/passwordHashMock";

const INITIAL_BRANCH_NAME = "Matriz";
const INITIAL_BRANCH_CODE = "MATRIZ";
const ADMIN_ROLE_NAME = "Administrador";

/**
 * Coordinador transaccional del alta de un Tenant nuevo (feature/tenant-onboarding, auditoría
 * §15/§16/§24/§26 -- "CRÍTICO").
 *
 * `RepositoryRegistry` no expone `MockDatabaseStore` a ninguna capa superior, así que ninguna
 * combinación de llamadas sueltas a `tenants.create()` + `branches.create()` + `roles.create()`
 * + `users.create()` + `auth.bootstrapEmployeeAccount()` + `businessConfig.create*()` +
 * `tenantSubscriptions.create()` desde `TenantOnboardingService` podría ser atómica: cada
 * `Mock*Repository.create()` abre y confirma su PROPIO `store.mutate()`/`store.transact()` de
 * forma independiente (confirmado leyendo cada implementación -- ninguna comparte draft con
 * otra). Si la escritura Nº6 fallara, las 5 anteriores ya habrían sido persistidas: exactamente
 * el escenario "Tenant ✅ Branch ✅ Role ✅ User ✅ Auth ❌ Subscription ❌" que la auditoría
 * prohíbe.
 *
 * Este repositorio existe para reproducir, DENTRO de un único `store.transact()`, el mismo
 * patrón que ya usa el resto del código base para atomicidad multi-tabla real (p.ej.
 * `MockPickingRepository.assign()`, que muta `db.pickingOrders` Y `db.orders` en un solo
 * draft): `onboard()` toca `db.tenants`, `db.branches`, `db.roles`, `db.users`,
 * `db.authAccounts`, `db.businessCapabilities`, `db.ecommerceConfigs` y `db.tenantSubscriptions`
 * directamente, sin delegar en las otras clases `Mock*Repository`. Si `transact()` lanza en
 * cualquier punto, TODO el draft se descarta y `this.database` queda exactamente como estaba --
 * rollback real, no compensación manual.
 *
 * `onboard()` está deliberadamente partido en pasos `protected` (`pushTenant`, `pushBranch`,
 * ...) en vez de un único método monolítico -- NO por estilo, sino para que el harness
 * (`scripts/verify-tenant-onboarding.ts`) pueda provocar un fallo a mitad de la transacción con
 * un test double real (una subclase que sobreescribe un solo paso para lanzar), en vez de una
 * rama `if (input.failStep)` en código productivo (auditoría §24, explícitamente prohibido).
 */
export class MockTenantOnboardingRepository
  extends BaseMockRepository
  implements TenantOnboardingRepository
{
  async onboard(input: TenantOnboardingInput): Promise<TenantOnboardingResult> {
    const result = this.store.transact((db) => {
      // Defensa en profundidad: `TenantOnboardingService` ya valida slug/email disponibles antes
      // de llamar a `onboard()`, pero esa validación lee el store ANTES de abrir esta
      // transacción -- sin este re-chequeo contra el draft, dos onboardings concurrentes con el
      // mismo slug/email podrían pasar ambos la validación previa y sólo detectarse acá.
      this.ensureSlugAvailable(db, input.tenantSlug);
      this.ensureEmailAvailable(db, input.adminEmail);

      const now = this.now();
      const tenant = this.pushTenant(db, input, now);
      this.pushIncidentTypes(db, tenant.id);
      const branch = this.pushBranch(db, tenant.id, now);
      const role = this.pushRole(db, tenant.id, input.adminPermissions, now);
      this.pushCustomerRole(db, tenant.id, now);
      const user = this.pushUser(db, tenant.id, role.id, branch.id, input, now);
      const authAccount = this.pushAuthAccount(db, user, input.adminPasswordMock, now);
      const businessCapabilities = this.pushBusinessCapabilities(db, tenant.id, input.businessPreset);
      const ecommerceConfig = this.pushEcommerceConfig(db, tenant, now);
      this.pushHeroBanner(db, tenant.id, now);
      const subscription = this.pushSubscription(db, tenant.id, input.planId, now);

      return {
        tenant,
        branch,
        role,
        user,
        authAccount,
        businessCapabilities,
        ecommerceConfig,
        subscription,
      };
    });

    this.emit("branch.changed", {
      entityId: result.branch.id,
      tenantId: result.tenant.id,
      action: "created",
    });
    this.emit("role.changed", {
      entityId: result.role.id,
      tenantId: result.tenant.id,
      action: "created",
    });
    this.emit("user.changed", {
      entityId: result.user.id,
      tenantId: result.tenant.id,
      action: "created",
    });
    this.emit("business-config.changed", { tenantId: result.tenant.id, action: "created" });
    return result;
  }

  protected ensureSlugAvailable(db: MockDatabase, slug: string) {
    if (db.tenants.some((tenant) => tenant.slug === slug)) {
      throw new Error(`Ya existe un negocio con el identificador "${slug}".`);
    }
  }

  protected ensureEmailAvailable(db: MockDatabase, email: string) {
    const normalized = email.toLowerCase();
    if (db.users.some((user) => user.email.toLowerCase() === normalized)) {
      throw new Error(`Ya existe una cuenta con el correo "${email}".`);
    }
  }

  protected pushTenant(db: MockDatabase, input: TenantOnboardingInput, now: string): Tenant {
    const tenant: Tenant = {
      id: this.id("tenant"),
      name: input.tenantName,
      slug: input.tenantSlug,
      status: TenantStatus.active,
      defaultCurrency: input.defaultCurrency,
      timezone: input.timezone,
      createdAt: now,
      updatedAt: now,
    };
    db.tenants.push(tenant);
    return tenant;
  }

  protected pushIncidentTypes(db: MockDatabase, tenantId: string): IncidentType[] {
    const incidentTypes: IncidentType[] = [
      { code: "DAMAGED", name: "Producto dañado" },
      { code: "MISSING", name: "Producto faltante" },
      { code: "UNSOLICITED", name: "Producto no solicitado" },
      { code: "OTHER", name: "Otros" },
    ].map(({ code, name }) => ({
      id: this.id("incident-type"),
      tenantId,
      code,
      name,
      active: true,
    }));
    db.incidentTypes.push(...incidentTypes);
    return incidentTypes;
  }

  // Branch inicial ANTES del User -- User.branchId/allowedBranchIds la necesitan (auditoría §11).
  protected pushBranch(db: MockDatabase, tenantId: string, now: string): Branch {
    const branch: Branch = {
      id: this.id("branch"),
      tenantId,
      code: INITIAL_BRANCH_CODE,
      name: INITIAL_BRANCH_NAME,
      type: BranchType.main,
      status: BranchStatus.active,
      createdAt: now,
      updatedAt: now,
    };
    db.branches.push(branch);
    return branch;
  }

  protected pushRole(
    db: MockDatabase,
    tenantId: string,
    permissions: string[],
    now: string,
  ): Role {
    const role: Role = {
      id: this.id("role"),
      tenantId,
      name: ADMIN_ROLE_NAME,
      isSystem: true,
      permissions: [...permissions],
      branchScope: "all",
      status: RoleStatus.active,
      createdAt: now,
      updatedAt: now,
    };
    db.roles.push(role);
    return role;
  }

  protected pushCustomerRole(
    db: MockDatabase,
    tenantId: string,
    now: string,
  ): Role {
    const role: Role = {
      id: this.id("role"),
      tenantId,
      name: "Cliente",
      isSystem: true,
      permissions: [
        "customer.account.read",
        "customer.account.update",
        "customer.address.manage",
        "customer.payment_method.manage",
        "storefront.orders.read",
      ],
      branchScope: "assigned",
      status: RoleStatus.active,
      createdAt: now,
      updatedAt: now,
    };
    db.roles.push(role);
    return role;
  }

  protected pushUser(
    db: MockDatabase,
    tenantId: string,
    roleId: string,
    branchId: string,
    input: TenantOnboardingInput,
    now: string,
  ): User {
    const user: User = {
      id: this.id("user"),
      tenantId,
      name: input.adminName,
      email: input.adminEmail,
      type: UserType.employee,
      status: UserStatus.active,
      roleId,
      branchId,
      allowedBranchIds: [branchId],
      createdAt: now,
      updatedAt: now,
    };
    db.users.push(user);
    return user;
  }

  // Misma forma de cuenta que `MockAuthRepository.bootstrapEmployeeAccount` -- ver el docstring
  // de esa clase para por qué esta transacción no puede llamarla en vez de reproducirla acá.
  protected pushAuthAccount(
    db: MockDatabase,
    user: User,
    passwordMock: string,
    now: string,
  ): AuthAccount {
    const authAccount: AuthAccount = {
      id: this.id("auth"),
      userId: user.id,
      email: user.email,
      passwordHashMock: buildPasswordHashMock(passwordMock),
      status: AccountStatus.active,
      failedLoginAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    db.authAccounts.push(authAccount);
    return authAccount;
  }

  // Defaults técnicos mínimos -- nunca copiados de tenant-demo (auditoría §18) y sin ningún
  // entitlement/capability comercial (eso es SaasCapabilityKey vía Plan, no esto).
  protected pushBusinessCapabilities(
    db: MockDatabase,
    tenantId: string,
    preset?: BusinessPreset,
  ): BusinessCapabilitiesConfig {
    const capabilities: BusinessCapabilitiesConfig = !preset ? {
      tenantId,
      preset: BusinessPreset.custom,
      supportsInventory: true,
      supportsLots: true,
      supportsExpiration: true,
      supportsSerials: true,
      supportsMultipleLocations: false,
      supportsUnitsAndPackaging: true,
      supportsProductAttributes: false,
      supportsKits: false,
      supportsServices: false,
      defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
    } : preset === BusinessPreset.custom ? {
      tenantId,
      preset: BusinessPreset.custom,
      supportsInventory: true,
      supportsLots: false,
      supportsExpiration: false,
      supportsSerials: false,
      supportsMultipleLocations: false,
      supportsUnitsAndPackaging: false,
      supportsProductAttributes: false,
      supportsKits: false,
      supportsServices: false,
      defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
    } : { ...businessDefaultsConfig[preset], tenantId };
    db.businessCapabilities.push(capabilities);
    return capabilities;
  }

  // enabled=false por default explícito de la auditoría (§4) -- ningún /contratar en este PR.
  protected pushEcommerceConfig(db: MockDatabase, tenant: Tenant, now: string): EcommerceConfig {
    const ecommerceConfig: EcommerceConfig = {
      tenantId: tenant.id,
      enabled: false,
      storeName: tenant.name,
      requireAccountForCheckout: true,
      guestTrackingEnabled: false,
      allowedDeliveryMethods: [],
      allowedPaymentMethods: [],
      createdAt: now,
      updatedAt: now,
    };
    db.ecommerceConfigs.push(ecommerceConfig);
    return ecommerceConfig;
  }

  // Arranca neutro (sin copy de ningun rubro) -- el dueño configura sus propios textos/imagenes
  // desde Diseño E-commerce antes de habilitar la tienda.
  protected pushHeroBanner(db: MockDatabase, tenantId: string, now: string): HeroBannerConfig {
    const heroBanner: HeroBannerConfig = {
      tenantId,
      slides: [
        { title: "", description: "" },
        { title: "", description: "" },
        { title: "", description: "" },
      ],
      updatedAt: now,
    };
    db.heroBanners.push(heroBanner);
    return heroBanner;
  }

  // Sólo crea/asocia -- nunca aplica capabilities/limits (eso queda para el enforcement futuro
  // que este PR explícitamente NO implementa, auditoría §14).
  protected pushSubscription(
    db: MockDatabase,
    tenantId: string,
    planId: string,
    now: string,
  ): TenantSubscription {
    const subscription: TenantSubscription = {
      id: this.id("tenant-subscription"),
      tenantId,
      planId,
      status: TenantSubscriptionStatus.active,
      addonCodes: [],
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    db.tenantSubscriptions.push(subscription);
    return subscription;
  }
}
