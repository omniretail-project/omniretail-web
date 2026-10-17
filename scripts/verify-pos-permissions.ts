import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role, User } from "@/core/entities";
import {
  BranchStatus,
  BranchType,
  CashMovementType,
  CashShiftStatus,
  DeliveryMethod,
  PlanCode,
  PlanStatus,
  ProductStatus,
  ProductType,
  RoleStatus,
  SaasCapabilityKey,
  TenantStatus,
  TenantSubscriptionStatus,
  TransportMode,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  MockBankAccountRepository,
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCashMovementRepository,
  MockCashShiftRepository,
  MockCustomerRepository,
  MockInventoryRepository,
  MockOrderRepository,
  MockPlanRepository,
  MockProductRepository,
  MockPromotionRepository,
  MockRoleRepository,
  MockSaleConfirmationRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import type { CheckoutDto } from "@/modules/pos/application/dto/CheckoutDto";
import type { SaleTicketDto } from "@/modules/pos/application/dto/SaleTicketDto";
import {
  ConfirmSaleService,
  type ConfirmPosSaleInput,
} from "@/modules/pos/application/services/ConfirmSaleService";
import { GetCheckoutBankAccountsService } from "@/modules/pos/application/services/GetCheckoutBankAccountsService";
import { OpenCashShiftService } from "@/modules/pos/application/services/OpenCashShiftService";
import { RegisterCashMovementService } from "@/modules/pos/application/services/RegisterCashMovementService";
import { CloseCashShiftService } from "@/modules/pos/application/services/CloseCashShiftService";

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

const NOW = "2026-01-01T12:00:00.000Z";

/**
 * feature/saas-entitlement-enforcement agregó un guard de entitlement SaaS delante de las
 * mutaciones de POS -- este harness prueba permisos/tenant/branch, no entitlements (eso vive en
 * verify-saas-entitlement-enforcement.ts), así que TENANT_B necesita un Plan "full" para no
 * quedar bloqueado por una capa que este script no está probando.
 */
function seedFullEntitlementPlan(db: MockDatabase, tenantId: string) {
  const planId = `plan-full-${tenantId}`;
  db.planDefinitions.push({
    id: planId,
    code: PlanCode.enterprise,
    name: `Plan full (fixture ${tenantId})`,
    status: PlanStatus.active,
    capabilities: Object.values(SaasCapabilityKey),
    limits: {},
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.tenantSubscriptions.push({
    id: `tenant-subscription-${tenantId}`,
    tenantId,
    planId,
    status: TenantSubscriptionStatus.active,
    startedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
}
const TENANT_A = "tenant-demo";
const TENANT_B = "pos-hardening-tenant-b";
const BRANCH_CENTRO = "branch-centro";
const BRANCH_NORTE = "branch-norte";
const BRANCH_B = "pos-hardening-branch-b";
const USER_AUTHORIZED = "pos-hardening-user-authorized";
const USER_NO_SALES = "pos-hardening-user-no-sales";
const USER_CASH = "pos-hardening-user-cash";
const ROLE_AUTHORIZED = "pos-hardening-role-authorized";
const ROLE_NO_SALES = "pos-hardening-role-no-sales";
const ROLE_CASH = "pos-hardening-role-cash";
const PRODUCT_ID = "prod-hammer";
const BALANCE_ID = "balance-prod-hammer";
const CASH_SHIFT_ID = "pos-hardening-shift-authorized";
const SALE_UNIT_ID = "unit-box";
const BASE_UNIT_ID = "unit-unit";
const SALE_TO_BASE_FACTOR = 4;

function role(id: string, permissions: string[]): Role {
  return {
    id,
    tenantId: TENANT_A,
    name: id,
    isSystem: false,
    permissions,
    branchScope: "selected",
    status: RoleStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function user(id: string, roleId: string, allowedBranchIds: string[]): User {
  return {
    id,
    tenantId: TENANT_A,
    name: id,
    email: `${id}@example.test`,
    type: UserType.employee,
    status: UserStatus.active,
    roleId,
    allowedBranchIds,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createHarness(initialUserId = USER_AUTHORIZED) {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  let currentUserId = initialUserId;

  store.mutate((db) => {
    db.tenants.push({
      id: TENANT_B,
      name: "Tenant B POS",
      slug: "tenant-b-pos",
      status: TenantStatus.active,
      defaultCurrency: "GTQ",
      timezone: "America/Guatemala",
      createdAt: NOW,
      updatedAt: NOW,
    });
    seedFullEntitlementPlan(db, TENANT_B);
    db.branches.push({
      id: BRANCH_B,
      tenantId: TENANT_B,
      code: "TB",
      name: "Tenant B Branch",
      type: BranchType.store,
      status: BranchStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.roles.push(
      role(ROLE_AUTHORIZED, ["pos.sales.create"]),
      role(ROLE_NO_SALES, ["pos.sales.read"]),
      role(ROLE_CASH, ["pos.cash.open", "pos.cash.close", "pos.cash.movement.create"]),
    );
    db.users.push(
      user(USER_AUTHORIZED, ROLE_AUTHORIZED, [BRANCH_CENTRO]),
      user(USER_NO_SALES, ROLE_NO_SALES, [BRANCH_CENTRO]),
      user(USER_CASH, ROLE_CASH, [BRANCH_CENTRO]),
    );
    const product = db.products.find((item) => item.id === PRODUCT_ID);
    assert.ok(product, "fixture product must exist");
    product.baseUnitId = BASE_UNIT_ID;
    product.inventoryUnitId = BASE_UNIT_ID;
    product.saleUnitId = SALE_UNIT_ID;
    product.salePrice = 75;
    product.status = ProductStatus.published;
    product.productType = ProductType.physical;
    product.tracking = { stock: true, lot: false, expiration: false, serial: false };
    product.channels = { ecommerce: true, pos: true, mobileApp: true };
    db.unitConversions = db.unitConversions.filter((item) => item.productId !== PRODUCT_ID);
    db.unitConversions.push({
      id: "pos-hardening-hammer-box-unit",
      tenantId: TENANT_A,
      productId: PRODUCT_ID,
      fromUnitId: SALE_UNIT_ID,
      toUnitId: BASE_UNIT_ID,
      factor: SALE_TO_BASE_FACTOR,
      createdAt: NOW,
    });
    const balance = db.inventoryBalances.find((item) => item.id === BALANCE_ID);
    assert.ok(balance, "fixture balance must exist");
    balance.quantity = 24;
    balance.reservedQuantity = 0;
    balance.locationId = "loc-centro-a";
    db.cashShifts.push({
      id: CASH_SHIFT_ID,
      tenantId: TENANT_A,
      branchId: BRANCH_CENTRO,
      userId: USER_AUTHORIZED,
      registerCode: "PR-C-POS",
      status: CashShiftStatus.open,
      openedAt: NOW,
      openingAmount: 100,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.bankAccounts.push({
      id: "pos-hardening-bank-tenant-b",
      tenantId: TENANT_B,
      bankName: "Banco Tenant B",
      holderName: "Tenant B",
      accountNumber: "999988887777",
      accountNumberMasked: "********7777",
      accountType: "monetary",
      currency: "GTQ",
      alias: "Tenant B",
      branchIds: [BRANCH_B],
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  const repositories = {
    auth: {
      getCurrentSessionId: async () => `session-${currentUserId}`,
      getSession: async (sessionId: string) =>
        sessionId === `session-${currentUserId}` ? { id: sessionId, userId: currentUserId } : null,
    },
    tenants: new MockTenantRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    branches: new MockBranchRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    productSalesPriceTiers: { getByProduct: async () => [] },
    promotions: new MockPromotionRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    inventory: new MockInventoryRepository(store, eventBus),
    customers: new MockCustomerRepository(store, eventBus),
    orders: new MockOrderRepository(store, eventBus),
    bankAccounts: new MockBankAccountRepository(store, eventBus),
    saleConfirmations: new MockSaleConfirmationRepository(store, eventBus),
    cashShifts: new MockCashShiftRepository(store, eventBus),
    cashMovements: new MockCashMovementRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return {
    store,
    repositories,
    setCurrentUser: (userId: string) => {
      currentUserId = userId;
    },
  };
}

function createSaleInput(overrides: Partial<ConfirmPosSaleInput> = {}): ConfirmPosSaleInput {
  const quantity = 2;
  const unitPrice = 75;
  const total = quantity * unitPrice;
  const ticket: SaleTicketDto = {
    items: [
      {
        productId: PRODUCT_ID,
        sku: "HER-MAN-001",
        name: "Martillo de uña 16 oz",
        quantity,
        baseUnitPrice: unitPrice,
        unitPrice,
        discount: 0,
        subtotal: total,
        availableQuantity: 24,
        saleUnitId: SALE_UNIT_ID,
        saleUnitName: "Caja",
        tracksStock: true,
        requiresUnsupportedTraceability: false,
      },
    ],
    subtotal: total,
    discountTotal: 0,
    total,
    hasUnsupportedTraceability: false,
  };
  const checkout: CheckoutDto = {
    documentType: "ticket",
    invoiceData: { taxId: "", legalName: "", fiscalAddress: "" },
    paymentMode: "cash",
    cashAmount: total,
    cashReceived: total,
    changeAmount: 0,
    cardAmount: 0,
    cardTerminalResult: { status: "idle" },
    transferAmount: 0,
    bankAccountId: "",
    transferReference: "",
    transferExternallyVerified: false,
    deliveryMethod: DeliveryMethod.immediate,
    transportMode: TransportMode.none,
    notificationContact: { emailMode: "not_applicable" },
  };
  return {
    confirmationId: `pos-hardening-${crypto.randomUUID()}`,
    branchId: BRANCH_CENTRO,
    cashShiftId: CASH_SHIFT_ID,
    ticket,
    checkout,
    ...overrides,
  };
}

function snapshotEffects(store: MockDatabaseStore) {
  return store.read((db) => ({
    balances: db.inventoryBalances,
    movements: db.inventoryMovements,
    lots: db.stockLots,
    serials: db.serialNumbers,
    reservations: db.inventoryReservations,
    sales: db.sales,
    payments: db.payments,
    cashMovements: db.cashMovements,
  }));
}

async function assertDeniedWithoutEffects(
  store: MockDatabaseStore,
  action: () => Promise<unknown>,
  message: RegExp,
) {
  const before = snapshotEffects(store);
  await assert.rejects(action, message);
  const after = snapshotEffects(store);
  assert.deepEqual(after, before, "denied POS operation must not mutate inventory/sales/cash state");
}

async function verifySaleAuthBoundaries() {
  const harness = createHarness(USER_AUTHORIZED);
  const service = new ConfirmSaleService(harness.repositories);

  harness.setCurrentUser(USER_NO_SALES);
  await assertDeniedWithoutEffects(
    harness.store,
    () =>
      service.execute({
        ...createSaleInput(),
        hasSalesPermission: true,
        user: { id: USER_AUTHORIZED, tenantId: TENANT_A },
      } as unknown as ConfirmPosSaleInput),
    /permiso/,
  );

  harness.setCurrentUser(USER_AUTHORIZED);
  await assertDeniedWithoutEffects(
    harness.store,
    () =>
      service.execute({
        ...createSaleInput({ branchId: BRANCH_NORTE }),
        hasBranchAccess: true,
        currentBranch: { id: BRANCH_NORTE, tenantId: TENANT_A },
      } as unknown as ConfirmPosSaleInput),
    /acceso|sucursal/,
  );

  await assertDeniedWithoutEffects(
    harness.store,
    () => service.execute(createSaleInput({ branchId: BRANCH_B })),
    /sucursal|negocio|acceso/,
  );
  await assertDeniedWithoutEffects(
    harness.store,
    () => service.execute(createSaleInput({ branchId: BRANCH_NORTE })),
    /acceso|sucursal/,
  );

  harness.setCurrentUser(USER_NO_SALES);
  await assertDeniedWithoutEffects(
    harness.store,
    () => service.execute(createSaleInput()),
    /permiso/,
  );

  harness.setCurrentUser(USER_AUTHORIZED);
  const before = harness.store.read((db) => ({
    balance: db.inventoryBalances.find((item) => item.id === BALANCE_ID),
    reservations: db.inventoryReservations,
  }));
  assert.ok(before.balance);
  const result = await service.execute(createSaleInput());
  const expectedCanonicalDecrement = 2 * SALE_TO_BASE_FACTOR;
  assert.equal(result.idempotent, false, "authorized sale must be created");
  assert.equal(result.inventoryMovements.length, 1, "physical stock sale must create one movement");
  assert.equal(
    result.inventoryMovements[0]?.quantity,
    expectedCanonicalDecrement,
    "sale unit must be converted to canonical base quantity in inventory movement",
  );
  const after = harness.store.read((db) => ({
    balance: db.inventoryBalances.find((item) => item.id === BALANCE_ID),
    reservations: db.inventoryReservations,
  }));
  assert.ok(after.balance);
  assert.equal(
    after.balance.quantity,
    before.balance.quantity - expectedCanonicalDecrement,
    "authorized sale must decrement base-unit inventory quantity",
  );
  assert.deepEqual(
    after.reservations,
    before.reservations,
    "immediate POS sale must not rewrite existing canonical reservations",
  );
}

async function verifyBankAccountBoundaries() {
  const harness = createHarness(USER_NO_SALES);
  const service = new GetCheckoutBankAccountsService(harness.repositories);

  await assert.rejects(
    service.execute({ branchId: BRANCH_CENTRO }),
    /permiso/,
    "bank account read must require POS sales operational permission",
  );

  harness.setCurrentUser(USER_AUTHORIZED);
  await assert.rejects(
    service.execute({ branchId: BRANCH_NORTE }),
    /acceso|sucursal/,
    "bank account read must enforce User.allowedBranchIds",
  );
  await assert.rejects(
    service.execute({ branchId: BRANCH_B }),
    /sucursal|negocio|acceso/,
    "bank account read must deny foreign tenant branch",
  );

  const accounts = await service.execute({ branchId: BRANCH_CENTRO });
  assert.ok(accounts.length > 0, "authorized POS cashier should see active checkout accounts");
  assert.ok(
    accounts.every((account) => "accountNumberMasked" in account),
    "read model must expose masked account number",
  );
  assert.ok(
    accounts.every((account) => !("accountNumber" in account)),
    "read model must not expose full account number",
  );
  assert.equal(
    accounts.some((account) => account.id === "pos-hardening-bank-tenant-b"),
    false,
    "Tenant A cashier must not receive Tenant B accounts",
  );
}

async function verifyCashSmoke() {
  const harness = createHarness(USER_CASH);
  const open = new OpenCashShiftService(harness.repositories);
  const movement = new RegisterCashMovementService(harness.repositories);
  const close = new CloseCashShiftService(harness.repositories);
  const opened = await open.execute({
    tenantId: TENANT_A,
    actorUserId: USER_CASH,
    branchId: BRANCH_CENTRO,
    registerCode: "PR-C-SMOKE",
    openingAmount: 50,
  });
  assert.equal(opened.status, CashShiftStatus.open);
  const registered = await movement.execute({
    tenantId: TENANT_A,
    actorUserId: USER_CASH,
    branchId: BRANCH_CENTRO,
    cashShiftId: opened.id,
    type: CashMovementType.in,
    amount: 10,
    reason: "Smoke PR C",
  });
  assert.equal(registered.cashShiftId, opened.id);
  const closed = await close.execute({
    tenantId: TENANT_A,
    actorUserId: USER_CASH,
    branchId: BRANCH_CENTRO,
    cashShiftId: opened.id,
    countedAmount: 60,
  });
  assert.notEqual(closed.status, CashShiftStatus.open);
}

function verifySourceInvariants() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  const confirmSale = read("src/modules/pos/application/services/ConfirmSaleService.ts");
  const inputBlock = confirmSale.match(/export interface ConfirmPosSaleInput \{[\s\S]*?\n\}/)?.[0] ?? "";
  for (const forbidden of ["hasSalesPermission", "hasBranchAccess", "user:", "currentBranch:"]) {
    assert.equal(inputBlock.includes(forbidden), false, `ConfirmPosSaleInput must not expose ${forbidden}`);
  }
  assert.ok(
    confirmSale.includes("resolvePosSessionContext") && confirmSale.includes("POS_SALES_CREATE_PERMISSION"),
    "ConfirmSaleService must resolve session and permission internally",
  );

  const usePosTerminal = read("src/modules/pos/hooks/usePosTerminal.ts");
  const executePayload = usePosTerminal.match(/confirmationService\.execute\(\{[\s\S]*?\}\);/)?.[0] ?? "";
  for (const forbidden of ["hasSalesPermission", "hasBranchAccess", "user:", "currentBranch:", "cashShift:", "currency:"] ) {
    assert.equal(executePayload.includes(forbidden), false, `usePosTerminal must not send ${forbidden} as authority`);
  }

  const checkoutDto = read("src/modules/pos/application/dto/CheckoutDto.ts");
  const bankAccountDto =
    checkoutDto.match(/export interface CheckoutBankAccountDto \{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.ok(
    !bankAccountDto.includes("accountNumber:"),
    "POS bank account DTO must not expose full account number",
  );

  assert.ok(
    bankAccountDto.includes("accountNumberMasked"),
    "POS bank account DTO must preserve masked account number",
  );

  const checkoutModal = read("src/modules/pos/components/CheckoutModal.tsx");

  assert.ok(
    checkoutModal.includes('label="Cuenta"') &&
      checkoutModal.includes("account.accountNumberMasked") &&
      !checkoutModal.includes("value={account.accountNumber}"),
    "POS transfer detail must show only the masked account number",
  );
}

async function main() {
  await verifySaleAuthBoundaries();
  await verifyBankAccountBoundaries();
  await verifyCashSmoke();
  verifySourceInvariants();
  console.log("pos permissions verification: PASS");
}

void main();
