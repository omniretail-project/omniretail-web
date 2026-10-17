import { vi } from "vitest";
import {
  BranchStatus,
  CashMovementType,
  CashShiftStatus,
  DeliveryMethod,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PlanStatus,
  RoleStatus,
  SaasCapabilityKey,
  SaleStatus,
  TenantStatus,
  TenantSubscriptionStatus,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import type {
  PosApiCashMovement,
  PosApiCashShift,
  PosApiConfirmSaleCommand,
  PosApiRepository,
  PosApiReturnEligibility,
  PosApiReversalEffect,
  PosApiSaleConfirmation,
  PosApiSaleDetail,
  PosApiSalesHistoryPage,
  PosApiVoidResult,
} from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

export const ids = {
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
  plan: id(22),
  otherBranch: id(23),
  session: id(24),
  customer: id(25),
};

export const at = "2026-10-08T12:00:00.000Z";

export const POS_PERMISSIONS = [
  "pos.sales.create",
  "pos.sales.read",
  "pos.sales.void",
  "pos.returns.read",
  "pos.returns.create",
  "pos.cash.open",
  "pos.cash.read",
  "pos.cash.close",
  "pos.cash.movement.create",
];

// --- Respuestas crudas del backend (JSON de Spring: los opcionales llegan como null) -----------

export const cashShiftJson = {
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

export const cashMovementJson = {
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

export const cashSummaryJson = {
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

export const saleItemJson = {
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

const paymentJson = (
  paymentId: string,
  method: PaymentMethod,
  amount: number,
  extra: Record<string, unknown> = {},
) => ({
  id: paymentId,
  saleId: ids.sale,
  orderId: null,
  method,
  amount,
  reference: null,
  status: PaymentStatus.approved,
  currency: "GTQ",
  bankAccountId: null,
  externallyVerified: null,
  verifiedByUserId: null,
  verifiedAt: null,
  ...extra,
});

export const paymentsJson = [
  paymentJson(ids.paymentCash, PaymentMethod.cash, 20),
  paymentJson(ids.paymentCard, PaymentMethod.card, 30, { reference: "TERM-200" }),
  paymentJson(ids.paymentTransfer, PaymentMethod.transfer, 48.76, {
    reference: "TRX-300",
    bankAccountId: ids.bankAccount,
    externallyVerified: true,
    verifiedByUserId: ids.user,
    verifiedAt: at,
  }),
];

export const saleSummaryJson = {
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

export const saleConfirmationJson = {
  ...saleSummaryJson,
  items: [saleItemJson],
  payments: paymentsJson,
  inventoryEffects: [{ id: ids.inventoryMovement, productId: ids.product, createdAt: at }],
  cashMovement: cashMovementJson,
  order: { id: ids.order, orderNumber: "ORD-100", serverStatus: "confirmed" },
  pickingOrder: { id: ids.picking, orderId: ids.order, serverStatus: "pending" },
  idempotent: false,
};

export const historyPageJson = {
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

export const saleDetailJson = { sale: saleSummaryJson, items: [saleItemJson], payments: paymentsJson };

export const returnEligibilityJson = {
  sale: {
    id: ids.sale,
    documentNumber: "V-100",
    createdAt: at,
    customerDisplayName: "Consumidor final",
    total: 98.76,
    status: SaleStatus.completed,
  },
  items: [
    {
      saleItemId: ids.saleItem,
      productId: ids.product,
      sku: "POS-001",
      name: "Producto POS",
      soldQuantity: 2,
      returnedQuantity: 0,
      returnableQuantity: 2,
      unitPrice: 50,
      discount: 1.24,
      subtotal: 97.52,
      canReturn: true,
      blockedReason: null,
      traceOptions: [],
    },
  ],
  payments: [
    {
      id: ids.paymentCash,
      method: PaymentMethod.cash,
      status: PaymentStatus.approved,
      amount: 98.76,
      currency: "GTQ",
    },
  ],
  previouslyReturnedAmount: 0,
  cashRefundRecordedAmount: 0,
  originalCashShiftOpen: true,
  actorHasOpenCashShift: true,
  allowedOperations: {
    voidTotal: true,
    partialReturn: true,
    voidBlockedReason: null,
    returnBlockedReason: null,
  },
};

const reversalEffects = {
  inventory: {
    inventoryRestored: true,
    movementIds: [ids.inventoryMovement],
    reservationsReleased: 0,
  },
  cashMovement: { recorded: true, movementIds: [ids.movement], amount: 20 },
};

export const returnOperationJson = {
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
  ...reversalEffects,
};

export const voidOperationJson = {
  operationId: ids.operation,
  idempotent: false,
  reason: "Venta duplicada",
  sale: { ...saleSummaryJson, status: SaleStatus.cancelled },
  ...reversalEffects,
};

export const confirmSaleCommand = {
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

// --- Valores ya parseados (lo que entrega el repositorio API a los servicios) -----------------

export const apiCashShift: PosApiCashShift = {
  id: ids.shift,
  branchId: ids.branch,
  userId: ids.user,
  registerCode: "POS-01",
  status: CashShiftStatus.open,
  openedAt: at,
  openingAmount: 100,
  createdAt: at,
  updatedAt: at,
};

export const apiCashMovement: PosApiCashMovement = {
  id: ids.movement,
  cashShiftId: ids.shift,
  type: CashMovementType.in,
  amount: 200,
  reason: "Venta POS #V-100",
  referenceType: "sale",
  referenceId: ids.sale,
  createdByUserId: ids.user,
  createdAt: at,
  saleNumber: "V-100",
};

export const apiSaleConfirmation: PosApiSaleConfirmation = {
  id: ids.sale,
  number: "V-100",
  branchId: ids.branch,
  cashShiftId: ids.shift,
  subtotal: 100,
  discountTotal: 0,
  taxTotal: 0,
  total: 100,
  createdAt: at,
  status: SaleStatus.completed,
  items: [
    {
      id: ids.saleItem,
      productId: ids.product,
      sku: "POS-001",
      name: "Producto POS",
      quantity: 2,
      unitPrice: 50,
      discount: 0,
      subtotal: 100,
    },
  ],
  payments: [
    {
      id: ids.paymentCash,
      saleId: ids.sale,
      method: PaymentMethod.cash,
      amount: 100,
      status: PaymentStatus.approved,
      currency: "GTQ",
    },
  ],
  inventoryEffects: [{ id: ids.inventoryMovement }],
  cashMovement: { id: ids.movement, cashShiftId: ids.shift, amount: 100 },
  idempotent: false,
};

export const apiReturnEligibility: PosApiReturnEligibility = {
  sale: {
    id: ids.sale,
    documentNumber: "V-100",
    createdAt: at,
    customerDisplayName: "Consumidor final",
    total: 98.76,
    status: SaleStatus.completed,
  },
  items: [
    {
      saleItemId: ids.saleItem,
      productId: ids.product,
      sku: "POS-001",
      name: "Producto POS",
      soldQuantity: 2,
      returnedQuantity: 0,
      returnableQuantity: 2,
      unitPrice: 50,
      discount: 1.24,
      subtotal: 97.52,
      canReturn: true,
    },
  ],
  payments: [
    {
      id: ids.paymentCash,
      method: PaymentMethod.cash,
      status: PaymentStatus.approved,
      amount: 20,
      currency: "GTQ",
    },
    {
      id: ids.paymentCard,
      method: PaymentMethod.card,
      status: PaymentStatus.approved,
      amount: 78.76,
      currency: "GTQ",
    },
  ],
  previouslyReturnedAmount: 0,
  cashRefundRecordedAmount: 0,
  originalCashShiftOpen: true,
  actorHasOpenCashShift: true,
  allowedOperations: { voidTotal: true, partialReturn: true },
};

export const apiReversalEffect: PosApiReversalEffect = {
  operationId: ids.operation,
  idempotent: false,
  reason: "Producto incorrecto",
  saleStatus: SaleStatus.partially_returned,
  commercialRefundAmount: 48.76,
  inventory: { inventoryRestored: true, movementIds: [ids.inventoryMovement] },
  cashMovement: { recorded: true, movementIds: [ids.movement], amount: 48.76 },
};

export const apiVoidResult: PosApiVoidResult = {
  operationId: ids.operation,
  idempotent: true,
  reason: "Venta duplicada",
  inventory: { inventoryRestored: true, movementIds: [ids.inventoryMovement] },
  cashMovement: { recorded: false, movementIds: [] },
  sale: { id: ids.sale, number: "V-100", status: SaleStatus.cancelled, total: 98.76 },
};

export const apiHistoryPage = (
  overrides: Partial<PosApiSalesHistoryPage> = {},
): PosApiSalesHistoryPage => ({
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
  pageSize: 100,
  totalItems: 1,
  totalPages: 1,
  summary: { total: 1, completed: 1, partiallyReturned: 0, returned: 0, cancelled: 0 },
  ...overrides,
});

export const apiSaleDetail: PosApiSaleDetail = {
  sale: {
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
    sourceOrderId: ids.order,
    document: { type: "invoice", taxId: "1234567-8" },
  },
  items: apiSaleConfirmation.items,
  payments: apiSaleConfirmation.payments,
};

// --- Entidades de sesión y alcance -------------------------------------------------------------

export const user = {
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
};

export const role = {
  id: ids.role,
  tenantId: ids.tenant,
  name: "POS",
  isSystem: false,
  permissions: POS_PERMISSIONS,
  branchScope: "assigned",
  status: RoleStatus.active,
  createdAt: at,
  updatedAt: at,
};

export const branch = {
  id: ids.branch,
  tenantId: ids.tenant,
  code: "MAIN",
  name: "Principal",
  type: "store",
  status: BranchStatus.active,
  createdAt: at,
  updatedAt: at,
};

export const tenant = {
  id: ids.tenant,
  name: "Ferretería",
  status: TenantStatus.active,
  defaultCurrency: "GTQ",
  createdAt: at,
  updatedAt: at,
};

/** Repositorios mock financieros: en modo API invocarlos es un error de integración. */
export function forbiddenRepository(name: string) {
  return new Proxy(
    {},
    {
      get(_target, property) {
        return () => {
          throw new Error(`Repositorio mock ${name}.${String(property)} invocado en modo API`);
        };
      },
    },
  );
}

export type PosApiMock = { [Key in keyof PosApiRepository]: ReturnType<typeof vi.fn> };

export function createPosApiMock(): PosApiMock {
  return {
    getOpenCashShift: vi.fn().mockResolvedValue(apiCashShift),
    openCashShift: vi.fn().mockResolvedValue(apiCashShift),
    closeCashShift: vi.fn().mockResolvedValue({ ...apiCashShift, status: CashShiftStatus.closed }),
    getCashShiftSummary: vi.fn(),
    getCashShiftMovements: vi.fn().mockResolvedValue([apiCashMovement]),
    registerCashMovement: vi.fn().mockResolvedValue(apiCashMovement),
    confirmSale: vi.fn().mockResolvedValue(apiSaleConfirmation),
    getSalesHistory: vi.fn().mockResolvedValue(apiHistoryPage()),
    getSaleDetail: vi.fn().mockResolvedValue(apiSaleDetail),
    getReturnEligibility: vi.fn().mockResolvedValue(apiReturnEligibility),
    processReturn: vi.fn().mockResolvedValue(apiReversalEffect),
    voidSale: vi.fn().mockResolvedValue(apiVoidResult),
  };
}

export interface PosRepositoryOptions {
  user?: Partial<typeof user> | null;
  role?: Partial<typeof role> | null;
  branch?: Partial<typeof branch> | null;
  planCapabilities?: SaasCapabilityKey[];
  allowedPosPaymentMethods?: PaymentMethod[];
  sessionId?: string | null;
  extra?: Record<string, unknown>;
}

/** Registro en modo API: sesión y alcance reales, `posApi` simulado y mocks financieros vetados. */
export function createPosRepositories(options: PosRepositoryOptions = {}) {
  const posApi = createPosApiMock();
  const currentUser = options.user === null ? null : { ...user, ...options.user };
  const currentRole = options.role === null ? null : { ...role, ...options.role };
  const currentBranch = options.branch === null ? null : { ...branch, ...options.branch };
  const repositories = {
    posDataSource: "api",
    posApi,
    auth: {
      getCurrentSessionId: vi
        .fn()
        .mockResolvedValue(options.sessionId === undefined ? ids.session : options.sessionId),
      getSession: vi.fn().mockResolvedValue({ id: ids.session, userId: ids.user }),
    },
    users: { getById: vi.fn().mockResolvedValue(currentUser) },
    roles: { getByIdScoped: vi.fn().mockResolvedValue(currentRole) },
    tenants: { getById: vi.fn().mockResolvedValue(tenant) },
    branches: {
      getById: vi.fn().mockResolvedValue(currentBranch),
      getByIdScoped: vi.fn().mockResolvedValue(currentBranch),
    },
    tenantSubscriptions: {
      getByTenantId: vi.fn().mockResolvedValue({
        id: id(30),
        tenantId: ids.tenant,
        planId: ids.plan,
        status: TenantSubscriptionStatus.active,
        addonCodes: [],
      }),
    },
    plans: {
      getById: vi.fn().mockResolvedValue({
        id: ids.plan,
        code: "pro",
        status: PlanStatus.active,
        capabilities: options.planCapabilities ?? [SaasCapabilityKey.pos],
      }),
    },
    businessConfig: {
      getCapabilities: vi.fn().mockResolvedValue({
        allowedPosPaymentMethods: options.allowedPosPaymentMethods ?? [
          PaymentMethod.cash,
          PaymentMethod.card,
          PaymentMethod.transfer,
        ],
      }),
    },
    customers: { getById: vi.fn().mockResolvedValue(null) },
    bankAccounts: {
      getById: vi.fn().mockResolvedValue({
        id: ids.bankAccount,
        tenantId: ids.tenant,
        status: "active",
        currency: "GTQ",
        branchIds: [],
      }),
    },
    cashShifts: forbiddenRepository("cashShifts"),
    cashMovements: forbiddenRepository("cashMovements"),
    sales: forbiddenRepository("sales"),
    saleConfirmations: forbiddenRepository("saleConfirmations"),
    saleReversals: forbiddenRepository("saleReversals"),
    payments: forbiddenRepository("payments"),
    ...options.extra,
  };
  return { repositories: repositories as unknown as RepositoryRegistry, posApi, raw: repositories };
}

export const cashContext = { tenantId: ids.tenant, actorUserId: ids.user, branchId: ids.branch };

export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

export interface CapturedCall {
  url: string;
  method: string;
  body?: unknown;
  idempotencyKey?: string;
}

/** Sustituye `fetch` global y registra cada llamada al proxy `/api/backend`. */
export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: CapturedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        idempotencyKey: headers["Idempotency-Key"],
      });
      return handler(url, init);
    }),
  );
  return calls;
}
