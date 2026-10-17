import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Order, Sale } from "@/core/entities";
import type { OrderRepository } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  BranchStatus,
  BranchType,
  CashShiftStatus,
  DeliveryMethod,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
  ProductType,
  RoleStatus,
  SaleStatus,
  TenantStatus,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockOrderRepository,
  MockPaymentRepository,
  MockRoleRepository,
  MockSaleReversalRepository,
  MockSalesRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import {
  GetPosSalesHistoryService,
  orderStatusPresentation,
  saleStatusPresentation,
} from "@/modules/pos/application/services/GetPosSalesHistoryService";
import {
  GetReturnSaleLookupService,
  getReturnBlockedNotice,
} from "@/modules/pos/application/services/GetReturnSaleLookupService";
import { ReturnSaleDetails } from "@/modules/pos/components/ReturnSaleDetails";

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

const now = "2026-08-15T14:30:00.000Z";
const tenantA = "history-tenant-a";
const tenantB = "history-tenant-b";
const branchA1 = "history-branch-a1";
const branchA2 = "history-branch-a2";
const branchB1 = "history-branch-b1";

function sale(
  id: string,
  tenantId: string,
  branchId: string,
  sourceOrderId?: string,
  status = SaleStatus.completed,
): Sale {
  return {
    id,
    tenantId,
    branchId,
    number: `POS-${id}`,
    sourceOrderId,
    cashShiftId: `shift-${branchId}`,
    items: [
      {
        id: `item-${id}`,
        saleId: id,
        productId: "history-product",
        skuSnapshot: "HISTORY-SKU",
        nameSnapshot: "Producto histórico",
        quantity: 2,
        unitPrice: 12.5,
        discount: 1,
        subtotal: 25,
      },
    ],
    status,
    document: { type: "invoice", legalName: `Cliente ${id}`, taxId: "CF" },
    subtotal: 27,
    discountTotal: 2,
    taxTotal: 0,
    total: 25,
    createdByUserId: `history-user-${tenantId}`,
    createdAt: now,
    updatedAt: now,
  };
}

function order(
  id: string,
  tenantId: string,
  branchId: string,
  deliveryMethod: DeliveryMethod,
  status: OrderStatus,
): Order {
  return {
    id,
    tenantId,
    branchId,
    orderNumber: `ORDER-${id}`,
    source: OrderSource.pos,
    guestCustomer: { name: `Cliente ${id}`, email: "history@example.test" },
    items: [
      {
        id: `order-item-${id}`,
        orderId: id,
        productId: "history-product",
        skuSnapshot: "HISTORY-SKU",
        nameSnapshot: "Producto histórico",
        quantity: 2,
        unitPrice: 12.5,
        discount: 1,
        subtotal: 25,
      },
    ],
    status,
    deliveryMethod,
    transportMode:
      deliveryMethod === DeliveryMethod.store_pickup
        ? TransportMode.customer
        : TransportMode.own_fleet,
    subtotal: 27,
    discountTotal: 2,
    shippingTotal: 0,
    total: 25,
    trackingToken: `tracking-${id}`,
    createdAt: now,
    updatedAt: now,
  };
}

async function verifyPosSalesHistory() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.tenants.push(
      {
        id: tenantA,
        name: "History A",
        slug: "history-a",
        status: TenantStatus.active,
        defaultCurrency: "GTQ",
        timezone: "America/Guatemala",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: tenantB,
        name: "History B",
        slug: "history-b",
        status: TenantStatus.active,
        defaultCurrency: "GTQ",
        timezone: "America/Guatemala",
        createdAt: now,
        updatedAt: now,
      },
    );
    db.branches.push(
      {
        id: branchA1,
        tenantId: tenantA,
        code: "A1",
        name: "A Uno",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: branchA2,
        tenantId: tenantA,
        code: "A2",
        name: "A Dos",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: branchB1,
        tenantId: tenantB,
        code: "B1",
        name: "B Uno",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: now,
        updatedAt: now,
      },
    );
    db.roles.push(
      {
        id: "history-role-a",
        tenantId: tenantA,
        name: "POS History A",
        isSystem: false,
        permissions: ["pos.sales.read", "pos.returns.read"],
        branchScope: "all",
        status: RoleStatus.active,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "history-role-b",
        tenantId: tenantB,
        name: "POS History B",
        isSystem: false,
        permissions: ["pos.sales.read"],
        branchScope: "all",
        status: RoleStatus.active,
        createdAt: now,
        updatedAt: now,
      },
    );
    db.users.push(
      {
        id: "history-user-a",
        tenantId: tenantA,
        name: "History User A",
        email: "history-a@example.test",
        type: UserType.employee,
        status: UserStatus.active,
        roleId: "history-role-a",
        branchId: branchA1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "history-user-b",
        tenantId: tenantB,
        name: "History User B",
        email: "history-b@example.test",
        type: UserType.employee,
        status: UserStatus.active,
        roleId: "history-role-b",
        branchId: branchB1,
        createdAt: now,
        updatedAt: now,
      },
    );

    const pickupOrder = order(
      "history-order-pickup",
      tenantA,
      branchA1,
      DeliveryMethod.store_pickup,
      OrderStatus.ready_for_pickup,
    );
    const deliveryOrder = order(
      "history-order-delivery",
      tenantA,
      branchA1,
      DeliveryMethod.home_delivery,
      OrderStatus.dispatched,
    );
    db.orders.push(
      pickupOrder,
      deliveryOrder,
      order(
        "history-order-cross-tenant",
        tenantB,
        branchA1,
        DeliveryMethod.home_delivery,
        OrderStatus.delivered,
      ),
      order(
        "history-order-cross-branch",
        tenantA,
        branchA2,
        DeliveryMethod.store_pickup,
        OrderStatus.picking,
      ),
      order(
        "history-order-b",
        tenantB,
        branchB1,
        DeliveryMethod.home_delivery,
        OrderStatus.confirmed,
      ),
    );
    db.sales.push(
      sale("history-immediate", tenantA, branchA1),
      sale("history-pickup", tenantA, branchA1, pickupOrder.id),
      sale("history-pickup-repeat", tenantA, branchA1, pickupOrder.id),
      sale("history-delivery", tenantA, branchA1, deliveryOrder.id),
      sale("history-legacy", tenantA, branchA1, "history-order-missing"),
      sale("history-cross-tenant-order", tenantA, branchA1, "history-order-cross-tenant"),
      sale("history-cross-branch-order", tenantA, branchA1, "history-order-cross-branch"),
      sale("history-branch-two", tenantA, branchA2),
      sale("history-tenant-b", tenantB, branchB1, "history-order-b"),
    );
    db.payments.push(
      {
        id: "history-payment-cash",
        tenantId: tenantA,
        saleId: "history-immediate",
        method: PaymentMethod.cash,
        status: PaymentStatus.approved,
        amount: 10,
        currency: "GTQ",
        createdAt: now,
      },
      {
        id: "history-payment-card",
        tenantId: tenantA,
        saleId: "history-immediate",
        method: PaymentMethod.card,
        status: PaymentStatus.approved,
        amount: 15,
        currency: "GTQ",
        createdAt: now,
      },
    );
  });

  const branches = new MockBranchRepository(store, eventBus);
  const sales = new MockSalesRepository(store, eventBus);
  const underlyingOrders = new MockOrderRepository(store, eventBus);
  const payments = new MockPaymentRepository(store, eventBus);
  const roles = new MockRoleRepository(store, eventBus);
  const users = new MockUserRepository(store, eventBus);
  const batchCalls: Array<{ tenantId: string; branchId: string; ids: string[] }> = [];
  const orders = new Proxy(underlyingOrders, {
    get(target, property, receiver) {
      if (property !== "getByIdsScoped") return Reflect.get(target, property, receiver);
      return async (requestedTenantId: string, requestedBranchId: string, ids: string[]) => {
        batchCalls.push({
          tenantId: requestedTenantId,
          branchId: requestedBranchId,
          ids: [...ids],
        });
        return target.getByIdsScoped(requestedTenantId, requestedBranchId, ids);
      };
    },
  }) as OrderRepository;
  const service = new GetPosSalesHistoryService({
    branches,
    orders,
    payments,
    roles,
    sales,
    users,
  });

  const sideEffectsBefore = store.read((db) => ({
    balances: db.inventoryBalances,
    movements: db.inventoryMovements,
    reservations: db.inventoryReservations,
  }));
  const readModelsBefore = store.read((db) => ({
    orders: db.orders,
    payments: db.payments,
    sales: db.sales,
  }));
  const branchOne = await service.execute({ actorUserId: "history-user-a", branchId: branchA1 });
  assert.deepEqual(
    store.read((db) => ({ orders: db.orders, payments: db.payments, sales: db.sales })),
    readModelsBefore,
    "History read must not mutate Sales, Orders or Payments",
  );
  assert.equal(branchOne.sales.length, 7, "A: Branch A1 must only receive its seven sales");
  assert.ok(branchOne.sales.every((item) => item.saleId !== "history-branch-two"));
  assert.ok(branchOne.sales.every((item) => item.saleId !== "history-tenant-b"));
  const branchOneBatchCalls = batchCalls.filter(
    (call) => call.tenantId === tenantA && call.branchId === branchA1,
  );
  assert.equal(branchOneBatchCalls.length, 1, "H: Branch A1 must use one batch Order lookup");
  assert.equal(
    branchOneBatchCalls[0]?.ids.filter((id) => id === "history-order-pickup").length,
    1,
    "H: the shared pickup Order ID must be requested exactly once",
  );

  const branchTwo = await service.execute({ actorUserId: "history-user-a", branchId: branchA2 });
  assert.deepEqual(
    branchTwo.sales.map((item) => item.saleId),
    ["history-branch-two"],
  );
  await assert.rejects(
    service.execute({ actorUserId: "history-user-a", branchId: branchB1 }),
    /sucursal no está activa|acceso/,
    "C: a Tenant A actor must not enter a Tenant B branch",
  );
  const tenantBHistory = await service.execute({
    actorUserId: "history-user-b",
    branchId: branchB1,
  });
  assert.deepEqual(
    tenantBHistory.sales.map((item) => item.saleId),
    ["history-tenant-b"],
  );

  const immediate = branchOne.sales.find((item) => item.saleId === "history-immediate");
  assert.equal(immediate?.sourceOrderId, undefined);
  assert.equal(immediate?.orderStatus, undefined);
  assert.equal(immediate?.operationalStatusLabel, "—");
  assert.equal(immediate?.paymentSummary, "Efectivo + Tarjeta");
  assert.deepEqual(
    immediate?.payments?.map((payment) => payment.method),
    [PaymentMethod.cash, PaymentMethod.card],
  );
  const pickup = branchOne.sales.find((item) => item.saleId === "history-pickup");
  const repeatedPickup = branchOne.sales.find((item) => item.saleId === "history-pickup-repeat");
  assert.equal(pickup?.deliveryMethod, DeliveryMethod.store_pickup);
  assert.equal(pickup?.orderNumber, "ORDER-history-order-pickup");
  assert.equal(pickup?.orderStatus, OrderStatus.ready_for_pickup);
  assert.equal(pickup?.operationalStatusLabel, "Listo para retiro");
  assert.equal(repeatedPickup?.sourceOrderId, pickup?.sourceOrderId);
  assert.equal(repeatedPickup?.orderNumber, pickup?.orderNumber);
  assert.equal(repeatedPickup?.orderStatus, pickup?.orderStatus);
  assert.equal(repeatedPickup?.operationalStatusLabel, pickup?.operationalStatusLabel);
  assert.equal(repeatedPickup?.orderStatus, OrderStatus.ready_for_pickup);
  assert.equal(repeatedPickup?.operationalStatusLabel, "Listo para retiro");
  const delivery = branchOne.sales.find((item) => item.saleId === "history-delivery");
  assert.equal(delivery?.deliveryMethod, DeliveryMethod.home_delivery);
  assert.equal(delivery?.operationalStatusLabel, "Despachado");

  for (const saleId of [
    "history-legacy",
    "history-cross-tenant-order",
    "history-cross-branch-order",
  ]) {
    const unavailable = branchOne.sales.find((item) => item.saleId === saleId);
    assert.equal(unavailable?.hasUnavailableOrder, true);
    assert.equal(unavailable?.orderStatus, undefined);
    assert.equal(unavailable?.operationalStatusLabel, "Estado no disponible");
  }

  assert.equal(
    batchCalls.length,
    3,
    "H: each authorized query must perform one batch Order lookup",
  );
  const directBatch = await underlyingOrders.getByIdsScoped(tenantA, branchA1, [
    "history-order-pickup",
    "history-order-pickup",
    "history-order-cross-tenant",
    "history-order-cross-branch",
    "missing",
  ]);
  assert.deepEqual(
    directBatch.map((item) => item.id),
    ["history-order-pickup"],
  );
  const directlyScopedSales = await sales.listByBranch(tenantA, branchA1);
  assert.ok(
    directlyScopedSales.every((item) => item.tenantId === tenantA && item.branchId === branchA1),
  );

  const filtered = await service.execute({
    actorUserId: "history-user-a",
    branchId: branchA1,
    filters: {
      search: "history-order-delivery",
      deliveryMethod: DeliveryMethod.home_delivery,
      operationalStatus: OrderStatus.dispatched,
    },
  });
  assert.deepEqual(
    filtered.sales.map((item) => item.saleId),
    ["history-delivery"],
  );

  assert.deepEqual(
    Object.entries(saleStatusPresentation).map(([status, presentation]) => [
      status,
      presentation.label,
    ]),
    [
      [SaleStatus.completed, "Completada"],
      [SaleStatus.partially_returned, "Devolución parcial"],
      [SaleStatus.returned, "Devuelta totalmente"],
      [SaleStatus.cancelled, "Anulada"],
    ],
  );
  assert.deepEqual(Object.keys(saleStatusPresentation).sort(), Object.values(SaleStatus).sort());

  for (const [status, label] of [
    [OrderStatus.pending, "Pendiente"],
    [OrderStatus.confirmed, "Confirmado"],
    [OrderStatus.preparing, "Preparando"],
    [OrderStatus.picking, "En picking"],
    [OrderStatus.packing, "En empaque"],
    [OrderStatus.ready_for_pickup, "Listo para retiro"],
    [OrderStatus.ready_for_dispatch, "Listo para despacho"],
    [OrderStatus.dispatched, "Despachado"],
    [OrderStatus.delivered, "Entregado"],
    [OrderStatus.cancelled, "Cancelado"],
  ] as const) {
    assert.equal(orderStatusPresentation[status].label, label);
    store.mutate((db) => {
      const current = db.orders.find((item) => item.id === "history-order-delivery");
      assert.ok(current);
      current.status = status;
    });
    const projected = await service.execute({
      actorUserId: "history-user-a",
      branchId: branchA1,
    });
    assert.equal(
      projected.sales.find((item) => item.saleId === "history-delivery")?.operationalStatusLabel,
      label,
    );
  }

  assert.equal(
    getReturnBlockedNotice(DeliveryMethod.store_pickup, false, []),
    "Esta venta no admite devoluciones porque fue realizada con retiro en tienda.",
  );
  assert.equal(
    getReturnBlockedNotice(DeliveryMethod.home_delivery, false, []),
    "Esta venta no admite devoluciones porque fue realizada con envío a domicilio.",
  );
  assert.equal(
    getReturnBlockedNotice(DeliveryMethod.immediate, false, [
      { returnableQuantity: 1, isSafelyReversible: false },
    ]),
    "No es posible procesar la devolución porque no se puede validar de forma segura el movimiento de inventario de esta venta.",
  );
  assert.equal(
    getReturnBlockedNotice(DeliveryMethod.immediate, true, [
      { returnableQuantity: 1, isSafelyReversible: true },
    ]),
    undefined,
  );

  store.mutate((db) => {
    db.products.push({
      id: "history-product",
      tenantId: tenantA,
      sku: "HISTORY-SKU",
      name: "Producto histórico",
      productType: ProductType.physical,
      categoryId: "history-category",
      baseUnitId: "history-unit",
      saleUnitId: "history-unit",
      salePrice: 12.5,
      status: ProductStatus.published,
      tracking: { stock: true, lot: false, expiration: false, serial: false },
      channels: { ecommerce: false, pos: true, mobileApp: false },
      createdAt: now,
      updatedAt: now,
    });
    db.cashShifts.push({
      id: `shift-${branchA1}`,
      tenantId: tenantA,
      branchId: branchA1,
      userId: "history-user-a",
      registerCode: "HISTORY-REGISTER",
      status: CashShiftStatus.open,
      openedAt: now,
      openingAmount: 100,
      createdAt: now,
      updatedAt: now,
    });
    for (const saleId of ["history-pickup", "history-delivery"]) {
      const currentSale = db.sales.find((item) => item.id === saleId);
      assert.ok(currentSale);
      const originalItem = currentSale.items[0];
      assert.ok(originalItem);
      currentSale.items.push({
        ...originalItem,
        id: `${originalItem.id}-second`,
        skuSnapshot: `${originalItem.skuSnapshot}-SECOND`,
        nameSnapshot: `${originalItem.nameSnapshot} adicional`,
      });
    }
  });

  const returnLookupService = new GetReturnSaleLookupService({
    branches,
    orders: underlyingOrders,
    roles,
    saleReversals: new MockSaleReversalRepository(store, eventBus),
    sales,
    users,
  } as unknown as RepositoryRegistry);
  const pickupReturnLookup = await returnLookupService.execute({
    actorUserId: "history-user-a",
    branchId: branchA1,
    documentNumber: "POS-history-pickup",
    tenantId: tenantA,
  });
  const deliveryReturnLookup = await returnLookupService.execute({
    actorUserId: "history-user-a",
    branchId: branchA1,
    documentNumber: "POS-history-delivery",
    tenantId: tenantA,
  });
  assert.ok(pickupReturnLookup);
  assert.ok(deliveryReturnLookup);
  assertBlockedReturnRender(
    pickupReturnLookup,
    "Esta venta no admite devoluciones porque fue realizada con retiro en tienda.",
  );
  assertBlockedReturnRender(
    deliveryReturnLookup,
    "Esta venta no admite devoluciones porque fue realizada con envío a domicilio.",
  );

  const immediateReturnLookup = await returnLookupService.execute({
    actorUserId: "history-user-a",
    branchId: branchA1,
    documentNumber: "POS-history-immediate",
    tenantId: tenantA,
  });
  assert.ok(immediateReturnLookup);
  assert.equal(immediateReturnLookup.allowedOperations.partialReturn, false);
  assert.equal(immediateReturnLookup.returnableItems.length, 0);
  assert.equal(
    immediateReturnLookup.allowedOperations.returnBlockedReason,
    "No es posible procesar la devolución porque no se puede validar de forma segura el movimiento de inventario de esta venta.",
  );

  store.mutate((db) => {
    const current = db.orders.find((item) => item.id === "history-order-pickup");
    assert.ok(current);
    current.status = OrderStatus.delivered;
  });
  const deliveredPickup = await service.execute({
    actorUserId: "history-user-a",
    branchId: branchA1,
  });
  assert.equal(
    deliveredPickup.sales.find((item) => item.saleId === "history-pickup")?.operationalStatusLabel,
    "Entregado",
  );

  const sideEffectsAfter = store.read((db) => ({
    balances: db.inventoryBalances,
    movements: db.inventoryMovements,
    reservations: db.inventoryReservations,
  }));
  assert.deepEqual(sideEffectsAfter.balances, sideEffectsBefore.balances, "K: balances unchanged");
  assert.deepEqual(
    sideEffectsAfter.movements,
    sideEffectsBefore.movements,
    "L: movements unchanged",
  );
  assert.deepEqual(
    sideEffectsAfter.reservations,
    sideEffectsBefore.reservations,
    "M: reservations unchanged",
  );
  assert.ok(
    store.getSnapshot().sales.some((item) => item.id === "history-immediate"),
    "N: history reads must not reset the database to seeds",
  );

  console.log("POS sales history harness: PASS (A-N)");
}

function assertBlockedReturnRender(
  lookup: NonNullable<Awaited<ReturnType<GetReturnSaleLookupService["execute"]>>>,
  expectedMessage: string,
) {
  assert.equal(lookup.items.length, 2);
  const markup = renderToStaticMarkup(
    createElement(ReturnSaleDetails, {
      lookup,
      canProcessReturn: true,
      canVoid: true,
      onBeginOperation: () => undefined,
    }),
  );
  assert.equal(countOccurrences(markup, expectedMessage), 1);
  for (const label of ["Vendida", "Devuelta", "Retornable", "Importe"]) {
    assert.ok(markup.includes(label), `Return details must preserve the ${label} quantity column`);
  }
  assert.ok(markup.includes("HISTORY-SKU"));
  assert.ok(markup.includes("HISTORY-SKU-SECOND"));
  assert.ok(!markup.includes("huella histórica"));
  assert.ok(!markup.includes("huella historica"));
}

function countOccurrences(value: string, search: string) {
  return value.split(search).length - 1;
}

void verifyPosSalesHistory();
