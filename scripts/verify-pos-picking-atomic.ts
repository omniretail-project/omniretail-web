import assert from "node:assert/strict";
import { DeliveryMethod, OrderStatus, PickingStatus, TransportMode } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockBranchRepository } from "@/infrastructure/mock/repositories/MockBranchRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockCashShiftRepository } from "@/infrastructure/mock/repositories/MockCashShiftRepository";
import { MockCustomerRepository } from "@/infrastructure/mock/repositories/MockCustomerRepository";
import { MockDispatchRepository } from "@/infrastructure/mock/repositories/MockDispatchRepository";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MockNotificationRepository } from "@/infrastructure/mock/repositories/MockNotificationRepository";
import { MockOrderRepository } from "@/infrastructure/mock/repositories/MockOrderRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockPickingRepository } from "@/infrastructure/mock/repositories/MockPickingRepository";
import { MockPackingRepository } from "@/infrastructure/mock/repositories/MockPackingRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockProductSalesPriceTierRepository } from "@/infrastructure/mock/repositories/MockProductSalesPriceTierRepository";
import { MockPromotionRepository } from "@/infrastructure/mock/repositories/MockPromotionRepository";
import { MockUnitRepository } from "@/infrastructure/mock/repositories/MockUnitRepository";
import { MockRoleRepository } from "@/infrastructure/mock/repositories/MockRoleRepository";
import {
  MockSaleConfirmationRepository,
  type MockSaleConfirmationRepositoryTestHooks,
} from "@/infrastructure/mock/repositories/MockSaleConfirmationRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUserRepository } from "@/infrastructure/mock/repositories/MockUserRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { PackingApplicationService } from "@/modules/logistics/application/services/PackingApplicationService";
import {
  ConfirmSaleService,
  type ConfirmPosSaleInput,
} from "@/modules/pos/application/services/ConfirmSaleService";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const cashierId = "user-cashier";
const warehouseId = "user-warehouse";
const productId = "prod-screws";

async function main() {
  const store = createIsolatedStore();
  const eventBus = new DataEventBus();
  const repositories = createRepositories(store, eventBus);
  const posRepositories = createRepositories(store, eventBus, {}, cashierId);
  const confirmSale = new ConfirmSaleService(posRepositories);
  const picking = new PickingApplicationService(repositories);
  const packing = new PackingApplicationService(repositories);
  const dispatch = new DispatchApplicationService(repositories);

  // A. Immediate POS sales keep the existing direct-sale inventory path.
  const immediateInput = confirmationInput(store, DeliveryMethod.immediate, "immediate");
  const immediate = await confirmSale.execute(immediateInput);
  assert.equal(immediate.sale.sourceOrderId, undefined);
  assert.equal(immediate.order, undefined);
  assert.equal(immediate.pickingOrder, undefined);
  assert.equal(store.getSnapshot().orders.length, 0);
  assert.equal(store.getSnapshot().pickingOrders.length, 0);
  assert.equal(immediate.inventoryMovements.length, 1);

  const pickupMissingName = confirmationInput(
    store,
    DeliveryMethod.store_pickup,
    "pickup-missing-name",
  );
  pickupMissingName.checkout.storePickupContact!.recipientName = "";
  await assert.rejects(confirmSale.execute(pickupMissingName), /datos de pago deben revisarse/);
  const pickupMissingPhone = confirmationInput(
    store,
    DeliveryMethod.store_pickup,
    "pickup-missing-phone",
  );
  pickupMissingPhone.checkout.storePickupContact!.recipientPhone = "";
  await assert.rejects(confirmSale.execute(pickupMissingPhone), /datos de pago deben revisarse/);
  const pickupInvalidPhone = confirmationInput(
    store,
    DeliveryMethod.store_pickup,
    "pickup-invalid-phone",
  );
  pickupInvalidPhone.checkout.storePickupContact!.recipientPhone = "1234";
  await assert.rejects(confirmSale.execute(pickupInvalidPhone), /datos de pago deben revisarse/);

  // B-C. Deferred POS confirmations create canonical Orders and pending PickingOrders atomically.
  const pickupInput = confirmationInput(store, DeliveryMethod.store_pickup, "pickup");
  const pickup = await confirmSale.execute(pickupInput);
  assertDeferredResult(pickup, DeliveryMethod.store_pickup);
  assert.deepEqual(pickup.order?.storePickupContact, {
    recipientName: "Persona que retira",
    recipientPhone: "55550003",
  });
  assert.equal(pickup.order?.deliveryAddress, undefined);
  const pickupRetry = await confirmSale.execute(pickupInput);
  assert.equal(pickupRetry.idempotent, true);
  assert.equal(pickupRetry.order?.id, pickup.order?.id);
  assert.deepEqual(pickupRetry.order?.storePickupContact, pickup.order?.storePickupContact);

  const homeInput = confirmationInput(store, DeliveryMethod.home_delivery, "home");
  homeInput.checkout.storePickupContact = {
    recipientName: "No debe persistirse",
    recipientPhone: "55550004",
  };
  const home = await confirmSale.execute(homeInput);
  assertDeferredResult(home, DeliveryMethod.home_delivery);
  assert.deepEqual(home.order?.notificationContact, {
    emailMode: "send",
    email: "delivery@example.com",
  });
  assert.equal(home.order?.deliveryAddress?.recipientPhone, "55550000");
  assert.equal(home.order?.storePickupContact, undefined);

  const queue = await picking.getQueue(branchId);
  const pickupQueueItem = queue.find((item) => item.pickingOrderId === pickup.pickingOrder?.id);
  const homeQueueItem = queue.find((item) => item.pickingOrderId === home.pickingOrder?.id);
  assert.equal(pickupQueueItem?.orderReference, pickup.sale.number);
  assert.equal(homeQueueItem?.orderReference, home.sale.number);
  assert.equal(pickupQueueItem?.deliveryMethod, DeliveryMethod.store_pickup);
  assert.equal(pickupQueueItem?.customerName, "Persona que retira");
  assert.deepEqual(pickupQueueItem?.storePickupContact, pickup.order?.storePickupContact);
  assert.equal(homeQueueItem?.deliveryMethod, DeliveryMethod.home_delivery);

  // D-E. Productive Picking completion owns the canonical delivery transitions.
  const pickupCompleted = await completePicking(picking, pickup.pickingOrder!.id, "pickup");
  assert.equal(pickupCompleted.orderStatus, OrderStatus.packing);
  const homeCompleted = await completePicking(picking, home.pickingOrder!.id, "home");
  assert.equal(homeCompleted.orderStatus, OrderStatus.packing);
  await finalizePacking(packing, pickup.order!.id, DeliveryMethod.store_pickup, "pickup");
  await finalizePacking(packing, home.order!.id, DeliveryMethod.home_delivery, "home");
  const prepared = await dispatch.getPreparedQueue(branchId);
  assert.ok(prepared.some((item) => item.orderId === home.order?.id));
  assert.ok(!prepared.some((item) => item.orderId === pickup.order?.id));

  // F. The same confirmation returns the same aggregate graph without duplicates.
  const beforeRetry = entityCounts(store);
  const homeRetry = await confirmSale.execute(homeInput);
  assert.equal(homeRetry.idempotent, true);
  assert.equal(homeRetry.sale.id, home.sale.id);
  assert.equal(homeRetry.order?.id, home.order?.id);
  assert.equal(homeRetry.pickingOrder?.id, home.pickingOrder?.id);
  assert.deepEqual(entityCounts(store), beforeRetry);
  const retrySnapshot = store.getSnapshot();
  assert.equal(
    retrySnapshot.sales.filter((sale) => sale.confirmationId === homeInput.confirmationId).length,
    1,
  );
  assert.equal(
    retrySnapshot.orders.filter((order) => order.idempotencyKey === homeInput.orderIdempotencyKey)
      .length,
    1,
  );
  assert.equal(
    retrySnapshot.pickingOrders.filter((item) => item.orderId === home.order?.id).length,
    1,
  );

  // G. A late failure after Picking construction rolls the entire graph back.
  const rollbackStore = createIsolatedStore();
  const rollbackEvents = new DataEventBus();
  const hooks: MockSaleConfirmationRepositoryTestHooks = {
    afterDeferredPickingCreated: () => {
      throw new Error("simulated late deferred fulfillment failure");
    },
  };
  const rollbackRepositories = createRepositories(
    rollbackStore,
    rollbackEvents,
    hooks,
    cashierId,
  );
  const rollbackService = new ConfirmSaleService(rollbackRepositories);
  const rollbackBefore = rollbackSnapshot(rollbackStore);
  await assert.rejects(
    rollbackService.execute(
      confirmationInput(rollbackStore, DeliveryMethod.home_delivery, "rollback"),
    ),
    /simulated late deferred fulfillment failure/,
  );
  assert.deepEqual(rollbackSnapshot(rollbackStore), rollbackBefore);

  // H. Every generated aggregate remains inside the trusted tenant/branch scope.
  const snapshot = store.getSnapshot();
  for (const order of snapshot.orders) {
    assert.equal(order.tenantId, tenantId);
    assert.equal(order.branchId, branchId);
  }
  for (const pickingOrder of snapshot.pickingOrders) {
    assert.equal(pickingOrder.tenantId, tenantId);
    assert.equal(pickingOrder.branchId, branchId);
  }
  assert.equal(
    (await repositories.picking.getQueue({ tenantId, branchId: "branch-norte" })).length,
    0,
  );

  console.log("verify-pos-picking-atomic: PASS");
  console.log(
    "A-H immediate, deferred fulfillment, queue, completion, retry, rollback and scope: PASS",
  );
}

function createIsolatedStore() {
  const store = new MockDatabaseStore(new LocalStorageAdapter());
  store.transact((db) => {
    db.orders = [];
    db.orderItems = [];
    db.payments = [];
    db.sales = db.sales.filter((sale) => sale.id === "sale-001");
    db.saleItems = [];
    db.cashMovements = [];
    db.inventoryMovements = [];
    db.inventoryReservations = [];
    db.inventoryReservationConsumeOperations = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.pickingItemUpdateOperations = [];
    db.pickingAssignmentReleases = [];
    db.pickingIncidents = [];
    db.packings = [];
    db.packingOperations = [];
    db.dispatches = [];
    db.packages = [];
    db.notifications = [];
    db.inventoryBalances.forEach((balance) => {
      balance.reservedQuantity = 0;
      if (balance.productId === productId && balance.branchId === branchId) {
        balance.quantity = 100;
      }
    });
  });
  return store;
}

function createRepositories(
  store: MockDatabaseStore,
  eventBus: DataEventBus,
  saleHooks: MockSaleConfirmationRepositoryTestHooks = {},
  sessionUserId = warehouseId,
): RepositoryRegistry {
  const auth = {
    getCurrentSessionId: async () => "session-pos-picking-atomic",
    getSession: async () => ({
      id: "session-pos-picking-atomic",
      userId: sessionUserId,
      createdAt: "2026-09-14T10:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      rememberMe: false,
    }),
  };
  return {
    auth,
    branches: new MockBranchRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    cashShifts: new MockCashShiftRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    dispatches: new MockDispatchRepository(store, eventBus),
    inventory: new MockInventoryRepository(store, eventBus),
    notifications: new MockNotificationRepository(store, eventBus),
    orders: new MockOrderRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    picking: new MockPickingRepository(store, eventBus),
    packings: new MockPackingRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, eventBus),
    promotions: new MockPromotionRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    saleConfirmations: new MockSaleConfirmationRepository(store, eventBus, saleHooks),
    tenants: new MockTenantRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
}

function confirmationInput(
  store: MockDatabaseStore,
  deliveryMethod: DeliveryMethod,
  suffix: string,
): ConfirmPosSaleInput {
  const snapshot = store.getSnapshot();
  const user = snapshot.users.find((item) => item.id === cashierId);
  const currentBranch = snapshot.branches.find((item) => item.id === branchId);
  const cashShift = snapshot.cashShifts.find((item) => item.id === "cash-shift-001");
  const product = snapshot.products.find((item) => item.id === productId);
  assert.ok(user && currentBranch && cashShift && product);
  assert.ok(product.saleUnitId);
  const unitPrice = product.salePrice;
  const isHome = deliveryMethod === DeliveryMethod.home_delivery;
  const isDeferred = deliveryMethod !== DeliveryMethod.immediate;
  return {
    confirmationId: `pos-picking-confirmation-${suffix}`,
    branchId: currentBranch.id,
    cashShiftId: cashShift.id,
    orderIdempotencyKey: isDeferred ? `pos-picking-order-${suffix}` : undefined,
    ticket: {
      items: [
        {
          productId,
          sku: product.sku,
          name: product.name,
          saleUnitId: product.saleUnitId,
          saleUnitName: "Caja",
          quantity: 1,
          baseUnitPrice: unitPrice,
          unitPrice,
          discount: 0,
          subtotal: unitPrice,
          availableQuantity: 100,
          tracksStock: true,
          requiresUnsupportedTraceability: false,
        },
      ],
      subtotal: unitPrice,
      discountTotal: 0,
      total: unitPrice,
      hasUnsupportedTraceability: false,
    },
    checkout: {
      documentType: "ticket",
      invoiceData: { taxId: "", legalName: "", fiscalAddress: "" },
      paymentMode: "cash",
      cashAmount: unitPrice,
      cashReceived: unitPrice,
      changeAmount: 0,
      cardAmount: 0,
      cardTerminalResult: { status: "idle" },
      transferAmount: 0,
      bankAccountId: "",
      transferReference: "",
      transferExternallyVerified: false,
      deliveryMethod,
      transportMode: TransportMode.own_fleet,
      deliveryAddress: isHome
        ? {
            recipientName: "Cliente POS",
            recipientPhone: "55550000",
            line1: "Zona 1",
            city: "Guatemala",
            country: "Guatemala",
          }
        : undefined,
      storePickupContact:
        deliveryMethod === DeliveryMethod.store_pickup
          ? {
              recipientName: "  Persona que retira  ",
              recipientPhone: " 55550003 ",
            }
          : undefined,
      notificationContact: isHome
        ? { emailMode: "send", email: "delivery@example.com" }
        : { emailMode: "not_applicable" },
    },
  };
}

function assertDeferredResult(
  result: Awaited<ReturnType<ConfirmSaleService["execute"]>>,
  deliveryMethod: DeliveryMethod,
) {
  assert.ok(result.order);
  assert.ok(result.pickingOrder);
  assert.equal(result.sale.sourceOrderId, result.order.id);
  assert.equal(result.order.orderNumber, result.sale.number);
  assert.match(result.sale.number, /^POS-\d{3}$/);
  assert.equal(result.order.source, "pos");
  assert.equal(result.order.deliveryMethod, deliveryMethod);
  assert.equal(result.order.status, OrderStatus.confirmed);
  assert.equal(result.pickingOrder.orderId, result.order.id);
  assert.equal(result.pickingOrder.status, PickingStatus.pending);
  assert.equal(result.inventoryMovements.length, 0);
}

async function completePicking(
  service: PickingApplicationService,
  pickingOrderId: string,
  suffix: string,
) {
  await service.assign(branchId, pickingOrderId);
  const detail = await service.getDetail(branchId, pickingOrderId);
  for (const line of detail.lines) {
    await service.updateLine(branchId, {
      pickingOrderId,
      pickingLineId: line.pickingLineId,
      pickedQuantity: line.requiredQuantity,
      operationId: `pos-picking-consume-${suffix}-${line.pickingLineId}`,
    });
  }
  return service.complete(branchId, pickingOrderId);
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
    operationId: `pos-packing-prepare-${suffix}`,
    expectedVersion: packing.version,
    checklist: {
      packageProtectionChecked: true,
      documentIncludedChecked: true,
      recipientVerifiedChecked: true,
    },
    totalWeight: deliveryMethod === DeliveryMethod.home_delivery ? 1 : undefined,
    packageCount: deliveryMethod === DeliveryMethod.home_delivery ? 1 : undefined,
  });
  if (deliveryMethod === DeliveryMethod.home_delivery) {
    const generated = await service.generateLabel(branchId, {
      packingId: packing.packingId,
      operationId: `pos-packing-label-${suffix}`,
      expectedVersion: prepared.packing.version,
    });
    prepared = await service.registerLabelPrint(branchId, {
      packingId: packing.packingId,
      labelGenerationId: generated.packing.labelGenerationId!,
      operationId: `pos-packing-print-${suffix}`,
      expectedVersion: generated.packing.version,
    });
  }
  return service.finalize(branchId, {
    packingId: packing.packingId,
    operationId: `pos-packing-finalize-${suffix}`,
    expectedVersion: prepared.packing.version,
  });
}

function entityCounts(store: MockDatabaseStore) {
  const db = store.getSnapshot();
  return {
    sales: db.sales.length,
    saleItems: db.saleItems.length,
    orders: db.orders.length,
    reservations: db.inventoryReservations.length,
    pickingOrders: db.pickingOrders.length,
    pickingItems: db.pickingItems.length,
    packings: db.packings.length,
    packingOperations: db.packingOperations.length,
    payments: db.payments.length,
    cashMovements: db.cashMovements.length,
    inventoryMovements: db.inventoryMovements.length,
  };
}

function rollbackSnapshot(store: MockDatabaseStore) {
  const db = store.getSnapshot();
  return {
    counts: entityCounts(store),
    balances: db.inventoryBalances.map((balance) => ({
      id: balance.id,
      quantity: balance.quantity,
      reservedQuantity: balance.reservedQuantity,
    })),
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
