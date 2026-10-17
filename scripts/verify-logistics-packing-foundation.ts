import assert from "node:assert/strict";
import {
  DeliveryMethod,
  OrderSource,
  OrderStatus,
  PackingStatus,
  PickingPriority,
  TransportMode,
} from "@/core/enums";
import type { OrderNotificationContact } from "@/core/types/orderNotification.types";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  MockBranchRepository,
  MockCustomerRepository,
  MockDispatchRepository,
  MockOrderRepository,
  MockPackingRepository,
  MockPickingRepository,
  MockProductRepository,
  MockRoleRepository,
  MockStorePickupDeliveryRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { PackingApplicationService } from "@/modules/logistics/application/services/PackingApplicationService";
import { filterPackingQueue } from "@/modules/logistics/hooks/useLogisticsPacking";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const actorUserId = "user-warehouse";
const completeChecklist = {
  packageProtectionChecked: true,
  documentIncludedChecked: true,
  recipientVerifiedChecked: true,
};

async function main() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  prepareDatabase(store);
  const runtime = createRuntime(store);

  const legacyStorage = new MemoryStorageAdapter();
  const legacySnapshot: Partial<MockDatabase> = store.getSnapshot();
  delete legacySnapshot.packings;
  delete legacySnapshot.packingOperations;
  legacyStorage.set(MOCK_DATABASE_STORAGE_KEY, legacySnapshot);
  const legacyStore = new MockDatabaseStore(legacyStorage);
  assert.deepEqual(legacyStore.getSnapshot().packings, []);
  assert.deepEqual(legacyStore.getSnapshot().packingOperations, []);

  const home = await completePicking(
    runtime.orders,
    runtime.picking,
    "home",
    DeliveryMethod.home_delivery,
  );
  assert.equal(home.order.status, OrderStatus.packing);
  assert.equal(home.pickingOrder.status, "completed");
  assert.equal(home.packing.status, PackingStatus.in_progress);
  assert.equal(store.getSnapshot().packings.length, 1);
  const inventoryAfterHomePicking = inventorySnapshot(store);

  const queue = await runtime.packingService.getQueue(branchId);
  assert.deepEqual(
    queue.map((item) => item.packingId),
    [home.packing.id],
  );
  const initial = await runtime.packingService.getDetail(branchId, home.packing.id);
  assert.equal(initial.version, 0);
  assert.equal(initial.deliveryMethod, DeliveryMethod.home_delivery);

  const reloadedStore = new MockDatabaseStore(storage);
  const reloadedPacking = new MockPackingRepository(reloadedStore, new DataEventBus());
  assert.equal(
    (await reloadedPacking.getById({ tenantId, branchId }, home.packing.id))?.id,
    home.packing.id,
  );

  await assert.rejects(
    runtime.packingService.finalize(branchId, {
      packingId: home.packing.id,
      operationId: "home-finalize-incomplete",
      expectedVersion: initial.version,
    }),
    /checklist is incomplete/,
  );

  const checklistOnly = await runtime.packingService.savePreparation(branchId, {
    packingId: home.packing.id,
    operationId: "home-checklist",
    expectedVersion: initial.version,
    checklist: completeChecklist,
  });
  const checklistRetry = await runtime.packingService.savePreparation(branchId, {
    packingId: home.packing.id,
    operationId: "home-checklist",
    expectedVersion: initial.version,
    checklist: completeChecklist,
  });
  assert.equal(checklistRetry.idempotent, true);
  await assert.rejects(
    runtime.packingService.generateLabel(branchId, {
      packingId: home.packing.id,
      operationId: "home-label-no-weight",
      expectedVersion: checklistOnly.packing.version,
    }),
    /totalWeight is required/,
  );

  const prepared = await runtime.packingService.savePreparation(branchId, {
    packingId: home.packing.id,
    operationId: "home-measurements",
    expectedVersion: checklistOnly.packing.version,
    checklist: completeChecklist,
    totalWeight: 3.75,
    packageCount: 2,
  });
  await assert.rejects(
    runtime.packingService.finalize(branchId, {
      packingId: home.packing.id,
      operationId: "home-finalize-no-label",
      expectedVersion: prepared.packing.version,
    }),
    /label has not been generated/,
  );

  const generated = await runtime.packingService.generateLabel(branchId, {
    packingId: home.packing.id,
    operationId: "home-generate-label",
    expectedVersion: prepared.packing.version,
  });
  assert.ok(generated.packing.labelGenerationId && generated.packing.labelCode);
  await assert.rejects(
    runtime.packingService.finalize(branchId, {
      packingId: home.packing.id,
      operationId: "home-finalize-no-print",
      expectedVersion: generated.packing.version,
    }),
    /label print is required/,
  );

  const printed = await runtime.packingService.registerLabelPrint(branchId, {
    packingId: home.packing.id,
    labelGenerationId: generated.packing.labelGenerationId,
    operationId: "home-print-label",
    expectedVersion: generated.packing.version,
  });
  const invalidated = await runtime.packingService.savePreparation(branchId, {
    packingId: home.packing.id,
    operationId: "home-change-label-data",
    expectedVersion: printed.packing.version,
    checklist: completeChecklist,
    totalWeight: 4,
    packageCount: 2,
  });
  assert.equal(invalidated.packing.labelGenerationId, null);
  assert.equal(invalidated.packing.labelPrintedAt, null);
  const regenerated = await runtime.packingService.generateLabel(branchId, {
    packingId: home.packing.id,
    operationId: "home-regenerate-label",
    expectedVersion: invalidated.packing.version,
  });
  const reprinted = await runtime.packingService.registerLabelPrint(branchId, {
    packingId: home.packing.id,
    labelGenerationId: regenerated.packing.labelGenerationId!,
    operationId: "home-reprint-label",
    expectedVersion: regenerated.packing.version,
  });

  const finalizedHome = await runtime.packingService.finalize(branchId, {
    packingId: home.packing.id,
    operationId: "home-finalize",
    expectedVersion: reprinted.packing.version,
  });
  assert.equal(finalizedHome.orderStatus, OrderStatus.ready_for_dispatch);
  assert.equal(finalizedHome.packing.status, PackingStatus.finalized);
  const finalizedHomeRetry = await runtime.packingService.finalize(branchId, {
    packingId: home.packing.id,
    operationId: "home-finalize",
    expectedVersion: reprinted.packing.version,
  });
  assert.equal(finalizedHomeRetry.idempotent, true);
  assert.deepEqual(inventorySnapshot(store), inventoryAfterHomePicking);

  const pickup = await completePicking(
    runtime.orders,
    runtime.picking,
    "pickup",
    DeliveryMethod.store_pickup,
  );
  const pickupDetail = await runtime.packingService.getDetail(branchId, pickup.packing.id);
  assert.deepEqual(pickupDetail.storePickupContact, {
    recipientName: "Persona Retiro pickup",
    recipientPhone: "55550001",
  });
  const pickupQueue = await runtime.packingService.getQueue(branchId);
  assert.equal(filterPackingQueue(pickupQueue, "persona retiro")[0]?.packingId, pickup.packing.id);
  const pickupPrepared = await runtime.packingService.savePreparation(branchId, {
    packingId: pickup.packing.id,
    operationId: "pickup-prepare",
    expectedVersion: pickup.packing.version,
    checklist: completeChecklist,
  });
  await assert.rejects(
    runtime.packingService.generateLabel(branchId, {
      packingId: pickup.packing.id,
      operationId: "pickup-label",
      expectedVersion: pickupPrepared.packing.version,
    }),
    /only available for home delivery/,
  );
  const finalizedPickup = await runtime.packingService.finalize(branchId, {
    packingId: pickup.packing.id,
    operationId: "pickup-finalize",
    expectedVersion: pickupPrepared.packing.version,
  });
  assert.equal(finalizedPickup.orderStatus, OrderStatus.ready_for_pickup);
  assert.equal(
    (await runtime.packingService.getQueue(branchId))
      .some((item) => item.packingId === pickup.packing.id),
    true,
  );
  const inventoryBeforePickupDelivery = inventorySnapshot(store);
  const deliveredPickup = await runtime.packingService.confirmStorePickupDelivery(branchId, {
    packingId: pickup.packing.id,
    operationId: "pickup-delivery",
  });
  assert.equal(deliveredPickup.orderStatus, OrderStatus.delivered);
  assert.equal(deliveredPickup.idempotent, false);
  const deliveredPickupRetry = await runtime.packingService.confirmStorePickupDelivery(branchId, {
    packingId: pickup.packing.id,
    operationId: "pickup-delivery",
  });
  assert.equal(deliveredPickupRetry.idempotent, true);
  assert.equal(deliveredPickupRetry.deliveredAt, deliveredPickup.deliveredAt);
  assert.equal(
    (await runtime.packingService.getQueue(branchId))
      .some((item) => item.packingId === pickup.packing.id),
    false,
  );
  assert.equal(
    store.getSnapshot().storePickupDeliveries.filter((item) => item.orderId === pickup.order.id).length,
    1,
  );
  const inventoryAfterPickupDelivery = inventorySnapshot(store);
  const beforePickupBalance = inventoryBeforePickupDelivery.balances.find((item) => item.id === "bal-screws");
  const afterPickupBalance = inventoryAfterPickupDelivery.balances.find((item) => item.id === "bal-screws");
  assert.equal(afterPickupBalance?.quantity, (beforePickupBalance?.quantity ?? 0) - 1);
  assert.equal(afterPickupBalance?.reservedQuantity, (beforePickupBalance?.reservedQuantity ?? 0) - 1);
  assert.equal(inventoryAfterPickupDelivery.movements.length,
    inventoryBeforePickupDelivery.movements.length + 1);

  const concurrent = await completePicking(
    runtime.orders,
    runtime.picking,
    "concurrent",
    DeliveryMethod.store_pickup,
  );
  const concurrencyResults = await Promise.allSettled([
    runtime.packings.savePreparation({
      tenantId,
      branchId,
      actorUserId,
      packingId: concurrent.packing.id,
      operationId: "concurrent-a",
      expectedVersion: 0,
      checklist: completeChecklist,
    }),
    runtime.packings.savePreparation({
      tenantId,
      branchId,
      actorUserId,
      packingId: concurrent.packing.id,
      operationId: "concurrent-b",
      expectedVersion: 0,
      checklist: {
        ...completeChecklist,
        recipientVerifiedChecked: false,
      },
    }),
  ]);
  assert.equal(concurrencyResults.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(concurrencyResults.filter((item) => item.status === "rejected").length, 1);
  assert.match(
    String(
      (concurrencyResults.find((item) => item.status === "rejected") as PromiseRejectedResult)
        .reason,
    ),
    /version conflict/,
  );

  const rollback = await completePicking(
    runtime.orders,
    runtime.picking,
    "rollback",
    DeliveryMethod.store_pickup,
  );
  const rollbackPrepared = await runtime.packings.savePreparation({
    tenantId,
    branchId,
    actorUserId,
    packingId: rollback.packing.id,
    operationId: "rollback-prepare",
    expectedVersion: 0,
    checklist: completeChecklist,
  });
  const rollbackRepository = new MockPackingRepository(store, runtime.eventBus, {
    afterPackingFinalized: () => {
      throw new Error("late packing failure");
    },
  });
  const rollbackBefore = packingMutationSnapshot(store, rollback.packing.id, rollback.order.id);
  await assert.rejects(
    rollbackRepository.finalize({
      tenantId,
      branchId,
      actorUserId,
      packingId: rollback.packing.id,
      operationId: "rollback-finalize",
      expectedVersion: rollbackPrepared.packing.version,
    }),
    /late packing failure/,
  );
  assert.deepEqual(
    packingMutationSnapshot(store, rollback.packing.id, rollback.order.id),
    rollbackBefore,
  );

  const unfinalizedHome = await completePicking(
    runtime.orders,
    runtime.picking,
    "dispatch-blocked",
    DeliveryMethod.home_delivery,
  );
  await assert.rejects(
    runtime.dispatchService.confirm(branchId, {
      orderId: unfinalizedHome.order.id,
      operationId: "dispatch-before-packing",
    }),
    /Finalized home-delivery Packing not found/,
  );

  const inventoryBeforeDispatch = inventorySnapshot(store);
  const dispatch = await runtime.dispatchService.confirm(branchId, {
    orderId: home.order.id,
    operationId: "dispatch-from-packing",
  });
  assert.equal(dispatch.orderStatus, OrderStatus.dispatched);
  assert.equal(dispatch.packages.length, 2);
  const persistedDispatch = await runtime.dispatches.getById(
    { tenantId, branchId },
    dispatch.dispatchId,
  );
  assert.equal(persistedDispatch?.packageCount, 2);
  assert.equal(persistedDispatch?.weight, 4);
  assert.ok(
    dispatch.packages.every((item) => item.number.startsWith(finalizedHome.packing.labelCode!)),
  );
  const inventoryAfterDispatch = inventorySnapshot(store);
  const beforeDispatchBalance = inventoryBeforeDispatch.balances.find((item) => item.id === "bal-screws");
  const afterDispatchBalance = inventoryAfterDispatch.balances.find((item) => item.id === "bal-screws");
  assert.equal(afterDispatchBalance?.quantity, (beforeDispatchBalance?.quantity ?? 0) - 1);
  assert.equal(afterDispatchBalance?.reservedQuantity, (beforeDispatchBalance?.reservedQuantity ?? 0) - 1);
  assert.equal(inventoryAfterDispatch.movements.length, inventoryBeforeDispatch.movements.length + 1);
  const finalizedDetail = await runtime.packingService.getDetail(branchId, home.packing.id);
  const reprintAfterDispatch = await runtime.packingService.registerLabelPrint(branchId, {
    packingId: home.packing.id,
    labelGenerationId: finalizedDetail.labelGenerationId!,
    operationId: "home-reprint-after-dispatch",
    expectedVersion: finalizedDetail.version,
  });
  assert.equal(reprintAfterDispatch.packing.status, PackingStatus.finalized);
  const dispatchRetry = await runtime.dispatchService.confirm(branchId, {
    orderId: home.order.id,
    operationId: "dispatch-from-packing",
  });
  assert.equal(dispatchRetry.idempotent, true);

  console.log("verify-logistics-packing-foundation: PASS");
  console.log(
    "Picking→Packing, persistence, validation, label, idempotency, concurrency, rollback, inventory and Dispatch: PASS",
  );
}

function createRuntime(store: MockDatabaseStore) {
  const eventBus = new DataEventBus();
  const orders = new MockOrderRepository(store, eventBus);
  const picking = new MockPickingRepository(store, eventBus);
  const packings = new MockPackingRepository(store, eventBus);
  const dispatches = new MockDispatchRepository(store, eventBus);
  const storePickupDeliveries = new MockStorePickupDeliveryRepository(store, eventBus);
  const repositories = {
    auth: {
      getCurrentSessionId: async () => "packing-session",
      getSession: async () => ({
        id: "packing-session",
        userId: actorUserId,
        createdAt: "2026-09-14T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        rememberMe: false,
      }),
    },
    branches: new MockBranchRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    dispatches,
    orders,
    packings,
    picking,
    products: new MockProductRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    storePickupDeliveries,
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
  return {
    eventBus,
    orders,
    picking,
    packings,
    dispatches,
    packingService: new PackingApplicationService(repositories),
    dispatchService: new DispatchApplicationService(repositories),
  };
}

async function completePicking(
  orders: MockOrderRepository,
  picking: MockPickingRepository,
  suffix: string,
  deliveryMethod: DeliveryMethod,
) {
  const order = await orders.create(orderInput(suffix, deliveryMethod));
  const pickingOrder = await picking.create({
    tenantId,
    branchId,
    orderId: order.id,
    priority: PickingPriority.normal,
  });
  await picking.assign({ tenantId, branchId, pickingOrderId: pickingOrder.id, actorUserId });
  const [line] = await picking.getItems({ tenantId, branchId }, pickingOrder.id);
  assert.ok(line);
  await picking.updateItem({
    tenantId,
    branchId,
    pickingOrderId: pickingOrder.id,
    pickingItemId: line.id,
    pickedQuantity: line.requestedQuantity,
    operationId: `pick-${suffix}`,
    performedByUserId: actorUserId,
  });
  return picking.complete({ tenantId, branchId, pickingOrderId: pickingOrder.id, actorUserId });
}

function orderInput(
  suffix: string,
  deliveryMethod: DeliveryMethod,
  notificationContact: OrderNotificationContact = { emailMode: "not_applicable" },
) {
  return {
    tenantId,
    branchId,
    orderNumber: `PACK-${suffix}`,
    source:
      deliveryMethod === DeliveryMethod.home_delivery ? OrderSource.ecommerce : OrderSource.pos,
    customerId: "customer-ana",
    items: [
      {
        id: `pack-item-${suffix}`,
        productId: "prod-screws",
        skuSnapshot: "SCREWS",
        nameSnapshot: "Screws",
        quantity: 1,
        unitPrice: 24.99,
        discount: 0,
        subtotal: 24.99,
      },
    ],
    status: OrderStatus.confirmed,
    deliveryMethod,
    transportMode:
      deliveryMethod === DeliveryMethod.home_delivery
        ? TransportMode.own_fleet
        : TransportMode.customer,
    deliveryAddress:
      deliveryMethod === DeliveryMethod.home_delivery
        ? {
            recipientName: "Packing Recipient",
            recipientPhone: "55550000",
            line1: "Zona 1",
            city: "Guatemala",
            country: "Guatemala",
          }
        : undefined,
    storePickupContact:
      deliveryMethod === DeliveryMethod.store_pickup
        ? {
            recipientName: `Persona Retiro ${suffix}`,
            recipientPhone: "55550001",
          }
        : undefined,
    notificationContact,
    subtotal: 24.99,
    discountTotal: 0,
    shippingTotal: 0,
    total: 24.99,
    trackingToken: `packing-tracking-${suffix}`,
  };
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

function inventorySnapshot(store: MockDatabaseStore) {
  const db = store.getSnapshot();
  return {
    balances: db.inventoryBalances.map(({ id, quantity, reservedQuantity }) => ({
      id,
      quantity,
      reservedQuantity,
    })),
    reservations: db.inventoryReservations.map((item) => structuredClone(item)),
    movements: db.inventoryMovements.map((item) => structuredClone(item)),
    lots: db.stockLots.map((item) => structuredClone(item)),
    serials: db.serialNumbers.map((item) => structuredClone(item)),
  };
}

function packingMutationSnapshot(store: MockDatabaseStore, packingId: string, orderId: string) {
  const db = store.getSnapshot();
  return {
    packing: db.packings.find((item) => item.id === packingId),
    order: db.orders.find((item) => item.id === orderId),
    operations: db.packingOperations.filter((item) => item.packingId === packingId),
  };
}

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

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
