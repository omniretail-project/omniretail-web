import assert from "node:assert/strict";
import type { Session } from "@/core/entities";
import { CustomerStatus, RoleStatus, UserStatus, UserType } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockCustomerRepository } from "@/infrastructure/mock/repositories/MockCustomerRepository";
import { MockAuthRepository } from "@/infrastructure/mock/repositories/MockAuthRepository";
import { MockOrderPaymentConfirmationRepository } from "@/infrastructure/mock/repositories/MockOrderPaymentConfirmationRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPaymentRepository } from "@/infrastructure/mock/repositories/MockPaymentRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockPromotionRepository } from "@/infrastructure/mock/repositories/MockPromotionRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockProductSalesPriceTierRepository } from "@/infrastructure/mock/repositories/MockProductSalesPriceTierRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import { MockUnitRepository } from "@/infrastructure/mock/repositories/MockUnitRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import {
  canUserEnterPrivateRoute,
  resolvePostLoginDestination,
} from "@/modules/auth/application/services/postLoginNavigation";
import {
  resolveCurrentSessionSnapshot,
  type CurrentSessionSnapshot,
} from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import {
  CustomerIdentityError,
  resolveOptionalCustomerAuthorizationContext,
} from "@/modules/customer/application/services/CustomerAuthorizationContext";
import { getCurrentCustomerProfile } from "@/modules/customer/application/services/getCurrentCustomerProfile";
import {
  getCurrentCustomerOrderDetail,
  getCurrentCustomerOrders,
} from "@/modules/customer/application/services/orderService";
import type { StorefrontCheckoutFormDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";
import { getStorefrontAccountNavigation } from "@/modules/storefront/application/services/storefrontAccountNavigation";
import { publicStorefrontSlug } from "@/config/publicStorefront";

const tenantId = "tenant-demo";
const customerAId = "customer-ana";
const customerAUserId = "user-customer";
const customerBId = "customer-bea";
const customerBUserId = "user-customer-bea";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const rawValue = this.values.get(key);
    return rawValue === undefined ? null : (JSON.parse(rawValue) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

const checkoutForm: StorefrontCheckoutFormDto = {
  fullName: "Cliente Checkout",
  email: "checkout@example.com",
  phone: "55550000",
  addressLine1: "Zona 1",
  city: "Guatemala",
  cardholderName: "Cliente Checkout",
  cardLastFour: "4242",
};

function createHarness() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  store.transact((db) => {
    db.orders = [];
    db.payments = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
    });
    const balance = db.inventoryBalances.find((item) => item.id === "bal-screws");
    assert.ok(balance);
    balance.quantity = 50;

    db.customers.push({
      id: customerBId,
      tenantId,
      userId: customerBUserId,
      code: "CLI-002",
      name: "Bea Cliente",
      email: "bea@example.com",
      status: CustomerStatus.active,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    db.users.push({
      id: customerBUserId,
      tenantId,
      customerId: customerBId,
      name: "Bea Cliente",
      email: "bea@example.com",
      type: UserType.customer,
      status: UserStatus.active,
      roleId: "role-customer",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    db.roles.push({
      id: "role-other-customer",
      tenantId: "tenant-other",
      name: "Cliente otro tenant",
      isSystem: true,
      permissions: ["customer.account.read", "storefront.orders.read"],
      branchScope: "assigned",
      status: RoleStatus.active,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    db.customers.push({
      id: "customer-other",
      tenantId: "tenant-other",
      userId: "user-customer-other",
      code: "CLI-OTHER",
      name: "Cliente otro tenant",
      email: "other@example.com",
      status: CustomerStatus.active,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    db.users.push({
      id: "user-customer-other",
      tenantId: "tenant-other",
      customerId: "customer-other",
      name: "Cliente otro tenant",
      email: "other@example.com",
      type: UserType.customer,
      status: UserStatus.active,
      roleId: "role-other-customer",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  let currentUserId: string | null = null;
  const session: Session = {
    id: "session-verification",
    userId: customerAUserId,
    createdAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    rememberMe: false,
  };
  const auth = {
    getCurrentSessionId: async () => (currentUserId ? session.id : null),
    getSession: async (sessionId: string) =>
      sessionId === session.id && currentUserId ? { ...session, userId: currentUserId } : null,
  };
  const eventBus = new DataEventBus();
  const repositories = {
    auth,
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    orderPaymentConfirmations: new MockOrderPaymentConfirmationRepository(store, eventBus),
    orders: new MockOrderRepository(store, eventBus),
    payments: new MockPaymentRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    promotions: new MockPromotionRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return {
    store,
    repositories,
    checkout: new CreateStorefrontCheckoutService(repositories),
    setCurrentUser(userId: string | null) {
      currentUserId = userId;
    },
  };
}

function createSessionReactivityHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const auth = new MockAuthRepository(store, eventBus, storage);
  const users = new MockUserRepository(store, eventBus);
  const roles = new MockRoleRepository(store, eventBus);
  const tenants = new MockTenantRepository(store, eventBus);
  const customers = new MockCustomerRepository(store, eventBus);
  const repositories = {
    auth,
    users,
    roles,
    tenants,
    customers,
  } as unknown as RepositoryRegistry;

  let snapshot: CurrentSessionSnapshot = { user: null, role: null, sessionId: null };
  let reloadVersion = 0;
  let pendingReload: Promise<void> = Promise.resolve();
  let pointerChecks: Promise<void>[] = [];

  const reload = () => {
    const version = ++reloadVersion;
    pendingReload = resolveCurrentSessionSnapshot(repositories).then((resolved) => {
      if (version === reloadVersion) snapshot = resolved;
    });
    return pendingReload;
  };

  eventBus.subscribe("auth.changed", (payload) => {
    if (payload.action === "created") {
      pointerChecks.push(
        auth.getCurrentSessionId().then((currentSessionId) => {
          assert.equal(
            currentSessionId,
            payload.entityId,
            "auth.changed debe publicarse despues de persistir la nueva sesion",
          );
        }),
      );
    }
    void reload();
  });
  eventBus.subscribe("user.changed", () => {
    void reload();
  });

  return {
    auth,
    repositories,
    users,
    reload,
    getSnapshot: () => snapshot,
    async settle() {
      const checks = pointerChecks;
      pointerChecks = [];
      await Promise.all([pendingReload, ...checks]);
    },
  };
}

async function logoutCurrent(harness: ReturnType<typeof createSessionReactivityHarness>) {
  const sessionId = await harness.auth.getCurrentSessionId();
  assert.ok(sessionId);
  await harness.auth.logout(sessionId);
  await harness.settle();
}

async function loginCustomer(harness: ReturnType<typeof createSessionReactivityHarness>) {
  await harness.auth.login({
    tenantId,
    email: "ana@example.com",
    passwordMock: "ClienteDemo1",
  });
  await harness.settle();
}

async function loginAdmin(harness: ReturnType<typeof createSessionReactivityHarness>) {
  await harness.auth.login({
    tenantId,
    email: "admin@ferrepharma.demo",
    passwordMock: "AdminDemo123",
  });
  await harness.settle();
}

async function verifySessionReactivityAndProfile() {
  const harness = createSessionReactivityHarness();
  await harness.reload();
  assert.equal(harness.getSnapshot().user, null);

  // Guest -> Customer: el evento debe reconstruir inmediatamente la
  // identidad que consume StorefrontHeader y la ruta de perfil.
  await loginCustomer(harness);
  let snapshot = harness.getSnapshot();
  assert.equal(snapshot.user?.id, customerAUserId);
  assert.equal(snapshot.user?.type, UserType.customer);
  assert.equal(snapshot.role?.id, "role-customer");
  assert.equal(snapshot.role?.permissions.includes("customer.account.read"), true);
  assert.deepEqual(getStorefrontAccountNavigation(snapshot.user, false), {
    href: "/cuenta/perfil",
    label: "Mi Cuenta",
  });
  assert.equal(canUserEnterPrivateRoute(snapshot.user, "/cuenta/perfil"), true);
  assert.equal((await getCurrentCustomerProfile(harness.repositories)).id, customerAId);

  // Customer -> logout: no puede quedar ninguna identidad derivada.
  await logoutCurrent(harness);
  assert.equal(harness.getSnapshot().user, null);
  assert.deepEqual(getStorefrontAccountNavigation(harness.getSnapshot().user, false), {
    href: "/iniciar-sesion",
    label: "Ingresar",
  });

  // Admin -> logout -> Customer: no conserva User ni Role del Admin.
  await loginAdmin(harness);
  assert.equal(harness.getSnapshot().user?.id, "user-admin");
  await logoutCurrent(harness);
  assert.equal(harness.getSnapshot().user, null);
  await loginCustomer(harness);
  snapshot = harness.getSnapshot();
  assert.equal(snapshot.user?.id, customerAUserId);
  assert.equal(snapshot.role?.id, "role-customer");
  assert.equal(canUserEnterPrivateRoute(snapshot.user, "/inicio"), false);
  assert.equal((await getCurrentCustomerProfile(harness.repositories)).id, customerAId);

  // Customer -> logout -> Admin: no conserva contexto Customer y el
  // destino operacional existente permanece intacto.
  await logoutCurrent(harness);
  await loginAdmin(harness);
  snapshot = harness.getSnapshot();
  assert.equal(snapshot.user?.id, "user-admin");
  assert.equal(snapshot.user?.type, UserType.employee);
  assert.equal(snapshot.role?.id, "role-admin");
  assert.equal(resolvePostLoginDestination(snapshot.user), "/inicio");
  assert.equal(await resolveOptionalCustomerAuthorizationContext(harness.repositories), null);

  // Refresh/remount: una reconstruccion nueva desde el puntero ya
  // persistido debe recuperar la misma identidad Customer.
  await logoutCurrent(harness);
  await loginCustomer(harness);
  const rehydrated = await resolveCurrentSessionSnapshot(harness.repositories);
  assert.equal(rehydrated.user?.id, customerAUserId);
  assert.equal(rehydrated.role?.id, "role-customer");

  // Un cambio de estado del User invalida inmediatamente el snapshot.
  await harness.users.updateStatus(customerAUserId, UserStatus.inactive);
  await harness.settle();
  assert.equal(harness.getSnapshot().user, null);
  await assert.rejects(getCurrentCustomerProfile(harness.repositories), CustomerIdentityError);
}

function cart(quantity = 1) {
  return [
    {
      productId: "prod-screws",
      tenantId,
      sku: "TOR-001",
      name: "Tornillos",
      unitPrice: 24.99,
      quantity,
    },
  ];
}

async function checkout(
  harness: ReturnType<typeof createHarness>,
  key: string,
  form: StorefrontCheckoutFormDto = checkoutForm,
) {
  return harness.checkout.execute({
    tenantSlug: publicStorefrontSlug,
    items: cart(),
    form,
    idempotencyKey: key,
  });
}

async function verifyGuestCheckout() {
  const harness = createHarness();
  await checkout(harness, "guest-checkout");
  const order = harness.store.getSnapshot().orders.at(-1);
  assert.ok(order);
  assert.equal(order.customerId, undefined);
  assert.equal(order.guestCustomer?.email, checkoutForm.email);
}

async function verifyAuthenticatedCheckoutAndIsolation() {
  const harness = createHarness();
  harness.setCurrentUser(customerAUserId);
  const manipulatedForm = {
    ...checkoutForm,
    customerId: customerBId,
    tenantId: "tenant-other",
  } as StorefrontCheckoutFormDto;
  await checkout(harness, "customer-a-checkout", manipulatedForm);
  const customerAOrder = harness.store.getSnapshot().orders.at(-1);
  assert.ok(customerAOrder);
  assert.equal(customerAOrder.customerId, customerAId);
  assert.equal(customerAOrder.guestCustomer, undefined);

  harness.setCurrentUser(customerBUserId);
  await checkout(harness, "customer-b-checkout");
  const customerBOrder = harness.store.getSnapshot().orders.at(-1);
  assert.ok(customerBOrder);
  assert.equal(customerBOrder.customerId, customerBId);

  harness.setCurrentUser(customerAUserId);
  const visibleOrders = await getCurrentCustomerOrders(harness.repositories);
  assert.deepEqual(
    visibleOrders.map((order) => order.id),
    [customerAOrder.id],
  );
  const ownDetail = await getCurrentCustomerOrderDetail(harness.repositories, customerAOrder.id);
  assert.equal(ownDetail?.orderNumber, customerAOrder.orderNumber);
  const foreignDetail = await getCurrentCustomerOrderDetail(harness.repositories, customerBOrder.id);
  assert.equal(foreignDetail, null, "customer A cannot open customer B order by id");
}

async function verifyEmployeeAndCrossTenantIsolation() {
  const harness = createHarness();
  harness.setCurrentUser("user-admin");
  assert.equal(await resolveOptionalCustomerAuthorizationContext(harness.repositories), null);
  await checkout(harness, "employee-as-guest");
  assert.equal(harness.store.getSnapshot().orders.at(-1)?.customerId, undefined);

  harness.setCurrentUser("user-customer-other");
  const otherTenantContext = await resolveOptionalCustomerAuthorizationContext(
    harness.repositories,
  );
  assert.equal(otherTenantContext?.customerId, "customer-other");
  await checkout(harness, "cross-tenant-as-guest");
  const order = harness.store.getSnapshot().orders.at(-1);
  assert.equal(order?.customerId, undefined);
  assert.equal(order?.guestCustomer?.email, checkoutForm.email);
}

async function verifyInactiveCustomerDenied() {
  const inactiveUserHarness = createHarness();
  inactiveUserHarness.setCurrentUser(customerAUserId);
  inactiveUserHarness.store.transact((db) => {
    const user = db.users.find((item) => item.id === customerAUserId);
    assert.ok(user);
    user.status = UserStatus.inactive;
  });
  await assert.rejects(checkout(inactiveUserHarness, "inactive-user"), CustomerIdentityError);
  assert.equal(inactiveUserHarness.store.getSnapshot().orders.length, 0);

  const inactiveCustomerHarness = createHarness();
  inactiveCustomerHarness.setCurrentUser(customerAUserId);
  inactiveCustomerHarness.store.transact((db) => {
    const customer = db.customers.find((item) => item.id === customerAId);
    assert.ok(customer);
    customer.status = CustomerStatus.inactive;
  });
  await assert.rejects(
    checkout(inactiveCustomerHarness, "inactive-customer"),
    CustomerIdentityError,
  );
  assert.equal(inactiveCustomerHarness.store.getSnapshot().orders.length, 0);
}

function verifyPostLoginNavigation() {
  const harness = createHarness();
  const snapshot = harness.store.getSnapshot();
  const customer = snapshot.users.find((user) => user.id === customerAUserId);
  const employee = snapshot.users.find((user) => user.id === "user-admin");
  assert.ok(customer);
  assert.ok(employee);

  assert.deepEqual(getStorefrontAccountNavigation(null, false), {
    href: "/iniciar-sesion",
    label: "Ingresar",
  });
  assert.deepEqual(getStorefrontAccountNavigation(customer, false), {
    href: "/cuenta/perfil",
    label: "Mi Cuenta",
  });
  assert.deepEqual(getStorefrontAccountNavigation(employee, false), {
    href: "/inicio",
    label: "Ir a inicio",
  });

  assert.equal(resolvePostLoginDestination(customer), "/");
  assert.equal(resolvePostLoginDestination(employee), "/inicio");
  assert.equal(resolvePostLoginDestination(customer, "/cuenta"), "/cuenta");
  assert.equal(resolvePostLoginDestination(customer, "/cuenta/pedidos"), "/cuenta/pedidos");
  assert.equal(resolvePostLoginDestination(customer, "/catalogo?oferta=1"), "/catalogo?oferta=1");

  [
    "/inicio",
    "/administracion/dashboard",
    "/inventario/alertas",
    "/pos/terminal",
    "//evil.example",
    "javascript:alert(1)",
  ].forEach((unsafeReturnUrl) => {
    assert.equal(resolvePostLoginDestination(customer, unsafeReturnUrl), "/");
  });

  assert.equal(canUserEnterPrivateRoute(customer, "/cuenta"), true);
  assert.equal(canUserEnterPrivateRoute(customer, "/cuenta/perfil"), true);
  assert.equal(canUserEnterPrivateRoute(customer, "/inicio"), false);
  assert.equal(canUserEnterPrivateRoute(customer, "/administracion/dashboard"), false);
  assert.equal(canUserEnterPrivateRoute(customer, "/inventario/alertas"), false);
  assert.equal(canUserEnterPrivateRoute(customer, "/pos/terminal"), false);
  assert.equal(canUserEnterPrivateRoute(employee, "/inicio"), true);
}

async function verifyRegistrationProvisioning() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const auth = new MockAuthRepository(store, eventBus, storage);

  const registerResult = await auth.registerCustomer({
    tenantSlug: publicStorefrontSlug,
    name: "Nuevo Cliente",
    email: "nuevo@example.com",
    phone: "12345678",
    passwordMock: "NuevoCliente123!",
  });

  assert.equal(registerResult.user.type, UserType.customer);
  assert.ok(registerResult.user.customerId);
  assert.ok(registerResult.user.roleId);
  assert.equal(registerResult.user.roleId, "role-customer");
}

async function main() {
  verifyPostLoginNavigation();
  await verifySessionReactivityAndProfile();
  await verifyGuestCheckout();
  await verifyAuthenticatedCheckoutAndIsolation();
  await verifyEmployeeAndCrossTenantIsolation();
  await verifyInactiveCustomerDenied();
  await verifyRegistrationProvisioning();
  console.log("customer storefront integration verification: PASS");
}

void main();
