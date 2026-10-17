import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BankAccount, Tenant } from "@/core/entities";
import { BranchStatus, BranchType, RoleStatus, TenantStatus, UserStatus, UserType } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBankAccountRepository,
  MockBranchRepository,
  MockRoleRepository,
  MockTenantRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { GetCheckoutBankAccountsService } from "@/modules/pos/application/services/GetCheckoutBankAccountsService";

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

const NOW = "2026-01-01T00:00:00.000Z";
const TENANT_A = "pos-bank-tenant-a";
const TENANT_B = "pos-bank-tenant-b";
const BRANCH_A1 = "pos-bank-branch-a1";
const BRANCH_A2 = "pos-bank-branch-a2";

function tenant(id: string, currency: Tenant["defaultCurrency"]): Tenant {
  return {
    id,
    name: id,
    slug: id,
    status: TenantStatus.active,
    defaultCurrency: currency,
    timezone: "America/Guatemala",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function bankAccount(overrides: Partial<BankAccount> & Pick<BankAccount, "id">): BankAccount {
  return {
    tenantId: TENANT_A,
    bankName: "Banco Demo",
    holderName: "FerrePharma Demo",
    accountNumber: "123456789012",
    accountNumberMasked: "********9012",
    accountType: "monetary",
    currency: "GTQ",
    alias: "Principal",
    branchIds: [],
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createHarness() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.tenants = [tenant(TENANT_A, "GTQ"), tenant(TENANT_B, "GTQ")];
    db.branches = [
      {
        id: BRANCH_A1,
        tenantId: TENANT_A,
        code: "A1",
        name: "Sucursal A1",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: BRANCH_A2,
        tenantId: TENANT_A,
        code: "A2",
        name: "Sucursal A2",
        type: BranchType.store,
        status: BranchStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    db.roles.push({
      id: "role-pos-bank",
      tenantId: TENANT_A,
      name: "POS bank role",
      isSystem: false,
      permissions: ["pos.sales.create"],
      branchScope: "selected",
      status: RoleStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.users.push({
      id: "user-pos-bank",
      tenantId: TENANT_A,
      name: "POS Bank User",
      email: "pos-bank@example.com",
      type: UserType.employee,
      status: UserStatus.active,
      roleId: "role-pos-bank",
      allowedBranchIds: [BRANCH_A1, BRANCH_A2],
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.bankAccounts = [
      bankAccount({ id: "account-branch-a1-only", branchIds: [BRANCH_A1] }),
      bankAccount({ id: "account-all-branches", branchIds: [] }),
      bankAccount({ id: "account-inactive", status: "inactive" }),
      bankAccount({ id: "account-tenant-b", tenantId: TENANT_B }),
      bankAccount({ id: "account-wrong-currency", currency: "USD" }),
    ];
  });

  const session = { id: "session-pos-bank", userId: "user-pos-bank" };
  return {
    repositories: {
      auth: {
        getCurrentSessionId: async () => session.id,
        getSession: async (sessionId: string) => (sessionId === session.id ? session : null),
      },
      bankAccounts: new MockBankAccountRepository(store, eventBus),
      branches: new MockBranchRepository(store, eventBus),
      roles: new MockRoleRepository(store, eventBus),
      tenants: new MockTenantRepository(store, eventBus),
      users: new MockUserRepository(store, eventBus),
    } as unknown as RepositoryRegistry,
  };
}

async function verifyServiceBehavior(harness: ReturnType<typeof createHarness>) {
  const service = new GetCheckoutBankAccountsService(harness.repositories);

  const forBranchA1 = await service.execute({ branchId: BRANCH_A1 });
  const byId = new Map(forBranchA1.map((item) => [item.id, item]));

  // B. POS transfer recibe solo mascara, no numero completo.
  assert.equal(
    byId.get("account-branch-a1-only")?.accountNumberMasked,
    "********9012",
    "El servicio debe devolver accountNumberMasked",
  );
  assert.equal(
    "accountNumber" in (byId.get("account-branch-a1-only") ?? {}),
    false,
    "El read model de POS no debe exponer accountNumber completo",
  );

  // C. Campos estructurados correctos, sin label concatenado.
  const account = byId.get("account-branch-a1-only");
  assert.equal(account?.bankName, "Banco Demo");
  assert.equal(account?.accountType, "monetary");
  assert.equal(account?.holderName, "FerrePharma Demo");
  assert.equal("label" in (account ?? {}), false, "CheckoutBankAccountDto no debe tener label");

  // D. Cuenta inactive no aparece.
  assert.equal(byId.has("account-inactive"), false, "Una cuenta inactive no debe aparecer en POS");

  // E. Tenant B no aparece para Tenant A.
  assert.equal(byId.has("account-tenant-b"), false, "Tenant A jamas debe recibir cuenta de Tenant B");

  // Moneda distinta a la del tenant tampoco aparece (regla ya existente, se conserva).
  assert.equal(byId.has("account-wrong-currency"), false, "La moneda debe coincidir con el tenant");

  // F. Cuenta restringida a otra sucursal no aparece; la de todas las sucursales si.
  assert.equal(
    byId.has("account-branch-a1-only"),
    true,
    "La cuenta restringida a A1 debe verse desde A1",
  );
  assert.equal(byId.has("account-all-branches"), true, "branchIds vacio = todas las sucursales");

  const forBranchA2 = await service.execute({ branchId: BRANCH_A2 });
  const idsForA2 = forBranchA2.map((item) => item.id);
  assert.equal(
    idsForA2.includes("account-branch-a1-only"),
    false,
    "Una cuenta restringida a A1 no debe verse desde A2",
  );
  assert.equal(
    idsForA2.includes("account-all-branches"),
    true,
    "branchIds vacio sigue viendose desde cualquier sucursal",
  );
}

function verifySourceInvariants() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

  // A. El contrato de checkout POS solo permite el numero enmascarado.
  const checkoutDto = read("src/modules/pos/application/dto/CheckoutDto.ts");
  const checkoutBankAccountDto =
    checkoutDto.match(/export interface CheckoutBankAccountDto \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.equal(
    checkoutBankAccountDto.includes("accountNumber:"),
    false,
    "CheckoutBankAccountDto no debe exponer accountNumber completo",
  );
  assert.equal(
    checkoutBankAccountDto.includes("accountNumberMasked:"),
    true,
    "CheckoutBankAccountDto debe conservar accountNumberMasked",
  );

  // G. El service de POS no debe exigir admin.bank_accounts.manage.
  const checkoutBankAccountsService = read(
    "src/modules/pos/application/services/GetCheckoutBankAccountsService.ts",
  );
  assert.equal(
    checkoutBankAccountsService.includes("admin.bank_accounts.manage"),
    false,
    "El cajero no debe necesitar admin.bank_accounts.manage para leer cuentas de transferencia",
  );
  assert.equal(
    checkoutBankAccountsService.includes("accountNumber: account.accountNumber"),
    false,
    "El servicio de checkout no debe mapear accountNumber completo",
  );
  assert.equal(
    checkoutBankAccountsService.includes("accountNumberMasked: account.accountNumberMasked"),
    true,
    "El servicio de checkout debe mapear accountNumberMasked",
  );
  const apiSession = read("src/infrastructure/api/withApiSession.ts");
  const apiBankAccounts =
    apiSession.match(/function apiBankAccountsForEmployees[\s\S]*?\n\}/)?.[0] ?? "";
  assert.equal(
    apiBankAccounts.includes("getActiveByTenant: async (tenantId: string) => api.getActiveByTenant(tenantId)"),
    true,
    "La lectura operacional de cuentas POS debe usar API sin fallback a mock",
  );
  assert.equal(
    apiBankAccounts.includes("getById: async (id: string) => api.getById(id)"),
    true,
    "La validacion de la cuenta seleccionada debe usar API sin fallback a mock",
  );

  // H. Checkout solo muestra mascara; no copia ni renderiza accountNumber completo.
  const checkoutModal = read("src/modules/pos/components/CheckoutModal.tsx");
  assert.equal(
    /account\.accountNumber(?!Masked)/.test(checkoutModal),
    false,
    "CheckoutModal no debe usar accountNumber completo",
  );
  assert.equal(
    checkoutModal.includes("account.accountNumberMasked"),
    true,
    "CheckoutModal debe mostrar accountNumberMasked",
  );

  // I. Cash shift sigue sin exponer userId.
  const cashShiftTable = read("src/modules/administration/components/CashShiftTable.tsx");
  assert.equal(
    cashShiftTable.includes("ID de cajero"),
    false,
    "El detalle de turno no debe volver a mostrar el userId del cajero",
  );
}

async function main() {
  const harness = createHarness();
  await verifyServiceBehavior(harness);
  verifySourceInvariants();
  console.log("pos bank account transfer verification: PASS");
}

void main();
