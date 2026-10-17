import assert from "node:assert/strict";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Order } from "@/core/entities";
import {
  DeliveryMethod,
  DispatchStatus,
  InventoryTransferStatus,
  OrderSource,
  OrderStatus,
  PackingStatus,
  PickingItemStatus,
  PickingPriority,
  PickingStatus,
  ProductStatus,
  ProductType,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockCustomerRepository,
  MockDispatchRepository,
  MockInventoryRepository,
  MockInventoryTransferRepository,
  MockNotificationRepository,
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
import { GetLogisticsHistoryService } from "@/modules/logistics/application/services/GetLogisticsHistoryService";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { LogisticsHistoryDetailModal } from "@/modules/logistics/components/LogisticsHistoryDetailModal";
import {
  canAddGuide,
  LogisticsHistoryTable,
} from "@/modules/logistics/components/LogisticsHistoryTable";
import {
  defaultLogisticsHistoryFilters,
  filterLogisticsHistory,
} from "@/modules/logistics/hooks/useLogisticsHistory";
import { validateDispatchShipment } from "@/modules/logistics/validation/dispatch.validation";

const tenantId = "tenant-demo";
const branchId = "branch-centro";
const actorUserId = "user-warehouse";
const time = {
  created: "2026-09-15T08:00:00.000Z",
  picked: "2026-09-15T09:00:00.000Z",
  packed: "2026-09-15T10:00:00.000Z",
  dispatched: "2026-09-15T11:00:00.000Z",
  delivered: "2026-09-15T12:00:00.000Z",
  transferDispatched: "2026-09-16T10:00:00.000Z",
  transferReceived: "2026-09-16T12:00:00.000Z",
};

async function main() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  prepareFixtures(store);
  const service = new GetLogisticsHistoryService(createRepositories(store));
  const history = await service.execute(branchId);

  assert.deepEqual(
    new Set(history.map((item) => item.orderReference)),
    new Set([
      "POS-H-PACKING",
      "POS-H-READY",
      "POS-H-OWN",
      "POS-H-DISPATCHED",
      "POS-H-DELIVERED",
      "POS-P-PACKING",
      "POS-P-READY",
      "POS-P-DELIVERED",
      "Traslado TR-HISTORY-001",
    ]),
  );
  assert.ok(!history.some((item) => item.orderReference.startsWith("OUT-")));
  assert.equal(history[0]?.sourceType, "transfer");
  assert.equal(history[0]?.sourceId, "history-transfer-received");

  const transfer = required(history, "Traslado TR-HISTORY-001");
  assert.equal(transfer.sourceType, "transfer");
  assert.equal(transfer.orderId, "transfer:history-transfer-received");
  assert.equal(transfer.deliveryMethod, "transfer");
  assert.equal(transfer.operationalStatus, OrderStatus.delivered);
  assert.equal(transfer.dispatchedAt, time.transferDispatched);
  assert.equal(transfer.deliveredAt, time.transferReceived);
  assert.equal(transfer.responsibleUserId, actorUserId);
  assert.equal(transfer.responsibleUserName, "Bodeguero Demo");
  assert.match(transfer.contactName, /^Destino: /);

  const homePacking = required(history, "POS-H-PACKING");
  assert.equal(homePacking.operationalStatus, OrderStatus.packing);
  assert.equal(homePacking.pickingCompletedAt, time.picked);
  assert.equal(homePacking.packingFinalizedAt, null);

  const homeReady = required(history, "POS-H-READY");
  assert.equal(homeReady.operationalStatus, OrderStatus.ready_for_dispatch);
  assert.equal(homeReady.packingFinalizedAt, time.packed);
  assert.equal(homeReady.totalWeight, 4.5);
  assert.equal(homeReady.packageCount, 2);

  const homeDispatched = required(history, "POS-H-DISPATCHED");
  assert.equal(homeDispatched.operationalStatus, OrderStatus.dispatched);
  assert.equal(homeDispatched.dispatchedAt, time.dispatched);
  assert.equal(homeDispatched.trackingNumber, "GUIA-H-DISPATCHED");
  assert.equal(homeDispatched.carrierName, "Transportes Demo");
  assert.ok(homeDispatched.dispatchId);

  const homeDelivered = required(history, "POS-H-DELIVERED");
  assert.equal(homeDelivered.deliveredAt, time.delivered);
  assert.equal(homeDelivered.responsibleUserId, actorUserId);
  assert.equal(homeDelivered.responsibleUserName, "Bodeguero Demo");

  const pickupPacking = required(history, "POS-P-PACKING");
  assert.equal(pickupPacking.contactName, "Retira Packing");
  assert.equal(pickupPacking.contactPhone, "55551001");
  assert.equal(pickupPacking.totalWeight, null);
  assert.equal(pickupPacking.packageCount, null);
  assert.equal(pickupPacking.dispatchId, null);
  assert.equal(pickupPacking.responsibleUserId, null);
  assert.equal(pickupPacking.responsibleUserName, null);

  const pickupReady = required(history, "POS-P-READY");
  assert.equal(pickupReady.operationalStatus, OrderStatus.ready_for_pickup);
  assert.equal(pickupReady.packingFinalizedAt, time.packed);

  const pickupDelivered = required(history, "POS-P-DELIVERED");
  assert.equal(pickupDelivered.operationalStatus, OrderStatus.delivered);
  assert.equal(pickupDelivered.deliveredAt, time.delivered);
  assert.ok(pickupDelivered.storePickupDeliveryId);
  assert.equal(pickupDelivered.dispatchId, null);

  const detail = await service.getDetail(branchId, homeDelivered.orderId);
  assert.equal(detail.summary.orderReference, "POS-H-DELIVERED");
  assert.equal(detail.items.length, 1);
  assert.equal(detail.items[0]?.name, "Servicio de instalación");
  assert.equal(detail.items[0]?.pickedQuantity, 1);
  const detailMarkup = renderToStaticMarkup(
    createElement(LogisticsHistoryDetailModal, {
      open: true,
      detail,
      loading: false,
      error: null,
      onClose: () => undefined,
    }),
  );
  assert.match(detailMarkup, /POS-H-DELIVERED/);
  assert.match(detailMarkup, /Servicio de instalación/);
  assert.match(detailMarkup, /Transportes Demo/);
  assert.match(detailMarkup, /GUIA-H-DELIVERED/);

  const pickupDetail = await service.getDetail(branchId, pickupDelivered.orderId);
  const pickupMarkup = renderToStaticMarkup(
    createElement(LogisticsHistoryDetailModal, {
      open: true,
      detail: pickupDetail,
      loading: false,
      error: null,
      onClose: () => undefined,
    }),
  );
  assert.match(pickupMarkup, /Persona que retira/);
  assert.match(pickupMarkup, /Retira Delivered/);
  assert.match(pickupMarkup, /Entrega en tienda/);
  assert.doesNotMatch(pickupMarkup, /Transportista/);

  const transferDetail = await service.getDetail(branchId, transfer.orderId);
  assert.equal(transferDetail.summary.sourceType, "transfer");
  assert.equal(transferDetail.summary.sourceId, "history-transfer-received");
  assert.equal(transferDetail.summary.orderReference, "Traslado TR-HISTORY-001");
  assert.deepEqual(transferDetail.items, []);

  let openedOrderId: string | null = null;
  let guideOrderId: string | null = null;
  const table = LogisticsHistoryTable({
    canConfirmDispatch: true,
    currentPage: 1,
    items: history,
    pageSize: 10,
    onAddGuide: (item) => {
      guideOrderId = item.orderId;
    },
    onPageChange: () => undefined,
    onPageSizeChange: () => undefined,
    onRowDoubleClick: (item) => {
      openedOrderId = item.orderId;
    },
  });
  const tableChildren = Array.isArray(table.props.children)
    ? table.props.children
    : [table.props.children];
  const dataTable = tableChildren[0];
  assert.ok(isValidElement(dataTable));
  const tableProps = dataTable.props as {
    columns: Array<{ key: string; cell: (item: (typeof history)[number]) => unknown }>;
    onRowClick?: (item: (typeof history)[number]) => void;
    onRowDoubleClick?: (item: (typeof history)[number]) => void;
  };
  assert.equal(tableProps.onRowClick, undefined);
  const actionCell = tableProps.columns.find((column) => column.key === "action")?.cell(homeReady);
  assert.ok(isValidElement(actionCell));
  const actionProps = actionCell.props as {
    onClick: (event: { stopPropagation: () => void }) => void;
  };
  let propagationStopped = false;
  actionProps.onClick({ stopPropagation: () => { propagationStopped = true; } });
  assert.equal(propagationStopped, true);
  assert.equal(guideOrderId, homeReady.orderId);
  assert.equal(openedOrderId, null);
  tableProps.onRowDoubleClick?.(homeDelivered);
  assert.equal(openedOrderId, homeDelivered.orderId);
  assert.equal(canAddGuide(homeReady), true);
  assert.equal(canAddGuide(homeDelivered), false);
  assert.equal(canAddGuide(pickupReady), false);

  assert.deepEqual(
    filterLogisticsHistory(history, {
      ...defaultLogisticsHistoryFilters,
      search: "retira packing",
    }).map((item) => item.orderReference),
    ["POS-P-PACKING"],
  );
  assert.deepEqual(
    filterLogisticsHistory(history, {
      ...defaultLogisticsHistoryFilters,
      status: OrderStatus.ready_for_dispatch,
    }).map((item) => item.orderReference),
    ["POS-H-READY", "POS-H-OWN"],
  );
  assert.equal(
    filterLogisticsHistory(history, {
      ...defaultLogisticsHistoryFilters,
      deliveryMethod: DeliveryMethod.store_pickup,
    }).length,
    3,
  );
  assert.equal(
    filterLogisticsHistory(history, {
      ...defaultLogisticsHistoryFilters,
      from: "2026-09-15",
      to: "2026-09-15",
    }).length,
    8,
  );
  assert.equal(
    filterLogisticsHistory(history, {
      ...defaultLogisticsHistoryFilters,
      from: "2026-09-16",
    }).length,
    1,
  );
  assert.deepEqual(
    filterLogisticsHistory(history, {
      ...defaultLogisticsHistoryFilters,
      search: "TR-HISTORY-001",
    }).map((item) => item.sourceId),
    ["history-transfer-received"],
  );

  const dispatchService = new DispatchApplicationService(createRepositories(store));
  const inventoryMovementCount = store.getSnapshot().inventoryMovements.length;
  assert.equal(
    validateDispatchShipment(TransportMode.third_party, {
      carrierName: "",
      trackingNumber: "",
    }).valid,
    false,
  );
  const thirdPartyValidation = validateDispatchShipment(TransportMode.third_party, {
    carrierName: "Transportes Historial",
    trackingNumber: "GUIA-HISTORY-READY",
  });
  assert.equal(thirdPartyValidation.valid, true);
  const thirdPartyDispatch = await dispatchService.confirm(branchId, {
    orderId: homeReady.orderId,
    operationId: "history-dispatch-third-party",
    carrierName: thirdPartyValidation.carrierName,
    trackingNumber: thirdPartyValidation.trackingNumber,
  });
  assert.equal(thirdPartyDispatch.orderStatus, OrderStatus.dispatched);
  assert.equal(thirdPartyDispatch.idempotent, false);
  const thirdPartyRetry = await dispatchService.confirm(branchId, {
    orderId: homeReady.orderId,
    operationId: "history-dispatch-third-party",
    carrierName: thirdPartyValidation.carrierName,
    trackingNumber: thirdPartyValidation.trackingNumber,
  });
  assert.equal(thirdPartyRetry.idempotent, true);

  const homeOwn = required(history, "POS-H-OWN");
  const ownFleetValidation = validateDispatchShipment(TransportMode.own_fleet, {
    carrierName: "",
    trackingNumber: "",
  });
  assert.equal(ownFleetValidation.valid, true);
  const ownFleetDispatch = await dispatchService.confirm(branchId, {
    orderId: homeOwn.orderId,
    operationId: "history-dispatch-own-fleet",
  });
  assert.equal(ownFleetDispatch.orderStatus, OrderStatus.dispatched);
  assert.equal(ownFleetDispatch.trackingNumber, null);
  await assert.rejects(
    dispatchService.getPreparedDetail(branchId, pickupReady.orderId),
    /not prepared for dispatch/,
  );
  assert.equal(store.getSnapshot().inventoryMovements.length, inventoryMovementCount);

  const refreshedHistory = await service.execute(branchId);
  const refreshedThirdParty = required(refreshedHistory, "POS-H-READY");
  assert.equal(refreshedThirdParty.operationalStatus, OrderStatus.dispatched);
  assert.equal(refreshedThirdParty.trackingNumber, "GUIA-HISTORY-READY");
  assert.equal(canAddGuide(refreshedThirdParty), false);
  assert.equal(canAddGuide(required(refreshedHistory, "POS-H-OWN")), false);

  store.transact((db) => {
    const role = db.roles.find((item) => item.id === "role-warehouse");
    assert.ok(role);
    role.permissions = role.permissions.filter((permission) => permission !== "logistics.history.read");
  });
  await assert.rejects(service.execute(branchId), /access denied/);
  await assert.rejects(service.getDetail(branchId, homeDelivered.orderId), /access denied/);

  console.log("verify-logistics-history-foundation: PASS");
  console.log("scope, home/store projection, dates, responsible user and permission: PASS");
}

function prepareFixtures(store: MockDatabaseStore) {
  store.transact((db) => {
    db.orders = [];
    db.orderItems = [];
    db.pickingOrders = [];
    db.pickingItems = [];
    db.packings = [];
    db.packingOperations = [];
    db.dispatches = [];
    db.packages = [];
    db.storePickupDeliveries = [];
    db.inventoryTransfers = [];
    db.inventoryTransferItems = [];
    const warehouse = db.users.find((item) => item.id === actorUserId);
    const role = db.roles.find((item) => item.id === "role-warehouse");
    assert.ok(warehouse && role);
    warehouse.name = "Bodeguero Demo";
    role.permissions = [...new Set([...role.permissions, "logistics.history.read"])];
    db.users.push({
      id: "history-foreign-user",
      tenantId: "tenant-foreign",
      employeeCode: "HISTORY-FOREIGN",
      name: "Usuario de otro tenant",
      email: "history-foreign@example.com",
      type: UserType.employee,
      status: UserStatus.active,
      createdAt: time.created,
      updatedAt: time.created,
    });
    db.products.push({
      id: "history-service-product",
      tenantId,
      sku: "HISTORY-SERVICE",
      name: "Servicio de instalación",
      productType: ProductType.service,
      categoryId: "cat-services",
      baseUnitId: "unit-unit",
      saleUnitId: "unit-unit",
      salePrice: 25,
      status: ProductStatus.published,
      tracking: { stock: false, lot: false, expiration: false, serial: false },
      channels: { ecommerce: false, pos: true, mobileApp: false },
      createdAt: time.created,
      updatedAt: time.created,
    });

    const definitions = [
      ["h-packing", DeliveryMethod.home_delivery, OrderStatus.packing],
      ["h-ready", DeliveryMethod.home_delivery, OrderStatus.ready_for_dispatch],
      ["h-own", DeliveryMethod.home_delivery, OrderStatus.ready_for_dispatch],
      ["h-dispatched", DeliveryMethod.home_delivery, OrderStatus.dispatched],
      ["h-delivered", DeliveryMethod.home_delivery, OrderStatus.delivered],
      ["p-packing", DeliveryMethod.store_pickup, OrderStatus.packing],
      ["p-ready", DeliveryMethod.store_pickup, OrderStatus.ready_for_pickup],
      ["p-delivered", DeliveryMethod.store_pickup, OrderStatus.delivered],
    ] as const;

    for (const [suffix, deliveryMethod, status] of definitions) {
      const order = createOrder(suffix, deliveryMethod, status);
      if (suffix === "h-own") order.transportMode = TransportMode.own_fleet;
      db.orders.push(order);
      db.pickingOrders.push({
        id: `picking-${suffix}`,
        tenantId,
        branchId,
        orderId: order.id,
        assignedUserId: suffix === "p-packing" ? "history-foreign-user" : actorUserId,
        status: PickingStatus.completed,
        priority: PickingPriority.normal,
        startedAt: time.created,
        completedAt: time.picked,
        createdAt: time.created,
        updatedAt: time.picked,
      });
      {
        db.pickingItems.push({
          id: suffix === "h-delivered" ? "history-picking-item-service" : `history-picking-item-${suffix}`,
          pickingOrderId: `picking-${suffix}`,
          orderItemId: "history-order-item-service",
          productId: "history-service-product",
          requestedQuantity: 1,
          pickedQuantity: 1,
          status: PickingItemStatus.completed,
        });
      }
      db.packings.push({
        id: `packing-${suffix}`,
        tenantId,
        branchId,
        orderId: order.id,
        pickingOrderId: `picking-${suffix}`,
        status: status === OrderStatus.packing ? PackingStatus.in_progress : PackingStatus.finalized,
        checklist: {
          packageProtectionChecked: status !== OrderStatus.packing,
          documentIncludedChecked: status !== OrderStatus.packing,
          recipientVerifiedChecked: status !== OrderStatus.packing,
        },
        totalWeight: deliveryMethod === DeliveryMethod.home_delivery ? 4.5 : undefined,
        packageCount: deliveryMethod === DeliveryMethod.home_delivery ? 2 : undefined,
        labelGenerationId:
          deliveryMethod === DeliveryMethod.home_delivery && status !== OrderStatus.packing
            ? `label-generation-${suffix}`
            : undefined,
        labelGeneratedAt:
          deliveryMethod === DeliveryMethod.home_delivery && status !== OrderStatus.packing
            ? time.packed
            : undefined,
        labelPrintedAt:
          deliveryMethod === DeliveryMethod.home_delivery && status !== OrderStatus.packing
            ? time.packed
            : undefined,
        labelCode:
          deliveryMethod === DeliveryMethod.home_delivery && status !== OrderStatus.packing
            ? `LABEL-${suffix.toUpperCase()}`
            : undefined,
        startedByUserId: suffix === "p-packing" ? "history-foreign-user" : actorUserId,
        finalizedByUserId: status === OrderStatus.packing ? undefined : actorUserId,
        startedAt: time.picked,
        finalizedAt: status === OrderStatus.packing ? undefined : time.packed,
        version: status === OrderStatus.packing ? 0 : 1,
        createdAt: time.picked,
        updatedAt: status === OrderStatus.packing ? time.picked : time.packed,
      });

      if (
        deliveryMethod === DeliveryMethod.home_delivery &&
        (status === OrderStatus.dispatched || status === OrderStatus.delivered)
      ) {
        db.dispatches.push({
          id: `dispatch-${suffix}`,
          tenantId,
          branchId,
          orderId: order.id,
          status: status === OrderStatus.delivered ? DispatchStatus.delivered : DispatchStatus.dispatched,
          transportMode: TransportMode.third_party,
          carrierName: "Transportes Demo",
          trackingNumber: `GUIA-${suffix.toUpperCase()}`,
          dispatchedByUserId: actorUserId,
          dispatchedAt: time.dispatched,
          deliveredAt: status === OrderStatus.delivered ? time.delivered : undefined,
          createdAt: time.dispatched,
          updatedAt: status === OrderStatus.delivered ? time.delivered : time.dispatched,
        });
      }
      if (deliveryMethod === DeliveryMethod.store_pickup && status === OrderStatus.delivered) {
        db.storePickupDeliveries.push({
          id: `pickup-delivery-${suffix}`,
          tenantId,
          branchId,
          orderId: order.id,
          confirmedByUserId: actorUserId,
          confirmationOperationId: `pickup-operation-${suffix}`,
          confirmationFingerprint: `pickup-fingerprint-${suffix}`,
          deliveredAt: time.delivered,
          createdAt: time.delivered,
        });
      }
    }

    db.orders.push(
      { ...createOrder("out-branch", DeliveryMethod.home_delivery, OrderStatus.packing), id: "out-branch", orderNumber: "OUT-BRANCH", branchId: "branch-norte" },
      { ...createOrder("out-tenant", DeliveryMethod.home_delivery, OrderStatus.packing), id: "out-tenant", orderNumber: "OUT-TENANT", tenantId: "tenant-foreign" },
      createOrder("immediate", DeliveryMethod.immediate, OrderStatus.confirmed),
    );
    db.inventoryTransfers.push({
      id: "history-transfer-received",
      tenantId,
      number: "TR-HISTORY-001",
      sourceBranchId: branchId,
      destinationBranchId: "branch-norte",
      status: InventoryTransferStatus.received,
      operationId: "history-transfer-operation",
      preparedByUserId: actorUserId,
      dispatchedByUserId: actorUserId,
      receivedByUserId: actorUserId,
      createdAt: time.created,
      updatedAt: time.transferReceived,
      dispatchedAt: time.transferDispatched,
      receivedAt: time.transferReceived,
    });
    db.inventoryTransferItems.push({
      id: "history-transfer-item",
      transferId: "history-transfer-received",
      productId: "prod-screws",
      requestedQuantity: 2,
      dispatchedQuantity: 2,
      receivedQuantity: 2,
    });
  });
}

function createOrder(suffix: string, deliveryMethod: DeliveryMethod, status: OrderStatus): Order {
  const pickup = deliveryMethod === DeliveryMethod.store_pickup;
  const home = deliveryMethod === DeliveryMethod.home_delivery;
  return {
    id: `order-${suffix}`,
    tenantId,
    branchId,
    orderNumber: suffix === "immediate" ? "OUT-IMMEDIATE" : `POS-${suffix.toUpperCase()}`,
    source: OrderSource.pos,
    items: [],
    status,
    deliveryMethod,
    transportMode: home ? TransportMode.third_party : pickup ? TransportMode.customer : TransportMode.none,
    deliveryAddress: home
      ? { recipientName: `Destinatario ${suffix}`, recipientPhone: "55550000", line1: "Zona 1", city: "Guatemala", country: "Guatemala" }
      : undefined,
    storePickupContact: pickup
      ? { recipientName: `Retira ${suffix.replace("p-", "").replace(/^./, (value) => value.toUpperCase())}`, recipientPhone: "55551001" }
      : undefined,
    subtotal: 10,
    discountTotal: 0,
    shippingTotal: 0,
    total: 10,
    trackingToken: `tracking-${suffix}`,
    createdAt: time.created,
    updatedAt: time.delivered,
  };
}

function createRepositories(store: MockDatabaseStore) {
  const eventBus = new DataEventBus();
  return {
    auth: {
      getCurrentSessionId: async () => "history-session",
      getSession: async () => ({
        id: "history-session",
        userId: actorUserId,
        createdAt: time.created,
        expiresAt: "2099-01-01T00:00:00.000Z",
        rememberMe: false,
      }),
    },
    branches: new MockBranchRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    dispatches: new MockDispatchRepository(store, eventBus),
    inventory: new MockInventoryRepository(store, eventBus),
    inventoryTransfers: new MockInventoryTransferRepository(store, eventBus),
    notifications: new MockNotificationRepository(store, eventBus),
    orders: new MockOrderRepository(store, eventBus),
    packings: new MockPackingRepository(store, eventBus),
    picking: new MockPickingRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    storePickupDeliveries: new MockStorePickupDeliveryRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
}

function required(items: Awaited<ReturnType<GetLogisticsHistoryService["execute"]>>, reference: string) {
  const item = items.find((candidate) => candidate.orderReference === reference);
  assert.ok(item, `Missing history item: ${reference}`);
  return item;
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
