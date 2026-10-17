import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import type { OrderNotificationContact } from "@/core/types/orderNotification.types";
import {
  DeliveryMethod,
  DispatchStatus,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PackingStatus,
  PickingPriority,
  PickingStatus,
  TransportMode,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockDispatchRepository,
  MockNotificationRepository,
  MockOrderRepository,
  MockPackingRepository,
  MockPickingRepository,
  MockPlanRepository,
  MockRoleRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { DispatchAuthorizationError } from "@/modules/logistics/application/services/DispatchAuthorizationContext";
import { toCustomerOrderSummaryDto } from "@/modules/customer/application/dto/CustomerOrderSummaryDto";
import { toCustomerOrderDetailDto } from "@/modules/customer/application/dto/CustomerOrderDetailDto";
import { GetStorefrontOrderTrackingService } from "@/modules/storefront/application/services/GetStorefrontOrderTrackingService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const otherBranchId = "branch-norte";
const actorId = "user-warehouse";

async function main() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  const eventBus = new DataEventBus();
  const dispatchEvents: unknown[] = [];
  const orderEvents: unknown[] = [];
  eventBus.subscribe("dispatch.changed", (event) => dispatchEvents.push(event));
  eventBus.subscribe("order.changed", (event) => orderEvents.push(event));
  prepareDatabase(store);
  const orders = new MockOrderRepository(store, eventBus);
  const picking = new MockPickingRepository(store, eventBus);
  const packings = new MockPackingRepository(store, eventBus);
  const dispatches = new MockDispatchRepository(store, eventBus);
  const notifications = new MockNotificationRepository(store, eventBus);
  const auth = {
    getCurrentSessionId: async () => "dispatch-session",
    getSession: async () => ({
      id: "dispatch-session",
      userId: actorId,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      rememberMe: false,
    }),
  };
  const repositories = {
    auth,
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    dispatches,
    notifications,
    orders,
    packings,
    picking,
    roles: new MockRoleRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
  const service = new DispatchApplicationService(repositories);
  const trackingService = new GetStorefrontOrderTrackingService(repositories);
  const assertPublicStatus = async (orderId: string, expected: string) => {
    const order = await orders.getById(orderId);
    assert.ok(order);
    assert.equal((await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: order.trackingToken }))?.tracking.status, expected);
    assert.equal(toCustomerOrderSummaryDto(order).status, expected);
    assert.equal(toCustomerOrderDetailDto(order).status, expected);
  };

  // Initial status policy is distinct from lifecycle transition ownership.
  assert.equal(
    (await orders.create(orderInput("initial-pending", { status: OrderStatus.pending }))).status,
    OrderStatus.pending,
  );
  const initialConfirmed = await orders.create(orderInput("initial-confirmed", { status: OrderStatus.confirmed }));
  assert.equal(initialConfirmed.status, OrderStatus.confirmed);
  await assertPublicStatus(initialConfirmed.id, "confirmed");
  const unassigned = await orders.create(orderInput("unassigned-picking", {}));
  await picking.create({ tenantId, branchId, orderId: unassigned.id, priority: PickingPriority.normal });
  await assertPublicStatus(unassigned.id, "confirmed");
  const initialPayment = await orders.createWithPayment({
    order: orderInput("initial-payment", { status: OrderStatus.pending }),
    payment: {
      tenantId,
      method: PaymentMethod.card,
      status: PaymentStatus.pending,
      amount: 24.99,
      currency: "GTQ",
    },
  });
  assert.equal(initialPayment.order.status, OrderStatus.pending);
  const beforeRejectedCreation = creationSnapshot(store);
  for (const status of [
    OrderStatus.preparing,
    OrderStatus.picking,
    OrderStatus.packing,
    OrderStatus.ready_for_pickup,
    OrderStatus.ready_for_dispatch,
    OrderStatus.dispatched,
    OrderStatus.delivered,
    OrderStatus.cancelled,
  ]) {
    await assert.rejects(
      orders.create(orderInput(`invalid-initial-${status}`, { status })),
      /not allowed for create/,
    );
  }
  for (const status of Object.values(OrderStatus).filter(
    (candidate) => candidate !== OrderStatus.pending,
  )) {
    await assert.rejects(
      orders.createWithPayment({
        order: orderInput(`invalid-payment-${status}`, { status }),
        payment: {
          tenantId,
          method: PaymentMethod.card,
          status: PaymentStatus.pending,
          amount: 24.99,
          currency: "GTQ",
        },
      }),
      /not allowed for createWithPayment/,
    );
  }
  assert.deepEqual(creationSnapshot(store), beforeRejectedCreation);

  const trackingProgress = await createTrackingProgressOrder(orders, picking);
  const trackingOrder = await orders.getByTrackingToken(tenantId, trackingProgress.trackingToken);
  assert.ok(trackingOrder);
  await assertPublicStatus(trackingOrder.id, "preparing");
  assert.equal(
      (await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: trackingProgress.trackingToken }))?.tracking.status,
    OrderStatus.preparing,
  );
  await picking.updateItem({
    tenantId,
    branchId,
    pickingOrderId: trackingProgress.pickingId,
    pickingItemId: trackingProgress.lineId,
    pickedQuantity: 1,
    operationId: "tracking-first-pick",
    performedByUserId: actorId,
  });
  await assertPublicStatus(trackingOrder.id, "preparing");
  assert.equal(
    (await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: trackingProgress.trackingToken }))?.tracking.status,
    OrderStatus.preparing,
  );

  // E-H, I. Taking and first physical pick update Order in the same repository transaction.
  const thirdParty = await prepareOrder(orders, picking, packings, "third", {
    deliveryMethod: DeliveryMethod.home_delivery,
    transportMode: TransportMode.third_party,
    notificationContact: { emailMode: "send", email: "shipment@example.com" },
  });
  assert.equal(thirdParty.statusAfterAssign, OrderStatus.preparing);
  assert.equal(thirdParty.assignmentRetryIdempotent, true);
  assert.equal(thirdParty.statusAfterFirstPick, OrderStatus.picking);
  assert.equal(thirdParty.completed.status, OrderStatus.ready_for_dispatch);
  await assertPublicStatus(thirdParty.completed.id, "preparing");
  assert.equal(
    (await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: thirdParty.completed.trackingToken }))?.tracking.status,
    OrderStatus.preparing,
  );

  const pickup = await prepareOrder(orders, picking, packings, "pickup", {
    deliveryMethod: DeliveryMethod.store_pickup,
    transportMode: TransportMode.customer,
    notificationContact: { emailMode: "not_applicable" },
  });
  assert.equal(pickup.completed.status, OrderStatus.ready_for_pickup);
  await assert.rejects(
    orders.updateStatus(pickup.completed.id, OrderStatus.dispatched),
    /not owned/,
  );
  await assert.rejects(
    service.confirm(branchId, { orderId: pickup.completed.id, operationId: "dispatch-pickup" }),
    /not found|not dispatchable|not ready/i,
  );

  const immediate = await createAndPick(orders, picking, "immediate", {
    deliveryMethod: DeliveryMethod.immediate,
    transportMode: TransportMode.none,
  });
  await assert.rejects(
    picking.complete({
      tenantId,
      branchId,
      pickingOrderId: immediate.pickingId,
      actorUserId: actorId,
    }),
    /cannot complete delivery method/,
  );
  await assert.rejects(
    service.confirm(branchId, { orderId: immediate.order.id, operationId: "dispatch-immediate" }),
    /not dispatchable/,
  );

  // Generic status updates cannot bypass Picking or Dispatch. Legacy packing remains readable.
  const illegal = await orders.create(orderInput("illegal", {}));
  await assert.rejects(orders.updateStatus(illegal.id, OrderStatus.dispatched), /not owned/);
  const pending = await orders.create(orderInput("pending", { status: OrderStatus.pending }));
  await assert.rejects(
    orders.updateStatus(pending.id, OrderStatus.ready_for_dispatch),
    /not owned/,
  );
  await assert.rejects(orders.updateStatus(pending.id, OrderStatus.delivered), /not owned/);
  store.transact((db) => {
    const candidate = db.orders.find((item) => item.id === illegal.id);
    assert.ok(candidate);
    candidate.status = OrderStatus.packing;
  });
  assert.equal((await orders.getById(illegal.id))?.status, OrderStatus.packing);

  // Queue/detail project recipientPhone and exclude other branch/tenant fixtures.
  addIsolatedPreparedFixtures(store, thirdParty.completed.id, thirdParty.pickingId);
  const queue = await service.getPreparedQueue(branchId);
  assert.ok(queue.some((item) => item.orderId === thirdParty.completed.id));
  assert.ok(queue.every((item) => item.orderId !== "order-foreign"));
  assert.ok(queue.every((item) => item.orderId !== "order-other-branch"));
  const preparedDetail = await service.getPreparedDetail(branchId, thirdParty.completed.id);
  assert.equal(preparedDetail.recipientPhone, "55550000");
  assert.equal(preparedDetail.notificationContact.emailMode, "send");
  await assert.rejects(service.getPreparedQueue(otherBranchId), DispatchAuthorizationError);
  await assert.rejects(
    service.confirm(branchId, { orderId: "order-other-branch", operationId: "cross-branch" }),
    /authorized dispatch scope/,
  );

  // L-O, T-Z, AF-AG. Dispatch owns the atomic/idempotent stock mutation.
  await assert.rejects(
    service.confirm(branchId, {
      orderId: thirdParty.completed.id,
      operationId: "missing-carrier",
      trackingNumber: "TRACK-1",
    }),
    /carrierName is required/,
  );
  await assert.rejects(
    service.confirm(branchId, {
      orderId: thirdParty.completed.id,
      operationId: "missing-tracking",
      carrierName: "Carrier",
    }),
    /trackingNumber is required/,
  );
  store.transact((db) => {
    const customer = db.customers.find((item) => item.id === "customer-ana");
    assert.ok(customer);
    customer.email = "mutable-address-changed@example.com";
  });
  const inventoryBefore = inventorySnapshot(store);
  const confirmed = await service.confirm(branchId, {
    orderId: thirdParty.completed.id,
    operationId: "dispatch-third-party",
    carrierName: "  Carrier QA  ",
    trackingNumber: "  TRACK-001  ",
  });
  assert.equal(confirmed.orderStatus, OrderStatus.dispatched);
  assert.equal(confirmed.dispatchStatus, DispatchStatus.dispatched);
  assert.equal(confirmed.carrierName, "Carrier QA");
  assert.equal(confirmed.trackingNumber, "TRACK-001");
  assert.equal(confirmed.notificationStatus, "simulated_sent");
  assert.equal(confirmed.notification?.recipientEmail, "shipment@example.com");
  await assertPublicStatus(thirdParty.completed.id, "sent");
  assert.equal(
    (await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: thirdParty.completed.trackingToken }))?.tracking.status,
    "sent",
  );
  const inventoryAfter = inventorySnapshot(store);
  assert.equal(inventoryAfter.movementCount, inventoryBefore.movementCount + 1);
  assert.equal(inventoryAfter.balances.find((item) => item.id === "bal-screws")?.quantity,
    (inventoryBefore.balances.find((item) => item.id === "bal-screws")?.quantity ?? 0) - 1);
  const retry = await service.confirm(branchId, {
    orderId: thirdParty.completed.id,
    operationId: "dispatch-third-party",
    carrierName: "Carrier QA",
    trackingNumber: "TRACK-001",
  });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.dispatchId, confirmed.dispatchId);
  assert.equal(
    store.getSnapshot().notifications.filter((item) => item.dispatchId === confirmed.dispatchId)
      .length,
    1,
  );
  await assert.rejects(
    service.confirm(branchId, {
      orderId: thirdParty.completed.id,
      operationId: "dispatch-third-party",
      carrierName: "Other Carrier",
      trackingNumber: "TRACK-001",
    }),
    /operation conflict/,
  );

  const deliveryInventoryBefore = inventorySnapshot(store);
  const notificationCountBeforeDelivery = store.getSnapshot().notifications.length;
  const dispatchEventsBeforeDelivery = dispatchEvents.length;
  const orderEventsBeforeDelivery = orderEvents.length;
  const delivered = await service.markDelivered(branchId, {
    orderId: thirdParty.completed.id,
  });
  assert.equal(delivered.orderStatus, OrderStatus.delivered);
  assert.equal(delivered.dispatchStatus, DispatchStatus.delivered);
  assert.ok(delivered.deliveredAt);
  assert.equal(delivered.idempotent, false);
  assert.equal(dispatchEvents.length, dispatchEventsBeforeDelivery + 1);
  assert.equal(orderEvents.length, orderEventsBeforeDelivery + 1);
  const deliveredRetry = await service.markDelivered(branchId, {
    orderId: thirdParty.completed.id,
  });
  assert.equal(deliveredRetry.idempotent, true);
  assert.equal(deliveredRetry.dispatchId, delivered.dispatchId);
  assert.equal(dispatchEvents.length, dispatchEventsBeforeDelivery + 1);
  assert.equal(orderEvents.length, orderEventsBeforeDelivery + 1);
  assert.equal(
    store.getSnapshot().dispatches.filter((item) => item.orderId === thirdParty.completed.id)
      .length,
    1,
  );
  assert.deepEqual(inventorySnapshot(store), deliveryInventoryBefore);
  assert.equal(store.getSnapshot().notifications.length, notificationCountBeforeDelivery);
  const persistedDeliveredDispatch = store
    .getSnapshot()
    .dispatches.find((item) => item.id === delivered.dispatchId);
  assert.equal(persistedDeliveredDispatch?.carrierName, "Carrier QA");
  assert.equal(persistedDeliveredDispatch?.trackingNumber, "TRACK-001");
  assert.equal(
      (await trackingService.execute({ tenantSlug: publicStorefrontSlug, trackingToken: thirdParty.completed.trackingToken }))?.tracking.status,
    OrderStatus.delivered,
  );
  await assert.rejects(
    service.markDelivered(branchId, {
      orderId: thirdParty.completed.id,
      carrierName: "Mutation denied",
    } as Parameters<DispatchApplicationService["markDelivered"]>[1]),
    /cannot modify dispatch shipment data/,
  );
  await assert.rejects(
    dispatches.markDelivered({
      tenantId: "tenant-foreign",
      branchId,
      actorUserId: actorId,
      orderId: thirdParty.completed.id,
    }),
    /actor not found|not found for authorized delivery scope/,
  );
  await assert.rejects(
    service.markDelivered(otherBranchId, { orderId: thirdParty.completed.id }),
    DispatchAuthorizationError,
  );

  const notDispatched = await prepareOrder(orders, picking, packings, "delivery-not-dispatched", {
    transportMode: TransportMode.own_fleet,
  });
  await assert.rejects(
    service.markDelivered(branchId, { orderId: notDispatched.completed.id }),
    /Canonical Dispatch not found/,
  );
  store.transact((db) => {
    const order = db.orders.find((item) => item.id === notDispatched.completed.id);
    assert.ok(order);
    order.status = OrderStatus.dispatched;
    const now = "2026-09-13T00:00:00.000Z";
    db.dispatches.push({
      id: "pending-delivery-dispatch",
      tenantId,
      branchId,
      orderId: order.id,
      status: DispatchStatus.pending,
      transportMode: order.transportMode,
      createdAt: now,
      updatedAt: now,
    });
  });
  await assert.rejects(
    service.markDelivered(branchId, { orderId: notDispatched.completed.id }),
    /Dispatch is not dispatched/,
  );

  const ownFleet = await prepareOrder(orders, picking, packings, "fleet", {
    transportMode: TransportMode.own_fleet,
    notificationContact: { emailMode: "not_applicable" },
  });
  const fleetResult = await service.confirm(branchId, {
    orderId: ownFleet.completed.id,
    operationId: "dispatch-fleet",
  });
  assert.equal(fleetResult.trackingNumber, null);
  assert.equal(fleetResult.notificationStatus, "not_applicable");
  assert.equal(fleetResult.notification, null);

  for (const transportMode of [TransportMode.none, TransportMode.customer]) {
    const unsupported = await prepareOrder(
      orders,
      picking,
      packings,
      `unsupported-${transportMode}`,
      {
        transportMode,
      },
    );
    await assert.rejects(
      service.confirm(branchId, {
        orderId: unsupported.completed.id,
        operationId: `dispatch-unsupported-${transportMode}`,
      }),
      /transport mode is not dispatchable/,
    );
  }

  const legacy = await prepareOrder(orders, picking, packings, "legacy", {
    transportMode: TransportMode.own_fleet,
  });
  const legacyResult = await service.confirm(branchId, {
    orderId: legacy.completed.id,
    operationId: "dispatch-legacy",
  });
  assert.equal(legacyResult.notificationStatus, "legacy_unknown_skipped");
  assert.equal(legacyResult.notification, null);

  // Dispatch before completion and with pending reservations fails closed.
  const beforePicking = await orders.create(orderInput("before-picking", {}));
  const beforePickingRecord = await picking.create({
    tenantId,
    branchId,
    orderId: beforePicking.id,
    priority: PickingPriority.normal,
  });
  store.transact((db) => {
    const order = db.orders.find((item) => item.id === beforePicking.id);
    assert.ok(order);
    order.status = OrderStatus.ready_for_dispatch;
  });
  await assert.rejects(
    service.confirm(branchId, { orderId: beforePicking.id, operationId: "too-early" }),
    /Packing not found/,
  );
  store.transact((db) => {
    const record = db.pickingOrders.find((item) => item.id === beforePickingRecord.id);
    assert.ok(record);
    record.status = PickingStatus.completed;
    record.completedAt = "2026-09-13T00:00:00.000Z";
    db.packings.push({
      id: "packing-pending-reservation",
      tenantId,
      branchId,
      orderId: beforePicking.id,
      pickingOrderId: record.id,
      status: PackingStatus.finalized,
      checklist: {
        packageProtectionChecked: true,
        documentIncludedChecked: true,
        recipientVerifiedChecked: true,
      },
      totalWeight: 1,
      packageCount: 1,
      labelGenerationId: "pending-reservation-label",
      labelCode: "PENDING-RESERVATION",
      labelGeneratedAt: "2026-09-13T00:00:00.000Z",
      labelPrintedAt: "2026-09-13T00:00:00.000Z",
      startedByUserId: actorId,
      finalizedByUserId: actorId,
      startedAt: "2026-09-13T00:00:00.000Z",
      finalizedAt: "2026-09-13T00:00:00.000Z",
      version: 1,
      createdAt: "2026-09-13T00:00:00.000Z",
      updatedAt: "2026-09-13T00:00:00.000Z",
    });
  });
  await assert.rejects(
    service.confirm(branchId, { orderId: beforePicking.id, operationId: "pending-reservation" }),
    /Picking item is incomplete/,
  );

  assert.equal(await notifications.getByDispatch("tenant-foreign", confirmed.dispatchId), null);
  const detail = await service.getDispatchDetail(branchId, thirdParty.completed.id);
  assert.equal(detail.dispatch?.id, confirmed.dispatchId);
  assert.equal(detail.recipientPhone, "55550000");
  assert.equal(detail.dispatch?.deliveredAt, delivered.deliveredAt);
  store.transact((db) => {
    const dispatch = db.dispatches.find((item) => item.id === confirmed.dispatchId);
    assert.ok(dispatch);
    db.dispatches.push({ ...dispatch, id: "duplicate-dispatch-fixture" });
  });
  await assert.rejects(
    service.confirm(branchId, {
      orderId: thirdParty.completed.id,
      operationId: "duplicate-check",
      carrierName: "Carrier QA",
      trackingNumber: "TRACK-001",
    }),
    /Duplicate Dispatch records/,
  );

  const persistence = new MemoryStorageAdapter();
  const persistedStore = new MockDatabaseStore(persistence);
  persistedStore.transact((db) => {
    db.orders.push({ ...thirdParty.completed, id: "persisted-without-reset" });
  });
  assert.ok(
    new MockDatabaseStore(persistence)
      .getSnapshot()
      .orders.some((order) => order.id === "persisted-without-reset"),
  );

  console.log("verify-dispatch-shared-contracts: PASS");
  console.log(
    "initial-state policy, public status, picking, atomic dispatch inventory, delivery, scope and notification: PASS",
  );
}

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

function prepareDatabase(store: MockDatabaseStore) {
  store.transact((db) => {
    db.orders = [];
    db.payments = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.pickingItemUpdateOperations = [];
    db.pickingIncidents = [];
    db.pickingAssignmentReleases = [];
    db.dispatches = [];
    db.notifications = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryMovements = [];
    db.packings = [];
    db.packingOperations = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
      if (balance.id === "bal-screws") balance.quantity = 100;
    });
    const role = db.roles.find((item) => item.id === "role-warehouse");
    assert.ok(role);
    role.permissions = [
      "logistics.picking.read",
      "logistics.picking.start",
      "logistics.picking.complete",
      "logistics.packing.read",
      "logistics.packing.prepare",
      "logistics.packing.finalize",
      "logistics.dispatch.read",
      "logistics.dispatch.confirm",
    ];
  });
}

async function prepareOrder(
  orders: MockOrderRepository,
  picking: MockPickingRepository,
  packings: MockPackingRepository,
  suffix: string,
  options: {
    deliveryMethod?: DeliveryMethod;
    transportMode?: TransportMode;
    notificationContact?: OrderNotificationContact;
  },
) {
  const picked = await createAndPick(orders, picking, suffix, options);
  const completed = await picking.complete({
    tenantId,
    branchId,
    pickingOrderId: picked.pickingId,
    actorUserId: actorId,
  });
  let prepared = await packings.savePreparation({
    tenantId,
    branchId,
    actorUserId: actorId,
    packingId: completed.packing.id,
    operationId: `dispatch-packing-prepare-${suffix}`,
    expectedVersion: completed.packing.version,
    checklist: {
      packageProtectionChecked: true,
      documentIncludedChecked: true,
      recipientVerifiedChecked: true,
    },
    totalWeight: completed.order.deliveryMethod === DeliveryMethod.home_delivery ? 1 : undefined,
    packageCount: completed.order.deliveryMethod === DeliveryMethod.home_delivery ? 1 : undefined,
  });
  if (completed.order.deliveryMethod === DeliveryMethod.home_delivery) {
    const generated = await packings.generateLabel({
      tenantId,
      branchId,
      actorUserId: actorId,
      packingId: completed.packing.id,
      operationId: `dispatch-packing-label-${suffix}`,
      expectedVersion: prepared.packing.version,
    });
    prepared = await packings.registerLabelPrint({
      tenantId,
      branchId,
      actorUserId: actorId,
      packingId: completed.packing.id,
      labelGenerationId: generated.packing.labelGenerationId!,
      operationId: `dispatch-packing-print-${suffix}`,
      expectedVersion: generated.packing.version,
    });
  }
  const finalized = await packings.finalize({
    tenantId,
    branchId,
    actorUserId: actorId,
    packingId: completed.packing.id,
    operationId: `dispatch-packing-finalize-${suffix}`,
    expectedVersion: prepared.packing.version,
  });
  return { ...picked, completed: finalized.order };
}

async function createTrackingProgressOrder(
  orders: MockOrderRepository,
  picking: MockPickingRepository,
) {
  const order = await orders.create(orderInput("tracking-progress", {}));
  const pickingOrder = await picking.create({
    tenantId,
    branchId,
    orderId: order.id,
    priority: PickingPriority.normal,
  });
  await picking.assign({
    tenantId,
    branchId,
    pickingOrderId: pickingOrder.id,
    actorUserId: actorId,
  });
  const line = (await picking.getItems({ tenantId, branchId }, pickingOrder.id))[0];
  assert.ok(line);
  return { trackingToken: order.trackingToken, pickingId: pickingOrder.id, lineId: line.id };
}

async function createAndPick(
  orders: MockOrderRepository,
  picking: MockPickingRepository,
  suffix: string,
  options: {
    deliveryMethod?: DeliveryMethod;
    transportMode?: TransportMode;
    notificationContact?: OrderNotificationContact;
  },
) {
  const order = await orders.create(orderInput(suffix, options));
  const pickingOrder = await picking.create({
    tenantId,
    branchId,
    orderId: order.id,
    priority: PickingPriority.normal,
  });
  await picking.assign({
    tenantId,
    branchId,
    pickingOrderId: pickingOrder.id,
    actorUserId: actorId,
  });
  const statusAfterAssign = (await orders.getById(order.id))?.status;
  const assignmentRetry = await picking.assign({
    tenantId,
    branchId,
    pickingOrderId: pickingOrder.id,
    actorUserId: actorId,
  });
  const line = (await picking.getItems({ tenantId, branchId }, pickingOrder.id))[0];
  assert.ok(line);
  await picking.updateItem({
    tenantId,
    branchId,
    pickingOrderId: pickingOrder.id,
    pickingItemId: line.id,
    pickedQuantity: line.requestedQuantity,
    operationId: `pick-${suffix}`,
    performedByUserId: actorId,
  });
  return {
    order,
    pickingId: pickingOrder.id,
    statusAfterAssign,
    assignmentRetryIdempotent: assignmentRetry.idempotent,
    statusAfterFirstPick: (await orders.getById(order.id))?.status,
  };
}

function orderInput(
  suffix: string,
  options: {
    status?: OrderStatus;
    deliveryMethod?: DeliveryMethod;
    transportMode?: TransportMode;
    notificationContact?: OrderNotificationContact;
  },
) {
  const deliveryMethod = options.deliveryMethod ?? DeliveryMethod.home_delivery;
  return {
    tenantId,
    branchId,
    orderNumber: `WEB-DISPATCH-${suffix}`,
    source:
      deliveryMethod === DeliveryMethod.home_delivery ? OrderSource.ecommerce : OrderSource.pos,
    customerId: "customer-ana",
    items: [
      {
        id: `dispatch-item-${suffix}`,
        productId: "prod-screws",
        skuSnapshot: "SCREWS",
        nameSnapshot: "Screws",
        quantity: 1,
        unitPrice: 24.99,
        discount: 0,
        subtotal: 24.99,
      },
    ],
    status: options.status ?? OrderStatus.confirmed,
    deliveryMethod,
    transportMode: options.transportMode ?? TransportMode.own_fleet,
    deliveryAddress:
      deliveryMethod === DeliveryMethod.home_delivery
        ? {
            recipientName: "Dispatch Recipient",
            recipientPhone: "55550000",
            line1: "Zona 1",
            city: "Guatemala",
            country: "Guatemala",
          }
        : undefined,
    storePickupContact:
      deliveryMethod === DeliveryMethod.store_pickup
        ? {
            recipientName: "Dispatch Pickup",
            recipientPhone: "55550001",
          }
        : undefined,
    notificationContact: options.notificationContact,
    subtotal: 24.99,
    discountTotal: 0,
    shippingTotal: 0,
    total: 24.99,
    trackingToken: `dispatch-tracking-${suffix}`,
  };
}

function inventorySnapshot(store: MockDatabaseStore) {
  const snapshot = store.getSnapshot();
  return {
    balances: snapshot.inventoryBalances.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      reservedQuantity: item.reservedQuantity,
    })),
    reservations: snapshot.inventoryReservations.map((item) => structuredClone(item)),
    movementCount: snapshot.inventoryMovements.length,
    lots: snapshot.stockLots.map((item) => structuredClone(item)),
    serials: snapshot.serialNumbers.map((item) => structuredClone(item)),
  };
}

function creationSnapshot(store: MockDatabaseStore) {
  const snapshot = store.getSnapshot();
  return {
    orderIds: snapshot.orders.map((item) => item.id),
    paymentIds: snapshot.payments.map((item) => item.id),
    reservationIds: snapshot.inventoryReservations.map((item) => item.id),
    reservedQuantities: snapshot.inventoryBalances.map((item) => ({
      id: item.id,
      reservedQuantity: item.reservedQuantity,
    })),
  };
}

function addIsolatedPreparedFixtures(store: MockDatabaseStore, orderId: string, pickingId: string) {
  store.transact((db) => {
    const order = db.orders.find((item) => item.id === orderId);
    const picking = db.pickingOrders.find((item) => item.id === pickingId);
    assert.ok(order && picking);
    db.orders.push({ ...order, id: "order-other-branch", branchId: otherBranchId });
    db.pickingOrders.push({
      ...picking,
      id: "picking-other-branch",
      orderId: "order-other-branch",
      branchId: otherBranchId,
    });
    const foreignBranch = { ...db.branches[0], id: "branch-foreign", tenantId: "tenant-foreign" };
    db.branches.push(foreignBranch);
    db.orders.push({
      ...order,
      id: "order-foreign",
      tenantId: "tenant-foreign",
      branchId: foreignBranch.id,
    });
    db.pickingOrders.push({
      ...picking,
      id: "picking-foreign",
      tenantId: "tenant-foreign",
      branchId: foreignBranch.id,
      orderId: "order-foreign",
    });
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
