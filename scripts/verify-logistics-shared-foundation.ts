import assert from "node:assert/strict";
import type { CreateOrderInput } from "@/core/repositories";
import {
  DeliveryMethod,
  InventoryMovementType,
  InventoryReservationStatus,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PickingItemStatus,
  PickingPriority,
  PickingStatus,
  ProductType,
  SerialStatus,
  TransportMode,
} from "@/core/enums";
import { isOrderDeliveryMethodAllowed } from "@/core/orders/orderDeliveryPolicy";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPickingRepository } from "@/infrastructure/mock/repositories/MockPickingRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockStorePickupDeliveryRepository } from "@/infrastructure/mock/repositories/MockStorePickupDeliveryRepository";
import {
  getEligibleStockLots,
  planStockLotConsumption,
} from "@/infrastructure/mock/repositories/stockLotMutations";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import { GetLogisticsItemTraceService } from "@/modules/logistics/application/services/GetLogisticsItemTraceService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const actorUserId = "user-warehouse";
const now = "2026-09-14T12:00:00.000Z";

async function main() {
  await verifyChannelPolicy();
  await verifyBranchQuery();
  await verifyStorePickupDelivery();
  await verifyFulfillmentTrace();
  await verifyCanonicalMultiAllocationTrace();
  await verifySerialConcurrency();
  console.log("verify-logistics-shared-foundation: PASS");
  console.log(
    "channel policy, branch scope, store pickup, trace, FEFO, serial, kit and service: PASS",
  );
}

async function verifyChannelPolicy() {
  assert.equal(
    isOrderDeliveryMethodAllowed(OrderSource.ecommerce, DeliveryMethod.home_delivery),
    true,
  );
  assert.equal(
    isOrderDeliveryMethodAllowed(OrderSource.mobileApp, DeliveryMethod.home_delivery),
    true,
  );
  assert.equal(isOrderDeliveryMethodAllowed(OrderSource.pos, DeliveryMethod.immediate), true);
  assert.equal(isOrderDeliveryMethodAllowed(OrderSource.pos, DeliveryMethod.store_pickup), true);
  assert.equal(isOrderDeliveryMethodAllowed(OrderSource.pos, DeliveryMethod.home_delivery), true);
  assert.equal(
    isOrderDeliveryMethodAllowed(OrderSource.ecommerce, DeliveryMethod.store_pickup),
    false,
  );
  assert.equal(
    isOrderDeliveryMethodAllowed(OrderSource.ecommerce, DeliveryMethod.immediate),
    false,
  );
  assert.equal(
    isOrderDeliveryMethodAllowed(OrderSource.mobileApp, DeliveryMethod.store_pickup),
    false,
  );
  assert.equal(
    isOrderDeliveryMethodAllowed(OrderSource.mobileApp, DeliveryMethod.immediate),
    false,
  );

  const store = createStore();
  const orders = new MockOrderRepository(store, new DataEventBus());
  const valid = [
    [OrderSource.ecommerce, DeliveryMethod.home_delivery],
    [OrderSource.mobileApp, DeliveryMethod.home_delivery],
    [OrderSource.pos, DeliveryMethod.home_delivery],
    [OrderSource.pos, DeliveryMethod.store_pickup],
    [OrderSource.pos, DeliveryMethod.immediate],
  ] as const;
  for (const [source, method] of valid) {
    const created = await orders.create(orderInput(`valid-${source}-${method}`, source, method));
    assert.equal(created.source, source);
    assert.equal(created.deliveryMethod, method);
  }
  const pickingCount = store.getSnapshot().pickingOrders.length;
  const immediate = store
    .getSnapshot()
    .orders.find((order) => order.trackingToken.includes("valid-pos-immediate"));
  assert.ok(immediate);
  assert.equal(
    store.getSnapshot().pickingOrders.some((picking) => picking.orderId === immediate.id),
    false,
  );
  assert.equal(store.getSnapshot().pickingOrders.length, pickingCount);

  const invalid = [
    [OrderSource.ecommerce, DeliveryMethod.store_pickup],
    [OrderSource.ecommerce, DeliveryMethod.immediate],
    [OrderSource.mobileApp, DeliveryMethod.store_pickup],
    [OrderSource.mobileApp, DeliveryMethod.immediate],
  ] as const;
  for (const [source, method] of invalid) {
    const before = mutationCounts(store);
    await assert.rejects(
      orders.create(orderInput(`invalid-${source}-${method}`, source, method)),
      /not allowed for source/,
    );
    assert.deepEqual(mutationCounts(store), before);
  }

  const beforePaymentBoundary = mutationCounts(store);
  const invalidPaymentOrder = orderInput(
    "invalid-payment-boundary",
    OrderSource.ecommerce,
    DeliveryMethod.store_pickup,
  );
  await assert.rejects(
    orders.createWithPayment({
      order: invalidPaymentOrder,
      payment: {
        tenantId,
        method: PaymentMethod.card,
        status: PaymentStatus.pending,
        amount: invalidPaymentOrder.total,
        currency: "GTQ",
      },
    }),
    /not allowed for source/,
  );
  assert.deepEqual(mutationCounts(store), beforePaymentBoundary);
}

async function verifyBranchQuery() {
  const store = createStore();
  const eventBus = new DataEventBus();
  const orders = new MockOrderRepository(store, eventBus);
  const events: Array<{ tenantId?: string; branchId?: string; orderId?: string }> = [];
  eventBus.subscribe("order.changed", (payload) => events.push(payload ?? {}));
  const created = await orders.create(
    orderInput("branch-query", OrderSource.pos, DeliveryMethod.store_pickup),
  );
  const branchOrders = await orders.listByBranch(tenantId, branchId);
  assert.ok(branchOrders.some((order) => order.id === created.id));
  assert.ok(
    branchOrders.every((order) => order.tenantId === tenantId && order.branchId === branchId),
  );
  assert.ok(
    events.some(
      (event) =>
        event.tenantId === tenantId && event.branchId === branchId && event.orderId === created.id,
    ),
  );
  await assert.rejects(orders.listByBranch("tenant-foreign", branchId), /Branch not found/);
  await assert.rejects(orders.listByBranch(tenantId, ""), /required/);
}

async function verifyStorePickupDelivery() {
  const store = createStore();
  prepareStorePickupFixtures(store);
  const eventBus = new DataEventBus();
  const events: Array<{ tenantId?: string; branchId?: string; orderId?: string }> = [];
  eventBus.subscribe("order.changed", (payload) => events.push(payload ?? {}));
  const repository = new MockStorePickupDeliveryRepository(store, eventBus);
  const movementCount = store.getSnapshot().inventoryMovements.length;
  const input = {
    tenantId,
    branchId,
    actorUserId,
    orderId: "order-pickup-ready",
    operationId: "pickup-confirm-001",
  };
  const confirmed = await repository.confirm(input);
  assert.equal(confirmed.order.status, OrderStatus.delivered);
  assert.equal(confirmed.delivery.confirmedByUserId, actorUserId);
  assert.equal(confirmed.idempotent, false);
  assert.ok(confirmed.delivery.deliveredAt);
  assert.equal(store.getSnapshot().inventoryMovements.length, movementCount);
  assert.equal(events.length, 1);
  assert.deepEqual(
    {
      tenantId: events[0]?.tenantId,
      branchId: events[0]?.branchId,
      orderId: events[0]?.orderId,
    },
    { tenantId, branchId, orderId: input.orderId },
  );

  const retry = await repository.confirm(input);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.delivery.id, confirmed.delivery.id);
  assert.equal(retry.delivery.deliveredAt, confirmed.delivery.deliveredAt);
  assert.equal(events.length, 1);
  assert.equal(store.getSnapshot().inventoryMovements.length, movementCount);
  await assert.rejects(
    repository.confirm({ ...input, actorUserId: "user-cashier" }),
    /retry state conflict/,
  );
  await assert.rejects(
    repository.confirm({ ...input, operationId: "pickup-confirm-other" }),
    /already delivered/,
  );
  await assert.rejects(
    repository.confirm({
      ...input,
      orderId: "order-pickup-ready-two",
    }),
    /operation conflict/,
  );
  await assert.rejects(
    repository.confirm({
      ...input,
      orderId: "order-home-ready",
      operationId: "pickup-home",
    }),
    /not a store pickup/,
  );
  await assert.rejects(
    repository.confirm({
      ...input,
      orderId: "order-pickup-wrong-status",
      operationId: "pickup-wrong-status",
    }),
    /not ready/,
  );
  await assert.rejects(
    repository.confirm({ ...input, branchId: "branch-norte", operationId: "pickup-branch" }),
    /not found/,
  );
  await assert.rejects(
    repository.confirm({ ...input, tenantId: "tenant-foreign", operationId: "pickup-tenant" }),
    /not found/,
  );
  await assert.rejects(
    repository.confirm({
      ...input,
      orderId: "order-pickup-invalid-actor",
      operationId: "pickup-invalid-actor",
      actorUserId: "missing-user",
    }),
    /actor not found/,
  );

  const rollbackRepository = new MockStorePickupDeliveryRepository(store, eventBus, {
    afterDeliveryCreated: () => {
      throw new Error("simulated store pickup rollback");
    },
  });
  const beforeRollback = store.getSnapshot();
  await assert.rejects(
    rollbackRepository.confirm({
      ...input,
      orderId: "order-pickup-rollback",
      operationId: "pickup-rollback",
    }),
    /simulated store pickup rollback/,
  );
  const afterRollback = store.getSnapshot();
  assert.equal(
    afterRollback.orders.find((order) => order.id === "order-pickup-rollback")?.status,
    OrderStatus.ready_for_pickup,
  );
  assert.equal(
    afterRollback.storePickupDeliveries.length,
    beforeRollback.storePickupDeliveries.length,
  );
  assert.equal(afterRollback.inventoryMovements.length, beforeRollback.inventoryMovements.length);
}

async function verifyFulfillmentTrace() {
  const store = createStore();
  prepareTraceFixtures(store);
  const inventory = new MockInventoryRepository(store, new DataEventBus());
  const trace = await inventory.getPickingFulfillmentTrace({
    tenantId,
    branchId,
    orderId: "order-trace",
    pickingOrderId: "picking-trace",
  });
  assert.equal(trace.length, 5);
  const normal = requiredTrace(trace, "trace-normal");
  assert.equal(normal.requestedQuantity, 10);
  assert.equal(normal.pickedQuantity, 10);
  assert.deepEqual(
    normal.allocations.map((item) => item.quantity),
    [6, 4],
  );
  assert.deepEqual(
    normal.allocations.map((item) => item.location?.id),
    ["loc-centro-a", "loc-centro-b"],
  );

  const lot = requiredTrace(trace, "trace-lot");
  assert.deepEqual(
    lot.allocations.map((item) => item.lot?.id),
    ["trace-lot-a", "trace-lot-b"],
  );
  assert.deepEqual(
    lot.allocations.map((item) => item.lot?.expiresAt),
    ["2026-10-01", "2026-12-01"],
  );
  assert.ok(lot.allocations.every((item) => item.inventoryMovementId?.startsWith("movement-trace")));

  const serial = requiredTrace(trace, "trace-serial");
  assert.equal(serial.allocations[0]?.serial?.number, "TRACE-SERIAL-001");
  const lotSerial = requiredTrace(trace, "trace-lot-serial");
  assert.equal(lotSerial.allocations[0]?.lot?.id, "trace-lot-serial-a");
  assert.equal(lotSerial.allocations[0]?.serial?.number, "TRACE-LOT-SERIAL-001");
  const kitComponent = requiredTrace(trace, "trace-kit-component");
  assert.equal(kitComponent.orderItemId, "order-item-trace-kit");
  assert.equal(
    trace.some((item) => item.productId === "trace-kit"),
    false,
  );
  assert.equal(
    trace.some((item) => item.productId === "trace-service"),
    false,
  );

  const eventBus = new DataEventBus();
  const traceService = new GetLogisticsItemTraceService({
    auth: {
      getCurrentSessionId: async () => "session-logistics-trace",
      getSession: async () => ({
        id: "session-logistics-trace",
        userId: actorUserId,
        createdAt: now,
        expiresAt: "2099-01-01T00:00:00.000Z",
        rememberMe: false,
      }),
    },
    branches: new MockBranchRepository(store, eventBus),
    inventory,
    products: new MockProductRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry);
  const projectedTrace = await traceService.execute(branchId, {
    orderId: "order-trace",
    pickingOrderId: "picking-trace",
  });
  assert.equal(projectedTrace.length, trace.length);
  assert.ok(projectedTrace.every((item) => item.sku && item.name));

  await assert.rejects(
    inventory.getPickingFulfillmentTrace({
      tenantId,
      branchId: "branch-norte",
      orderId: "order-trace",
      pickingOrderId: "picking-trace",
    }),
    /Order not found/,
  );
  await assert.rejects(
    inventory.getPickingFulfillmentTrace({
      tenantId: "tenant-foreign",
      branchId,
      orderId: "order-trace",
      pickingOrderId: "picking-trace",
    }),
    /Order not found/,
  );

  const eligibleLots = store.read((db) =>
    getEligibleStockLots(db, {
      tenantId,
      branchId,
      productId: "trace-lot",
      locationId: "loc-centro-a",
      expirationTracked: true,
      at: now,
    }),
  );
  assert.deepEqual(
    eligibleLots.map((item) => item.id),
    ["trace-lot-a"],
  );
  const fefoPlan = store.read((db) =>
    planStockLotConsumption(
      db,
      {
        tenantId,
        branchId,
        productId: "trace-fefo",
        locationId: "loc-centro-a",
        expirationTracked: true,
        at: now,
      },
      10,
    ),
  );
  assert.deepEqual(
    fefoPlan.map((item) => [item.lot.id, item.quantity]),
    [
      ["trace-fefo-first", 6],
      ["trace-fefo-second", 4],
    ],
  );
  assert.equal(
    fefoPlan.some((item) => item.lot.id === "trace-fefo-expired"),
    false,
  );

  const orders = new MockOrderRepository(store, eventBus);
  const picking = new MockPickingRepository(store, eventBus);
  const kitOrder = await orders.create({
    ...orderInput("kit-service", OrderSource.pos, DeliveryMethod.home_delivery),
    status: OrderStatus.confirmed,
    items: [
      {
        id: "order-item-kit-actual",
        productId: "trace-kit",
        skuSnapshot: "TRACE-KIT",
        nameSnapshot: "Trace kit",
        quantity: 1,
        unitPrice: 1,
        discount: 0,
        subtotal: 1,
      },
      {
        id: "order-item-service-actual",
        productId: "trace-service",
        skuSnapshot: "TRACE-SERVICE",
        nameSnapshot: "Trace service",
        quantity: 1,
        unitPrice: 1,
        discount: 0,
        subtotal: 1,
      },
    ],
    subtotal: 2,
    total: 2,
  });
  assert.deepEqual(kitOrder.items[0]?.fulfillmentComponents, [
    { productId: "trace-kit-component", quantity: 2 },
  ]);
  assert.equal(kitOrder.items[1]?.fulfillmentComponents, undefined);
  const kitPicking = await picking.create({
    tenantId,
    branchId,
    orderId: kitOrder.id,
    priority: PickingPriority.normal,
  });
  const kitPickingItems = await picking.getItems({ tenantId, branchId }, kitPicking.id);
  assert.deepEqual(
    kitPickingItems.map((item) => item.productId),
    ["trace-kit-component"],
  );
  assert.equal(
    store.getSnapshot().inventoryMovements.some((movement) => movement.productId === "trace-kit"),
    false,
  );
}

async function verifyCanonicalMultiAllocationTrace() {
  const store = createStore();
  const eventBus = new DataEventBus();
  store.transact((db) => {
    const productTemplate = db.products[0];
    assert.ok(productTemplate);
    db.products.push({
      ...productTemplate,
      id: "trace-canonical-lot-product",
      sku: "TRACE-CANONICAL-LOT",
      name: "Canonical multi-location lot product",
      productType: ProductType.physical,
      tracking: { stock: true, lot: true, expiration: true, serial: false },
    });
    db.inventoryBalances.push(
      {
        id: "trace-canonical-balance-a",
        tenantId,
        branchId,
        productId: "trace-canonical-lot-product",
        locationId: "loc-centro-a",
        quantity: 6,
        reservedQuantity: 0,
        updatedAt: now,
      },
      {
        id: "trace-canonical-balance-b",
        tenantId,
        branchId,
        productId: "trace-canonical-lot-product",
        locationId: "loc-centro-b",
        quantity: 4,
        reservedQuantity: 0,
        updatedAt: now,
      },
    );
    db.stockLots.push(
      {
        id: "trace-canonical-expired-lot",
        tenantId,
        branchId,
        productId: "trace-canonical-lot-product",
        locationId: "loc-centro-a",
        lotNumber: "CANONICAL-EXPIRED",
        expirationDate: "2020-01-01",
        quantity: 20,
        createdAt: now,
      },
      {
        id: "trace-canonical-lot-a",
        tenantId,
        branchId,
        productId: "trace-canonical-lot-product",
        locationId: "loc-centro-a",
        lotNumber: "CANONICAL-A",
        expirationDate: "2026-10-01",
        quantity: 6,
        createdAt: now,
      },
      {
        id: "trace-canonical-lot-b",
        tenantId,
        branchId,
        productId: "trace-canonical-lot-product",
        locationId: "loc-centro-b",
        lotNumber: "CANONICAL-B",
        expirationDate: "2026-12-01",
        quantity: 4,
        createdAt: now,
      },
    );
  });

  const orders = new MockOrderRepository(store, eventBus);
  const inventory = new MockInventoryRepository(store, eventBus);
  const picking = new MockPickingRepository(store, eventBus);
  const order = await orders.create({
    ...orderInput("canonical-trace", OrderSource.pos, DeliveryMethod.home_delivery),
    status: OrderStatus.confirmed,
    items: [
      {
        id: "trace-canonical-order-item",
        productId: "trace-canonical-lot-product",
        skuSnapshot: "TRACE-CANONICAL-LOT",
        nameSnapshot: "Canonical multi-location lot product",
        quantity: 10,
        unitPrice: 1,
        discount: 0,
        subtotal: 10,
      },
    ],
    subtotal: 10,
    total: 10,
  });
  const reservation = store
    .getSnapshot()
    .inventoryReservations.find((item) => item.orderItemId === "trace-canonical-order-item");
  assert.ok(reservation);
  assert.equal(reservation.allocations.length, 2);
  const reservedBalances = reservation.allocations.map((allocation) => allocation.balanceId).sort();
  assert.deepEqual(reservedBalances, ["trace-canonical-balance-a", "trace-canonical-balance-b"]);
  const persistedBalanceIds = new Set(
    store.getSnapshot().inventoryBalances.map((balance) => balance.id),
  );
  assert.ok(
    reservation.allocations.every((allocation) => persistedBalanceIds.has(allocation.balanceId)),
  );

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
    actorUserId,
  });
  const [pickingItem] = await picking.getItems({ tenantId, branchId }, pickingOrder.id);
  assert.ok(pickingItem);
  const movementsBeforeConsumption = store.getSnapshot().inventoryMovements.length;
  const consumedItem = await picking.updateItem({
    tenantId,
    branchId,
    pickingOrderId: pickingOrder.id,
    pickingItemId: pickingItem.id,
    performedByUserId: actorUserId,
    pickedQuantity: 10,
    operationId: "trace-canonical-consumption",
  });
  assert.equal(consumedItem.pickedAllocations?.length, 2);

  const afterConsumption = store.getSnapshot();
  assert.equal(afterConsumption.inventoryMovements.length, movementsBeforeConsumption);
  assert.equal(afterConsumption.inventoryReservationConsumeOperations.some(
    (operation) => operation.operationId === "trace-canonical-consumption"), false);

  const trace = await inventory.getPickingFulfillmentTrace({
    tenantId,
    branchId,
    orderId: order.id,
    pickingOrderId: pickingOrder.id,
  });
  assert.equal(trace.length, 1);
  const [itemTrace] = trace;
  assert.ok(itemTrace);
  const allocations = [...itemTrace.allocations].sort((left, right) =>
    (left.location?.id ?? "").localeCompare(right.location?.id ?? ""),
  );
  assert.equal(allocations.length, 2);
  assert.deepEqual(
    allocations.map((allocation) => ({
      locationId: allocation.location?.id,
      lotId: allocation.lot?.id,
      expiresAt: allocation.lot?.expiresAt,
      quantity: allocation.quantity,
    })),
    [
      {
        locationId: "loc-centro-a",
        lotId: "trace-canonical-lot-a",
        expiresAt: "2026-10-01",
        quantity: 6,
      },
      {
        locationId: "loc-centro-b",
        lotId: "trace-canonical-lot-b",
        expiresAt: "2026-12-01",
        quantity: 4,
      },
    ],
  );
  assert.equal(
    allocations.reduce((total, allocation) => total + allocation.quantity, 0),
    itemTrace.pickedQuantity,
  );
  assert.ok(allocations.every((allocation) => allocation.inventoryMovementId === undefined));
  assert.ok(allocations.every((allocation) => consumedItem.pickedAllocations?.some((selected) =>
    selected.locationId === allocation.location?.id && selected.lotId === allocation.lot?.id &&
    selected.quantity === allocation.quantity)));

  const traceService = new GetLogisticsItemTraceService({
    auth: {
      getCurrentSessionId: async () => "session-logistics-canonical-trace",
      getSession: async () => ({
        id: "session-logistics-canonical-trace",
        userId: actorUserId,
        createdAt: now,
        expiresAt: "2099-01-01T00:00:00.000Z",
        rememberMe: false,
      }),
    },
    branches: new MockBranchRepository(store, eventBus),
    inventory,
    products: new MockProductRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry);
  const projected = await traceService.execute(branchId, {
    orderId: order.id,
    pickingOrderId: pickingOrder.id,
  });
  assert.equal(projected.length, 1);
  assert.deepEqual(
    projected[0]?.allocations.map((allocation) => allocation.lot?.id).sort(),
    itemTrace.allocations.map((allocation) => allocation.lot?.id).sort(),
  );
  assert.equal(
    store.getSnapshot().inventoryMovements.length,
    afterConsumption.inventoryMovements.length,
  );
}

async function verifySerialConcurrency() {
  const store = createStore();
  prepareSerialConcurrencyFixtures(store);
  const inventory = new MockInventoryRepository(store, new DataEventBus());
  const firstInput = {
    tenantId,
    branchId,
    reservationId: "reservation-serial-a",
    allocationsConsumed: [{ balanceId: "balance-serial-concurrency", quantity: 1 }],
    serialNumbers: ["CONCURRENT-SERIAL-001"],
    operationId: "serial-operation-a",
    performedByUserId: actorUserId,
  };
  const secondInput = {
    ...firstInput,
    reservationId: "reservation-serial-b",
    operationId: "serial-operation-b",
  };
  const attempts = [
    inventory.consumeReservation(firstInput),
    inventory.consumeReservation(secondInput),
  ];
  const results = await Promise.allSettled(attempts);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
  const winner = results[winnerIndex];
  assert.ok(winner?.status === "fulfilled");
  assert.equal(winner.value.idempotent, false);
  assert.equal(winner.value.inventoryMovements.length, 1);
  assert.equal(winner.value.inventoryMovements[0]?.serialNumberId, "concurrent-serial-id");
  const loser = results.find((result) => result.status === "rejected");
  assert.ok(loser?.status === "rejected");
  assert.match(
    loser.reason instanceof Error ? loser.reason.message : String(loser.reason),
    /not available|Insufficient available serial/i,
  );

  const winnerInput = winnerIndex === 0 ? firstInput : secondInput;
  const retry = await inventory.consumeReservation(winnerInput);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.inventoryMovements[0]?.id, winner.value.inventoryMovements[0]?.id);
  const snapshot = store.getSnapshot();
  const serialMovements = snapshot.inventoryMovements.filter(
    (movement) => movement.serialNumberId === "concurrent-serial-id",
  );
  assert.equal(serialMovements.length, 1);
  assert.equal(serialMovements[0]?.id, winner.value.inventoryMovements[0]?.id);
  assert.equal(
    snapshot.serialNumbers.find((item) => item.id === "concurrent-serial-id")?.status,
    SerialStatus.sold,
  );
}

function orderInput(
  suffix: string,
  source: OrderSource,
  deliveryMethod: DeliveryMethod,
): CreateOrderInput {
  const homeDelivery = deliveryMethod === DeliveryMethod.home_delivery;
  return {
    tenantId,
    branchId,
    orderNumber: `ORDER-${suffix}`,
    source,
    items: [
      {
        id: `order-item-${suffix}`,
        productId: "prod-screws",
        skuSnapshot: "FIJ-TOR-001",
        nameSnapshot: "Tornillos",
        quantity: 1,
        unitPrice: 1,
        discount: 0,
        subtotal: 1,
      },
    ],
    status: OrderStatus.pending,
    deliveryMethod,
    transportMode: homeDelivery ? TransportMode.own_fleet : TransportMode.customer,
    deliveryAddress: homeDelivery
      ? {
          recipientName: "Cliente Logistics",
          recipientPhone: "55550000",
          line1: "Zona 1",
          city: "Guatemala",
          country: "Guatemala",
        }
      : undefined,
    storePickupContact:
      deliveryMethod === DeliveryMethod.store_pickup
        ? {
            recipientName: "Cliente que retira",
            recipientPhone: "55550001",
          }
        : undefined,
    subtotal: 1,
    discountTotal: 0,
    shippingTotal: 0,
    total: 1,
    trackingToken: `tracking-${suffix}`,
  };
}

function prepareStorePickupFixtures(store: MockDatabaseStore) {
  store.transact((db) => {
    const fixtures = [
      ["order-pickup-ready", DeliveryMethod.store_pickup, OrderStatus.ready_for_pickup],
      ["order-pickup-ready-two", DeliveryMethod.store_pickup, OrderStatus.ready_for_pickup],
      ["order-home-ready", DeliveryMethod.home_delivery, OrderStatus.ready_for_pickup],
      ["order-pickup-wrong-status", DeliveryMethod.store_pickup, OrderStatus.picking],
      ["order-pickup-invalid-actor", DeliveryMethod.store_pickup, OrderStatus.ready_for_pickup],
      ["order-pickup-rollback", DeliveryMethod.store_pickup, OrderStatus.ready_for_pickup],
    ] as const;
    fixtures.forEach(([id, deliveryMethod, status]) => {
      const input = orderInput(id, OrderSource.pos, deliveryMethod);
      db.orders.push({
        ...input,
        id,
        orderNumber: id,
        status,
        items: input.items.map((item) => ({ ...item, id: `${id}-item`, orderId: id })),
        createdAt: now,
        updatedAt: now,
      });
    });
  });
}

function prepareTraceFixtures(store: MockDatabaseStore) {
  store.transact((db) => {
    const productTemplate = db.products[0];
    const orderTemplate = db.orders[0];
    const pickingTemplate = db.pickingOrders[0];
    assert.ok(productTemplate && orderTemplate && pickingTemplate);
    const productDefinitions = [
      [
        "trace-normal",
        ProductType.physical,
        { stock: true, lot: false, expiration: false, serial: false },
      ],
      [
        "trace-lot",
        ProductType.physical,
        { stock: true, lot: true, expiration: true, serial: false },
      ],
      [
        "trace-fefo",
        ProductType.physical,
        { stock: true, lot: true, expiration: true, serial: false },
      ],
      [
        "trace-serial",
        ProductType.physical,
        { stock: true, lot: false, expiration: false, serial: true },
      ],
      [
        "trace-lot-serial",
        ProductType.physical,
        { stock: true, lot: true, expiration: true, serial: true },
      ],
      [
        "trace-kit-component",
        ProductType.physical,
        { stock: true, lot: false, expiration: false, serial: false },
      ],
      [
        "trace-kit",
        ProductType.kit,
        { stock: false, lot: false, expiration: false, serial: false },
      ],
      [
        "trace-service",
        ProductType.service,
        { stock: false, lot: false, expiration: false, serial: false },
      ],
    ] as const;
    productDefinitions.forEach(([id, productType, tracking]) => {
      db.products.push({
        ...productTemplate,
        id,
        sku: id.toUpperCase(),
        name: id,
        productType,
        tracking,
      });
    });
    db.productKitComponents.push({
      id: "trace-kit-component-link",
      tenantId,
      kitProductId: "trace-kit",
      componentProductId: "trace-kit-component",
      quantityPerKit: 2,
      createdAt: now,
      updatedAt: now,
    });
    db.inventoryBalances.push({
      id: "balance-trace-kit-component",
      tenantId,
      branchId,
      productId: "trace-kit-component",
      locationId: "loc-centro-a",
      quantity: 10,
      reservedQuantity: 0,
      updatedAt: now,
    });
    const itemDefinitions = [
      ["normal", "trace-normal", 10, undefined],
      ["lot", "trace-lot", 10, undefined],
      ["serial", "trace-serial", 1, undefined],
      ["lot-serial", "trace-lot-serial", 1, undefined],
      ["kit", "trace-kit", 1, [{ productId: "trace-kit-component", quantity: 2 }]],
      ["service", "trace-service", 1, undefined],
    ] as const;
    const orderItems = itemDefinitions.map(
      ([suffix, productId, quantity, fulfillmentComponents]) => ({
        id: `order-item-trace-${suffix}`,
        orderId: "order-trace",
        productId,
        skuSnapshot: productId,
        nameSnapshot: productId,
        quantity,
        unitPrice: 1,
        discount: 0,
        subtotal: quantity,
        fulfillmentComponents: fulfillmentComponents?.map((component) => ({
          ...component,
        })),
      }),
    );
    db.orders.push({
      ...orderTemplate,
      id: "order-trace",
      orderNumber: "ORDER-TRACE",
      source: OrderSource.pos,
      status: OrderStatus.ready_for_dispatch,
      deliveryMethod: DeliveryMethod.home_delivery,
      items: orderItems,
      createdAt: now,
      updatedAt: now,
    });
    db.pickingOrders.push({
      ...pickingTemplate,
      id: "picking-trace",
      orderId: "order-trace",
      tenantId,
      branchId,
      status: PickingStatus.completed,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const physicalLines = [
      ["normal", "trace-normal", 10],
      ["lot", "trace-lot", 10],
      ["serial", "trace-serial", 1],
      ["lot-serial", "trace-lot-serial", 1],
      ["kit", "trace-kit-component", 2],
    ] as const;
    physicalLines.forEach(([suffix, productId, quantity]) => {
      db.pickingItems.push({
        id: `picking-item-trace-${suffix}`,
        pickingOrderId: "picking-trace",
        orderItemId: `order-item-trace-${suffix}`,
        productId,
        requestedQuantity: quantity,
        pickedQuantity: quantity,
        status: PickingItemStatus.completed,
      });
    });

    const lots = [
      ["trace-lot-a", "trace-lot", "loc-centro-a", "LOT-A", "2026-10-01", 6],
      ["trace-lot-b", "trace-lot", "loc-centro-b", "LOT-B", "2026-12-01", 4],
      ["trace-lot-expired", "trace-lot", "loc-centro-a", "LOT-EXPIRED", "2020-01-01", 5],
      ["trace-lot-serial-a", "trace-lot-serial", "loc-centro-a", "LOT-SERIAL", "2026-11-01", 1],
      ["trace-fefo-first", "trace-fefo", "loc-centro-a", "FEFO-1", "2026-10-01", 6],
      ["trace-fefo-second", "trace-fefo", "loc-centro-a", "FEFO-2", "2026-12-01", 4],
      ["trace-fefo-expired", "trace-fefo", "loc-centro-a", "FEFO-X", "2020-01-01", 20],
    ] as const;
    lots.forEach(([id, productId, locationId, lotNumber, expirationDate, quantity]) => {
      db.stockLots.push({
        id,
        tenantId,
        branchId,
        productId,
        locationId,
        lotNumber,
        expirationDate,
        quantity,
        createdAt: now,
      });
    });
    db.serialNumbers.push(
      {
        id: "trace-serial-id",
        tenantId,
        branchId,
        productId: "trace-serial",
        locationId: "loc-centro-a",
        serialNumber: "TRACE-SERIAL-001",
        status: SerialStatus.sold,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "trace-lot-serial-id",
        tenantId,
        branchId,
        productId: "trace-lot-serial",
        locationId: "loc-centro-a",
        lotId: "trace-lot-serial-a",
        serialNumber: "TRACE-LOT-SERIAL-001",
        status: SerialStatus.sold,
        createdAt: now,
        updatedAt: now,
      },
    );

    const traceDefinitions = [
      [
        "normal",
        "trace-normal",
        [
          ["loc-centro-a", 6, undefined, undefined],
          ["loc-centro-b", 4, undefined, undefined],
        ],
      ],
      [
        "lot",
        "trace-lot",
        [
          ["loc-centro-a", 6, "trace-lot-a", undefined],
          ["loc-centro-b", 4, "trace-lot-b", undefined],
        ],
      ],
      ["serial", "trace-serial", [["loc-centro-a", 1, undefined, "trace-serial-id"]]],
      [
        "lot-serial",
        "trace-lot-serial",
        [["loc-centro-a", 1, "trace-lot-serial-a", "trace-lot-serial-id"]],
      ],
      ["kit", "trace-kit-component", [["loc-centro-a", 2, undefined, undefined]]],
    ] as const;
    traceDefinitions.forEach(([suffix, productId, allocations]) => {
      const reservationId = `reservation-trace-${suffix}`;
      allocations.forEach(([locationId], index) => {
        db.inventoryBalances.push({
          id: `${reservationId}-balance-${index}`,
          tenantId,
          branchId,
          productId,
          locationId,
          quantity: 0,
          reservedQuantity: 0,
          updatedAt: now,
        });
      });
      db.inventoryReservations.push({
        id: reservationId,
        tenantId,
        branchId,
        orderId: "order-trace",
        orderItemId: `order-item-trace-${suffix}`,
        productId,
        status: InventoryReservationStatus.consumed,
        allocations: allocations.map(([locationId, quantity], index) => ({
          id: `${reservationId}-allocation-${index}`,
          balanceId: `${reservationId}-balance-${index}`,
          locationId,
          reservedQuantity: quantity,
          consumedQuantity: quantity,
        })),
        createdAt: now,
        updatedAt: now,
      });
      allocations.forEach(([locationId, quantity, lotId, serialNumberId], index) => {
        db.inventoryMovements.push({
          id: `movement-trace-${suffix}-${index}`,
          tenantId,
          branchId,
          productId,
          lotId,
          serialNumberId,
          type: InventoryMovementType.out,
          reason: `Consumo de reserva ${reservationId}`,
          quantity,
          fromLocationId: locationId,
          referenceType: "inventoryReservation",
          referenceId: reservationId,
          performedByUserId: actorUserId,
          createdAt: now,
        });
      });
    });
  });
}

function prepareSerialConcurrencyFixtures(store: MockDatabaseStore) {
  store.transact((db) => {
    const template = db.products[0];
    assert.ok(template);
    db.products.push({
      ...template,
      id: "trace-concurrent-serial-product",
      sku: "TRACE-CONCURRENT-SERIAL",
      name: "Trace concurrent serial",
      productType: ProductType.physical,
      tracking: { stock: true, lot: false, expiration: false, serial: true },
    });
    db.inventoryBalances.push({
      id: "balance-serial-concurrency",
      tenantId,
      branchId,
      productId: "trace-concurrent-serial-product",
      locationId: "loc-centro-a",
      quantity: 2,
      reservedQuantity: 2,
      updatedAt: now,
    });
    db.serialNumbers.push({
      id: "concurrent-serial-id",
      tenantId,
      branchId,
      productId: "trace-concurrent-serial-product",
      locationId: "loc-centro-a",
      serialNumber: "CONCURRENT-SERIAL-001",
      status: SerialStatus.available,
      createdAt: now,
      updatedAt: now,
    });
    ["a", "b"].forEach((suffix) => {
      db.inventoryReservations.push({
        id: `reservation-serial-${suffix}`,
        tenantId,
        branchId,
        orderId: `order-serial-${suffix}`,
        orderItemId: `order-item-serial-${suffix}`,
        productId: "trace-concurrent-serial-product",
        status: InventoryReservationStatus.active,
        allocations: [
          {
            id: `allocation-serial-${suffix}`,
            balanceId: "balance-serial-concurrency",
            locationId: "loc-centro-a",
            reservedQuantity: 1,
            consumedQuantity: 0,
          },
        ],
        createdAt: now,
        updatedAt: now,
      });
    });
  });
}

function requiredTrace(
  traces: Awaited<ReturnType<MockInventoryRepository["getPickingFulfillmentTrace"]>>,
  productId: string,
) {
  const trace = traces.find((item) => item.productId === productId);
  assert.ok(trace, `Missing trace for ${productId}`);
  return trace;
}

function mutationCounts(store: MockDatabaseStore) {
  const snapshot = store.getSnapshot();
  return {
    orders: snapshot.orders.length,
    payments: snapshot.payments.length,
    reservations: snapshot.inventoryReservations.length,
    movements: snapshot.inventoryMovements.length,
  };
}

function createStore() {
  return new MockDatabaseStore(new LocalStorageAdapter());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
