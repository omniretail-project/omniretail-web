import assert from "node:assert/strict";
import { permissionsConfig } from "@/config/permissions";
import {
  DeliveryMethod,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PickingStatus,
  ProductType,
  TransportMode,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockCustomerRepository } from "@/infrastructure/mock/repositories/MockCustomerRepository";
import {
  MockOrderPaymentConfirmationRepository,
  type MockOrderPaymentConfirmationRepositoryTestHooks,
} from "@/infrastructure/mock/repositories/MockOrderPaymentConfirmationRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockProductSalesPriceTierRepository } from "@/infrastructure/mock/repositories/MockProductSalesPriceTierRepository";
import { MockPromotionRepository } from "@/infrastructure/mock/repositories/MockPromotionRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockSaleConfirmationRepository } from "@/infrastructure/mock/repositories/MockSaleConfirmationRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUnitRepository } from "@/infrastructure/mock/repositories/MockUnitRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";
import type { StorefrontCheckoutFormDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const productId = "prod-screws";

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

const checkoutForm: StorefrontCheckoutFormDto = {
  fullName: "Cliente Ecommerce",
  email: "ecommerce@example.com",
  phone: "55550000",
  addressLine1: "Zona 1",
  city: "Guatemala",
  cardholderName: "Cliente Ecommerce",
  cardLastFour: "4242",
};

function createHarness(testHooks: MockOrderPaymentConfirmationRepositoryTestHooks = {}) {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  store.transact((db) => {
    db.orders = [];
    db.payments = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryMovements = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
    });
    const product = db.products.find((item) => item.id === productId);
    const balance = db.inventoryBalances.find((item) => item.id === "bal-screws");
    assert.ok(product && balance);
    product.baseUnitId = "unit-unit";
    product.inventoryUnitId = "unit-unit";
    product.saleUnitId = "unit-box";
    balance.quantity = 100;
    db.products.push({
      ...product,
      id: "prod-install",
      sku: "SERV-INST-001",
      name: "Servicio de instalacion",
      productType: ProductType.service,
      saleUnitId: "unit-unit",
      salePrice: 250,
      tracking: { stock: false, lot: false, expiration: false, serial: false },
    });
    db.unitConversions = db.unitConversions.filter((item) => item.productId !== productId);
    db.unitConversions.push({
      id: "storefront-picking-box-conversion",
      tenantId,
      productId,
      fromUnitId: "unit-box",
      toUnitId: "unit-unit",
      factor: 5,
      createdAt: "2026-09-15T00:00:00.000Z",
    });
  });

  let authenticated = true;
  const eventBus = new DataEventBus();
  const auth = {
    getCurrentSessionId: async () => (authenticated ? "storefront-picking-session" : null),
    getSession: async (sessionId: string) =>
      authenticated && sessionId === "storefront-picking-session"
        ? {
            id: sessionId,
            userId: "user-customer",
            createdAt: "2026-09-15T00:00:00.000Z",
            expiresAt: "2099-01-01T00:00:00.000Z",
            rememberMe: false,
          }
        : null,
  };
  const repositories = {
    auth,
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    orderPaymentConfirmations: new MockOrderPaymentConfirmationRepository(
      store,
      eventBus,
      testHooks,
    ),
    orders: new MockOrderRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, eventBus),
    promotions: new MockPromotionRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return {
    store,
    repositories,
    checkout: new CreateStorefrontCheckoutService(repositories),
    setAuthenticated(value: boolean) {
      authenticated = value;
    },
  };
}

async function verifyAuthenticatedAndGuestFulfillment() {
  const harness = createHarness();
  const tenantSlug = harness.store.getSnapshot().tenants.find((tenant) => tenant.id === tenantId)?.slug;
  assert.ok(tenantSlug);
  const authenticatedKey = "00000000-0000-4000-8000-000000000201";
  await harness.checkout.execute({
    tenantSlug,
    items: [{
      productId,
      tenantId,
      sku: "TOR-001",
      name: "Tornillos",
      unitPrice: 24.99,
      quantity: 2,
    }],
    form: checkoutForm,
    idempotencyKey: authenticatedKey,
  });

  let snapshot = harness.store.getSnapshot();
  const authenticatedOrder = snapshot.orders.find(
    (order) => order.idempotencyKey === authenticatedKey,
  );
  assert.ok(authenticatedOrder);
  assert.equal(authenticatedOrder.customerId, "customer-ana");
  assert.equal(authenticatedOrder.status, OrderStatus.confirmed);
  const authenticatedPicking = snapshot.pickingOrders.filter(
    (picking) => picking.orderId === authenticatedOrder.id,
  );
  assert.equal(authenticatedPicking.length, 1);
  assert.equal(authenticatedPicking[0].tenantId, tenantId);
  assert.equal(authenticatedPicking[0].branchId, branchId);
  assert.equal(authenticatedPicking[0].status, PickingStatus.pending);
  assert.equal(
    snapshot.pickingItems.find(
      (item) => item.pickingOrderId === authenticatedPicking[0].id,
    )?.requestedQuantity,
    10,
  );

  const reservationCount = snapshot.inventoryReservations.length;
  await harness.checkout.execute({
    tenantSlug,
    items: [{
      productId,
      tenantId,
      sku: "TOR-001",
      name: "Tornillos",
      unitPrice: 24.99,
      quantity: 2,
    }],
    form: checkoutForm,
    idempotencyKey: authenticatedKey,
  });
  snapshot = harness.store.getSnapshot();
  assert.equal(
    snapshot.pickingOrders.filter((picking) => picking.orderId === authenticatedOrder.id).length,
    1,
  );
  assert.equal(snapshot.inventoryReservations.length, reservationCount);
  assert.equal(snapshot.inventoryMovements.length, 0);

  harness.setAuthenticated(false);
  const guestKey = "00000000-0000-4000-8000-000000000202";
  await harness.checkout.execute({
    tenantSlug,
    items: [{
      productId,
      tenantId,
      sku: "TOR-001",
      name: "Tornillos",
      unitPrice: 24.99,
      quantity: 1,
    }],
    form: { ...checkoutForm, email: "guest@example.com" },
    idempotencyKey: guestKey,
  });
  snapshot = harness.store.getSnapshot();
  const guestOrder = snapshot.orders.find((order) => order.idempotencyKey === guestKey);
  assert.ok(guestOrder);
  assert.equal(guestOrder.customerId, undefined);
  assert.equal(guestOrder.guestCustomer?.email, "guest@example.com");
  assert.equal(
    snapshot.pickingOrders.filter((picking) => picking.orderId === guestOrder.id).length,
    1,
  );

  const serviceKey = "00000000-0000-4000-8000-000000000203";
  await harness.checkout.execute({
    tenantSlug,
    items: [{
      productId: "prod-install",
      tenantId,
      sku: "SERV-INST-001",
      name: "Servicio de instalacion",
      unitPrice: 250,
      quantity: 1,
    }],
    form: { ...checkoutForm, email: "service@example.com" },
    idempotencyKey: serviceKey,
  });
  snapshot = harness.store.getSnapshot();
  const serviceOrder = snapshot.orders.find((order) => order.idempotencyKey === serviceKey);
  assert.ok(serviceOrder);
  assert.equal(
    snapshot.pickingOrders.some((picking) => picking.orderId === serviceOrder.id),
    false,
  );
}

async function verifyAtomicRollback() {
  const harness = createHarness({
    afterPickingCreated() {
      throw new Error("forced late fulfillment failure");
    },
  });
  const orders = harness.repositories.orders;
  const created = await orders.createWithPayment({
    order: {
      tenantId,
      branchId,
      orderNumber: "WEB-ATOMIC",
      source: OrderSource.ecommerce,
      items: [{
        id: "atomic-item",
        productId,
        skuSnapshot: "TOR-001",
        nameSnapshot: "Tornillos",
        quantity: 1,
        inventoryQuantity: 5,
        unitPrice: 24.99,
        discount: 0,
        subtotal: 24.99,
      }],
      status: OrderStatus.pending,
      deliveryMethod: DeliveryMethod.home_delivery,
      transportMode: TransportMode.third_party,
      deliveryAddress: {
        recipientName: "Cliente Atomic",
        recipientPhone: "55550000",
        line1: "Zona 1",
        city: "Guatemala",
        country: "Guatemala",
      },
      subtotal: 24.99,
      discountTotal: 0,
      shippingTotal: 0,
      total: 24.99,
      trackingToken: "atomic-tracking",
      idempotencyKey: "atomic-checkout",
    },
    payment: {
      tenantId,
      method: PaymentMethod.card,
      status: PaymentStatus.pending,
      amount: 24.99,
      currency: "GTQ",
    },
  });
  await assert.rejects(
    harness.repositories.orderPaymentConfirmations.confirm({
      tenantId,
      branchId,
      orderId: created.order.id,
      paymentId: created.payment.id,
    }),
    /forced late fulfillment failure/,
  );
  const snapshot = harness.store.getSnapshot();
  assert.equal(snapshot.orders.find((order) => order.id === created.order.id)?.status, OrderStatus.pending);
  assert.equal(snapshot.payments.find((payment) => payment.id === created.payment.id)?.status, PaymentStatus.pending);
  assert.equal(snapshot.inventoryReservations.length, 0);
  assert.equal(snapshot.pickingOrders.length, 0);
}

async function verifyPosRegression() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  store.transact((db) => {
    db.orders = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.sales = [];
    db.saleItems = [];
    db.payments = [];
    db.inventoryMovements = [];
    db.inventoryReservations = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
    });
  });
  const repository = new MockSaleConfirmationRepository(store, new DataEventBus());
  const common = {
    tenantId,
    branchId,
    cashierUserId: "user-cashier",
    cashShiftId: "cash-shift-001",
    items: [{
      productId,
      skuSnapshot: "TOR-001",
      nameSnapshot: "Tornillos",
      quantity: 1,
      inventoryQuantity: 5,
      unitPrice: 24.99,
      discount: 0,
      subtotal: 24.99,
    }],
    subtotal: 24.99,
    discountTotal: 0,
    taxTotal: 0,
    total: 24.99,
    payments: [{
      method: PaymentMethod.card as const,
      amount: 24.99,
      currency: "GTQ" as const,
    }],
  };
  const immediate = await repository.confirm({
    ...common,
    confirmationId: "storefront-picking-pos-immediate",
  });
  assert.equal(immediate.order, undefined);
  assert.equal(immediate.pickingOrder, undefined);
  assert.equal(immediate.inventoryMovements.length, 1);

  const deferred = await repository.confirm({
    ...common,
    confirmationId: "storefront-picking-pos-deferred",
    deferredOrder: {
      idempotencyKey: "storefront-picking-pos-order",
      deliveryMethod: DeliveryMethod.home_delivery,
      transportMode: TransportMode.own_fleet,
      deliveryAddress: {
        recipientName: "Cliente POS",
        recipientPhone: "55550000",
        line1: "Zona 1",
        city: "Guatemala",
        country: "Guatemala",
      },
      notificationContact: { emailMode: "not_applicable" },
    },
  });
  assert.ok(deferred.order && deferred.pickingOrder);
  assert.equal(deferred.inventoryMovements.length, 0);
  assert.equal(
    store.getSnapshot().pickingItems.find(
      (item) => item.pickingOrderId === deferred.pickingOrder?.id,
    )?.requestedQuantity,
    5,
  );
}

function verifyPersistedAdminBackfill() {
  const storage = new MemoryStorageAdapter();
  const initial = new MockDatabaseStore(storage).getSnapshot();
  const admin = initial.roles.find((role) => role.id === "role-admin");
  const warehouse = initial.roles.find((role) => role.id === "role-warehouse");
  const demoTenant = initial.tenants.find((tenant) => tenant.id === "tenant-demo");
  assert.ok(admin);
  assert.ok(warehouse && demoTenant);
  assert.deepEqual(new Set(admin.permissions), new Set(permissionsConfig.map((permission) => permission.key)));
  const warehousePermissions = [...warehouse.permissions];
  admin.permissions = ["catalog.products.read"];
  for (const suffix of ["a", "b"]) {
    const tenantId = `tenant-admin-backfill-${suffix}`;
    initial.tenants.push({
      ...demoTenant,
      id: tenantId,
      slug: `admin-backfill-${suffix}`,
      name: `Tenant Admin Backfill ${suffix.toUpperCase()}`,
    });
    initial.roles.push({
      ...admin,
      id: `role-admin-backfill-${suffix}`,
      tenantId,
      permissions: ["catalog.products.read"],
    });
  }
  initial.roles.push({
    ...admin,
    id: "role-custom-admin-like",
    tenantId: "tenant-admin-backfill-a",
    name: "Administrador",
    isSystem: false,
    permissions: ["catalog.products.read"],
  });
  initial.roles.push({
    ...warehouse,
    id: "role-custom-warehouse-like",
    tenantId: "tenant-admin-backfill-b",
    isSystem: false,
    permissions: ["logistics.picking.read"],
  });
  storage.set(MOCK_DATABASE_STORAGE_KEY, initial);

  const normalized = new MockDatabaseStore(storage).getSnapshot();
  const normalizedAdmin = normalized.roles.find((role) => role.id === "role-admin");
  const customRole = normalized.roles.find((role) => role.id === "role-custom-admin-like");
  assert.deepEqual(
    new Set(normalizedAdmin?.permissions),
    new Set(permissionsConfig.map((permission) => permission.key)),
  );
  assert.deepEqual(customRole?.permissions, ["catalog.products.read"]);
  for (const suffix of ["a", "b"]) {
    const tenantAdmin = normalized.roles.find((role) => role.id === `role-admin-backfill-${suffix}`);
    assert.deepEqual(
      new Set(tenantAdmin?.permissions),
      new Set(permissionsConfig.map((permission) => permission.key)),
    );
    assert.ok(tenantAdmin?.permissions.includes("inventory.transfers.manage"));
    assert.ok(tenantAdmin?.permissions.includes("logistics.picking.start"));
    assert.ok(tenantAdmin?.permissions.includes("logistics.packing.finalize"));
    assert.ok(tenantAdmin?.permissions.includes("logistics.dispatch.confirm"));
  }
  assert.deepEqual(normalized.roles.find((role) => role.id === "role-warehouse")?.permissions,
    warehousePermissions);
  assert.deepEqual(normalized.roles.find((role) => role.id === "role-custom-warehouse-like")?.permissions,
    ["logistics.picking.read"]);
  [
    "logistics.history.read",
    "logistics.picking.read",
    "logistics.packing.read",
    "logistics.dispatch.read",
  ].forEach((permission) => assert.ok(normalizedAdmin?.permissions.includes(permission)));
}

async function main() {
  await verifyAuthenticatedAndGuestFulfillment();
  await verifyAtomicRollback();
  await verifyPosRegression();
  verifyPersistedAdminBackfill();
  console.log("storefront -> picking and admin backfill verification: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
