import assert from "node:assert/strict";
import {
  DeliveryMethod,
  InventoryReservationStatus,
  OrderSource,
  OrderStatus,
  PickingIncidentStatus,
  PickingIncidentType,
  PickingPriority,
  PickingStatus,
  RoleStatus,
  SerialStatus,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { PickingChangedEventPayload } from "@/core/types/events.types";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPickingRepository } from "@/infrastructure/mock/repositories/MockPickingRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { getPickingLineUpdateAvailability } from "@/modules/logistics/application/pickingPhysicalSelection";
import { PickingAuthorizationError } from "@/modules/logistics/application/services/PickingAuthorizationContext";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const otherBranchId = "branch-norte";
const actorA = "user-picker-a";
const actorB = "user-picker-b";

async function main() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  const eventBus = new DataEventBus();
  const pickingEvents: PickingChangedEventPayload[] = [];
  eventBus.subscribe("picking.changed", (payload) => pickingEvents.push(payload));
  if (false) {
    // @ts-expect-error picking.changed requires tenant, branch, PickingOrder and Order IDs.
    eventBus.emit("picking.changed", {});
  }
  prepareDatabase(store);

  let currentActorId = actorA;
  const auth = {
    getCurrentSessionId: async () => `session-${currentActorId}`,
    getSession: async (sessionId: string) => ({
      id: sessionId,
      userId: currentActorId,
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      rememberMe: false,
    }),
  };
  const branches = new MockBranchRepository(store, eventBus);
  const inventory = new MockInventoryRepository(store, eventBus);
  const orders = new MockOrderRepository(store, eventBus);
  const picking = new MockPickingRepository(store, eventBus);
  const products = new MockProductRepository(store, eventBus);
  const roles = new MockRoleRepository(store, eventBus);
  const users = new MockUserRepository(store, eventBus);
  const repositories = {
    auth,
    branches,
    inventory,
    orders,
    picking,
    products,
    roles,
    users,
  } as unknown as RepositoryRegistry;
  const service = new PickingApplicationService(repositories);

  const orderA = await createOrder(orders, "A", [
    ["prod-screws", 6],
    ["prod-analgesic", 1],
    ["prod-sensor-serial-lot", 1],
  ]);
  const pickingA = await picking.create({
    tenantId,
    branchId,
    orderId: orderA.id,
    priority: PickingPriority.high,
  });
  const orderB = await createOrder(orders, "B", [["prod-screws", 2]]);

  addIsolatedQueueFixtures(store);

  // A. Authoritative queue and tenant/branch isolation.
  const queue = await service.getQueue(branchId);
  assert.equal(queue.length, 1);
  assert.equal(queue[0]?.pickingOrderId, pickingA.id);
  assert.equal(queue[0]?.orderReference, orderA.orderNumber);
  assert.equal(queue[0]?.priority, PickingPriority.high);
  assert.equal(queue[0]?.progress.requiredQuantity, 8);
  assert.deepEqual(await picking.getQueue({ tenantId, branchId }), [
    expectPickingOrder(store, pickingA.id),
  ]);
  assert.equal((await picking.getQueue({ tenantId, branchId: otherBranchId })).length, 1);
  assert.equal(
    (await picking.getQueue({ tenantId: "tenant-foreign", branchId: "branch-foreign" })).length,
    1,
  );

  // B, I, J, K. Complete detail plus traceability-aware own-reservation availability.
  const detail = await service.getDetail(branchId, pickingA.id);
  assert.equal(detail.lines.length, 3);
  detail.lines.forEach((line) => {
    assert.ok(line.sku);
    assert.ok(line.name);
    assert.equal(line.remainingQuantity, line.requiredQuantity);
    assert.ok(line.location);
  });
  const screws = detail.lines.find((line) => line.productId === "prod-screws");
  const lotTracked = detail.lines.find((line) => line.productId === "prod-analgesic");
  const lotSerialTracked = detail.lines.find((line) => line.productId === "prod-sensor-serial-lot");
  assert.ok(screws && lotTracked && lotSerialTracked);
  assert.equal(screws.inventory.physicalQuantity, 10);
  assert.equal(screws.inventory.ownReservedQuantity, 6);
  assert.equal(screws.inventory.otherReservedQuantity, 2);
  assert.equal(screws.inventory.freeQuantity, 2);
  assert.equal(screws.inventory.usableQuantity, 8);
  assert.ok(lotTracked.inventory.locations.some((location) => location.lots.length > 0));
  assert.ok(
    lotSerialTracked.inventory.locations.some((location) =>
      location.lots.some((lot) => lot.serialNumbers.length > 0),
    ),
  );
  assert.equal(getPickingLineUpdateAvailability(screws).available, true);
  assert.equal(getPickingLineUpdateAvailability(lotTracked).available, true);
  assert.equal(getPickingLineUpdateAvailability(lotSerialTracked).available, true);

  // C, D. Atomic concurrent assignment and same-actor idempotency.
  const assignmentRace = await Promise.allSettled([
    picking.assign({ tenantId, branchId, pickingOrderId: pickingA.id, actorUserId: actorA }),
    picking.assign({ tenantId, branchId, pickingOrderId: pickingA.id, actorUserId: actorB }),
  ]);
  assert.equal(assignmentRace.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(assignmentRace.filter((result) => result.status === "rejected").length, 1);
  const winner = assignmentRace.find((result) => result.status === "fulfilled");
  assert.ok(winner && winner.status === "fulfilled");
  const winnerId = winner.value.pickingOrder.assignedUserId;
  assert.ok(winnerId === actorA || winnerId === actorB);
  const loserId = winnerId === actorA ? actorB : actorA;
  const retryAssignment = await picking.assign({
    tenantId,
    branchId,
    pickingOrderId: pickingA.id,
    actorUserId: winnerId,
  });
  assert.equal(retryAssignment.idempotent, true);

  // E, G. Release with no progress and append-only evidence.
  currentActorId = winnerId;
  await service.release(branchId, pickingA.id, "Cambio de turno");
  let releasedOrder = await picking.getById({ tenantId, branchId }, pickingA.id);
  assert.equal(releasedOrder?.status, PickingStatus.pending);
  assert.equal(releasedOrder?.assignedUserId, undefined);
  let releaseHistory = await service.getReleaseHistory(branchId, pickingA.id);
  assert.equal(releaseHistory.length, 1);
  assert.equal(releaseHistory[0]?.actorUserId, winnerId);
  assert.equal(releaseHistory[0]?.reason, "Cambio de turno");

  // F. Release after incremental picking preserves progress and physical history.
  await service.assign(branchId, pickingA.id);
  await service.updateLine(branchId, {
    pickingOrderId: pickingA.id,
    pickingLineId: screws.pickingLineId,
    pickedQuantity: 2,
    operationId: "pick-a-screws-2",
  });
  const movementsAfterPartial = store.getSnapshot().inventoryMovements.length;
  await service.updateLine(branchId, {
    pickingOrderId: pickingA.id,
    pickingLineId: screws.pickingLineId,
    pickedQuantity: 2,
    operationId: "pick-a-screws-2",
  });
  assert.equal(store.getSnapshot().inventoryMovements.length, movementsAfterPartial);
  await service.release(branchId, pickingA.id, "Pausa operativa");
  releasedOrder = await picking.getById({ tenantId, branchId }, pickingA.id);
  assert.equal(releasedOrder?.status, PickingStatus.in_progress);
  assert.equal(releasedOrder?.assignedUserId, undefined);
  assert.equal(
    (await picking.getItems({ tenantId, branchId }, pickingA.id)).find(
      (line) => line.id === screws.pickingLineId,
    )?.pickedQuantity,
    2,
  );
  assert.equal(store.getSnapshot().inventoryMovements.length, movementsAfterPartial);
  releaseHistory = await service.getReleaseHistory(branchId, pickingA.id);
  assert.equal(releaseHistory.length, 2);

  // H. Persistent incident registration and resolution.
  currentActorId = loserId;
  await service.assign(branchId, pickingA.id);
  const incident = await service.registerIncident(branchId, {
    pickingOrderId: pickingA.id,
    pickingLineId: screws.pickingLineId,
    type: PickingIncidentType.quantity_difference,
    quantityAffected: 1,
    comment: "Conteo verificado",
  });
  assert.equal(incident.status, PickingIncidentStatus.open);
  assert.equal((await service.getIncidents(branchId, pickingA.id)).length, 1);
  const resolved = await service.resolveIncident(branchId, pickingA.id, incident.id);
  assert.equal(resolved.status, PickingIncidentStatus.resolved);
  assert.equal(resolved.resolvedBy, loserId);

  // L, N. Finish every line; completion atomically advances Picking and Order and retries safely.
  const beforeCompletion = await service.getDetail(branchId, pickingA.id);
  for (const line of beforeCompletion.lines) {
    const selectedSerial = line.tracking.serial
      ? line.inventory.locations.flatMap((location) => location.serialNumbers)[0]?.serialNumber
      : undefined;
    await service.updateLine(branchId, {
      pickingOrderId: pickingA.id,
      pickingLineId: line.pickingLineId,
      pickedQuantity: line.requiredQuantity,
      operationId: `complete-${line.pickingLineId}`,
      serialNumbers: selectedSerial ? [selectedSerial] : undefined,
    });
  }
  const completion = await service.complete(branchId, pickingA.id);
  assert.equal(completion.status, PickingStatus.completed);
  assert.equal(completion.orderStatus, OrderStatus.packing);
  assert.equal(completion.idempotent, false);
  const completionRetry = await service.complete(branchId, pickingA.id);
  assert.equal(completionRetry.idempotent, true);
  assert.equal((await orders.getById(orderA.id))?.status, OrderStatus.packing);
  assert.equal(store.getSnapshot().packings.filter((item) => item.orderId === orderA.id).length, 1);

  // M. An injected mid-transaction failure rolls both aggregate changes back.
  const orderC = await createOrder(orders, "C", [["prod-screws", 1]]);
  const pickingC = await picking.create({
    tenantId,
    branchId,
    orderId: orderC.id,
    priority: PickingPriority.normal,
  });
  await picking.assign({ tenantId, branchId, pickingOrderId: pickingC.id, actorUserId: loserId });
  const lineC = (await picking.getItems({ tenantId, branchId }, pickingC.id))[0];
  assert.ok(lineC);
  await picking.updateItem({
    tenantId,
    branchId,
    pickingOrderId: pickingC.id,
    pickingItemId: lineC.id,
    pickedQuantity: 1,
    operationId: "pick-c",
    performedByUserId: loserId,
  });
  const failingPicking = new MockPickingRepository(store, eventBus, {
    afterPickingCompleted: () => {
      throw new Error("Injected completion failure");
    },
  });
  await assert.rejects(
    failingPicking.complete({
      tenantId,
      branchId,
      pickingOrderId: pickingC.id,
      actorUserId: loserId,
    }),
    /Injected completion failure/,
  );
  assert.equal(
    (await picking.getById({ tenantId, branchId }, pickingC.id))?.status,
    PickingStatus.in_progress,
  );
  assert.equal((await orders.getById(orderC.id))?.status, OrderStatus.picking);
  assert.equal(
    store.getSnapshot().packings.some((item) => item.orderId === orderC.id),
    false,
  );
  const completedC = await picking.complete({
    tenantId,
    branchId,
    pickingOrderId: pickingC.id,
    actorUserId: loserId,
  });
  assert.equal(completedC.order.status, OrderStatus.packing);
  assert.equal(completedC.packing.orderId, orderC.id);
  assert.equal(
    (
      await picking.complete({
        tenantId,
        branchId,
        pickingOrderId: pickingC.id,
        actorUserId: loserId,
      })
    ).idempotent,
    true,
  );

  // P. Manipulated branch/tenant/actor values cannot become authority.
  await assert.rejects(service.getQueue(otherBranchId), PickingAuthorizationError);
  await assert.rejects(service.getQueue("branch-foreign"), PickingAuthorizationError);
  const orderD = await createOrder(orders, "D", [["prod-screws", 1]]);
  const pickingD = await picking.create({
    tenantId,
    branchId,
    orderId: orderD.id,
    priority: PickingPriority.normal,
  });
  currentActorId = actorA;
  const manipulatedAssignment = await (
    service.assign as unknown as (
      branch: string,
      id: string,
      attackerActorId: string,
    ) => ReturnType<PickingApplicationService["assign"]>
  )(branchId, pickingD.id, actorB);
  assert.equal(manipulatedAssignment.assignedUserId, actorA);
  const manipulatedIncident = await service.registerIncident(branchId, {
    pickingOrderId: pickingD.id,
    type: PickingIncidentType.location_empty,
    comment: "Scope test",
    tenantId: "tenant-foreign",
    branchId: "branch-foreign",
    createdBy: actorB,
  } as Parameters<PickingApplicationService["registerIncident"]>[1]);
  const persistedManipulatedIncident = store
    .getSnapshot()
    .pickingIncidents.find((item) => item.id === manipulatedIncident.id);
  assert.equal(persistedManipulatedIncident?.tenantId, tenantId);
  assert.equal(persistedManipulatedIncident?.branchId, branchId);
  assert.equal(persistedManipulatedIncident?.createdBy, actorA);

  // Q. Reservation cancellation, inventory movements, lots/serials, POS and Order lifecycle remain coherent.
  const reservationB = store
    .getSnapshot()
    .inventoryReservations.find((reservation) => reservation.orderId === orderB.id);
  assert.equal(reservationB?.status, InventoryReservationStatus.active);
  assert.equal(
    reservationB?.allocations.reduce(
      (total, allocation) => total + allocation.reservedQuantity - allocation.consumedQuantity,
      0,
    ),
    2,
  );
  const quantityBeforeCancel = expectBalance(store, "bal-screws").quantity;
  const movementsBeforeCancel = store.getSnapshot().inventoryMovements.length;
  await orders.updateStatus(orderD.id, OrderStatus.cancelled);
  assert.equal(
    store.getSnapshot().inventoryReservations.find((item) => item.orderId === orderD.id)?.status,
    InventoryReservationStatus.released,
  );
  assert.equal(expectBalance(store, "bal-screws").quantity, quantityBeforeCancel);
  assert.equal(store.getSnapshot().inventoryMovements.length, movementsBeforeCancel);
  assert.ok(store.getSnapshot().inventoryMovements.every((movement) => movement.type === "out"));
  assert.equal(
    store.getSnapshot().serialNumbers.find((serial) => serial.serialNumber === "SENSOR-A1")?.status,
    SerialStatus.available,
  );
  assert.equal(
    store.getSnapshot().sales.find((sale) => sale.id === "sale-001")?.status,
    "completed",
  );

  // O. Every normalized picking event is filterable by tenant and branch and identifies both aggregates.
  assert.ok(pickingEvents.length > 0);
  pickingEvents.forEach((event) => {
    assert.ok(event.tenantId);
    assert.ok(event.branchId);
    assert.ok(event.pickingOrderId);
    assert.ok(event.orderId);
  });

  console.log("verify-logistics-picking-shared-contracts: PASS");
  console.log(
    "A-Q: queue/detail/scope/concurrency/release/incidents/inventory/completion/events/regressions PASS",
  );
}

function prepareDatabase(store: MockDatabaseStore) {
  store.transact((db) => {
    db.orders = [];
    db.orderItems = [];
    db.payments = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.pickingItemUpdateOperations = [];
    db.pickingAssignmentReleases = [];
    db.pickingIncidents = [];
    db.packings = [];
    db.packingOperations = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.inventoryMovements = [];
    const productTemplate = db.products.find((item) => item.id === "prod-screws");
    assert.ok(productTemplate);
    db.products.push(
      {
        ...productTemplate,
        id: "prod-analgesic",
        sku: "HARNESS-LOT",
        barcode: undefined,
        name: "Producto fixture por lote",
        tracking: { stock: true, lot: true, expiration: true, serial: false },
      },
      {
        ...productTemplate,
        id: "prod-sensor-serial-lot",
        sku: "HARNESS-LOT-SERIAL",
        barcode: undefined,
        name: "Producto fixture por lote y serie",
        tracking: { stock: true, lot: true, expiration: false, serial: true },
      },
    );
    db.inventoryBalances.push(
      {
        id: "bal-analgesic",
        tenantId,
        branchId,
        productId: "prod-analgesic",
        locationId: "loc-centro-a",
        quantity: 5,
        reservedQuantity: 0,
        minStock: 1,
        updatedAt: "2026-09-12T12:00:00.000Z",
      },
      {
        id: "bal-sensor-serial-lot",
        tenantId,
        branchId,
        productId: "prod-sensor-serial-lot",
        locationId: "loc-centro-a",
        quantity: 4,
        reservedQuantity: 0,
        minStock: 1,
        updatedAt: "2026-09-12T12:00:00.000Z",
      },
    );
    db.stockLots.push(
      {
        id: "lot-harness-analgesic",
        tenantId,
        branchId,
        productId: "prod-analgesic",
        locationId: "loc-centro-a",
        lotNumber: "LOT-A",
        expirationDate: "2028-01-01T00:00:00.000Z",
        quantity: 5,
        createdAt: "2026-09-12T12:00:00.000Z",
      },
      {
        id: "lot-harness-sensor",
        tenantId,
        branchId,
        productId: "prod-sensor-serial-lot",
        locationId: "loc-centro-a",
        lotNumber: "LOT-SENSOR",
        quantity: 2,
        createdAt: "2026-09-12T12:00:00.000Z",
      },
    );
    db.serialNumbers.push({
      id: "serial-harness-sensor-a1",
      tenantId,
      branchId,
      productId: "prod-sensor-serial-lot",
      locationId: "loc-centro-a",
      lotId: "lot-harness-sensor",
      serialNumber: "SENSOR-A1",
      status: SerialStatus.available,
      createdAt: "2026-09-12T12:00:00.000Z",
      updatedAt: "2026-09-12T12:00:00.000Z",
    });
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
      if (balance.id === "bal-screws") balance.quantity = 10;
      if (balance.id === "bal-analgesic") balance.quantity = 5;
      if (balance.id === "bal-sensor-serial-lot") balance.quantity = 4;
    });
    db.stockLots.forEach((lot) => {
      if (lot.productId === "prod-analgesic") lot.quantity = 5;
      if (lot.productId === "prod-sensor-serial-lot") lot.quantity = 2;
    });
    db.serialNumbers.forEach((serial) => {
      serial.status = SerialStatus.available;
    });
    const now = "2026-09-12T12:00:00.000Z";
    db.roles.push({
      id: "role-picking-harness",
      tenantId,
      name: "Picking Harness",
      isSystem: false,
      permissions: [
        "logistics.picking.read",
        "logistics.picking.start",
        "logistics.picking.complete",
      ],
      branchScope: "assigned",
      status: RoleStatus.active,
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, name] of [
      [actorA, "Picker A"],
      [actorB, "Picker B"],
    ]) {
      db.users.push({
        id,
        tenantId,
        employeeCode: id,
        name,
        email: `${id}@example.test`,
        type: UserType.employee,
        status: UserStatus.active,
        roleId: "role-picking-harness",
        branchId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const branch = db.branches.find((item) => item.id === branchId);
    assert.ok(branch);
    db.branches.push({ ...branch, id: "branch-foreign", tenantId: "tenant-foreign" });
  });
}

async function createOrder(
  orders: MockOrderRepository,
  suffix: string,
  items: Array<[productId: string, quantity: number]>,
) {
  return orders.create({
    tenantId,
    branchId,
    orderNumber: `WEB-PICK-${suffix}`,
    source: OrderSource.ecommerce,
    items: items.map(([productId, quantity], index) => ({
      id: `order-${suffix}-item-${index + 1}`,
      productId,
      skuSnapshot: productId,
      nameSnapshot: productId,
      quantity,
      unitPrice: 1,
      discount: 0,
      subtotal: quantity,
    })),
    status: OrderStatus.confirmed,
    deliveryMethod: DeliveryMethod.home_delivery,
    transportMode: TransportMode.own_fleet,
    deliveryAddress: {
      recipientName: "Cliente Picking",
      recipientPhone: "55550000",
      line1: "Zona 1",
      city: "Guatemala",
      country: "Guatemala",
    },
    subtotal: items.reduce((total, [, quantity]) => total + quantity, 0),
    discountTotal: 0,
    shippingTotal: 0,
    total: items.reduce((total, [, quantity]) => total + quantity, 0),
    trackingToken: `TRACK-PICK-${suffix}`,
  });
}

function addIsolatedQueueFixtures(store: MockDatabaseStore) {
  store.transact((db) => {
    const templateOrder = db.orders[0];
    const templatePicking = db.pickingOrders[0];
    assert.ok(templateOrder && templatePicking);
    db.orders.push({
      ...templateOrder,
      id: "order-other-branch",
      branchId: otherBranchId,
      orderNumber: "OTHER-BRANCH",
      items: [],
    });
    db.pickingOrders.push({
      ...templatePicking,
      id: "picking-other-branch",
      orderId: "order-other-branch",
      branchId: otherBranchId,
    });
    db.orders.push({
      ...templateOrder,
      id: "order-foreign",
      tenantId: "tenant-foreign",
      branchId: "branch-foreign",
      orderNumber: "FOREIGN",
      items: [],
    });
    db.pickingOrders.push({
      ...templatePicking,
      id: "picking-foreign",
      tenantId: "tenant-foreign",
      branchId: "branch-foreign",
      orderId: "order-foreign",
    });
  });
}

function expectBalance(store: MockDatabaseStore, balanceId: string) {
  const balance = store.getSnapshot().inventoryBalances.find((item) => item.id === balanceId);
  assert.ok(balance);
  return balance;
}

function expectPickingOrder(store: MockDatabaseStore, pickingOrderId: string) {
  const pickingOrder = store.getSnapshot().pickingOrders.find((item) => item.id === pickingOrderId);
  assert.ok(pickingOrder);
  return pickingOrder;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
