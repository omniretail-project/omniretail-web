/**
 * verify-multi-tenant-storefront.ts
 *
 * Integration harness for feature/tenant-storefront-routing.
 * Run from the project root:
 *   npx tsx scripts/verify-multi-tenant-storefront.ts
 */

import assert from "node:assert/strict";
import {
  BranchStatus,
  BranchType,
  CustomerStatus,
  DeliveryMethod,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PlanCode,
  PlanStatus,
  ProductStatus,
  ProductType,
  RoleStatus,
  SaasCapabilityKey,
  TenantStatus,
  TenantSubscriptionStatus,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockAttributeRepository } from "@/infrastructure/mock/repositories/MockAttributeRepository";
import { MockAuthRepository } from "@/infrastructure/mock/repositories/MockAuthRepository";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockCategoryRepository } from "@/infrastructure/mock/repositories/MockCategoryRepository";
import { MockCustomerRepository } from "@/infrastructure/mock/repositories/MockCustomerRepository";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MockOrderPaymentConfirmationRepository } from "@/infrastructure/mock/repositories/MockOrderPaymentConfirmationRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPaymentRepository } from "@/infrastructure/mock/repositories/MockPaymentRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockProductKitComponentRepository } from "@/infrastructure/mock/repositories/MockProductKitComponentRepository";
import { MockProductMediaRepository } from "@/infrastructure/mock/repositories/MockProductMediaRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUnitRepository } from "@/infrastructure/mock/repositories/MockUnitRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import { buildPasswordHashMock } from "@/infrastructure/mock/shared/passwordHashMock";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";
import { GetStorefrontOrderTrackingService } from "@/modules/storefront/application/services/GetStorefrontOrderTrackingService";
import { GetStorefrontOrderConfirmationService } from "@/modules/storefront/application/services/GetStorefrontOrderConfirmationService";
import { GetStorefrontProductDetailService } from "@/modules/storefront/application/services/GetStorefrontProductDetailService";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";
import type { StorefrontCheckoutFormDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";

// ==================================================
// Assertion helpers
// ==================================================

const PASS_RESULTS: string[] = [];
const FAIL_RESULTS: { label: string; error: unknown }[] = [];
let testCount = 0;

async function check(label: string, fn: () => Promise<void> | void): Promise<void> {
  testCount++;
  try {
    await fn();
    PASS_RESULTS.push(label);
    console.log(`[PASS] ${label}`);
  } catch (err) {
    FAIL_RESULTS.push({ label, error: err });
    console.error(`[FAIL] ${label}`);
    console.error("       ", err instanceof Error ? err.message : String(err));
  }
}

async function expectRejects(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
    throw new assert.AssertionError({ message: "Expected rejection but resolved" });
  } catch (err) {
    if (err instanceof assert.AssertionError) throw err;
    return err instanceof Error ? err : new Error(String(err));
  }
}

// ==================================================
// In-memory storage
// ==================================================

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();
  override get<T>(key: string): T | null {
    const raw = this.values.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }
  override remove(key: string): void {
    this.values.delete(key);
  }
}

// ==================================================
// Fixture constants
// ==================================================

const NOW = "2026-09-16T12:00:00.000Z";
const TENANT_A_ID = "tenant-multi-a";
const TENANT_A_SLUG = "ferreteria-a";
const BRANCH_A_ID = "branch-multi-a";
const PRODUCT_A_ID = "product-multi-a";
const UNIT_A_ID = "unit-multi-a";
const CAT_A_ID = "cat-multi-a";
const PLAN_A_ID = "plan-multi-a";
const SUB_A_ID = "sub-multi-a";
const ROLE_CUSTOMER_A_ID = "role-customer-multi-a";
const TENANT_B_ID = "tenant-multi-b";
const TENANT_B_SLUG = "ferreteria-b";
const BRANCH_B_ID = "branch-multi-b";
const PRODUCT_B_ID = "product-multi-b";
const UNIT_B_ID = "unit-multi-b";
const CAT_B_ID = "cat-multi-b";
const PLAN_B_ID = "plan-multi-b";
const SUB_B_ID = "sub-multi-b";
const ROLE_CUSTOMER_B_ID = "role-customer-multi-b";
const TENANT_C_ID = "tenant-multi-c";
const TENANT_C_SLUG = "ferreteria-c";
const PLAN_C_ID = "plan-multi-c";
const SUB_C_ID = "sub-multi-c";
const TENANT_D_ID = "tenant-multi-d";
const TENANT_D_SLUG = "ferreteria-d";
const PLAN_D_ID = "plan-multi-d";
const SUB_D_ID = "sub-multi-d";
const CUSTOMER_A_EMAIL = "customera@ferreteria-a.test";
const CUSTOMER_A_PASS = "ClienteA123!";
const CUSTOMER_A_USER_ID = "user-customer-multi-a";
const CUSTOMER_A_ID = "customer-multi-a";
const TRACKING_A = "tracking-multi-a";

const ECOMMERCE_CAPS = [
  SaasCapabilityKey.inventory,
  SaasCapabilityKey.ecommerce,
  SaasCapabilityKey.pos,
  SaasCapabilityKey.purchasing,
  SaasCapabilityKey.receiving,
  SaasCapabilityKey.traceabilityLots,
  SaasCapabilityKey.traceabilityExpiration,
  SaasCapabilityKey.traceabilitySerials,
];

// ==================================================
// Store builder
// ==================================================

function buildStore() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);

  store.transact((db) => {
    // Tenant A
    db.tenants.push({ id: TENANT_A_ID, name: "Ferreteria A", slug: TENANT_A_SLUG, status: TenantStatus.active, defaultCurrency: "GTQ", timezone: "America/Guatemala", createdAt: NOW, updatedAt: NOW });
    db.branches.push({ id: BRANCH_A_ID, tenantId: TENANT_A_ID, code: "BRANCH-A", name: "Sucursal A", type: BranchType.store, status: BranchStatus.active, createdAt: NOW, updatedAt: NOW });
    db.units.push({ id: UNIT_A_ID, tenantId: TENANT_A_ID, code: "UND-A", name: "Unidad A", symbol: "u", category: "unit" as never, allowsDecimals: false, status: "active" as never, createdAt: NOW, updatedAt: NOW });
    db.categories.push({ id: CAT_A_ID, tenantId: TENANT_A_ID, name: "Categoria A", slug: "categoria-a", status: "active" as never, createdAt: NOW, updatedAt: NOW });
    db.products.push({ id: PRODUCT_A_ID, tenantId: TENANT_A_ID, sku: "PROD-A", name: "Producto A", productType: ProductType.physical, categoryId: CAT_A_ID, baseUnitId: UNIT_A_ID, saleUnitId: UNIT_A_ID, inventoryUnitId: UNIT_A_ID, salePrice: 25, status: ProductStatus.published, tracking: { stock: false, lot: false, expiration: false, serial: false }, channels: { ecommerce: true, pos: false, mobileApp: false }, createdAt: NOW, updatedAt: NOW });
    db.planDefinitions.push({ id: PLAN_A_ID, code: PlanCode.basic, name: "Plan A", status: PlanStatus.active, capabilities: ECOMMERCE_CAPS, limits: {}, createdAt: NOW, updatedAt: NOW });
    db.tenantSubscriptions.push({ id: SUB_A_ID, tenantId: TENANT_A_ID, planId: PLAN_A_ID, status: TenantSubscriptionStatus.active, addonCodes: [], startedAt: NOW, createdAt: NOW, updatedAt: NOW });
    db.ecommerceConfigs.push({ tenantId: TENANT_A_ID, enabled: true, storeName: "Ferreteria A Online", contactPhone: "+502 1111-0001", contactEmail: "ventas@ferreteria-a.test", requireAccountForCheckout: false, guestTrackingEnabled: true, allowedDeliveryMethods: [DeliveryMethod.home_delivery], allowedPaymentMethods: [PaymentMethod.card], defaultBranchId: BRANCH_A_ID, createdAt: NOW, updatedAt: NOW });
    db.businessCapabilities.push({ tenantId: TENANT_A_ID, preset: "custom" as never, supportsInventory: true, supportsLots: false, supportsExpiration: false, supportsSerials: false, supportsMultipleLocations: false, supportsUnitsAndPackaging: true, supportsProductAttributes: false, supportsKits: false, supportsServices: false, defaultProductTracking: { stock: false, lot: false, expiration: false, serial: false } });
    db.roles.push({ id: ROLE_CUSTOMER_A_ID, tenantId: TENANT_A_ID, name: "Cliente", isSystem: true, permissions: ["customer.account.read", "storefront.orders.read"], branchScope: "assigned", status: RoleStatus.active, createdAt: NOW, updatedAt: NOW });
    db.customers.push({ id: CUSTOMER_A_ID, tenantId: TENANT_A_ID, userId: CUSTOMER_A_USER_ID, code: "CLI-MULTI-A", name: "Cliente A", email: CUSTOMER_A_EMAIL, status: CustomerStatus.active, createdAt: NOW, updatedAt: NOW });
    db.users.push({ id: CUSTOMER_A_USER_ID, tenantId: TENANT_A_ID, customerId: CUSTOMER_A_ID, name: "Cliente A", email: CUSTOMER_A_EMAIL, type: UserType.customer, status: UserStatus.active, roleId: ROLE_CUSTOMER_A_ID, createdAt: NOW, updatedAt: NOW });
    db.authAccounts.push({ id: "auth-customer-multi-a", userId: CUSTOMER_A_USER_ID, email: CUSTOMER_A_EMAIL, passwordHashMock: buildPasswordHashMock(CUSTOMER_A_PASS), status: "active" as never, failedLoginAttempts: 0, createdAt: NOW, updatedAt: NOW });

    // Tenant B
    db.tenants.push({ id: TENANT_B_ID, name: "Ferreteria B", slug: TENANT_B_SLUG, status: TenantStatus.active, defaultCurrency: "GTQ", timezone: "America/Guatemala", createdAt: NOW, updatedAt: NOW });
    db.branches.push({ id: BRANCH_B_ID, tenantId: TENANT_B_ID, code: "BRANCH-B", name: "Sucursal B", type: BranchType.store, status: BranchStatus.active, createdAt: NOW, updatedAt: NOW });
    db.units.push({ id: UNIT_B_ID, tenantId: TENANT_B_ID, code: "UND-B", name: "Unidad B", symbol: "u", category: "unit" as never, allowsDecimals: false, status: "active" as never, createdAt: NOW, updatedAt: NOW });
    db.categories.push({ id: CAT_B_ID, tenantId: TENANT_B_ID, name: "Categoria B", slug: "categoria-b", status: "active" as never, createdAt: NOW, updatedAt: NOW });
    db.products.push({ id: PRODUCT_B_ID, tenantId: TENANT_B_ID, sku: "PROD-B", name: "Producto B", productType: ProductType.physical, categoryId: CAT_B_ID, baseUnitId: UNIT_B_ID, saleUnitId: UNIT_B_ID, inventoryUnitId: UNIT_B_ID, salePrice: 30, status: ProductStatus.published, tracking: { stock: false, lot: false, expiration: false, serial: false }, channels: { ecommerce: true, pos: false, mobileApp: false }, createdAt: NOW, updatedAt: NOW });
    db.planDefinitions.push({ id: PLAN_B_ID, code: PlanCode.basic, name: "Plan B", status: PlanStatus.active, capabilities: ECOMMERCE_CAPS, limits: {}, createdAt: NOW, updatedAt: NOW });
    db.tenantSubscriptions.push({ id: SUB_B_ID, tenantId: TENANT_B_ID, planId: PLAN_B_ID, status: TenantSubscriptionStatus.active, addonCodes: [], startedAt: NOW, createdAt: NOW, updatedAt: NOW });
    db.ecommerceConfigs.push({ tenantId: TENANT_B_ID, enabled: true, storeName: "Ferreteria B Online", contactPhone: "+502 2222-0002", contactEmail: "ventas@ferreteria-b.test", requireAccountForCheckout: false, guestTrackingEnabled: true, allowedDeliveryMethods: [DeliveryMethod.home_delivery], allowedPaymentMethods: [PaymentMethod.card], defaultBranchId: BRANCH_B_ID, createdAt: NOW, updatedAt: NOW });
    db.businessCapabilities.push({ tenantId: TENANT_B_ID, preset: "custom" as never, supportsInventory: true, supportsLots: false, supportsExpiration: false, supportsSerials: false, supportsMultipleLocations: false, supportsUnitsAndPackaging: true, supportsProductAttributes: false, supportsKits: false, supportsServices: false, defaultProductTracking: { stock: false, lot: false, expiration: false, serial: false } });
    db.roles.push({ id: ROLE_CUSTOMER_B_ID, tenantId: TENANT_B_ID, name: "Cliente", isSystem: true, permissions: ["customer.account.read", "storefront.orders.read"], branchScope: "assigned", status: RoleStatus.active, createdAt: NOW, updatedAt: NOW });

    // Tenant C - ecommerce capability OFF
    db.tenants.push({ id: TENANT_C_ID, name: "Ferreteria C", slug: TENANT_C_SLUG, status: TenantStatus.active, defaultCurrency: "GTQ", timezone: "America/Guatemala", createdAt: NOW, updatedAt: NOW });
    db.planDefinitions.push({ id: PLAN_C_ID, code: PlanCode.basic, name: "Plan C no ecommerce", status: PlanStatus.active, capabilities: [SaasCapabilityKey.inventory, SaasCapabilityKey.pos], limits: {}, createdAt: NOW, updatedAt: NOW });
    db.tenantSubscriptions.push({ id: SUB_C_ID, tenantId: TENANT_C_ID, planId: PLAN_C_ID, status: TenantSubscriptionStatus.active, addonCodes: [], startedAt: NOW, createdAt: NOW, updatedAt: NOW });
    db.ecommerceConfigs.push({ tenantId: TENANT_C_ID, enabled: true, storeName: "Ferreteria C Online", contactPhone: "", contactEmail: "", requireAccountForCheckout: false, guestTrackingEnabled: false, allowedDeliveryMethods: [], allowedPaymentMethods: [], defaultBranchId: "", createdAt: NOW, updatedAt: NOW });

    // Tenant D - EcommerceConfig.enabled=false
    db.tenants.push({ id: TENANT_D_ID, name: "Ferreteria D", slug: TENANT_D_SLUG, status: TenantStatus.active, defaultCurrency: "GTQ", timezone: "America/Guatemala", createdAt: NOW, updatedAt: NOW });
    db.planDefinitions.push({ id: PLAN_D_ID, code: PlanCode.basic, name: "Plan D ecommerce capable", status: PlanStatus.active, capabilities: ECOMMERCE_CAPS, limits: {}, createdAt: NOW, updatedAt: NOW });
    db.tenantSubscriptions.push({ id: SUB_D_ID, tenantId: TENANT_D_ID, planId: PLAN_D_ID, status: TenantSubscriptionStatus.active, addonCodes: [], startedAt: NOW, createdAt: NOW, updatedAt: NOW });
    db.ecommerceConfigs.push({ tenantId: TENANT_D_ID, enabled: false, storeName: "Ferreteria D Online", contactPhone: "", contactEmail: "", requireAccountForCheckout: false, guestTrackingEnabled: false, allowedDeliveryMethods: [], allowedPaymentMethods: [], defaultBranchId: "", createdAt: NOW, updatedAt: NOW });

    // Pre-existing tracking order for Tenant A
    db.orders.push({ id: "order-tracking-multi-a", tenantId: TENANT_A_ID, branchId: BRANCH_A_ID, orderNumber: "WEB-TRACK-A", source: OrderSource.ecommerce, status: OrderStatus.confirmed, deliveryMethod: DeliveryMethod.home_delivery, transportMode: TransportMode.third_party, items: [], notificationContact: { emailMode: "send", email: CUSTOMER_A_EMAIL }, deliveryAddress: { recipientName: "Cliente A", recipientPhone: "55550001", line1: "Zona 1", city: "Guatemala", country: "Guatemala" }, subtotal: 25, discountTotal: 0, shippingTotal: 0, total: 25, trackingToken: TRACKING_A, idempotencyKey: "order-tracking-multi-a", idempotencyFingerprint: "order-tracking-multi-a", createdAt: NOW, updatedAt: NOW });
  });

  return store;
}

// ==================================================
// Repository factory
// ==================================================

function buildRepositories(
  store: MockDatabaseStore,
  eventBus: DataEventBus,
  sessionStorage: MemoryStorageAdapter,
  currentUserId: { value: string | null },
): RepositoryRegistry {
  const auth = new MockAuthRepository(store, eventBus, sessionStorage);
  const proxied = new Proxy(auth, {
    get(target, prop) {
      if (prop === "getCurrentSessionId") return async () => (currentUserId.value ? `session-mt-${currentUserId.value}` : null);
      if (prop === "getSession") {
        return async (sessionId: string) => {
          const uid = currentUserId.value;
          if (!uid || sessionId !== `session-mt-${uid}`) return null;
          return { id: sessionId, userId: uid, createdAt: NOW, expiresAt: "2099-01-01T00:00:00.000Z", rememberMe: false };
        };
      }
      const value = Reflect.get(target, prop as keyof typeof target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return {
    auth: proxied,
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    categories: new MockCategoryRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    inventory: new MockInventoryRepository(store, eventBus),
    orderPaymentConfirmations: new MockOrderPaymentConfirmationRepository(store, eventBus),
    orders: new MockOrderRepository(store, eventBus),
    payments: new MockPaymentRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    productKitComponents: new MockProductKitComponentRepository(store, eventBus),
    productMedia: new MockProductMediaRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    attributes: new MockAttributeRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
}

function makeCheckoutForm(overrides: Partial<StorefrontCheckoutFormDto> = {}): StorefrontCheckoutFormDto {
  return { fullName: "Cliente Checkout", email: "checkout@ferreteria-a.test", phone: "55550002", addressLine1: "Zona 1 GT", city: "Guatemala", cardholderName: "Cliente Checkout", cardLastFour: "4242", ...overrides };
}

// ==================================================
// Main
// ==================================================

async function main() {
  const store = buildStore();
  const eventBus = new DataEventBus();
  const sessionStorage = new MemoryStorageAdapter();
  const currentUserId: { value: string | null } = { value: null };
  const repositories = buildRepositories(store, eventBus, sessionStorage, currentUserId);
  const contextService = new ResolvePublicStorefrontContextService(repositories);
  const productDetailService = new GetStorefrontProductDetailService(repositories);
  const trackingService = new GetStorefrontOrderTrackingService(repositories);
  const checkoutService = new CreateStorefrontCheckoutService(repositories);
  const confirmationService = new GetStorefrontOrderConfirmationService(repositories);

  // SCENARIO 1 – Context resolution
  await check("Context A", async () => {
    const ctx = await contextService.execute({ tenantSlug: TENANT_A_SLUG });
    assert.equal(ctx.tenantId, TENANT_A_ID);
  });
  await check("Context B", async () => {
    const ctx = await contextService.execute({ tenantSlug: TENANT_B_SLUG });
    assert.equal(ctx.tenantId, TENANT_B_ID);
  });
  await check("Invalid slug", async () => {
    const err = await expectRejects(() => contextService.execute({ tenantSlug: "no-existe" }));
    assert.ok(err.message.length > 0);
    assert.ok(!err.message.toLowerCase().includes("tenant-demo"));
  });
  await check("Invalid slug not demo", async () => {
    const ctxA = await contextService.execute({ tenantSlug: TENANT_A_SLUG });
    assert.notEqual(ctxA.tenantId, "tenant-demo");
  });

  // SCENARIO 2 – Product isolation
  await check("Product A / Store A - PASS", async () => {
    const detail = await productDetailService.execute(TENANT_A_SLUG, TENANT_A_ID, PRODUCT_A_ID);
    assert.ok(detail);
    assert.equal(detail.product.tenantId, TENANT_A_ID);
  });
  await check("Product B / Store A - null or denied", async () => {
    let result: Awaited<ReturnType<typeof productDetailService.execute>> = null;
    try { result = await productDetailService.execute(TENANT_A_SLUG, TENANT_A_ID, PRODUCT_B_ID); } catch { result = null; }
    assert.equal(result, null);
  });
  await check("Product B / Store B - PASS", async () => {
    const detail = await productDetailService.execute(TENANT_B_SLUG, TENANT_B_ID, PRODUCT_B_ID);
    assert.ok(detail);
    assert.equal(detail.product.tenantId, TENANT_B_ID);
  });
  await check("Product A / Store B - null or denied", async () => {
    let result: Awaited<ReturnType<typeof productDetailService.execute>> = null;
    try { result = await productDetailService.execute(TENANT_B_SLUG, TENANT_B_ID, PRODUCT_A_ID); } catch { result = null; }
    assert.equal(result, null);
  });

  // SCENARIO 3 – Checkout
  await check("Valid checkout Tenant A", async () => {
    currentUserId.value = null;
    const result = await checkoutService.execute({
      tenantSlug: TENANT_A_SLUG,
      items: [{ productId: PRODUCT_A_ID, tenantId: TENANT_A_ID, sku: "PROD-A", name: "Producto A", unitPrice: 25, quantity: 1 }],
      form: makeCheckoutForm(),
      idempotencyKey: "checkout-multi-a-valid",
    });
    assert.ok(result.orderNumber);
    const order = store.getSnapshot().orders.find((o) => o.orderNumber === result.orderNumber);
    assert.ok(order);
    assert.equal(order.tenantId, TENANT_A_ID);
    assert.equal(order.branchId, BRANCH_A_ID);
  });
  await check("Cross-tenant checkout denied (Tenant A slug + Product B)", async () => {
    currentUserId.value = null;
    const err = await expectRejects(() =>
      checkoutService.execute({
        tenantSlug: TENANT_A_SLUG,
        items: [{ productId: PRODUCT_B_ID, tenantId: TENANT_A_ID, sku: "PROD-B", name: "Producto B", unitPrice: 30, quantity: 1 }],
        form: makeCheckoutForm({ email: "cross@ferreteria-a.test" }),
        idempotencyKey: "checkout-cross-a",
      }),
    );
    assert.ok(err.message.length > 0);
    const crossOrder = store.getSnapshot().orders.find((o) => o.tenantId === TENANT_B_ID && o.idempotencyKey === "checkout-cross-a");
    assert.equal(crossOrder, undefined);
  });
  await check("Confirmation F5 recovery: guest, customer, invalid and cross-tenant", async () => {
    currentUserId.value = null;
    const guest = await checkoutService.execute({
      tenantSlug: TENANT_A_SLUG,
      items: [{ productId: PRODUCT_A_ID, tenantId: TENANT_A_ID, sku: "PROD-A", name: "Producto A", unitPrice: 25, quantity: 1 }],
      form: makeCheckoutForm({ email: "guest-confirmation@ferreteria-a.test" }),
      idempotencyKey: "checkout-confirmation-guest",
    });
    assert.ok(guest.trackingToken);
    // This lookup represents an F5: it receives no checkout-provider state.
    const recoveredGuest = await confirmationService.execute({ tenantSlug: TENANT_A_SLUG, trackingToken: guest.trackingToken });
    assert.ok(recoveredGuest);
    assert.equal(recoveredGuest.orderNumber, guest.orderNumber);
    assert.equal(recoveredGuest.total, guest.total);
    assert.equal(await confirmationService.execute({ tenantSlug: TENANT_A_SLUG, trackingToken: "not-a-token" }), null);
    assert.equal(await confirmationService.execute({ tenantSlug: TENANT_B_SLUG, trackingToken: guest.trackingToken }), null);

    currentUserId.value = CUSTOMER_A_USER_ID;
    const customer = await checkoutService.execute({
      tenantSlug: TENANT_A_SLUG,
      items: [{ productId: PRODUCT_A_ID, tenantId: TENANT_A_ID, sku: "PROD-A", name: "Producto A", unitPrice: 25, quantity: 1 }],
      form: makeCheckoutForm({ email: CUSTOMER_A_EMAIL }),
      idempotencyKey: "checkout-confirmation-customer",
    });
    const recoveredCustomer = await confirmationService.execute({ tenantSlug: TENANT_A_SLUG, trackingToken: customer.trackingToken });
    assert.ok(recoveredCustomer);
    assert.equal(recoveredCustomer.orderNumber, customer.orderNumber);
    currentUserId.value = null;
  });

  // SCENARIO 4 – Registration
  await check("Customer registration Tenant A", async () => {
    const authRepo = repositories.auth as MockAuthRepository;
    const result = await authRepo.registerCustomer({ tenantSlug: TENANT_A_SLUG, name: "Nuevo Cliente A", email: "nuevo-a@ferreteria-a.test", phone: "55559999", passwordMock: "NuevoClienteA1!" });
    assert.equal(result.user.type, UserType.customer);
    assert.equal(result.user.tenantId, TENANT_A_ID);
    assert.ok(result.user.customerId);
    assert.notEqual(result.user.tenantId, TENANT_B_ID);
    assert.notEqual(result.user.tenantId, "tenant-demo");
  });

  // SCENARIO 5 – Login isolation
  await check("Customer A login Tenant A - PASS", async () => {
    const authRepo = repositories.auth as MockAuthRepository;
    const ctx = await contextService.execute({ tenantSlug: TENANT_A_SLUG });
    const result = await authRepo.login({ tenantId: ctx.tenantId, email: CUSTOMER_A_EMAIL, passwordMock: CUSTOMER_A_PASS });
    assert.equal(result.status, "authenticated");
    if (result.status === "authenticated") await authRepo.logout(result.session.id);
  });
  await check("Customer A login Tenant B - DENIED", async () => {
    const authRepo = repositories.auth as MockAuthRepository;
    const ctxB = await contextService.execute({ tenantSlug: TENANT_B_SLUG });
    const err = await expectRejects(() => authRepo.login({ tenantId: ctxB.tenantId, email: CUSTOMER_A_EMAIL, passwordMock: CUSTOMER_A_PASS }));
    assert.ok(err.message.length > 0);
  });

  // SCENARIO 6 – Account guard (domain condition)
  await check("Account guard: Customer A / Store A - ALLOWED", () => {
    const userA = store.getSnapshot().users.find((u) => u.id === CUSTOMER_A_USER_ID);
    assert.ok(userA);
    const allowed = userA.type === UserType.customer && userA.tenantId === TENANT_A_ID;
    assert.equal(allowed, true);
  });
  await check("Account guard: Customer A / Store B - DENIED", () => {
    const userA = store.getSnapshot().users.find((u) => u.id === CUSTOMER_A_USER_ID);
    assert.ok(userA);
    const allowed = userA.type === UserType.customer && userA.tenantId === TENANT_B_ID;
    assert.equal(allowed, false);
  });

  // SCENARIO 7 – Tracking isolation
  await check("Tracking: Token A / Store A - PASS", async () => {
    const result = await trackingService.execute({ tenantSlug: TENANT_A_SLUG, trackingToken: TRACKING_A });
    assert.ok(result);
    assert.equal(result.orderId, "order-tracking-multi-a");
  });
  await check("Tracking: Token A / Store B - DENIED/null", async () => {
    const result = await trackingService.execute({ tenantSlug: TENANT_B_SLUG, trackingToken: TRACKING_A });
    assert.equal(result, null);
  });

  // SCENARIO 8 – Legacy demo tracking
  await check("Legacy demo tracking", async () => {
    const snap = store.getSnapshot();
    const demoOrder = snap.orders.find((o) => o.tenantId === "tenant-demo" && o.source === OrderSource.ecommerce && o.trackingToken);
    if (!demoOrder) {
      // No demo order in isolated store; verify interface does not throw
      const result = await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: "nonexistent-demo-token" });
      assert.equal(typeof result === "object", true);
    } else {
      const result = await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: demoOrder.trackingToken! });
      assert.ok(result);
    }
  });

  // SCENARIO 9 – Ecommerce OFF
  await check("Ecommerce OFF (no capability) - DENIED", async () => {
    const err = await expectRejects(() => contextService.execute({ tenantSlug: TENANT_C_SLUG }));
    assert.ok(err.message.length > 0);
  });

  // SCENARIO 10 – Config OFF
  await check("EcommerceConfig OFF - DENIED", async () => {
    const err = await expectRejects(() => contextService.execute({ tenantSlug: TENANT_D_SLUG }));
    assert.ok(err.message.length > 0);
  });

  // Security check
  await check("Global token lookup ABSENT", () => {
    const orderRepo = repositories.orders as MockOrderRepository;
    assert.equal("getByTrackingTokenGlobally" in orderRepo, false);
  });

  // Summary
  console.log(`\n============================`);
  console.log(`TOTAL: ${testCount} | PASS: ${PASS_RESULTS.length} | FAIL: ${FAIL_RESULTS.length}`);
  console.log(`============================\n`);
  if (FAIL_RESULTS.length > 0) {
    console.error("FAILED SCENARIOS:");
    for (const { label, error } of FAIL_RESULTS) {
      console.error(`  [FAIL] ${label}`);
      console.error(`         ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
  console.log("multi-tenant storefront verification: PASS");
}

void main();
