import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CashMovementType,
  CashShiftStatus,
  InventoryMovementType,
  OrderStatus,
  SaleStatus,
} from "@/core/enums";
import { calculateCashShiftTotals } from "@/core/cash/cashShiftTotals";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { createMockDatabase } from "@/infrastructure/mock/database/createMockDatabase";
import { MockAuthRepository } from "@/infrastructure/mock/repositories/MockAuthRepository";
import { buildPublicDemoSeedDatabase } from "@/infrastructure/mock/seeds/publicDemoSeed";
import { classifyInventoryStatus } from "@/modules/inventory/application/services/GetInventoryAlertsService";
import { MemoryStorageAdapter } from "../inventory/mockInventoryFixtures";

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);

// createMockDatabase()/MockDatabaseStore solo usan la capa demo con la bandera publica activa.
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("demo seed consistency", () => {
  const reference = new Date();
  const db = buildPublicDemoSeedDatabase(reference);

  it("keeps the demo tenant branding and the operational emails", () => {
    expect(db.tenants[0]).toMatchObject({ id: "tenant-demo", name: "Ferretería Demo" });
    const emails = db.users.filter((user) => user.type === "employee").map((user) => user.email);
    expect(emails).toEqual(
      expect.arrayContaining([
        "admin@marjym.demo",
        "cajero@marjym.demo",
        "bodega@marjym.demo",
        "inventario@marjym.demo",
      ]),
    );
  });

  it("generates 15-25 POS sales within the last 30 days across both branches", () => {
    expect(db.sales.length).toBeGreaterThanOrEqual(15);
    expect(db.sales.length).toBeLessThanOrEqual(25);
    expect(new Set(db.sales.map((sale) => sale.branchId))).toEqual(
      new Set(["branch-centro", "branch-norte"]),
    );
    db.sales.forEach((sale) => {
      const ageDays = (reference.getTime() - new Date(sale.createdAt).getTime()) / 86_400_000;
      expect(ageDays).toBeGreaterThanOrEqual(0);
      expect(ageDays).toBeLessThanOrEqual(30);
    });
    expect(new Set(db.sales.map((sale) => sale.number)).size).toBe(db.sales.length);
  });

  it("matches every sale total with the sum of its items, payments and sale rows", () => {
    db.sales.forEach((sale) => {
      expect(sale.status).toBe(SaleStatus.completed);
      expect(sale.items.length).toBeGreaterThan(0);
      const gross = sale.items.reduce(
        (sum, item) => sum + cents((item.unitPrice + item.discount) * item.quantity),
        0,
      );
      const discounts = sale.items.reduce(
        (sum, item) => sum + cents(item.discount * item.quantity),
        0,
      );
      const net = sale.items.reduce((sum, item) => sum + cents(item.subtotal), 0);
      sale.items.forEach((item) => {
        expect(cents(item.subtotal)).toBe(cents(item.unitPrice * item.quantity));
      });
      expect(cents(sale.subtotal)).toBe(gross);
      expect(cents(sale.discountTotal)).toBe(discounts);
      expect(cents(sale.total)).toBe(
        cents(sale.subtotal) - cents(sale.discountTotal) + cents(sale.taxTotal),
      );
      expect(cents(sale.total)).toBe(net);

      const paid = db.payments
        .filter((payment) => payment.saleId === sale.id)
        .reduce((sum, payment) => sum + cents(payment.amount), 0);
      expect(paid).toBe(cents(sale.total));
      expect(db.saleItems.filter((item) => item.saleId === sale.id)).toEqual(sale.items);
    });
  });

  it("keeps stock equal to inbound minus outbound movements per product and branch", () => {
    const net = new Map<string, number>();
    [...db.inventoryMovements]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .forEach((movement) => {
        const key = `${movement.branchId}|${movement.productId}`;
        const signed =
          movement.type === InventoryMovementType.in ? movement.quantity : -movement.quantity;
        const before = net.get(key) ?? 0;
        expect(movement.quantityBefore).toBe(before);
        expect(movement.quantityAfter).toBe(before + signed);
        expect(before + signed).toBeGreaterThanOrEqual(0);
        net.set(key, before + signed);
      });
    db.inventoryBalances.forEach((balance) => {
      expect(net.get(`${balance.branchId}|${balance.productId}`) ?? 0).toBe(balance.quantity);
      expect(balance.quantity - balance.reservedQuantity).toBeGreaterThanOrEqual(0);
    });
    db.sales.forEach((sale) => {
      sale.items.forEach((item) => {
        expect(
          db.inventoryMovements.some(
            (movement) =>
              movement.referenceType === "sale" &&
              movement.referenceId === sale.id &&
              movement.productId === item.productId &&
              movement.quantity === item.quantity &&
              movement.type === InventoryMovementType.out,
          ),
        ).toBe(true);
      });
    });
  });

  it("only sells products that do not require lot or serial tracking", () => {
    db.sales.forEach((sale) =>
      sale.items.forEach((item) => {
        const product = db.products.find((candidate) => candidate.id === item.productId);
        expect(product?.tracking.lot).toBe(false);
        expect(product?.tracking.serial).toBe(false);
      }),
    );
  });

  it("closes past cash shifts consistently and keeps one recent open shift on CAJA-01", () => {
    const openShifts = db.cashShifts.filter((shift) => shift.status === CashShiftStatus.open);
    expect(openShifts).toHaveLength(1);
    expect(openShifts[0]).toMatchObject({
      userId: "user-cashier",
      registerCode: "CAJA-01",
      branchId: "branch-centro",
    });
    expect(reference.getTime() - new Date(openShifts[0].openedAt).getTime()).toBeLessThan(
      24 * 3_600_000,
    );
    const closed = db.cashShifts.filter((shift) => shift.status !== CashShiftStatus.open);
    expect(closed.length).toBeGreaterThan(0);
    closed.forEach((shift) => {
      const movements = db.cashMovements.filter((movement) => movement.cashShiftId === shift.id);
      const totals = calculateCashShiftTotals(shift.openingAmount, movements);
      expect(shift.expectedAmount).toBe(totals.expectedCash);
      expect(cents(shift.difference ?? 0)).toBe(cents((shift.countedAmount ?? 0) - totals.expectedCash));
      const cashSales = db.sales
        .filter((sale) => sale.cashShiftId === shift.id)
        .flatMap((sale) => db.payments.filter((payment) => payment.saleId === sale.id))
        .filter((payment) => payment.method === "cash")
        .reduce((sum, payment) => sum + cents(payment.amount), 0);
      expect(cents(totals.cashSalesAmount)).toBe(cashSales);
    });
    db.cashMovements
      .filter(
        (movement) => movement.type === CashMovementType.in && movement.referenceType === "sale",
      )
      .forEach((movement) => {
        expect(db.sales.some((sale) => sale.id === movement.referenceId)).toBe(true);
      });
  });

  it("exposes e-commerce orders in several statuses with consistent totals", () => {
    const statuses = new Set(db.orders.map((order) => order.status));
    [
      OrderStatus.pending,
      OrderStatus.confirmed,
      OrderStatus.picking,
      OrderStatus.dispatched,
      OrderStatus.delivered,
    ].forEach((status) => expect(statuses.has(status)).toBe(true));
    expect(db.customers.length).toBeGreaterThanOrEqual(4);
    db.orders.forEach((order) => {
      const items = db.orderItems.filter((item) => item.orderId === order.id);
      expect(items.length).toBeGreaterThan(0);
      const subtotal = items.reduce((sum, item) => sum + cents(item.subtotal), 0);
      expect(cents(order.subtotal)).toBe(subtotal);
      expect(cents(order.total)).toBe(
        subtotal + cents(order.shippingTotal) - cents(order.discountTotal),
      );
      if (order.customerId) {
        expect(db.customers.some((customer) => customer.id === order.customerId)).toBe(true);
      }
    });
    db.pickingOrders.forEach((picking) =>
      expect(db.orders.some((order) => order.id === picking.orderId)).toBe(true),
    );
    db.dispatches.forEach((dispatch) =>
      expect(db.orders.some((order) => order.id === dispatch.orderId)).toBe(true),
    );
  });

  it("keeps the dashboard stock alerts to a small showcase (2-5 across branches)", () => {
    const alerts: string[] = [];
    ["branch-centro", "branch-norte"].forEach((branchId) => {
      db.products
        .filter((product) => product.status === "published" && product.tracking.stock)
        .forEach((product) => {
          const available = db.inventoryBalances
            .filter((item) => item.branchId === branchId && item.productId === product.id)
            .reduce((sum, item) => sum + item.quantity - item.reservedQuantity, 0);
          const settings = db.productInventorySettings.find(
            (item) => item.branchId === branchId && item.productId === product.id,
          );
          const status = classifyInventoryStatus(
            available,
            settings?.minStock ?? 0,
            settings?.reorderPoint,
          );
          if (status !== "normal") alerts.push(`${branchId}:${product.id}:${status}`);
        });
    });
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(alerts.length).toBeLessThanOrEqual(5);
    expect(alerts).toContain("branch-norte:prod-wall-plugs:critical");
  });

  it("builds a fresh database with relative dates on every createMockDatabase call", () => {
    const created = createMockDatabase();
    const newest = Math.max(...created.sales.map((sale) => new Date(sale.createdAt).getTime()));
    expect(Date.now() - newest).toBeLessThan(24 * 3_600_000);
  });
});

describe("demo accounts", () => {
  const cases = [
    { email: "admin@marjym.demo", password: "AdminDemo123", roleId: "role-admin" },
    { email: "cajero@marjym.demo", password: "CajeroDemo123", roleId: "role-cashier" },
    { email: "bodega@marjym.demo", password: "BodegaDemo123", roleId: "role-warehouse" },
  ];

  it.each(cases)(
    "logs $email in through MockAuthRepository",
    async ({ email, password, roleId }) => {
      const storage = new MemoryStorageAdapter();
      const store = new MockDatabaseStore(storage);
      const auth = new MockAuthRepository(store, new DataEventBus(), storage);

      const result = await auth.login({ email, passwordMock: password });

      expect(result.status).toBe("authenticated");
      if (result.status !== "authenticated") return;
      const user = createMockDatabase().users.find((item) => item.id === result.session.userId);
      expect(user?.email).toBe(email);
      expect(user?.roleId).toBe(roleId);
      expect(user?.status).toBe("active");
    },
  );

  it("keeps the cashier assigned to the branch of the open CAJA-01 shift", () => {
    const seed = createMockDatabase();
    const cashier = seed.users.find((user) => user.email === "cajero@marjym.demo");
    const shift = seed.cashShifts.find((item) => item.status === CashShiftStatus.open);
    expect(shift?.userId).toBe(cashier?.id);
    expect(shift?.branchId).toBe(cashier?.branchId);
  });
});
