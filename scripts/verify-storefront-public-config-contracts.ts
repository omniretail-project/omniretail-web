import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import { existsSync, readFileSync } from "node:fs";
import type { Session } from "@/core/entities";
import {
  AccountStatus,
  BranchStatus,
  BranchType,
  CustomerStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockAuditLogRepository } from "@/infrastructure/mock/repositories/MockAuditLogRepository";
import { MockAuthRepository } from "@/infrastructure/mock/repositories/MockAuthRepository";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockCustomerRepository } from "@/infrastructure/mock/repositories/MockCustomerRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import { buildPasswordHashMock } from "@/infrastructure/mock/shared/passwordHashMock";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";
import type { EcommerceConfigInputDto } from "@/modules/administration/application/dto/EcommerceConfigDto";
import { GetEcommerceConfigService } from "@/modules/administration/application/services/GetEcommerceConfigService";
import { SaveEcommerceConfigService } from "@/modules/administration/application/services/SaveEcommerceConfigService";
import { canUserEnterPrivateRoute, resolvePostLoginDestination } from "@/modules/auth/application/services/postLoginNavigation";
import { resolveCustomerAuthorizationContext } from "@/modules/customer/application/services/CustomerAuthorizationContext";
import { getCurrentCustomerOrders } from "@/modules/customer/application/services/orderService";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";
import { GetPublicStorefrontConfigService } from "@/modules/storefront/application/services/GetPublicStorefrontConfigService";
import { GetStorefrontOrderTrackingService } from "@/modules/storefront/application/services/GetStorefrontOrderTrackingService";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";
import { shouldRefreshPublicConfig } from "@/modules/storefront/application/services/publicConfigReactivity";

const tenantId = "tenant-demo";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

function editableConfig(
  config: Awaited<ReturnType<MockBusinessConfigRepository["getEcommerceConfig"]>>,
  overrides: Partial<EcommerceConfigInputDto> = {},
): EcommerceConfigInputDto {
  assert.ok(config);
  return {
    enabled: config.enabled,
    storeName: config.storeName,
    contactPhone: config.contactPhone,
    contactEmail: config.contactEmail,
    requireAccountForCheckout: config.requireAccountForCheckout,
    guestTrackingEnabled: config.guestTrackingEnabled,
    allowedDeliveryMethods: [...config.allowedDeliveryMethods],
    allowedPaymentMethods: [...config.allowedPaymentMethods],
    defaultBranchId: config.defaultBranchId,
    ...overrides,
  };
}

async function expectDenied(action: () => Promise<unknown>, message: string) {
  await assert.rejects(action, /permiso|rol/i, message);
}

async function main() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const branches = new MockBranchRepository(store, eventBus);
  const businessConfig = new MockBusinessConfigRepository(store, eventBus);
  const tenants = new MockTenantRepository(store, eventBus);
  const users = new MockUserRepository(store, eventBus);
  const roles = new MockRoleRepository(store, eventBus);
  const customers = new MockCustomerRepository(store, eventBus);
  const orders = new MockOrderRepository(store, eventBus);
  const auditLogs = new MockAuditLogRepository(store, eventBus);
  const plans = new MockPlanRepository(store, eventBus);
  const tenantSubscriptions = new MockTenantSubscriptionRepository(store, eventBus);
  let currentUserId: string | null = "user-admin";
  const session: Session = {
    id: "session-public-config-verification",
    userId: "user-admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    rememberMe: false,
  };
  const auth = {
    getCurrentSessionId: async () => (currentUserId ? session.id : null),
    getSession: async (sessionId: string) =>
      sessionId === session.id && currentUserId ? { ...session, userId: currentUserId } : null,
  };
  const repositories = {
    auth,
    auditLogs,
    branches,
    businessConfig,
    customers,
    orders,
    plans,
    roles,
    tenants,
    tenantSubscriptions,
    users,
  } as unknown as RepositoryRegistry;
  const adminGet = new GetEcommerceConfigService(repositories);
  const adminSave = new SaveEcommerceConfigService(repositories);
  const publicConfig = new GetPublicStorefrontConfigService(repositories);
  const publicContext = new ResolvePublicStorefrontContextService(repositories);

  store.transact((db) => {
    const timestamp = "2026-01-02T00:00:00.000Z";
    db.branches.push(
      {
        id: "branch-warehouse-public-test",
        tenantId,
        code: "WAREHOUSE-TEST",
        name: "Bodega no publica",
        type: BranchType.warehouse,
        status: BranchStatus.active,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "branch-inactive-public-test",
        tenantId,
        code: "INACTIVE-TEST",
        name: "Tienda inactiva",
        type: BranchType.store,
        status: BranchStatus.inactive,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "branch-cross-tenant-public-test",
        tenantId: "tenant-other",
        code: "CROSS-TEST",
        name: "Tienda ajena",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    );
  });

  const initialConfig = await businessConfig.getEcommerceConfig(tenantId);
  assert.ok(initialConfig);
  const originalDefaultBranchId = initialConfig.defaultBranchId;
  const saved = await adminSave.execute(
    editableConfig(initialConfig, {
      storeName: "  Mi Tienda Publica  ",
      contactPhone: "  +502 2345-6789  ",
      contactEmail: "  CONTACTO@EJEMPLO.COM  ",
    }),
  );
  assert.equal(saved.storeName, "Mi Tienda Publica", "A: admin debe normalizar storeName");
  assert.equal(saved.contactEmail, "contacto@ejemplo.com", "B: email debe normalizarse");
  assert.equal((await adminGet.execute()).storeName, saved.storeName);

  const publicDto = await publicConfig.execute(publicStorefrontSlug);
  assert.equal(publicDto.storeName, "Mi Tienda Publica", "A: Storefront debe leer storeName admin");
  assert.equal(publicDto.contactPhone, "+502 2345-6789", "B: debe publicar telefono configurado");
  assert.equal(publicDto.contactEmail, "contacto@ejemplo.com", "B: debe publicar email configurado");
  assert.deepEqual(
    Object.keys(publicDto).sort(),
    [
      "accountRequired",
      "branches",
      "contactEmail",
      "contactPhone",
      "guestTrackingEnabled",
      "heroBanner",
      "logoImageSource",
      "storeEnabled",
      "storeName",
    ].sort(),
    "C: el DTO publico debe ser minimo",
  );
  assert.deepEqual(
    Object.keys(publicDto.branches[0] ?? {}).sort(),
    ["address", "id", "name"].sort(),
    "C: las branches publicas no deben filtrar campos internos",
  );
  assert.deepEqual(
    publicDto.branches.map((branch) => branch.id),
    ["branch-norte"],
    "D-H: solo debe aparecer la tienda activa del tenant publico",
  );
  assert.equal(GetPublicStorefrontConfigService.prototype.execute.length, 1, "I: execute recibe tenantSlug");

  currentUserId = "user-inventory";
  await expectDenied(() => adminSave.execute(editableConfig(initialConfig)), "J: usuario sin permiso");
  currentUserId = "user-admin";
  store.transact((db) => {
    const role = db.roles.find((item) => item.id === "role-admin");
    assert.ok(role);
    role.tenantId = "tenant-other";
  });
  await expectDenied(() => adminSave.execute(editableConfig(initialConfig)), "K: rol cross-tenant");
  store.transact((db) => {
    const role = db.roles.find((item) => item.id === "role-admin");
    assert.ok(role);
    role.tenantId = tenantId;
  });

  const allowlistPayload = {
    ...editableConfig(await businessConfig.getEcommerceConfig(tenantId)),
    storeName: "Allowlist comprobada",
    tenantId: "tenant-other",
    createdAt: "1900-01-01T00:00:00.000Z",
  } as EcommerceConfigInputDto;
  await adminSave.execute(allowlistPayload);
  const allowlisted = await businessConfig.getEcommerceConfig(tenantId);
  assert.ok(allowlisted);
  assert.equal(allowlisted.tenantId, tenantId, "L: tenantId no debe ser editable");
  assert.notEqual(allowlisted.createdAt, "1900-01-01T00:00:00.000Z", "L: createdAt no debe cambiar");

  await businessConfig.updateEcommerceConfig(
    tenantId,
    editableConfig(allowlisted, { enabled: false }),
  );
  assert.equal((await publicConfig.execute(publicStorefrontSlug)).storeEnabled, false, "M: DTO refleja tienda deshabilitada");
  await assert.rejects(() => publicContext.execute({ tenantSlug: publicStorefrontSlug }), /no est.* disponible/i, "M: boundary bloquea tienda");

  const disabledConfig = await businessConfig.getEcommerceConfig(tenantId);
  await businessConfig.updateEcommerceConfig(
    tenantId,
    editableConfig(disabledConfig, { enabled: true, requireAccountForCheckout: true }),
  );
  currentUserId = null;
  const checkout = new CreateStorefrontCheckoutService(repositories);
  await assert.rejects(
    () =>
      checkout.execute({
        tenantSlug: publicStorefrontSlug,
        items: [],
        idempotencyKey: "account-required-check",
        form: {
          fullName: "Invitado",
          email: "guest@example.com",
          phone: "55550000",
          addressLine1: "Zona 1",
          city: "Guatemala",
          cardholderName: "Invitado",
          cardLastFour: "4242",
        },
      }),
    /iniciar sesi.*cuenta/i,
    "N: checkout service mantiene accountRequired como autoridad",
  );

  const tracking = new GetStorefrontOrderTrackingService(repositories);
  const accountRequiredConfig = await businessConfig.getEcommerceConfig(tenantId);
  await businessConfig.updateEcommerceConfig(
    tenantId,
    editableConfig(accountRequiredConfig, { guestTrackingEnabled: false }),
  );
  assert.equal(await tracking.execute({ tenantSlug: publicStorefrontSlug, trackingToken: "TRACK-WEB-002" }), null, "O: tracking invitado bloqueado");
  const trackingDisabledConfig = await businessConfig.getEcommerceConfig(tenantId);
  await businessConfig.updateEcommerceConfig(
    tenantId,
    editableConfig(trackingDisabledConfig, { guestTrackingEnabled: true }),
  );
  assert.ok(await tracking.execute({ tenantSlug: publicStorefrontSlug, trackingToken: "TRACK-WEB-002" }), "O: tracking invitado habilitado");

  let configRefreshes = 0;
  let branchRefreshes = 0;
  const pendingRefreshes: Promise<unknown>[] = [];
  const refresh = (kind: "config" | "branch", eventTenantId?: string) => {
    if (!shouldRefreshPublicConfig(eventTenantId, tenantId)) return;
    if (kind === "config") configRefreshes += 1;
    else branchRefreshes += 1;
    pendingRefreshes.push(publicConfig.execute(publicStorefrontSlug));
  };
  const unsubscribeConfig = eventBus.subscribe("business-config.changed", (event) =>
    refresh("config", event.tenantId),
  );
  const unsubscribeBranch = eventBus.subscribe("branch.changed", (event) =>
    refresh("branch", event.tenantId),
  );
  const reactivityConfig = await businessConfig.getEcommerceConfig(tenantId);
  await businessConfig.updateEcommerceConfig(
    tenantId,
    editableConfig(reactivityConfig, { storeName: "Nombre reactivo" }),
  );
  await branches.create({
    tenantId,
    code: "SOUTH-TEST",
    name: "Sucursal Sur",
    type: BranchType.store,
    address: "Zona 12, Guatemala",
    status: BranchStatus.active,
  });
  await branches.create({
    tenantId: "tenant-other",
    code: "OTHER-EVENT",
    name: "Otra sucursal ajena",
    type: BranchType.store,
    status: BranchStatus.active,
  });
  eventBus.emit("branch.changed", { action: "reset" });
  await Promise.all(pendingRefreshes);
  unsubscribeConfig();
  unsubscribeBranch();
  assert.equal(configRefreshes, 1, "P: config del tenant debe refrescar");
  assert.equal(branchRefreshes, 2, "Q: branch propia y reset deben refrescar; otra tenant no");

  const legacySnapshot = store.getSnapshot();
  for (const config of legacySnapshot.ecommerceConfigs) {
    delete config.contactPhone;
    delete config.contactEmail;
  }
  const legacyStorage = new MemoryStorageAdapter();
  legacyStorage.set(MOCK_DATABASE_STORAGE_KEY, legacySnapshot);
  const legacyStore = new MockDatabaseStore(legacyStorage);
  const legacyConfig = legacyStore.getSnapshot().ecommerceConfigs[0];
  assert.equal(legacyConfig.contactPhone, undefined, "R: legacy sin telefono debe cargar");
  assert.equal(legacyConfig.contactEmail, undefined, "R: legacy sin email debe cargar");

  const routeConfig = await businessConfig.getEcommerceConfig(tenantId);
  await businessConfig.updateEcommerceConfig(
    tenantId,
    editableConfig(routeConfig, { enabled: false, requireAccountForCheckout: false }),
  );
  const disabledPublicContext = await publicContext.execute({ tenantSlug: publicStorefrontSlug, allowDisabled: true });
  assert.equal(disabledPublicContext.tenantId, tenantId, "T: tenant sigue resolviendose");
  assert.equal(disabledPublicContext.ecommerceConfig.enabled, false, "T: canal queda deshabilitado");

  const publicLayout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  const dynamicTenantLayout = readFileSync("src/app/tienda/[tenantSlug]/layout.tsx", "utf8");
  const commercialLayout = readFileSync(
    "src/app/(public)/(commercial)/layout.tsx",
    "utf8",
  );
  const publicShell = readFileSync(
    "src/modules/storefront/components/PublicStorefrontShell.tsx",
    "utf8",
  );
  const publicTenantProvider = readFileSync(
    "src/modules/storefront/providers/PublicTenantProvider.tsx",
    "utf8",
  );
  assert.equal(
    existsSync("src/app/(public)/(accessible)/layout.tsx"),
    false,
    "T-U: rutas accesibles heredan el shell comun sin otro owner",
  );
  assert.match(publicLayout, /<PublicStorefrontShell>/, "T-U: layout publico posee el shell comun");
  assert.match(commercialLayout, /<CommercialStorefrontGate>/, "W: rutas comerciales usan el gate");
  assert.doesNotMatch(
    commercialLayout,
    /PublicStorefrontShell/,
    "Y: layout comercial no debe montar otro shell",
  );
  assert.equal(
    publicShell.match(/<StorefrontHeader\s*\/>/g)?.length,
    1,
    "Y: existe un unico owner del Header",
  );
  assert.equal(
    publicShell.match(/<StorefrontFooter\s*\/>/g)?.length,
    1,
    "Y: existe un unico owner del Footer",
  );
  assert.match(
    publicLayout,
    /<PublicTenantProvider tenantSlug=\{publicStorefrontSlug\}>/,
    "Y: legacy usa explícitamente el slug demo",
  );
  assert.match(
    dynamicTenantLayout,
    /<PublicTenantProvider tenantSlug=\{tenantSlug\}>/,
    "Y: layout dinámico usa el slug de params",
  );
  assert.doesNotMatch(
    dynamicTenantLayout,
    /publicStorefrontSlug/,
    "Y: layout dinámico no usa fallback demo",
  );
  assert.match(
    publicTenantProvider,
    /setTenantId\(context\.tenantId\)/,
    "T-U: provider conserva tenant cuando ecommerce esta deshabilitado",
  );

  store.transact((db) => {
    const timestamp = "2026-01-03T00:00:00.000Z";
    db.customers.push({
      id: "customer-fernando-qa",
      tenantId,
      userId: "user-fernando-qa",
      code: "CLI-QA",
      name: "Fernando QA",
      email: "fernando1999@gmail.com",
      status: CustomerStatus.active,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.users.push({
      id: "user-fernando-qa",
      tenantId,
      customerId: "customer-fernando-qa",
      name: "Fernando QA",
      email: "fernando1999@gmail.com",
      type: UserType.customer,
      status: UserStatus.active,
      roleId: "role-customer",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.authAccounts.push({
      id: "auth-fernando-qa",
      userId: "user-fernando-qa",
      email: "fernando1999@gmail.com",
      passwordHashMock: buildPasswordHashMock("Fernando1999."),
      status: AccountStatus.active,
      failedLoginAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  const realAuth = new MockAuthRepository(store, eventBus, storage);
  const authenticatedRepositories = {
    ...repositories,
    auth: realAuth,
  } as RepositoryRegistry;
  const adminLogin = await realAuth.login({
    email: "admin@ferrepharma.demo",
    passwordMock: "AdminDemo123",
    expectedUserType: UserType.employee,
  });
  assert.equal(adminLogin.status, "authenticated", "V: admin no tiene MFA habilitado en este seed");
  const adminSession = adminLogin as Extract<typeof adminLogin, { status: "authenticated" }>;
  const adminUser = await users.getById(adminSession.session.userId);
  assert.ok(adminUser, "V: admin debe autenticarse con ecommerce deshabilitado");
  assert.equal(resolvePostLoginDestination(adminUser), "/inicio", "V: admin conserva /inicio");
  assert.equal(canUserEnterPrivateRoute(adminUser, "/administracion/diseno-ecommerce"), true);
  assert.ok(
    (await roles.getByIdScoped(adminUser.tenantId, adminUser.roleId ?? ""))?.permissions.includes(
      "admin.ecommerce_config.manage",
    ),
    "V: admin conserva capacidad de administracion",
  );

  const customerLogin = await realAuth.login({
    tenantId,
    email: "fernando1999@gmail.com",
    passwordMock: "Fernando1999.",
    expectedUserType: UserType.customer,
  });
  assert.equal(customerLogin.status, "authenticated", "U: customer no tiene MFA habilitado en este seed");
  const customerSession = customerLogin as Extract<typeof customerLogin, { status: "authenticated" }>;
  const customerUser = await users.getById(customerSession.session.userId);
  assert.ok(customerUser, "U: customer debe autenticarse con ecommerce deshabilitado");
  assert.equal(canUserEnterPrivateRoute(customerUser, "/cuenta/perfil"), true, "U: /cuenta sigue habilitada");
  assert.equal((await resolveCustomerAuthorizationContext(authenticatedRepositories)).tenantId, tenantId);
  assert.ok(Array.isArray(await getCurrentCustomerOrders(authenticatedRepositories)), "U: pedidos existentes legibles");

  const disabledCheckout = new CreateStorefrontCheckoutService(authenticatedRepositories);
  await assert.rejects(
    () =>
      disabledCheckout.execute({
        tenantSlug: publicStorefrontSlug,
        items: [],
        idempotencyKey: "disabled-commercial-check",
        form: {
          fullName: "Fernando QA",
          email: "fernando1999@gmail.com",
          phone: "55550000",
          addressLine1: "Zona 1",
          city: "Guatemala",
          cardholderName: "Fernando QA",
          cardLastFour: "4242",
        },
      }),
    /no est.* disponible/i,
    "W: checkout permanece bloqueado con ecommerce deshabilitado",
  );

  await realAuth.login({
    email: "admin@ferrepharma.demo",
    passwordMock: "AdminDemo123",
    expectedUserType: UserType.employee,
  });
  const disabledConfigForAdmin = await businessConfig.getEcommerceConfig(tenantId);
  await new SaveEcommerceConfigService(authenticatedRepositories).execute(
    editableConfig(disabledConfigForAdmin, { enabled: true }),
  );
  assert.equal((await businessConfig.getEcommerceConfig(tenantId))?.enabled, true, "X: admin rehabilita ecommerce");

  const finalConfig = await businessConfig.getEcommerceConfig(tenantId);
  assert.equal(finalConfig?.defaultBranchId, originalDefaultBranchId, "S: defaultBranchId no cambia");
  assert.equal(originalDefaultBranchId, "branch-centro", "S: fulfillment conserva branch main");
  assert.equal((await branches.getById("branch-centro"))?.type, BranchType.main, "S: main se conserva");

  console.log("Storefront public config contract harness: PASS (A-Y)");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
