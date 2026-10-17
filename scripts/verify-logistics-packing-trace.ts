import assert from "node:assert/strict";
import type { OrderNotificationContact } from "@/core/types/orderNotification.types";
import { DeliveryMethod, NotificationChannel, NotificationStatus, OrderSource, OrderStatus, PickingPriority, ProductType, TransportMode } from "@/core/enums";
import { isOrderDeliveryMethodAllowed } from "@/core/orders/orderDeliveryPolicy";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository, MockDispatchRepository, MockInventoryRepository, MockNotificationRepository, MockOrderRepository, MockPackingRepository, MockPickingRepository, MockProductRepository, MockRoleRepository, MockUserRepository } from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { GetLogisticsItemTraceService } from "@/modules/logistics/application/services/GetLogisticsItemTraceService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const actorUserId = "user-warehouse";

async function main() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  prepareDatabase(store);
  const eventBus = new DataEventBus();
  const orders = new MockOrderRepository(store, eventBus);
  const picking = new MockPickingRepository(store, eventBus);
  const packings = new MockPackingRepository(store, eventBus);
  const dispatches = new MockDispatchRepository(store, eventBus);
  const repositories = {
    auth: {
      getCurrentSessionId: async () => "packing-session",
      getSession: async () => ({ id: "packing-session", userId: actorUserId, createdAt: "2026-09-14T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", rememberMe: false }),
    },
    branches: new MockBranchRepository(store, eventBus),
    dispatches,
    inventory: new MockInventoryRepository(store, eventBus),
    notifications: new MockNotificationRepository(store, eventBus),
    orders,
    packings,
    picking,
    products: new MockProductRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
  const service = new DispatchApplicationService(repositories);
  const traceService = new GetLogisticsItemTraceService(repositories);

  const primary = await prepareOrder(orders, picking, packings, "primary", TransportMode.own_fleet);
  const thirdParty = await prepareOrder(orders, picking, packings, "third-party", TransportMode.third_party);
  const pickup = await prepareOrder(orders, picking, packings, "pickup", TransportMode.customer, DeliveryMethod.store_pickup);
  const nonEligible = await orders.create(orderInput("not-ready", TransportMode.own_fleet, DeliveryMethod.home_delivery));
  addQueueContaminants(store, primary.orderId, primary.pickingOrderId);

  const queue = await service.getPreparedQueue(branchId);
  assert.ok(queue.some((item) => item.orderId === primary.orderId));
  assert.ok(queue.some((item) => item.orderId === thirdParty.orderId));
  assert.ok(queue.every((item) => item.orderId !== pickup.orderId));
  assert.ok(queue.every((item) => item.orderId !== nonEligible.id));
  assert.ok(queue.every((item) => item.orderId !== "packing-other-branch"));
  assert.ok(queue.every((item) => item.orderId !== "packing-other-tenant"));
  assert.deepEqual(queue.map((item) => item.orderId).sort(), [primary.orderId, thirdParty.orderId].sort());
  assert.ok(queue.every((item) => item.address && item.transportMode !== TransportMode.customer));

  await verifyRichTrace(store, orders, picking, traceService);

  const inventoryBeforeDispatch = inventorySnapshot(store);
  const confirmed = await service.confirm(branchId, {
    orderId: primary.orderId,
    operationId: "packing-primary-confirm",
    packages: [
      { number: "BOX-001", weight: 1.25, description: "Frágil" },
      { number: "BOX-002", weight: 2.5 },
    ],
  });
  assert.equal(confirmed.orderStatus, OrderStatus.dispatched);
  assert.equal(confirmed.packages.length, 2);
  const persisted = await dispatches.getById({ tenantId, branchId }, confirmed.dispatchId);
  assert.equal(persisted?.packageCount, 2);
  assert.equal(persisted?.weight, 3.75);
  const packages = await dispatches.getPackagesByDispatch({ tenantId, branchId }, confirmed.dispatchId);
  assert.equal(packages.length, 2);
  assert.ok(packages.every((item) => item.number.startsWith("LBL-LOG-PACK-primary-")));
  assert.ok(packages.every((item) => item.dispatchId === confirmed.dispatchId));
  assert.deepEqual(await dispatches.getPackagesByDispatch({ tenantId, branchId: "branch-norte" }, confirmed.dispatchId), []);
  assert.deepEqual(await dispatches.getPackagesByDispatch({ tenantId: "tenant-foreign", branchId }, confirmed.dispatchId), []);
  const inventoryAfterDispatch = inventorySnapshot(store);
  const beforeBalance = inventoryBeforeDispatch.balances.find((item) => item.id === "bal-screws");
  const afterBalance = inventoryAfterDispatch.balances.find((item) => item.id === "bal-screws");
  assert.equal(afterBalance?.quantity, (beforeBalance?.quantity ?? 0) - 1);
  assert.equal(afterBalance?.reservedQuantity, (beforeBalance?.reservedQuantity ?? 0) - 1);
  assert.equal(inventoryAfterDispatch.movements.length, inventoryBeforeDispatch.movements.length + 1);
  assert.equal(inventoryAfterDispatch.movements.at(-1)?.referenceType, "dispatch");

  const retry = await service.confirm(branchId, {
    orderId: primary.orderId,
    operationId: "packing-primary-confirm",
    packages: [
      { number: "BOX-001", weight: 1.25, description: "Frágil" },
      { number: "BOX-002", weight: 2.5 },
    ],
  });
  assert.equal(retry.idempotent, true);
  assert.deepEqual(inventorySnapshot(store), inventoryAfterDispatch);
  assert.equal((await dispatches.getPackagesByDispatch({ tenantId, branchId }, confirmed.dispatchId)).length, 2);
  await assert.rejects(
    service.confirm(branchId, { orderId: primary.orderId, operationId: "packing-primary-confirm", carrierName: "Changed" }),
    /operation conflict/,
  );

  const rollbackOrder = await prepareOrder(
    orders,
    picking,
    packings,
    "rollback",
    TransportMode.own_fleet,
    DeliveryMethod.home_delivery,
    { emailMode: "send", email: "rollback@example.com" },
  );
  addConflictingNotification(store, rollbackOrder.orderId);
  const rollbackBefore = mutationSnapshot(store);
  await assert.rejects(
    service.confirm(branchId, { orderId: rollbackOrder.orderId, operationId: "packing-rollback", packages: [{ number: "ROLLBACK-1", weight: 1 }] }),
    /notification state conflict/,
  );
  assert.deepEqual(mutationSnapshot(store), rollbackBefore);

  await assert.rejects(
    service.confirm(branchId, { orderId: thirdParty.orderId, operationId: "third-missing", packages: [{ number: "THIRD-1" }] }),
    /carrierName is required/,
  );
  const thirdConfirmed = await service.confirm(branchId, {
    orderId: thirdParty.orderId,
    operationId: "third-confirm",
    carrierName: "Carrier QA",
    trackingNumber: "TRACK-QA",
    packages: [{ number: "THIRD-1" }],
  });
  assert.equal(thirdConfirmed.packages.length, 1);
  assert.equal(thirdConfirmed.trackingNumber, "TRACK-QA");

  const queueAfter = await service.getPreparedQueue(branchId);
  assert.ok(queueAfter.every((item) => item.orderId !== primary.orderId && item.orderId !== thirdParty.orderId));
  assert.equal((await orders.getById(pickup.orderId))?.status, OrderStatus.ready_for_pickup);

  assert.equal(isOrderDeliveryMethodAllowed(OrderSource.ecommerce, DeliveryMethod.home_delivery), true);
  assert.equal(isOrderDeliveryMethodAllowed(OrderSource.mobileApp, DeliveryMethod.home_delivery), true);
  assert.equal(isOrderDeliveryMethodAllowed(OrderSource.pos, DeliveryMethod.home_delivery), true);
  assert.equal(isOrderDeliveryMethodAllowed(OrderSource.ecommerce, DeliveryMethod.store_pickup), false);

  console.log("verify-logistics-packing-trace: PASS A-Y");
  console.log("queue, canonical trace, packages, scope, atomicity, idempotency, transport, inventory and pickup isolation: PASS");
}

async function prepareOrder(
  orders: MockOrderRepository,
  picking: MockPickingRepository,
  packings: MockPackingRepository,
  suffix: string,
  transportMode: TransportMode,
  deliveryMethod = DeliveryMethod.home_delivery,
  notificationContact: OrderNotificationContact = { emailMode: "not_applicable" },
) {
  const order = await orders.create(orderInput(suffix, transportMode, deliveryMethod, notificationContact));
  const pickingOrder = await picking.create({ tenantId, branchId, orderId: order.id, priority: PickingPriority.normal });
  await picking.assign({ tenantId, branchId, pickingOrderId: pickingOrder.id, actorUserId });
  const [line] = await picking.getItems({ tenantId, branchId }, pickingOrder.id);
  assert.ok(line);
  await picking.updateItem({ tenantId, branchId, pickingOrderId: pickingOrder.id, pickingItemId: line.id, pickedQuantity: line.requestedQuantity, operationId: `pick-${suffix}`, performedByUserId: actorUserId });
  const completed = await picking.complete({ tenantId, branchId, pickingOrderId: pickingOrder.id, actorUserId });
  const packing = completed.packing;
  let prepared = await packings.savePreparation({
    tenantId,
    branchId,
    actorUserId,
    packingId: packing.id,
    operationId: `packing-prepare-${suffix}`,
    expectedVersion: packing.version,
    checklist: { packageProtectionChecked: true, documentIncludedChecked: true, recipientVerifiedChecked: true },
    totalWeight: deliveryMethod === DeliveryMethod.home_delivery ? (suffix === "primary" ? 3.75 : 1) : undefined,
    packageCount: deliveryMethod === DeliveryMethod.home_delivery ? (suffix === "primary" ? 2 : 1) : undefined,
  });
  if (deliveryMethod === DeliveryMethod.home_delivery) {
    const generated = await packings.generateLabel({
      tenantId, branchId, actorUserId, packingId: packing.id,
      operationId: `packing-label-${suffix}`, expectedVersion: prepared.packing.version,
    });
    prepared = await packings.registerLabelPrint({
      tenantId, branchId, actorUserId, packingId: packing.id,
      labelGenerationId: generated.packing.labelGenerationId!,
      operationId: `packing-print-${suffix}`, expectedVersion: generated.packing.version,
    });
  }
  await packings.finalize({
    tenantId, branchId, actorUserId, packingId: packing.id,
    operationId: `packing-finalize-${suffix}`, expectedVersion: prepared.packing.version,
  });
  return { orderId: completed.order.id, pickingOrderId: pickingOrder.id };
}

function orderInput(
  suffix: string,
  transportMode: TransportMode,
  deliveryMethod: DeliveryMethod,
  notificationContact: OrderNotificationContact = { emailMode: "not_applicable" },
) {
  return {
    tenantId,
    branchId,
    orderNumber: `LOG-PACK-${suffix}`,
    source: deliveryMethod === DeliveryMethod.home_delivery ? OrderSource.ecommerce : OrderSource.pos,
    customerId: "customer-ana",
    items: [{ id: `pack-item-${suffix}`, productId: "prod-screws", skuSnapshot: "SCREWS", nameSnapshot: "Screws", quantity: 1, unitPrice: 24.99, discount: 0, subtotal: 24.99 }],
    status: OrderStatus.confirmed,
    deliveryMethod,
    transportMode,
    deliveryAddress: deliveryMethod === DeliveryMethod.home_delivery ? { recipientName: "Packing Recipient", recipientPhone: "55550000", line1: "Zona 1", city: "Guatemala", country: "Guatemala" } : undefined,
    storePickupContact:
      deliveryMethod === DeliveryMethod.store_pickup
        ? { recipientName: "Packing Pickup", recipientPhone: "55550001" }
        : undefined,
    notificationContact,
    subtotal: 24.99,
    discountTotal: 0,
    shippingTotal: 0,
    total: 24.99,
    trackingToken: `packing-tracking-${suffix}`,
  };
}

function addQueueContaminants(store: MockDatabaseStore, orderId: string, pickingOrderId: string) {
  store.transact((db) => {
    const order = db.orders.find((item) => item.id === orderId);
    const picking = db.pickingOrders.find((item) => item.id === pickingOrderId);
    const branch = db.branches.find((item) => item.id === branchId);
    assert.ok(order && picking && branch);
    db.orders.push({ ...order, id: "packing-other-branch", branchId: "branch-norte", orderNumber: "LOG-OTHER-BRANCH" });
    db.pickingOrders.push({ ...picking, id: "picking-other-branch", orderId: "packing-other-branch", branchId: "branch-norte" });
    db.branches.push({ ...branch, id: "packing-foreign-branch", tenantId: "packing-foreign-tenant" });
    db.orders.push({ ...order, id: "packing-other-tenant", tenantId: "packing-foreign-tenant", branchId: "packing-foreign-branch", orderNumber: "LOG-OTHER-TENANT" });
    db.pickingOrders.push({ ...picking, id: "picking-other-tenant", orderId: "packing-other-tenant", tenantId: "packing-foreign-tenant", branchId: "packing-foreign-branch" });
  });
}

async function verifyRichTrace(
  store: MockDatabaseStore,
  orders: MockOrderRepository,
  picking: MockPickingRepository,
  traceService: GetLogisticsItemTraceService,
) {
  store.transact((db) => {
    const template = db.products.find((product) => product.id === "prod-screws");
    assert.ok(template);
    db.products.push({
      ...template,
      id: "packing-trace-lot-product",
      sku: "PACK-TRACE-LOT",
      name: "Producto trazable para packing",
      productType: ProductType.physical,
      tracking: { stock: true, lot: true, expiration: true, serial: false },
    });
    db.inventoryBalances.push(
      { id: "packing-trace-balance-a", tenantId, branchId, productId: "packing-trace-lot-product", locationId: "loc-centro-a", quantity: 6, reservedQuantity: 0, updatedAt: "2026-09-14T00:00:00.000Z" },
      { id: "packing-trace-balance-b", tenantId, branchId, productId: "packing-trace-lot-product", locationId: "loc-centro-b", quantity: 4, reservedQuantity: 0, updatedAt: "2026-09-14T00:00:00.000Z" },
    );
    db.stockLots.push(
      { id: "packing-trace-lot-a", tenantId, branchId, productId: "packing-trace-lot-product", locationId: "loc-centro-a", lotNumber: "PACK-LOT-A", expirationDate: "2030-10-01", quantity: 6, createdAt: "2026-09-14T00:00:00.000Z" },
      { id: "packing-trace-lot-b", tenantId, branchId, productId: "packing-trace-lot-product", locationId: "loc-centro-b", lotNumber: "PACK-LOT-B", expirationDate: "2030-12-01", quantity: 4, createdAt: "2026-09-14T00:00:00.000Z" },
    );
  });

  const lotOrder = await orders.create({
    ...orderInput("rich-lot", TransportMode.own_fleet, DeliveryMethod.home_delivery),
    items: [{ id: "packing-trace-lot-item", productId: "packing-trace-lot-product", skuSnapshot: "PACK-TRACE-LOT", nameSnapshot: "Producto trazable para packing", quantity: 10, unitPrice: 1, discount: 0, subtotal: 10 }],
    subtotal: 10,
    total: 10,
  });
  const lotPicking = await pickOrder(orders, picking, lotOrder.id, "packing-trace-lot-pick", 10);
  const lotTrace = await traceService.execute(branchId, { orderId: lotOrder.id, pickingOrderId: lotPicking });
  assert.equal(lotTrace[0]?.allocations.length, 2);
  assert.deepEqual(lotTrace[0]?.allocations.map((item) => item.location?.id).sort(), ["loc-centro-a", "loc-centro-b"]);
  assert.deepEqual(lotTrace[0]?.allocations.map((item) => item.lot?.number).sort(), ["PACK-LOT-A", "PACK-LOT-B"]);
  assert.deepEqual(lotTrace[0]?.allocations.map((item) => item.lot?.expiresAt).sort(), ["2030-10-01", "2030-12-01"]);

  const serialOrder = await orders.create({
    ...orderInput("rich-serial", TransportMode.own_fleet, DeliveryMethod.home_delivery),
    items: [{ id: "packing-trace-serial-item", productId: "prod-drill", skuSnapshot: "DRILL", nameSnapshot: "Taladro", quantity: 1, unitPrice: 1, discount: 0, subtotal: 1 }],
    subtotal: 1,
    total: 1,
  });
  const serialPicking = await pickOrder(orders, picking, serialOrder.id, "packing-trace-serial-pick", 1, ["DRILL-SN-001"]);
  const serialTrace = await traceService.execute(branchId, { orderId: serialOrder.id, pickingOrderId: serialPicking });
  assert.equal(serialTrace[0]?.allocations[0]?.serial?.number, "DRILL-SN-001");
  assert.equal(serialTrace[0]?.allocations[0]?.inventoryMovementId, undefined,
    "Picking selection must not create an outbound movement before Dispatch");
}

async function pickOrder(
  _orders: MockOrderRepository,
  picking: MockPickingRepository,
  orderId: string,
  operationId: string,
  quantity: number,
  serialNumbers?: string[],
) {
  const pickingOrder = await picking.create({ tenantId, branchId, orderId, priority: PickingPriority.normal });
  await picking.assign({ tenantId, branchId, pickingOrderId: pickingOrder.id, actorUserId });
  const [line] = await picking.getItems({ tenantId, branchId }, pickingOrder.id);
  assert.ok(line);
  await picking.updateItem({ tenantId, branchId, pickingOrderId: pickingOrder.id, pickingItemId: line.id, pickedQuantity: quantity, operationId, performedByUserId: actorUserId, serialNumbers });
  await picking.complete({ tenantId, branchId, pickingOrderId: pickingOrder.id, actorUserId });
  return pickingOrder.id;
}

function addConflictingNotification(store: MockDatabaseStore, orderId: string) {
  store.transact((db) => {
    const order = db.orders.find((item) => item.id === orderId);
    assert.ok(order);
    db.notifications.push({
      id: "packing-rollback-notification",
      tenantId,
      channel: NotificationChannel.email,
      type: "dispatch_simulated_email",
      title: "Conflicto de prueba",
      message: "Debe provocar rollback tardío",
      status: NotificationStatus.unread,
      relatedEntityType: "Order",
      relatedEntityId: orderId,
      deliveryStatus: "simulated_sent",
      recipientEmail: "rollback@example.com",
      orderId,
      orderReference: order.orderNumber,
      deduplicationKey: `dispatch-email:${tenantId}:${orderId}`,
      sentAt: "2026-09-14T00:00:00.000Z",
      simulatedDeliveryResult: "accepted",
      createdAt: "2026-09-14T00:00:00.000Z",
    });
  });
}

function prepareDatabase(store: MockDatabaseStore) {
  store.transact((db) => {
    db.orders = [];
    db.orderItems = [];
    db.payments = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.pickingItemUpdateOperations = [];
    db.pickingIncidents = [];
    db.pickingAssignmentReleases = [];
    db.packings = [];
    db.packingOperations = [];
    db.dispatches = [];
    db.packages = [];
    db.notifications = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryMovements = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
      if (balance.id === "bal-screws") balance.quantity = 100;
    });
    const role = db.roles.find((item) => item.id === "role-warehouse");
    assert.ok(role);
    role.permissions = ["logistics.picking.read", "logistics.picking.start", "logistics.picking.complete", "logistics.packing.read", "logistics.packing.prepare", "logistics.packing.finalize", "logistics.dispatch.read", "logistics.dispatch.confirm"];
  });
}

function inventorySnapshot(store: MockDatabaseStore) {
  const db = store.getSnapshot();
  return {
    balances: db.inventoryBalances.map(({ id, quantity, reservedQuantity }) => ({ id, quantity, reservedQuantity })),
    reservations: db.inventoryReservations.map((item) => structuredClone(item)),
    movements: db.inventoryMovements.map((item) => structuredClone(item)),
    lots: db.stockLots.map((item) => structuredClone(item)),
    serials: db.serialNumbers.map((item) => structuredClone(item)),
  };
}

function mutationSnapshot(store: MockDatabaseStore) {
  const db = store.getSnapshot();
  return { dispatches: db.dispatches.map((item) => structuredClone(item)), packages: db.packages.map((item) => structuredClone(item)), orders: db.orders.map(({ id, status }) => ({ id, status })), notifications: db.notifications.map((item) => structuredClone(item)) };
}

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();
  override get<T>(key: string): T | null { const value = this.values.get(key); return value === undefined ? null : JSON.parse(value) as T; }
  override set<T>(key: string, value: T): void { this.values.set(key, JSON.stringify(value)); }
  override remove(key: string): void { this.values.delete(key); }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
