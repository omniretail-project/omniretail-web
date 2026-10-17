import assert from "node:assert/strict";
import {
  BranchStatus,
  CashMovementType,
  CashShiftStatus,
  DeliveryMethod,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductType,
  PromotionStatus,
  PromotionType,
  RoleStatus,
  SaleStatus,
  SalesChannel,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { PosApiConfirmSaleCommand, PosApiRepository } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiPosRepository } from "@/infrastructure/api/repositories/ApiPosRepository";
import {
  parseConfirmSaleCommand,
  parseOpenCashShiftCommand,
} from "@/infrastructure/api/repositories/posApi.schema";
import { withApiPos } from "@/infrastructure/api/withApiPos";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { DataEventName } from "@/core/types/events.types";
import { GetCashShiftMovementsService } from "@/modules/pos/application/services/GetCashShiftMovementsService";
import { GetPosProductsService } from "@/modules/pos/application/services/GetPosProductsService";

const id = (suffix: number) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = {
  tenant: id(1),
  branch: id(2),
  user: id(3),
  role: id(4),
  shift: id(5),
  movement: id(6),
  sale: id(7),
  saleItem: id(8),
  product: id(9),
  paymentCash: id(10),
  paymentCard: id(11),
  paymentTransfer: id(12),
  bankAccount: id(13),
  inventoryMovement: id(14),
  confirmation: id(15),
  order: id(16),
  picking: id(17),
  operation: id(18),
  saleReturn: id(19),
  returnLine: id(20),
  request: id(21),
};
const at = "2026-10-08T12:00:00.000Z";

const cashShift = {
  id: ids.shift,
  branchId: ids.branch,
  userId: ids.user,
  registerCode: "POS-01",
  status: CashShiftStatus.open,
  openedAt: at,
  openingAmount: 100,
  closedAt: null,
  expectedAmount: null,
  countedAmount: null,
  difference: null,
  createdAt: at,
  updatedAt: at,
};

const cashMovement = {
  id: ids.movement,
  cashShiftId: ids.shift,
  type: CashMovementType.in,
  amount: 25.5,
  reason: "Fondo adicional",
  referenceType: "sale",
  referenceId: ids.sale,
  createdByUserId: ids.user,
  createdAt: at,
  saleNumber: "V-100",
};

const cashSummary = {
  cashShiftId: ids.shift,
  branchId: ids.branch,
  cashierId: ids.user,
  registerCode: "POS-01",
  status: CashShiftStatus.open,
  openedAt: at,
  closedAt: null,
  openingAmount: 100,
  cashIn: 225.5,
  cashOut: 10,
  manualCashIn: 25.5,
  manualCashOut: 10,
  salesCashIn: 200,
  voidCashOut: 0,
  returnCashOut: 0,
  expectedAmount: 315.5,
  countedAmount: null,
  difference: null,
};

const saleItem = {
  id: ids.saleItem,
  productId: ids.product,
  promotionId: null,
  sku: "POS-001",
  name: "Producto POS",
  quantity: 2,
  unitPrice: 50,
  discount: 1.24,
  subtotal: 97.52,
  trackingDetails: [],
};

const payments = [
  {
    id: ids.paymentCash,
    saleId: ids.sale,
    orderId: null,
    method: PaymentMethod.cash,
    amount: 20,
    reference: null,
    status: PaymentStatus.approved,
    currency: "GTQ",
    bankAccountId: null,
    externallyVerified: null,
    verifiedByUserId: null,
    verifiedAt: null,
  },
  {
    id: ids.paymentCard,
    saleId: ids.sale,
    orderId: null,
    method: PaymentMethod.card,
    amount: 30,
    reference: "TERM-200",
    status: PaymentStatus.approved,
    currency: "GTQ",
    bankAccountId: null,
    externallyVerified: null,
    verifiedByUserId: null,
    verifiedAt: null,
  },
  {
    id: ids.paymentTransfer,
    saleId: ids.sale,
    orderId: null,
    method: PaymentMethod.transfer,
    amount: 48.76,
    reference: "TRX-300",
    status: PaymentStatus.approved,
    currency: "GTQ",
    bankAccountId: ids.bankAccount,
    externallyVerified: true,
    verifiedByUserId: ids.user,
    verifiedAt: at,
  },
];

const saleSummary = {
  id: ids.sale,
  number: "V-100",
  branchId: ids.branch,
  cashShiftId: ids.shift,
  subtotal: 100,
  discountTotal: 1.24,
  taxTotal: 0,
  total: 98.76,
  createdAt: at,
  status: SaleStatus.completed,
  customerId: null,
  sourceOrderId: ids.order,
  document: { type: "ticket", taxId: null, legalName: null, fiscalAddress: null },
};

const saleConfirmation = {
  ...saleSummary,
  items: [saleItem],
  payments,
  inventoryEffects: [
    {
      id: ids.inventoryMovement,
      tenantId: ids.tenant,
      branchId: ids.branch,
      productId: ids.product,
      type: "out",
      reason: "sale",
      quantity: 2,
      quantityBefore: 12,
      quantityAfter: 10,
      fromLocationId: null,
      toLocationId: null,
      referenceType: "sale",
      referenceId: ids.sale,
      referenceLineId: ids.saleItem,
      performedByUserId: ids.user,
      createdAt: at,
    },
  ],
  cashMovement,
  order: { id: ids.order, orderNumber: "ORD-100", serverStatus: "confirmed" },
  pickingOrder: { id: ids.picking, orderId: ids.order, serverStatus: "pending" },
  idempotent: false,
};

const historyPage = {
  items: [
    {
      saleId: ids.sale,
      saleNumber: "V-100",
      createdAt: at,
      customerDisplayName: "Cliente POS",
      total: 98.76,
      status: SaleStatus.completed,
      sourceOrderId: ids.order,
      deliveryMethod: DeliveryMethod.store_pickup,
      operationalStatus: OrderStatus.ready_for_pickup,
    },
  ],
  page: 1,
  pageSize: 20,
  totalItems: 1,
  totalPages: 1,
  summary: { total: 1, completed: 1, partiallyReturned: 0, returned: 0, cancelled: 0 },
};
const saleDetail = { sale: saleSummary, items: [saleItem], payments };

const returnOperation = {
  operationId: ids.operation,
  idempotent: true,
  reason: "Producto incorrecto",
  saleStatus: SaleStatus.partially_returned,
  saleReturn: {
    id: ids.saleReturn,
    saleId: ids.sale,
    branchId: ids.branch,
    reason: "Producto incorrecto",
    refundAmount: 48.76,
    createdAt: at,
    lines: [
      {
        id: ids.returnLine,
        saleItemId: ids.saleItem,
        productId: ids.product,
        quantity: 1,
        refundAmount: 48.76,
        trackingDetails: [],
      },
    ],
  },
  commercialRefundAmount: 48.76,
  inventory: { inventoryRestored: true, movementIds: [ids.inventoryMovement], reservationsReleased: 0 },
  cashMovement: { recorded: true, movementIds: [ids.movement], amount: 20 },
};
const voidOperation = {
  operationId: ids.operation,
  idempotent: true,
  reason: "Venta duplicada",
  sale: { ...saleSummary, status: SaleStatus.cancelled },
  inventory: { inventoryRestored: true, movementIds: [ids.inventoryMovement], reservationsReleased: 0 },
  cashMovement: { recorded: true, movementIds: [ids.movement], amount: 20 },
};

interface CapturedCall {
  url: string;
  method: string;
  body?: unknown;
  idempotencyKey?: string;
}

async function verifyCashRoutesAndParsing() {
  const originalFetch = globalThis.fetch;
  const calls: CapturedCall[] = [];
  try {
    let openReadCount = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(captureCall(url, init));
      if (url.includes("/cash-shifts/open?") && (init?.method ?? "GET") === "GET") {
        openReadCount += 1;
        return openReadCount === 1 ? Response.json(cashShift) : new Response(null, { status: 204 });
      }
      if (url.endsWith("/cash-shifts/open")) return Response.json(cashShift);
      if (url.endsWith("/cash-shifts/close")) {
        return Response.json({ ...cashShift, status: CashShiftStatus.closed, countedAmount: 315.5 });
      }
      if (url.endsWith(`/cash-shifts/${ids.shift}/summary`)) return Response.json(cashSummary);
      if (url.endsWith(`/cash-movements/shift/${ids.shift}`)) return Response.json([cashMovement]);
      return Response.json(cashMovement);
    };
    const repository = new ApiPosRepository(new DataEventBus());
    assert.equal((await repository.getOpenCashShift(ids.branch))?.id, ids.shift);
    assert.equal(await repository.getOpenCashShift(ids.branch), null);
    await repository.openCashShift({ branchId: ids.branch, registerCode: " POS-01 ", openingAmount: 100 });
    await repository.closeCashShift({ cashShiftId: ids.shift, countedAmount: 315.5 });
    assert.equal((await repository.getCashShiftSummary(ids.shift)).salesCashIn, 200);
    assert.equal((await repository.getCashShiftMovements(ids.shift))[0]?.saleNumber, "V-100");
    await repository.registerCashMovement({
      cashShiftId: ids.shift,
      type: CashMovementType.in,
      amount: 25.5,
      reason: " Fondo adicional ",
    });

    assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
      ["GET", `/api/backend/pos/cash-shifts/open?branchId=${ids.branch}`],
      ["GET", `/api/backend/pos/cash-shifts/open?branchId=${ids.branch}`],
      ["POST", "/api/backend/pos/cash-shifts/open"],
      ["POST", "/api/backend/pos/cash-shifts/close"],
      ["GET", `/api/backend/pos/cash-shifts/${ids.shift}/summary`],
      ["GET", `/api/backend/pos/cash-movements/shift/${ids.shift}`],
      ["POST", "/api/backend/pos/cash-movements"],
    ]);
    assert.deepEqual(calls[2]?.body, {
      branchId: ids.branch,
      registerCode: "POS-01",
      openingAmount: 100,
    });
    assert.deepEqual(calls[3]?.body, { cashShiftId: ids.shift, countedAmount: 315.5 });
    assert.deepEqual(calls[6]?.body, {
      cashShiftId: ids.shift,
      type: CashMovementType.in,
      amount: 25.5,
      reason: "Fondo adicional",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifySaleRoutePayloadAndSchema() {
  const originalFetch = globalThis.fetch;
  const calls: CapturedCall[] = [];
  const command = {
    branchId: ids.branch,
    cashShiftId: ids.shift,
    taxTotal: 0 as const,
    items: [{ productId: ids.product, quantity: 2, discount: 1.24, trackingSelections: [] as [] }],
    payments: [
      { method: PaymentMethod.cash, amount: 20 },
      { method: PaymentMethod.card, amount: 30, reference: "TERM-200" },
      {
        method: PaymentMethod.transfer,
        amount: 48.76,
        bankAccountId: ids.bankAccount,
        reference: "TRX-300",
        externallyVerified: true,
      },
    ],
    confirmationId: ids.confirmation,
    document: { type: "ticket" as const },
    sourceOrderId: null,
    deferredOrder: {
      idempotencyKey: "order-attempt-1",
      deliveryMethod: DeliveryMethod.store_pickup,
      transportMode: TransportMode.customer,
      storePickupContact: { recipientName: " Ana ", recipientPhone: " 5555-0101 " },
    },
  } satisfies PosApiConfirmSaleCommand;
  try {
    globalThis.fetch = async (input, init) => {
      calls.push(captureCall(String(input), init));
      return Response.json(saleConfirmation);
    };
    const { eventBus, events } = recordEvents();
    const repository = new ApiPosRepository(eventBus);
    const result = await repository.confirmSale(command);
    assert.equal(result.total, 98.76, "Los totales deben proceder de la respuesta autoritativa");
    assert.equal(result.payments.length, 3);
    assert.deepEqual(result.inventoryEffects, [{ id: ids.inventoryMovement }]);
    const expectedBody = {
      ...command,
      deferredOrder: {
        ...command.deferredOrder,
        storePickupContact: { recipientName: "Ana", recipientPhone: "5555-0101" },
      },
    };
    assert.deepEqual(calls, [
      { url: "/api/backend/pos/sales", method: "POST", body: expectedBody },
    ]);
    const body = calls[0]?.body as Record<string, unknown>;
    assert.equal("tenantId" in body, false);
    assert.equal("actorUserId" in body, false);
    assert.deepEqual(body.deferredOrder, expectedBody.deferredOrder);
    assert.deepEqual(
      events.map(({ event }) => event),
      ["sale.changed", "inventory.changed", "stock.changed", "cash-shift.changed", "order.changed"],
      "Una venta confirmada refresca venta, inventario, caja y pedido diferido una sola vez",
    );

    events.length = 0;
    calls.length = 0;
    assert.throws(
      () =>
        parseConfirmSaleCommand({
          ...command,
          deferredOrder: { ...command.deferredOrder, storePickupContact: undefined },
        }),
      (error) =>
        error instanceof BackendRequestError &&
        error.status === 400 &&
        Boolean(error.fields?.["deferredOrder.storePickupContact"]),
    );
    assert.throws(() =>
      parseConfirmSaleCommand({
        ...command,
        deferredOrder: {
          ...command.deferredOrder,
          storePickupContact: { recipientName: "   ", recipientPhone: "5555-0101" },
        },
      }),
    );

    // La respuesta 201 de una venta recien creada puede traer timestamps accesorios aun nulos;
    // no deben convertir una venta registrada en un error visible.
    globalThis.fetch = async () =>
      Response.json({
        ...saleConfirmation,
        cashMovement: { ...saleConfirmation.cashMovement, createdAt: null },
        inventoryEffects: saleConfirmation.inventoryEffects.map((effect) => ({
          ...effect,
          createdAt: null,
        })),
      });
    const freshSale = await repository.confirmSale(command);
    assert.equal(freshSale.id, saleConfirmation.id);
    assert.equal(freshSale.cashMovement?.cashShiftId, ids.shift);
    events.length = 0;

    globalThis.fetch = async () => Response.json({ ...saleConfirmation, total: "not-money" });
    await assert.rejects(
      repository.confirmSale(command),
      (error) =>
        error instanceof BackendRequestError &&
        error.status === 502 &&
        error.code === "INVALID_BACKEND_RESPONSE" &&
        Boolean(error.fields?.total),
    );
    globalThis.fetch = async () =>
      Response.json({ message: "Stock insuficiente", code: "INSUFFICIENT_STOCK" }, { status: 409 });
    await assert.rejects(
      repository.confirmSale(command),
      (error) => error instanceof BackendRequestError && error.status === 409,
    );
    assert.deepEqual(events, [], "Sin confirmación del backend no se emiten eventos de venta");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyErrorsArePreserved() {
  const originalFetch = globalThis.fetch;
  const repository = new ApiPosRepository(new DataEventBus());
  try {
    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      globalThis.fetch = async () =>
        Response.json(
          { message: `HTTP ${status}`, code: `POS_${status}`, fields: { reason: "invalid" } },
          { status },
        );
      await assert.rejects(
        repository.getCashShiftSummary(ids.shift),
        (error) =>
          error instanceof BackendRequestError &&
          error.status === status &&
          error.code === `POS_${status}` &&
          error.fields?.reason === "invalid",
      );
    }
    globalThis.fetch = async () => {
      throw new TypeError("network unavailable");
    };
    await assert.rejects(
      repository.getCashShiftSummary(ids.shift),
      (error) => error instanceof BackendRequestError && error.status === 0,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyHistoryReturnAndVoid() {
  const originalFetch = globalThis.fetch;
  const calls: CapturedCall[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(captureCall(url, init));
      if (url.includes("/sales/history?")) return Response.json(historyPage);
      if (url.endsWith(`/sales/${ids.sale}`)) return Response.json(saleDetail);
      if (url.includes("/returns/eligibility?")) {
        return Response.json({ message: "No encontrada", code: "SALE_NOT_FOUND" }, { status: 404 });
      }
      if (url.endsWith("/returns")) return Response.json(returnOperation);
      return Response.json(voidOperation);
    };
    const { eventBus, events } = recordEvents();
    const repository = new ApiPosRepository(eventBus);
    const history = await repository.getSalesHistory({
      branchId: ids.branch,
      search: " V-100 ",
      from: "2026-10-01",
      to: "2026-10-08",
      status: SaleStatus.completed,
      deliveryMethod: DeliveryMethod.store_pickup,
      operationalStatus: OrderStatus.ready_for_pickup,
      page: 1,
      pageSize: 20,
    });
    assert.equal(history.items[0]?.deliveryMethod, DeliveryMethod.store_pickup);
    assert.equal((await repository.getSaleDetail(ids.sale)).payments[2]?.method, PaymentMethod.transfer);
    assert.equal(await repository.getReturnEligibility(ids.branch, "V-100"), null);

    const returnBody = {
      reason: "Producto incorrecto",
      lines: [{ saleItemId: ids.saleItem, quantity: 1, trackingSelections: [] as [] }],
    };
    const returned = await repository.processReturn(ids.sale, ids.request, returnBody);
    assert.equal(returned.idempotent, true);
    const voidBody = { reason: "Venta duplicada" };
    const voided = await repository.voidSale(ids.sale, ids.request, voidBody);
    assert.equal(voided.idempotent, true);

    assert.deepEqual(calls.map(({ method, url }) => [method, url]), [
      [
        "GET",
        `/api/backend/pos/sales/history?branchId=${ids.branch}&search=V-100&from=2026-10-01&to=2026-10-08&status=completed&deliveryMethod=store_pickup&operationalStatus=ready_for_pickup&page=1&size=20&sort=createdAt%2Cdesc`,
      ],
      ["GET", `/api/backend/pos/sales/${ids.sale}`],
      [
        "GET",
        `/api/backend/pos/sales/returns/eligibility?branchId=${ids.branch}&documentNumber=V-100`,
      ],
      ["POST", `/api/backend/pos/sales/${ids.sale}/returns`],
      ["POST", `/api/backend/pos/sales/${ids.sale}/void`],
    ]);
    assert.deepEqual(calls[3]?.body, returnBody);
    assert.deepEqual(calls[4]?.body, voidBody);
    assert.equal(calls[3]?.idempotencyKey, ids.request);
    assert.equal(calls[4]?.idempotencyKey, ids.request);
    const reversalSequence = (event: DataEventName) => [
      event,
      "sale.changed",
      "inventory.changed",
      "stock.changed",
      "cash-shift.changed",
    ];
    assert.deepEqual(
      events.map(({ event }) => event),
      [...reversalSequence("sale.returned"), ...reversalSequence("sale.voided")],
      "Cada reversa confirmada refresca venta, inventario y caja exactamente una vez",
    );
    assert.ok(
      events.every(({ event, entityId }) => !event.startsWith("sale.") || entityId === ids.sale),
      "Los eventos de reversa identifican la venta afectada",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyProviderAndApplicationIsolation() {
  const original = { posDataSource: "mock", marker: true } as unknown as RepositoryRegistry;
  const decorated = withApiPos(original, new DataEventBus());
  assert.notEqual(decorated, original);
  assert.equal(decorated.posDataSource, "api");
  assert.ok(decorated.posApi instanceof ApiPosRepository);
  assert.equal(original.posDataSource, "mock");
  assert.equal((original as unknown as { marker: boolean }).marker, true);

  let mockFinancialCalls = 0;
  const forbidden = new Proxy(
    {},
    {
      get() {
        return () => {
          mockFinancialCalls += 1;
          throw new Error("Mock financial repository invoked");
        };
      },
    },
  );
  const api: Pick<PosApiRepository, "getOpenCashShift" | "getCashShiftMovements"> = {
    getOpenCashShift: async () => ({
      ...cashShift,
      closedAt: undefined,
      expectedAmount: undefined,
      countedAmount: undefined,
      difference: undefined,
    }),
    getCashShiftMovements: async () => [cashMovement],
  };
  const repositories = {
    posDataSource: "api",
    posApi: api,
    users: {
      getById: async () => ({
        id: ids.user,
        tenantId: ids.tenant,
        name: "Cajera",
        email: "cajera@example.com",
        type: UserType.employee,
        status: UserStatus.active,
        roleId: ids.role,
        allowedBranchIds: [ids.branch],
        createdAt: at,
        updatedAt: at,
      }),
    },
    roles: {
      getByIdScoped: async () => ({
        id: ids.role,
        tenantId: ids.tenant,
        name: "POS",
        isSystem: false,
        permissions: ["pos.cash.read"],
        branchScope: "assigned",
        status: RoleStatus.active,
        createdAt: at,
        updatedAt: at,
      }),
    },
    branches: {
      getById: async () => ({
        id: ids.branch,
        tenantId: ids.tenant,
        code: "MAIN",
        name: "Principal",
        type: "store",
        status: BranchStatus.active,
        createdAt: at,
        updatedAt: at,
      }),
    },
    cashShifts: forbidden,
    cashMovements: forbidden,
    sales: forbidden,
  } as unknown as RepositoryRegistry;
  const movements = await new GetCashShiftMovementsService(repositories).execute({
    tenantId: ids.tenant,
    actorUserId: ids.user,
    branchId: ids.branch,
    cashShiftId: ids.shift,
  });
  assert.equal(movements[0]?.id, ids.movement);
  assert.equal(mockFinancialCalls, 0);
}

function verifyRequestValidation() {
  const invalidRequests: Array<() => unknown> = [
    () => parseOpenCashShiftCommand({ branchId: "mock-id", registerCode: "POS", openingAmount: 1 }),
    () => parseOpenCashShiftCommand({ branchId: ids.branch, registerCode: "POS", openingAmount: Number.NaN }),
    () =>
      parseConfirmSaleCommand({
        branchId: ids.branch,
        cashShiftId: ids.shift,
        taxTotal: 0,
        items: [{ productId: ids.product, quantity: 1, discount: 0, trackingSelections: [] }],
        payments: [{ method: PaymentMethod.cash, amount: 1 }],
        confirmationId: ids.confirmation,
        sourceOrderId: null,
        deferredOrder: {
          idempotencyKey: "pickup-1",
          deliveryMethod: DeliveryMethod.store_pickup,
          transportMode: TransportMode.customer,
          storePickupContact: { recipientName: "Ana", recipientPhone: "" },
        },
      }),
  ];
  for (const run of invalidRequests) {
    assert.throws(
      run,
      (error) =>
        error instanceof BackendRequestError &&
        error.status === 400 &&
        error.code !== "INVALID_BACKEND_RESPONSE",
    );
  }
}

function recordEvents() {
  const eventBus = new DataEventBus();
  const events: Array<{ event: DataEventName; entityId?: string }> = [];
  const names: DataEventName[] = [
    "sale.changed",
    "sale.returned",
    "sale.voided",
    "inventory.changed",
    "stock.changed",
    "cash-shift.changed",
    "order.changed",
  ];
  names.forEach((event) =>
    eventBus.subscribe(event, (payload) => events.push({ event, entityId: payload?.entityId })),
  );
  return { eventBus, events };
}

function captureCall(url: string, init: RequestInit | undefined): CapturedCall {
  const headers = new Headers(init?.headers);
  return {
    url,
    method: init?.method ?? "GET",
    ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) as unknown } : {}),
    ...(headers.has("Idempotency-Key")
      ? { idempotencyKey: headers.get("Idempotency-Key") ?? undefined }
      : {}),
  };
}

/** Regresion de rendimiento: el catalogo POS no debe consultar promociones/conversiones por producto. */
async function verifyPosCatalogLoadsSharedDataOnce() {
  const productCount = 25;
  const unitId = id(900);
  const products = Array.from({ length: productCount }, (_, index) => ({
    id: id(1000 + index),
    tenantId: ids.tenant,
    sku: `SKU-${index}`,
    barcode: undefined,
    name: `Producto ${String(index).padStart(2, "0")}`,
    productType: ProductType.physical,
    salePrice: 100,
    baseUnitId: unitId,
    saleUnitId: unitId,
    tracking: { stock: true, lot: false, serial: false, expiration: false },
  }));
  const calls = { promotionsList: 0, applicable: 0, conversionsAll: 0, conversionsByProduct: 0, tiers: 0 };
  const promotion = {
    id: id(950),
    tenantId: ids.tenant,
    name: "Promo",
    type: PromotionType.percentage,
    value: 10,
    channels: [SalesChannel.pos],
    startAt: "2020-01-01T00:00:00.000Z",
    untilStockEnds: false,
    branchIds: [],
    productIds: [products[3]!.id],
    status: PromotionStatus.active,
    createdAt: at,
    updatedAt: at,
  };
  const repositories = {
    inventoryStockDataSource: "api",
    products: { getAvailableForPos: async () => products },
    inventory: {
      getStockPage: async () => ({
        items: products.map((product) => ({
          productId: product.id,
          productType: ProductType.physical,
          availableQuantity: 5,
        })),
        totalPages: 1,
      }),
    },
    units: {
      getByTenant: async () => [{ id: unitId, name: "Unidad" }],
      getAllConversionsByTenant: async () => {
        calls.conversionsAll += 1;
        return [];
      },
      getConversionsByProductScoped: async () => {
        calls.conversionsByProduct += 1;
        return [];
      },
    },
    promotions: {
      getActiveByTenant: async () => {
        calls.promotionsList += 1;
        return [promotion];
      },
      getApplicable: async () => {
        calls.applicable += 1;
        return null;
      },
    },
    productSalesPriceTiers: {
      getByProduct: async () => {
        calls.tiers += 1;
        return [];
      },
    },
  } as unknown as RepositoryRegistry;

  const result = await new GetPosProductsService(repositories).execute({
    tenantId: ids.tenant,
    branchId: ids.branch,
  });
  assert.equal(result.length, productCount);
  assert.deepEqual(calls, {
    promotionsList: 1,
    applicable: 0,
    conversionsAll: 1,
    conversionsByProduct: 0,
    tiers: productCount,
  });
  const promoted = result.find((item) => item.productId === products[3]!.id);
  assert.equal(promoted?.effectivePrice, 90, "La promocion se sigue aplicando al producto correcto");
  assert.ok(
    result.filter((item) => item.productId !== products[3]!.id).every((item) => item.effectivePrice === 100),
  );
}

async function main() {
  await verifyCashRoutesAndParsing();
  await verifySaleRoutePayloadAndSchema();
  await verifyErrorsArePreserved();
  await verifyHistoryReturnAndVoid();
  await verifyProviderAndApplicationIsolation();
  await verifyPosCatalogLoadsSharedDataOnce();
  verifyRequestValidation();
  console.log("API POS routes, schemas, errors, idempotency and isolation: PASS");
}

void main();
