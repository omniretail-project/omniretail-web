import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Customer, Order, Sale } from "@/core/entities";
import {
  CustomerStatus,
  DeliveryMethod,
  OrderSource,
  OrderStatus,
  SaleStatus,
  TransportMode,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockCustomerRepository,
  MockOrderRepository,
  MockSalesRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { GetCustomersService } from "@/modules/administration/application/services/GetCustomersService";

const TENANT_A = "tenant-admin-customers-a";
const TENANT_B = "tenant-admin-customers-b";
const READ_PERMISSION = "admin.customers.read";
const NOW = "2026-01-01T00:00:00.000Z";

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

function customer(id: string, name: string, tenantId = TENANT_A): Customer {
  return {
    id,
    tenantId,
    code: id.toUpperCase(),
    name,
    email: `${id}@example.test`,
    status: CustomerStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function order(
  id: string,
  customerId: string | undefined,
  status: OrderStatus = OrderStatus.delivered,
  tenantId = TENANT_A,
): Order {
  return {
    id,
    tenantId,
    branchId: `${tenantId}-branch`,
    orderNumber: id.toUpperCase(),
    source: OrderSource.ecommerce,
    customerId,
    items: [],
    status,
    deliveryMethod: DeliveryMethod.store_pickup,
    transportMode: TransportMode.customer,
    subtotal: 10,
    discountTotal: 0,
    shippingTotal: 0,
    total: 10,
    trackingToken: `${id}-track`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sale(
  id: string,
  customerId: string | undefined,
  sourceOrderId?: string,
  status: SaleStatus = SaleStatus.completed,
  tenantId = TENANT_A,
): Sale {
  return {
    id,
    tenantId,
    branchId: `${tenantId}-branch`,
    number: id.toUpperCase(),
    customerId,
    sourceOrderId,
    cashShiftId: `${tenantId}-shift`,
    items: [],
    status,
    subtotal: 10,
    discountTotal: 0,
    taxTotal: 0,
    total: 10,
    createdByUserId: `${tenantId}-admin`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function createHarness() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.customers = [
      customer("customer-alpha", "Alpha Order"),
      customer("customer-beta", "Beta POS"),
      customer("customer-charlie", "Charlie Linked"),
      customer("customer-delta", "Delta Two Orders"),
      customer("customer-echo", "Echo Legacy Sale"),
      customer("customer-foxtrot", "Foxtrot Cancelled"),
      customer("customer-tenant-b", "Tenant B Customer", TENANT_B),
    ];
    db.orders = [
      order("order-alpha", "customer-alpha"),
      order("order-charlie", "customer-charlie"),
      order("order-delta-1", "customer-delta"),
      order("order-delta-2", "customer-delta"),
      order("order-foxtrot-cancelled", "customer-foxtrot", OrderStatus.cancelled),
      order("order-without-customer", undefined),
      order("order-tenant-b", "customer-tenant-b", OrderStatus.delivered, TENANT_B),
    ];
    db.sales = [
      sale("sale-beta", "customer-beta"),
      sale("sale-charlie-linked", "customer-charlie", "order-charlie"),
      sale("sale-echo-legacy", "customer-echo", "missing-order"),
      sale("sale-wrong-customer-link", "customer-echo", "order-alpha"),
      sale("sale-foxtrot-cancelled", "customer-foxtrot", undefined, SaleStatus.cancelled),
      sale("sale-without-customer", undefined),
      sale("sale-tenant-b", "customer-tenant-b", undefined, SaleStatus.completed, TENANT_B),
    ];
  });

  const customers = new MockCustomerRepository(store, eventBus);
  const orders = new MockOrderRepository(store, eventBus);
  const sales = new MockSalesRepository(store, eventBus);

  return {
    repositories: {
      customers,
      orders,
      sales,
    } as unknown as RepositoryRegistry,
    store,
  };
}

async function verifyTenantScopedReads(harness: ReturnType<typeof createHarness>) {
  const { customers, orders, sales } = harness.repositories;

  assert.equal(
    (await customers.listByTenant(TENANT_A)).some((item) => item.tenantId === TENANT_B),
    false,
  );
  assert.equal(
    (await orders.listByTenant(TENANT_A)).some((item) => item.tenantId === TENANT_B),
    false,
  );
  assert.equal(
    (await sales.listByTenant(TENANT_A)).some((item) => item.tenantId === TENANT_B),
    false,
  );

  const source = readFileSync(
    join(process.cwd(), "src/modules/administration/application/services/GetCustomersService.ts"),
    "utf8",
  );
  assert.equal(source.includes(".getAll()"), false, "GetCustomersService no debe usar getAll()");
  assert.equal(
    (source.match(/\.listByTenant\(tenantId\)/g) ?? []).length,
    3,
    "GetCustomersService debe leer las tres fuentes por listByTenant(tenantId)",
  );
}

async function verifyFrequency(harness: ReturnType<typeof createHarness>) {
  const service = new GetCustomersService(harness.repositories);
  const customers = await service.execute(TENANT_A, [READ_PERMISSION]);
  const byId = new Map(customers.map((item) => [item.id, item]));

  assert.equal(byId.has("customer-tenant-b"), false, "Tenant A no debe recibir Customer B");
  assert.equal(byId.get("customer-alpha")?.purchaseCount, 1, "Order sola => 1");
  assert.equal(byId.get("customer-beta")?.purchaseCount, 1, "Sale POS inmediata => 1");
  assert.equal(byId.get("customer-charlie")?.purchaseCount, 1, "Order + Sale ligada => 1");
  assert.equal(byId.get("customer-delta")?.purchaseCount, 2, "2 Orders reales => 2");
  assert.equal(
    byId.get("customer-echo")?.purchaseCount,
    2,
    "Sale legacy/inexistente y link a Order de otro customer contabilizan seguro una vez cada una",
  );
  assert.equal(byId.get("customer-foxtrot")?.purchaseCount, 0, "cancelled no cuenta");

  assert.deepEqual(
    customers.map((item) => `${item.id}:${item.purchaseCount}`),
    [
      "customer-delta:2",
      "customer-echo:2",
      "customer-alpha:1",
      "customer-beta:1",
      "customer-charlie:1",
      "customer-foxtrot:0",
    ],
    "ranking debe ser purchaseCount DESC y desempate por nombre",
  );
}

function verifyReadOnlyScope() {
  const forbidden = [
    "CreateCustomerService",
    "UpdateCustomerService",
    "ArchiveCustomerService",
    "CustomerForm",
    "admin.customers.manage",
  ];
  const files = [
    "src/modules/administration",
    "src/config",
    "src/infrastructure/mock/seeds/demoSeed.ts",
  ];
  const matches: string[] = [];
  for (const path of files) {
    for (const file of listTextFiles(join(process.cwd(), path))) {
      const content = readFileSync(file, "utf8");
      for (const token of forbidden) {
        if (content.includes(token)) matches.push(`${file}: ${token}`);
      }
    }
  }
  assert.deepEqual(matches, [], "La pantalla de clientes debe permanecer read-only");
}

function listTextFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return listTextFiles(child);
    if (/\.(ts|tsx|md)$/.test(child)) return [child];
    return [];
  });
}

async function main() {
  const harness = createHarness();
  await verifyTenantScopedReads(harness);
  await verifyFrequency(harness);
  verifyReadOnlyScope();
  console.log("admin customers tenant-safe read-only verification: PASS");
}

void main();
