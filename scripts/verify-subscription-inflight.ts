import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import {
  DeliveryMethod, OrderSource, OrderStatus, PaymentMethod, PaymentStatus,
  PickingPriority, SaasCapabilityKey, TransportMode,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockAuditLogRepository, MockBranchRepository, MockBusinessConfigRepository,
  MockCustomerRepository, MockDispatchRepository, MockInventoryRepository,
  MockNotificationRepository, MockOrderRepository, MockPaymentRepository,
  MockPickingRepository, MockPlanRepository, MockProductRepository,
  MockRoleRepository, MockTenantRepository, MockTenantSubscriptionRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { UpdateTenantSubscriptionService } from "@/modules/administration/application/services/UpdateTenantSubscriptionService";
import { getCurrentCustomerOrderDetail, getCurrentCustomerOrders } from "@/modules/customer/application/services/orderService";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { CreateStorefrontCheckoutService } from "@/modules/storefront/application/services/CreateStorefrontCheckoutService";
import { GetPublicStorefrontConfigService } from "@/modules/storefront/application/services/GetPublicStorefrontConfigService";
import { GetStorefrontDiscoveryService } from "@/modules/storefront/application/services/GetStorefrontDiscoveryService";
import { GetStorefrontOrderTrackingService } from "@/modules/storefront/application/services/GetStorefrontOrderTrackingService";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";

class MemoryStorage extends LocalStorageAdapter {
  private readonly values = new Map<string, unknown>();
  override get<T>(key: string): T | null { return (this.values.get(key) as T | undefined) ?? null; }
  override set<T>(key: string, value: T): void { this.values.set(key, structuredClone(value)); }
  override remove(key: string): void { this.values.delete(key); }
}

async function main() {
  const store = new MockDatabaseStore(new MemoryStorage());
  store.mutate((db) => {
    db.orders = [];
    db.orderItems = [];
    db.payments = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.dispatches = [];
    db.packages = [];
    db.notifications = [];
    db.inventoryReservations = [];
    db.inventoryMovements = [];
    const balance = db.inventoryBalances.find((item) => item.id === "bal-screws");
    assert.ok(balance);
    balance.quantity = 100;
    balance.reservedQuantity = 0;
    const other = db.tenantSubscriptions[0];
    db.tenantSubscriptions.push({ ...other, id: "subscription-other", tenantId: "tenant-other", addonCodes: ["ecommerce_delivery"] });
  });

  const events = new DataEventBus();
  let actorUserId = "user-admin";
  const orders = new MockOrderRepository(store, events);
  const picking = new MockPickingRepository(store, events);
  const repositories = {
    auth: {
      getCurrentSessionId: async () => `session-${actorUserId}`,
      getSession: async () => ({ id: `session-${actorUserId}`, userId: actorUserId, expiresAt: "2099-01-01T00:00:00.000Z" }),
    },
    auditLogs: new MockAuditLogRepository(store, events),
    branches: new MockBranchRepository(store, events),
    businessConfig: new MockBusinessConfigRepository(store, events),
    customers: new MockCustomerRepository(store, events),
    dispatches: new MockDispatchRepository(store, events),
    inventory: new MockInventoryRepository(store, events),
    notifications: new MockNotificationRepository(store, events),
    orders,
    payments: new MockPaymentRepository(store, events),
    picking,
    plans: new MockPlanRepository(store, events),
    products: new MockProductRepository(store, events),
    roles: new MockRoleRepository(store, events),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, events),
    tenants: new MockTenantRepository(store, events),
    users: new MockUserRepository(store, events),
  } as unknown as RepositoryRegistry;

  const entitlements = new ResolveTenantEntitlementsService(repositories);
  assert((await entitlements.execute(tenantId)).effectiveCapabilities.includes(SaasCapabilityKey.ecommerce));
  assert.equal((await new GetPublicStorefrontConfigService(repositories).execute(publicStorefrontSlug)).storeEnabled, true);
  const order = await orders.create({
    tenantId, branchId, orderNumber: "WEB-INFLIGHT-001", source: OrderSource.ecommerce,
    customerId: "customer-ana", status: OrderStatus.confirmed,
    deliveryMethod: DeliveryMethod.home_delivery, transportMode: TransportMode.own_fleet,
    deliveryAddress: { recipientName: "Ana Cliente", recipientPhone: "55550000", line1: "Zona 1", city: "Guatemala", country: "Guatemala" },
    notificationContact: { emailMode: "send", email: "ana@example.com" },
    items: [{ id: "inflight-item", productId: "prod-screws", skuSnapshot: "SCREWS", nameSnapshot: "Tornillos", quantity: 1, unitPrice: 25, discount: 0, subtotal: 25 }],
    subtotal: 25, discountTotal: 0, shippingTotal: 0, total: 25,
    trackingToken: "TRACK-INFLIGHT-001",
  });
  await repositories.payments.create({ tenantId, orderId: order.id, method: PaymentMethod.card, status: PaymentStatus.approved, amount: 25, currency: "GTQ" });
  const pickingOrder = await picking.create({ tenantId, branchId, orderId: order.id, priority: PickingPriority.normal });
  actorUserId = "user-warehouse";
  const pickingService = new PickingApplicationService(repositories);
  const dispatchService = new DispatchApplicationService(repositories);
  await pickingService.assign(branchId, pickingOrder.id);

  actorUserId = "user-admin";
  const update = new UpdateTenantSubscriptionService(repositories);
  await update.execute(tenantId, ["advanced_reports"], ["admin.plans.read", "admin.plans.manage"], actorUserId);
  assert(!(await entitlements.execute(tenantId)).effectiveCapabilities.includes(SaasCapabilityKey.ecommerce));
  assert.equal((await new GetPublicStorefrontConfigService(repositories).execute(publicStorefrontSlug)).storeEnabled, false);
  assert((await entitlements.execute("tenant-other")).effectiveCapabilities.includes(SaasCapabilityKey.ecommerce));
  const ordersBeforeDeniedCheckout = (await orders.listByTenant(tenantId)).length;
  await assert.rejects(() => new CreateStorefrontCheckoutService(repositories).execute({
    tenantSlug: publicStorefrontSlug,
    items: [], idempotencyKey: "no-new-checkout", form: {
      fullName: "Cliente Checkout", email: "checkout@example.com", phone: "55550000",
      addressLine1: "Zona 1", city: "Guatemala", cardholderName: "Cliente Checkout", cardLastFour: "4242",
    },
  }));
  await assert.rejects(() => new GetStorefrontDiscoveryService(repositories).execute(publicStorefrontSlug, tenantId));
  assert.equal((await orders.listByTenant(tenantId)).length, ordersBeforeDeniedCheckout);

  actorUserId = "user-warehouse";
  assert((await pickingService.getQueue(branchId)).some((item) => item.pickingOrderId === pickingOrder.id));
  await assert.rejects(() => dispatchService.getPreparedDetail(branchId, order.id));
  await assert.rejects(() => dispatchService.confirm(branchId, { orderId: order.id, operationId: "premature-dispatch" }));
  const detail = await pickingService.getDetail(branchId, pickingOrder.id);
  const line = detail.lines[0];
  assert.ok(line);
  await pickingService.updateLine(branchId, {
    pickingOrderId: pickingOrder.id, pickingLineId: line.pickingLineId,
    pickedQuantity: line.requiredQuantity, operationId: "inflight-pick-1",
  });
  assert.equal((await pickingService.complete(branchId, pickingOrder.id)).orderStatus, OrderStatus.ready_for_dispatch);
  assert((await dispatchService.getPreparedQueue(branchId)).some((item) => item.orderId === order.id));
  assert.equal((await dispatchService.getPreparedDetail(branchId, order.id)).orderId, order.id);
  await assert.rejects(() => dispatchService.confirm("branch-norte", { orderId: order.id, operationId: "wrong-branch" }));
  await assert.rejects(() => dispatchService.confirm(branchId, { orderId: "missing-order", operationId: "invalid-order" }));
  store.mutate((db) => db.orders.push({ ...order, id: "foreign-order", tenantId: "tenant-other", status: OrderStatus.ready_for_dispatch }));
  await assert.rejects(() => dispatchService.getPreparedDetail(branchId, "foreign-order"));
  const dispatched = await dispatchService.confirm(branchId, { orderId: order.id, operationId: "inflight-dispatch", packages: [{ number: "BOX-1" }] });
  assert.equal(dispatched.orderStatus, OrderStatus.dispatched);
  assert.equal(dispatched.notificationStatus, "simulated_sent");
  assert.equal(dispatched.notification?.recipientEmail, "ana@example.com");
  assert.equal((await dispatchService.getDispatchDetail(branchId, order.id)).orderStatus, OrderStatus.dispatched);
  assert((await new GetStorefrontOrderTrackingService(repositories).execute({ tenantSlug: publicStorefrontSlug, trackingToken: order.trackingToken }))?.orderId === order.id);
  await assert.rejects(
    () => new GetStorefrontOrderTrackingService(repositories).execute({ tenantSlug: "tenant-other", trackingToken: order.trackingToken }),
  );
  store.mutate((db) => {
    db.tenants.push({ ...db.tenants[0], id: "tenant-other", slug: "tenant-other" });
    db.ecommerceConfigs.push({ ...db.ecommerceConfigs[0], tenantId: "tenant-other" });
    db.orders.push({ ...order, id: "other-order", tenantId: "tenant-other", trackingToken: "TRACK-OTHER-001" });
  });
  assert.equal(
    (await new GetStorefrontOrderTrackingService(repositories).execute({ tenantSlug: "tenant-other", trackingToken: "TRACK-OTHER-001" }))?.orderId,
    "other-order",
  );

  actorUserId = "user-customer";
  assert((await getCurrentCustomerOrders(repositories)).some((item) => item.id === order.id));
  assert.equal((await getCurrentCustomerOrderDetail(repositories, order.id))?.orderNumber, order.orderNumber);
  await assert.rejects(() => dispatchService.getPreparedQueue(branchId));
  actorUserId = "user-warehouse";
  store.mutate((db) => { db.roles.find((role) => role.id === "role-warehouse")!.permissions = ["logistics.picking.read"]; });
  await assert.rejects(() => dispatchService.getDispatchDetail(branchId, order.id));
  console.log("verify-subscription-inflight: ALL PASS");
}

void main();
