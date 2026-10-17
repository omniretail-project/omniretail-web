import assert from "node:assert/strict";
import {
  CustomerStatus,
  DeliveryMethod,
  OrderSource,
  OrderStatus,
  PickingIncidentStatus,
  PickingIncidentType,
  PickingPriority,
  PickingStatus,
  ProductType,
  RoleStatus,
  SerialStatus,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { CreateOrderInput } from "@/core/repositories";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockCustomerRepository } from "@/infrastructure/mock/repositories/MockCustomerRepository";
import { MockDispatchRepository } from "@/infrastructure/mock/repositories/MockDispatchRepository";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MockNotificationRepository } from "@/infrastructure/mock/repositories/MockNotificationRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPickingRepository } from "@/infrastructure/mock/repositories/MockPickingRepository";
import { MockPackingRepository } from "@/infrastructure/mock/repositories/MockPackingRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { PackingApplicationService } from "@/modules/logistics/application/services/PackingApplicationService";
import {
  filterAvailableSerialNumbers,
  formatExpirationDate,
} from "@/modules/logistics/components/PickingLineList";
import { normalizePickingSerialNumbers } from "@/modules/logistics/hooks/useLogisticsPicking";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const actorA = "user-picking-ui-a";
const actorB = "user-picking-ui-b";
const now = "2026-09-14T10:00:00.000Z";

async function main() {
  assert.equal(formatExpirationDate("2028-08-15T00:00:00.000Z"), "15/08/2028");
  assert.equal(formatExpirationDate("2028-08-15"), "15/08/2028");
  const availableSerialNumbers = ["SER-0008", "SER-0002", "SER-0006", "SER-0004", "SER-0005"];
  assert.deepEqual(filterAvailableSerialNumbers(availableSerialNumbers, ""), availableSerialNumbers);
  assert.deepEqual(filterAvailableSerialNumbers(availableSerialNumbers, "SER-000"), availableSerialNumbers);
  assert.deepEqual(filterAvailableSerialNumbers(availableSerialNumbers, "6"), ["SER-0006"]);
  assert.deepEqual(filterAvailableSerialNumbers(availableSerialNumbers, "0006"), ["SER-0006"]);
  assert.deepEqual(filterAvailableSerialNumbers(availableSerialNumbers, "absent"), []);

  const store = new MockDatabaseStore(new LocalStorageAdapter());
  const eventBus = new DataEventBus();
  prepareDatabase(store);

  let currentActorId = actorA;
  const auth = {
    getCurrentSessionId: async () => `session-${currentActorId}`,
    getSession: async (sessionId: string) => ({
      id: sessionId,
      userId: currentActorId,
      createdAt: now,
      expiresAt: "2099-01-01T00:00:00.000Z",
      rememberMe: false,
    }),
  };
  const branches = new MockBranchRepository(store, eventBus);
  const customers = new MockCustomerRepository(store, eventBus);
  const dispatches = new MockDispatchRepository(store, eventBus);
  const inventory = new MockInventoryRepository(store, eventBus);
  const notifications = new MockNotificationRepository(store, eventBus);
  const orders = new MockOrderRepository(store, eventBus);
  const picking = new MockPickingRepository(store, eventBus);
  const packings = new MockPackingRepository(store, eventBus);
  const products = new MockProductRepository(store, eventBus);
  const roles = new MockRoleRepository(store, eventBus);
  const users = new MockUserRepository(store, eventBus);
  const repositories = {
    auth,
    branches,
    customers,
    dispatches,
    inventory,
    notifications,
    orders,
    picking,
    packings,
    products,
    roles,
    users,
  } as unknown as RepositoryRegistry;
  const service = new PickingApplicationService(repositories);
  const dispatchService = new DispatchApplicationService(repositories);
  const packingService = new PackingApplicationService(repositories);

  const mainOrder = await orders.create(
    orderInput({
      suffix: "main",
      deliveryMethod: DeliveryMethod.home_delivery,
      customerId: "customer-picking-ui",
      items: [
        ["picking-ui-basic", 3],
        ["picking-ui-lot", 10],
        ["picking-ui-serial", 2],
      ],
    }),
  );
  const mainPicking = await picking.create({
    tenantId,
    branchId,
    orderId: mainOrder.id,
    priority: PickingPriority.high,
  });

  const guestOrder = await orders.create(
    orderInput({
      suffix: "guest",
      deliveryMethod: DeliveryMethod.store_pickup,
      guestName: "Cliente Invitado Picking",
      items: [["picking-ui-basic", 2]],
    }),
  );
  const guestPicking = await picking.create({
    tenantId,
    branchId,
    orderId: guestOrder.id,
    priority: PickingPriority.normal,
  });

  const corruptCustomerOrder = await orders.create(
    orderInput({
      suffix: "customer-scope",
      deliveryMethod: DeliveryMethod.store_pickup,
      items: [["picking-ui-basic", 1]],
    }),
  );
  const corruptCustomerPicking = await picking.create({
    tenantId,
    branchId,
    orderId: corruptCustomerOrder.id,
    priority: PickingPriority.low,
  });
  store.transact((db) => {
    const order = db.orders.find((item) => item.id === corruptCustomerOrder.id);
    assert.ok(order);
    order.customerId = "customer-picking-ui-foreign";
  });

  const assignedOrder = await orders.create(
    orderInput({
      suffix: "assigned",
      deliveryMethod: DeliveryMethod.store_pickup,
      items: [["picking-ui-basic", 1]],
    }),
  );
  const assignedPicking = await picking.create({
    tenantId,
    branchId,
    orderId: assignedOrder.id,
    priority: PickingPriority.normal,
  });
  await service.assign(branchId, assignedPicking.id);

  const progressOrder = await orders.create(
    orderInput({
      suffix: "progress",
      deliveryMethod: DeliveryMethod.store_pickup,
      items: [["picking-ui-basic", 1]],
    }),
  );
  const progressPicking = await picking.create({
    tenantId,
    branchId,
    orderId: progressOrder.id,
    priority: PickingPriority.urgent,
  });
  await service.assign(branchId, progressPicking.id);
  const progressLine = (await service.getDetail(branchId, progressPicking.id)).lines[0];
  assert.ok(progressLine);
  await service.updateLine(branchId, {
    pickingOrderId: progressPicking.id,
    pickingLineId: progressLine.pickingLineId,
    pickedQuantity: 1,
    operationId: "picking-ui-progress-fixture",
  });

  addOutOfScopeQueueFixtures(store, mainOrder.id, mainPicking.id);

  // A-B + read-model gap: scoped queue, all active statuses, canonical customer and delivery data.
  const queue = await service.getQueue(branchId);
  const queueIds = new Set(queue.map((item) => item.pickingOrderId));
  assert.ok(queueIds.has(mainPicking.id));
  assert.ok(queueIds.has(assignedPicking.id));
  assert.ok(queueIds.has(progressPicking.id));
  assert.ok(!queueIds.has("picking-ui-other-branch"));
  assert.ok(!queueIds.has("picking-ui-other-tenant"));
  assert.ok(queue.some((item) => item.status === PickingStatus.pending));
  assert.ok(queue.some((item) => item.status === PickingStatus.assigned));
  assert.ok(queue.some((item) => item.status === PickingStatus.in_progress));
  const registeredProjection = queue.find((item) => item.pickingOrderId === mainPicking.id);
  const guestProjection = queue.find((item) => item.pickingOrderId === guestPicking.id);
  const corruptProjection = queue.find((item) => item.pickingOrderId === corruptCustomerPicking.id);
  assert.equal(registeredProjection?.customerName, "Cliente Registrado Picking");
  assert.equal(registeredProjection?.deliveryMethod, mainOrder.deliveryMethod);
  assert.equal(guestProjection?.customerName, "Persona Retiro guest");
  assert.deepEqual(guestProjection?.storePickupContact, guestOrder.storePickupContact);
  assert.equal(guestProjection?.deliveryMethod, guestOrder.deliveryMethod);
  assert.equal(corruptProjection?.customerName, "Persona Retiro customer-scope");
  assert.notEqual(corruptProjection?.customerName, "Cliente Extranjero Secreto");
  const guestDetail = await service.getDetail(branchId, guestPicking.id);
  assert.equal(guestDetail.customerName, "Persona Retiro guest");
  assert.deepEqual(guestDetail.storePickupContact, guestOrder.storePickupContact);

  // C-E. Assignment through the application boundary, idempotent retry and actor conflict.
  const assigned = await service.assign(branchId, mainPicking.id);
  assert.equal(assigned.assignedUserId, actorA);
  assert.equal(assigned.idempotent, false);
  const assignmentRetry = await service.assign(branchId, mainPicking.id);
  assert.equal(assignmentRetry.idempotent, true);
  currentActorId = actorB;
  await assert.rejects(service.assign(branchId, mainPicking.id), /assignment conflict/);
  currentActorId = actorA;

  // F. Detail is real, scoped and contains all UI quantities and traceability data.
  let detail = await service.getDetail(branchId, mainPicking.id);
  assert.equal(detail.customerName, "Cliente Registrado Picking");
  assert.equal(detail.deliveryMethod, DeliveryMethod.home_delivery);
  assert.equal(detail.lines.length, 3);
  const basicLine = requiredLine(detail, "picking-ui-basic");
  const lotLine = requiredLine(detail, "picking-ui-lot");
  const serialLine = requiredLine(detail, "picking-ui-serial");
  assert.equal(detail.progress.requiredQuantity, 15);
  assert.equal(basicLine.remainingQuantity, basicLine.requiredQuantity);
  assert.ok(lotLine.availableLocations.length >= 2);
  assert.ok(lotLine.availableLots.some((lot) => lot.expirationDate));
  assert.deepEqual(serialLine.availableSerialNumbers.sort(), [
    "PICK-UI-SERIAL-1",
    "PICK-UI-SERIAL-2",
  ]);

  const balancesBeforePicking = balanceQuantities(store);
  const movementsBeforePicking = store.getSnapshot().inventoryMovements.length;

  // G-H. Incremental valid target quantities update the authoritative detail.
  detail = await service.updateLine(branchId, {
    pickingOrderId: mainPicking.id,
    pickingLineId: basicLine.pickingLineId,
    pickedQuantity: 1,
    operationId: "picking-ui-basic-1",
  });
  assert.equal(requiredLine(detail, "picking-ui-basic").pickedQuantity, 1);
  assert.equal(requiredLine(detail, "picking-ui-basic").remainingQuantity, 2);

  // S. Completion is rejected while lines remain incomplete.
  await assert.rejects(service.complete(branchId, mainPicking.id), /not completed/);

  // I. An invalid target above the requirement is rejected.
  await assert.rejects(
    service.updateLine(branchId, {
      pickingOrderId: mainPicking.id,
      pickingLineId: basicLine.pickingLineId,
      pickedQuantity: 4,
      operationId: "picking-ui-basic-invalid",
    }),
    /exceeds requestedQuantity/,
  );

  // Q-R. Release preserves progress and appends auditable release history.
  await service.release(branchId, mainPicking.id, "Cambio de operador en mesa");
  detail = await service.getDetail(branchId, mainPicking.id);
  assert.equal(requiredLine(detail, "picking-ui-basic").pickedQuantity, 1);
  assert.equal(detail.assignedUserId, null);
  const releaseHistory = await service.getReleaseHistory(branchId, mainPicking.id);
  assert.equal(releaseHistory.length, 1);
  assert.equal(releaseHistory[0]?.reason, "Cambio de operador en mesa");
  await service.assign(branchId, mainPicking.id);

  await service.updateLine(branchId, {
    pickingOrderId: mainPicking.id,
    pickingLineId: basicLine.pickingLineId,
    pickedQuantity: 3,
    operationId: "picking-ui-basic-3",
  });

  // J-K. Reservation allocations and FEFO are recorded without physical consumption.
  const lotReservation = store
    .getSnapshot()
    .inventoryReservations.find(
      (item) => item.orderId === mainOrder.id && item.productId === "picking-ui-lot",
    );
  assert.ok(lotReservation);
  assert.deepEqual(lotReservation.allocations.map((item) => item.balanceId).sort(), [
    "picking-ui-balance-lot-a",
    "picking-ui-balance-lot-b",
  ]);
  await service.updateLine(branchId, {
    pickingOrderId: mainPicking.id,
    pickingLineId: lotLine.pickingLineId,
    pickedQuantity: 10,
    operationId: "picking-ui-lot-complete",
  });
  const lotSelections = store.getSnapshot().pickingItems.find(
    (item) => item.id === lotLine.pickingLineId)?.pickedAllocations ?? [];
  assert.equal(lotSelections.length, 2);
  assert.deepEqual(
    lotSelections.map((item) => item.lotId),
    ["picking-ui-lot-a", "picking-ui-lot-b"],
  );
  assert.deepEqual(
    lotSelections.map((item) => item.locationId),
    ["loc-centro-a", "loc-centro-b"],
  );
  assert.equal(
    lotSelections.reduce((total, item) => total + item.quantity, 0),
    10,
  );

  // M-L. Arbitrary serials fail; canonical serial payloads are deterministic and idempotent.
  await assert.rejects(
    service.updateLine(branchId, {
      pickingOrderId: mainPicking.id,
      pickingLineId: serialLine.pickingLineId,
      pickedQuantity: 2,
      operationId: "picking-ui-serial-arbitrary",
      serialNumbers: ["SERIAL-INVENTADA", "PICK-UI-SERIAL-1"],
    }),
    /Serial number is not available for Picking/,
  );

  const firstSerialSelection = ["PICK-UI-SERIAL-2", "PICK-UI-SERIAL-1"];
  const retrySerialSelection = ["PICK-UI-SERIAL-1", "PICK-UI-SERIAL-2"];
  const firstCanonicalPayload = normalizePickingSerialNumbers(firstSerialSelection);
  const retryCanonicalPayload = normalizePickingSerialNumbers(retrySerialSelection);
  assert.deepEqual(firstCanonicalPayload, ["PICK-UI-SERIAL-1", "PICK-UI-SERIAL-2"]);
  assert.deepEqual(retryCanonicalPayload, firstCanonicalPayload);
  assert.deepEqual(firstSerialSelection, ["PICK-UI-SERIAL-2", "PICK-UI-SERIAL-1"]);

  await service.updateLine(branchId, {
    pickingOrderId: mainPicking.id,
    pickingLineId: serialLine.pickingLineId,
    pickedQuantity: 2,
    operationId: "picking-ui-serial-canonical",
    serialNumbers: firstCanonicalPayload,
  });
  const movementCountBeforeSerialRetry = store.getSnapshot().inventoryMovements.length;
  await service.updateLine(branchId, {
    pickingOrderId: mainPicking.id,
    pickingLineId: serialLine.pickingLineId,
    pickedQuantity: 2,
    operationId: "picking-ui-serial-canonical",
    serialNumbers: retryCanonicalPayload,
  });
  assert.equal(store.getSnapshot().inventoryMovements.length, movementCountBeforeSerialRetry);
  const serialSelections = store.getSnapshot().pickingItems.find(
    (item) => item.id === serialLine.pickingLineId)?.pickedAllocations ?? [];
  assert.equal(serialSelections.reduce((total, item) => total + (item.serialNumbers?.length ?? 0), 0), 2);
  assert.deepEqual(
    serialSelections.flatMap((item) => item.serialNumbers ?? []).sort(),
    firstCanonicalPayload,
  );

  // N-O. A persisted open incident blocks completion even after every line is complete.
  const incident = await service.registerIncident(branchId, {
    pickingOrderId: mainPicking.id,
    pickingLineId: basicLine.pickingLineId,
    type: PickingIncidentType.quantity_difference,
    quantityAffected: 1,
    comment: "Validación física pendiente",
  });
  assert.equal(incident.status, PickingIncidentStatus.open);
  await assert.rejects(service.complete(branchId, mainPicking.id), /unresolved incidents/);

  // P. Resolving the incident is persisted and removes that completion blocker.
  const resolvedIncident = await service.resolveIncident(branchId, mainPicking.id, incident.id);
  assert.equal(resolvedIncident.status, PickingIncidentStatus.resolved);
  assert.equal(
    (await service.getIncidents(branchId, mainPicking.id))[0]?.status,
    PickingIncidentStatus.resolved,
  );

  // T, W and X. Picking completion is atomic/idempotent and leaves physical stock reserved.
  assert.equal(store.getSnapshot().inventoryMovements.length, movementsBeforePicking);
  assert.deepEqual(balanceQuantities(store), balancesBeforePicking);
  const homeCompletion = await service.complete(branchId, mainPicking.id);
  assert.equal(homeCompletion.orderStatus, OrderStatus.packing);
  assert.equal(homeCompletion.idempotent, false);
  const movementCountAfterCompletion = store.getSnapshot().inventoryMovements.length;
  const homeRetry = await service.complete(branchId, mainPicking.id);
  assert.equal(homeRetry.idempotent, true);
  assert.equal(store.getSnapshot().inventoryMovements.length, movementCountAfterCompletion);

  // U. Store Pickup completes through the same service into ready_for_pickup.
  await service.assign(branchId, guestPicking.id);
  const guestLine = (await service.getDetail(branchId, guestPicking.id)).lines[0];
  assert.ok(guestLine);
  await service.updateLine(branchId, {
    pickingOrderId: guestPicking.id,
    pickingLineId: guestLine.pickingLineId,
    pickedQuantity: guestLine.requiredQuantity,
    operationId: "picking-ui-store-complete",
  });
  const storeCompletion = await service.complete(branchId, guestPicking.id);
  assert.equal(storeCompletion.orderStatus, OrderStatus.packing);
  await finalizePacking(packingService, guestOrder.id, DeliveryMethod.store_pickup, "guest");

  // V. Immediate delivery remains fail-closed without inventing a transition.
  const immediateOrder = await orders.create(
    orderInput({
      suffix: "immediate",
      deliveryMethod: DeliveryMethod.immediate,
      items: [["picking-ui-nonstock", 1]],
    }),
  );
  const immediatePicking = await picking.create({
    tenantId,
    branchId,
    orderId: immediateOrder.id,
    priority: PickingPriority.normal,
  });
  await service.assign(branchId, immediatePicking.id);
  const immediateLine = (await service.getDetail(branchId, immediatePicking.id)).lines[0];
  assert.ok(immediateLine);
  await service.updateLine(branchId, {
    pickingOrderId: immediatePicking.id,
    pickingLineId: immediateLine.pickingLineId,
    pickedQuantity: 1,
    operationId: "picking-ui-immediate-line",
  });
  await assert.rejects(
    service.complete(branchId, immediatePicking.id),
    /cannot complete delivery method: immediate/,
  );

  // Y. A completed home-delivery order enters the productive Packing queue automatically.
  await finalizePacking(packingService, mainOrder.id, DeliveryMethod.home_delivery, "main");
  const preparedQueue = await dispatchService.getPreparedQueue(branchId);
  assert.ok(
    preparedQueue.some(
      (item) => item.orderId === mainOrder.id && item.pickingOrderId === mainPicking.id,
    ),
  );
  assert.ok(!preparedQueue.some((item) => item.orderId === guestOrder.id));

  await verifyFefoSerialOptions(store, orders, picking, service);

  console.log("verify-logistics-picking-ui: PASS");
  console.log(
    "A-Y: scope/queue/read-model/assignment/detail/progress/allocations/FEFO/serial/incidents/release/completion/dispatch PASS",
  );
}

async function verifyFefoSerialOptions(
  store: MockDatabaseStore,
  orders: MockOrderRepository,
  picking: MockPickingRepository,
  service: PickingApplicationService,
) {
  store.transact((db) => {
    const template = db.products.find((item) => item.id === "picking-ui-serial");
    assert.ok(template);
    for (const suffix of ["single", "multi"] as const) {
      const productId = `picking-ui-fefo-serial-${suffix}`;
      const lotCapacities = suffix === "single" ? [5, 5] : [3, 2, 4];
      db.products.push({
        ...template,
        id: productId,
        sku: `PICK-UI-FEFO-${suffix.toUpperCase()}`,
        tracking: { stock: true, lot: true, expiration: true, serial: true },
      });
      db.inventoryBalances.push({
        id: `${productId}-balance`, tenantId, branchId, productId,
        locationId: "loc-centro-a", quantity: lotCapacities.reduce((sum, value) => sum + value, 0),
        reservedQuantity: 0, minStock: 0, updatedAt: now,
      });
      lotCapacities.forEach((quantity, index) => {
        const lotId = `${productId}-lot-${index + 1}`;
        db.stockLots.push({
          id: lotId, tenantId, branchId, productId, locationId: "loc-centro-a",
          lotNumber: `FEFO-${suffix}-${index + 1}`,
          expirationDate: `2026-${String(index + 10).padStart(2, "0")}-01`,
          quantity, createdAt: now,
        });
        for (let serialIndex = 1; serialIndex <= quantity; serialIndex += 1) {
          const serialNumber = `FEFO-${suffix}-${index + 1}-${serialIndex}`;
          db.serialNumbers.push({
            id: `${lotId}-serial-${serialIndex}`, tenantId, branchId, productId,
            locationId: "loc-centro-a", lotId, serialNumber,
            status: SerialStatus.available, createdAt: now, updatedAt: now,
          });
        }
      });
    }
  });

  for (const suffix of ["single", "multi"] as const) {
    const productId = `picking-ui-fefo-serial-${suffix}`;
    const order = await orders.create(orderInput({
      suffix: `fefo-${suffix}`, deliveryMethod: DeliveryMethod.home_delivery,
      items: [[productId, 5]],
    }));
    const pick = await picking.create({ tenantId, branchId, orderId: order.id, priority: PickingPriority.normal });
    await service.assign(branchId, pick.id);
    const line = requiredLine(await service.getDetail(branchId, pick.id), productId);
    const earlySerials = Array.from({ length: suffix === "single" ? 5 : 3 },
      (_, index) => `FEFO-${suffix}-1-${index + 1}`);
    const nextSerials = Array.from({ length: suffix === "single" ? 0 : 2 },
      (_, index) => `FEFO-${suffix}-2-${index + 1}`);
    assert.deepEqual(line.availableSerialNumbers, [...earlySerials, ...nextSerials]);
    assert.ok(!line.availableSerialNumbers.includes(`FEFO-${suffix}-${suffix === "single" ? 2 : 3}-1`));

    if (suffix === "single") {
      await assert.rejects(service.updateLine(branchId, {
        pickingOrderId: pick.id, pickingLineId: line.pickingLineId,
        pickedQuantity: 5, operationId: "picking-ui-fefo-late-denied",
        serialNumbers: [...earlySerials.slice(0, 4), "FEFO-single-2-1"],
      }), /FEFO lot allocation/);
    }
    await service.updateLine(branchId, {
      pickingOrderId: pick.id, pickingLineId: line.pickingLineId,
      pickedQuantity: 5, operationId: `picking-ui-fefo-${suffix}-valid`,
      serialNumbers: [...earlySerials, ...nextSerials],
    });
    const allocations = store.getSnapshot().pickingItems.find((item) =>
      item.id === line.pickingLineId)?.pickedAllocations ?? [];
    assert.deepEqual(allocations.map((item) => [item.lotId, item.quantity]),
      suffix === "single"
        ? [[`${productId}-lot-1`, 5]]
        : [[`${productId}-lot-1`, 3], [`${productId}-lot-2`, 2]]);
  }
}

function prepareDatabase(store: MockDatabaseStore) {
  store.transact((db) => {
    db.orders = [];
    db.orderItems = [];
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
    db.dispatches = [];
    db.packages = [];
    db.notifications = [];

    const productTemplate = db.products.find((item) => item.id === "prod-screws") ?? db.products[0];
    assert.ok(productTemplate);
    db.products.push(
      {
        ...productTemplate,
        id: "picking-ui-basic",
        sku: "PICK-UI-BASIC",
        name: "Producto básico Picking",
        productType: ProductType.physical,
        tracking: { stock: true, lot: false, expiration: false, serial: false },
      },
      {
        ...productTemplate,
        id: "picking-ui-lot",
        sku: "PICK-UI-LOT",
        name: "Producto por lote Picking",
        productType: ProductType.physical,
        tracking: { stock: true, lot: true, expiration: true, serial: false },
      },
      {
        ...productTemplate,
        id: "picking-ui-serial",
        sku: "PICK-UI-SERIAL",
        name: "Producto serializado Picking",
        productType: ProductType.physical,
        tracking: { stock: true, lot: false, expiration: false, serial: true },
      },
      {
        ...productTemplate,
        id: "picking-ui-nonstock",
        sku: "PICK-UI-NONSTOCK",
        name: "Producto sin stock Picking",
        productType: ProductType.physical,
        tracking: { stock: false, lot: false, expiration: false, serial: false },
      },
    );
    db.inventoryBalances.push(
      {
        id: "picking-ui-balance-basic",
        tenantId,
        branchId,
        productId: "picking-ui-basic",
        locationId: "loc-centro-a",
        quantity: 40,
        reservedQuantity: 0,
        minStock: 0,
        updatedAt: now,
      },
      {
        id: "picking-ui-balance-lot-a",
        tenantId,
        branchId,
        productId: "picking-ui-lot",
        locationId: "loc-centro-a",
        quantity: 6,
        reservedQuantity: 0,
        minStock: 0,
        updatedAt: now,
      },
      {
        id: "picking-ui-balance-lot-b",
        tenantId,
        branchId,
        productId: "picking-ui-lot",
        locationId: "loc-centro-b",
        quantity: 4,
        reservedQuantity: 0,
        minStock: 0,
        updatedAt: now,
      },
      {
        id: "picking-ui-balance-serial",
        tenantId,
        branchId,
        productId: "picking-ui-serial",
        locationId: "loc-centro-a",
        quantity: 2,
        reservedQuantity: 0,
        minStock: 0,
        updatedAt: now,
      },
    );
    db.stockLots.push(
      {
        id: "picking-ui-lot-expired",
        tenantId,
        branchId,
        productId: "picking-ui-lot",
        locationId: "loc-centro-a",
        lotNumber: "PICK-EXPIRED",
        expirationDate: "2020-01-01",
        quantity: 20,
        createdAt: now,
      },
      {
        id: "picking-ui-lot-a",
        tenantId,
        branchId,
        productId: "picking-ui-lot",
        locationId: "loc-centro-a",
        lotNumber: "PICK-LOT-A",
        expirationDate: "2026-10-01",
        quantity: 6,
        createdAt: now,
      },
      {
        id: "picking-ui-lot-b",
        tenantId,
        branchId,
        productId: "picking-ui-lot",
        locationId: "loc-centro-b",
        lotNumber: "PICK-LOT-B",
        expirationDate: "2026-12-01",
        quantity: 4,
        createdAt: now,
      },
    );
    db.serialNumbers.push(
      {
        id: "picking-ui-serial-id-1",
        tenantId,
        branchId,
        productId: "picking-ui-serial",
        locationId: "loc-centro-a",
        serialNumber: "PICK-UI-SERIAL-1",
        status: SerialStatus.available,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "picking-ui-serial-id-2",
        tenantId,
        branchId,
        productId: "picking-ui-serial",
        locationId: "loc-centro-a",
        serialNumber: "PICK-UI-SERIAL-2",
        status: SerialStatus.available,
        createdAt: now,
        updatedAt: now,
      },
    );

    db.roles.push({
      id: "role-picking-ui",
      tenantId,
      name: "Picking UI Harness",
      isSystem: false,
      permissions: [
        "logistics.picking.read",
        "logistics.picking.start",
        "logistics.picking.complete",
        "logistics.packing.read",
        "logistics.packing.prepare",
        "logistics.packing.finalize",
        "logistics.dispatch.read",
      ],
      branchScope: "assigned",
      status: RoleStatus.active,
      createdAt: now,
      updatedAt: now,
    });
    for (const [id, name] of [
      [actorA, "Picker UI A"],
      [actorB, "Picker UI B"],
    ]) {
      db.users.push({
        id,
        tenantId,
        employeeCode: id,
        name,
        email: `${id}@example.test`,
        type: UserType.employee,
        status: UserStatus.active,
        roleId: "role-picking-ui",
        branchId,
        createdAt: now,
        updatedAt: now,
      });
    }
    db.customers.push(
      {
        id: "customer-picking-ui",
        tenantId,
        code: "C-PICK-UI",
        name: "Cliente Registrado Picking",
        email: "registered@example.test",
        status: CustomerStatus.active,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "customer-picking-ui-foreign",
        tenantId: "tenant-foreign",
        code: "C-PICK-FOREIGN",
        name: "Cliente Extranjero Secreto",
        email: "secret@example.test",
        status: CustomerStatus.active,
        createdAt: now,
        updatedAt: now,
      },
    );
    assert.ok(db.storageLocations.some((item) => item.id === "loc-centro-a"));
    assert.ok(db.storageLocations.some((item) => item.id === "loc-centro-b"));
  });
}

function orderInput(input: {
  suffix: string;
  deliveryMethod: DeliveryMethod;
  items: Array<[productId: string, quantity: number]>;
  customerId?: string;
  guestName?: string;
}): CreateOrderInput {
  const homeDelivery = input.deliveryMethod === DeliveryMethod.home_delivery;
  const total = input.items.reduce((sum, [, quantity]) => sum + quantity, 0);
  return {
    tenantId,
    branchId,
    orderNumber: `PICK-UI-${input.suffix.toUpperCase()}`,
    source: OrderSource.pos,
    customerId: input.customerId,
    guestCustomer: input.guestName
      ? { name: input.guestName, email: "guest@example.test" }
      : undefined,
    items: input.items.map(([productId, quantity], index) => ({
      id: `picking-ui-${input.suffix}-item-${index + 1}`,
      productId,
      skuSnapshot: productId,
      nameSnapshot: productId,
      quantity,
      unitPrice: 1,
      discount: 0,
      subtotal: quantity,
    })),
    status: OrderStatus.confirmed,
    deliveryMethod: input.deliveryMethod,
    transportMode: homeDelivery ? TransportMode.own_fleet : TransportMode.customer,
    deliveryAddress: homeDelivery
      ? {
          recipientName: "Contacto Picking",
          recipientPhone: "55550000",
          line1: "Zona 1",
          city: "Guatemala",
          country: "Guatemala",
        }
      : undefined,
    storePickupContact:
      input.deliveryMethod === DeliveryMethod.store_pickup
        ? {
            recipientName: `Persona Retiro ${input.suffix}`,
            recipientPhone: "55550002",
          }
        : undefined,
    notificationContact: homeDelivery
      ? { emailMode: "send", email: "picking@example.test" }
      : undefined,
    subtotal: total,
    discountTotal: 0,
    shippingTotal: 0,
    total,
    trackingToken: `tracking-picking-ui-${input.suffix}`,
  };
}

function addOutOfScopeQueueFixtures(
  store: MockDatabaseStore,
  sourceOrderId: string,
  sourcePickingId: string,
) {
  store.transact((db) => {
    const sourceOrder = db.orders.find((item) => item.id === sourceOrderId);
    const sourcePicking = db.pickingOrders.find((item) => item.id === sourcePickingId);
    assert.ok(sourceOrder && sourcePicking);
    db.orders.push({
      ...structuredClone(sourceOrder),
      id: "order-picking-ui-other-branch",
      orderNumber: "OTHER-BRANCH",
      branchId: "branch-norte",
      items: [],
    });
    db.pickingOrders.push({
      ...structuredClone(sourcePicking),
      id: "picking-ui-other-branch",
      orderId: "order-picking-ui-other-branch",
      branchId: "branch-norte",
    });
    db.orders.push({
      ...structuredClone(sourceOrder),
      id: "order-picking-ui-other-tenant",
      orderNumber: "OTHER-TENANT",
      tenantId: "tenant-foreign",
      branchId: "branch-foreign",
      items: [],
    });
    db.pickingOrders.push({
      ...structuredClone(sourcePicking),
      id: "picking-ui-other-tenant",
      orderId: "order-picking-ui-other-tenant",
      tenantId: "tenant-foreign",
      branchId: "branch-foreign",
    });
  });
}

async function finalizePacking(
  service: PackingApplicationService,
  orderId: string,
  deliveryMethod: DeliveryMethod,
  suffix: string,
) {
  const packing = (await service.getQueue(branchId)).find((item) => item.orderId === orderId);
  assert.ok(packing);
  let prepared = await service.savePreparation(branchId, {
    packingId: packing.packingId,
    operationId: `picking-ui-packing-prepare-${suffix}`,
    expectedVersion: packing.version,
    checklist: {
      packageProtectionChecked: true,
      documentIncludedChecked: true,
      recipientVerifiedChecked: true,
    },
    totalWeight: deliveryMethod === DeliveryMethod.home_delivery ? 2 : undefined,
    packageCount: deliveryMethod === DeliveryMethod.home_delivery ? 1 : undefined,
  });
  if (deliveryMethod === DeliveryMethod.home_delivery) {
    const generated = await service.generateLabel(branchId, {
      packingId: packing.packingId,
      operationId: `picking-ui-packing-label-${suffix}`,
      expectedVersion: prepared.packing.version,
    });
    prepared = await service.registerLabelPrint(branchId, {
      packingId: packing.packingId,
      labelGenerationId: generated.packing.labelGenerationId!,
      operationId: `picking-ui-packing-print-${suffix}`,
      expectedVersion: generated.packing.version,
    });
  }
  return service.finalize(branchId, {
    packingId: packing.packingId,
    operationId: `picking-ui-packing-finalize-${suffix}`,
    expectedVersion: prepared.packing.version,
  });
}

function requiredLine(
  detail: Awaited<ReturnType<PickingApplicationService["getDetail"]>>,
  productId: string,
) {
  const line = detail.lines.find((item) => item.productId === productId);
  assert.ok(line);
  return line;
}

function balanceQuantities(store: MockDatabaseStore) {
  return store
    .getSnapshot()
    .inventoryBalances.filter((item) => item.productId.startsWith("picking-ui-"))
    .map((item) => [item.id, item.quantity, item.reservedQuantity] as const)
    .sort((left, right) => left[0].localeCompare(right[0]));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
