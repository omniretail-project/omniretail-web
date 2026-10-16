import { describe, expect, it } from "vitest";
import { InventoryMovementType } from "@/core/enums";
import { DEMO_SALE_SPECS } from "@/infrastructure/mock/seeds/demoActivitySeed";
import { buildPublicDemoSeedDatabase } from "@/infrastructure/mock/seeds/publicDemoSeed";

/** Mismo criterio de dia que el seed: calendario LOCAL del proceso (los tests no dependen de TZ). */
const localDay = (value: Date | string) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
const plannedDay = (reference: Date, daysAgo: number) => {
  const date = new Date(reference);
  date.setDate(date.getDate() - daysAgo);
  return localDay(date);
};
const time = (iso: string) => new Date(iso).getTime();

// Fechas locales explicitas: madrugada, cerca de medianoche (ambos lados) y horario normal.
const references: Array<[string, Date]> = [
  ["06:30", new Date(2026, 5, 15, 6, 30, 0, 0)],
  ["00:05", new Date(2026, 5, 15, 0, 5, 0, 0)],
  ["23:55", new Date(2026, 5, 15, 23, 55, 0, 0)],
  ["15:00", new Date(2026, 5, 15, 15, 0, 0, 0)],
];

// Orden planificado: dia (mas antiguo primero) y hora; empates conservan el orden de la lista.
const plannedOrder = DEMO_SALE_SPECS.map((spec, index) => ({ spec, index })).sort(
  (a, b) => b.spec.d - a.spec.d || a.spec.hm.localeCompare(b.spec.hm) || a.index - b.index,
);

describe.each(references)("demo activity timestamps at %s", (_label, reference) => {
  const db = buildPublicDemoSeedDatabase(reference);
  const referenceMs = reference.getTime();
  const sales = [...db.sales].sort((a, b) => a.number.localeCompare(b.number));

  it("never produces a timestamp after the reference", () => {
    const stamps = [
      ...db.sales.flatMap((sale) => [sale.createdAt, sale.updatedAt]),
      ...db.payments.map((payment) => payment.createdAt),
      ...db.cashMovements.map((movement) => movement.createdAt),
      ...db.cashShifts.flatMap((cashShift) => [cashShift.openedAt, cashShift.closedAt ?? cashShift.openedAt]),
      ...db.inventoryMovements.map((movement) => movement.createdAt),
      ...db.orders.flatMap((order) => [order.createdAt, order.updatedAt]),
    ];
    stamps.forEach((stamp) => expect(time(stamp)).toBeLessThanOrEqual(referenceMs));
  });

  it("keeps each sale on its planned day and in planned order within the day", () => {
    expect(sales).toHaveLength(plannedOrder.length);
    sales.forEach((sale, index) => {
      const { spec } = plannedOrder[index];
      expect(sale.items.map((item) => [item.productId, item.quantity])).toEqual(
        spec.items.map(([productId, quantity]) => [productId, quantity]),
      );
      expect(localDay(sale.createdAt)).toBe(plannedDay(reference, spec.d));
      if (index > 0 && plannedOrder[index - 1].spec.d === spec.d) {
        const previous = sales[index - 1];
        expect(time(sale.createdAt)).toBeGreaterThanOrEqual(time(previous.createdAt));
        if (plannedOrder[index - 1].spec.hm !== spec.hm) {
          expect(time(sale.createdAt)).toBeGreaterThan(time(previous.createdAt));
        }
      }
    });
  });

  it("keeps every sale inside its cash shift", () => {
    sales.forEach((sale) => {
      const cashShift = db.cashShifts.find((item) => item.id === sale.cashShiftId);
      expect(cashShift).toBeDefined();
      expect(time(cashShift!.openedAt)).toBeLessThanOrEqual(time(sale.createdAt));
      expect(time(sale.createdAt)).toBeLessThanOrEqual(
        cashShift!.closedAt ? time(cashShift!.closedAt) : referenceMs,
      );
      expect(localDay(cashShift!.openedAt)).toBe(localDay(sale.createdAt));
    });
    db.cashMovements.forEach((movement) => {
      const cashShift = db.cashShifts.find((item) => item.id === movement.cashShiftId)!;
      expect(time(movement.createdAt)).toBeGreaterThanOrEqual(time(cashShift.openedAt));
      expect(time(movement.createdAt)).toBeLessThanOrEqual(
        cashShift.closedAt ? time(cashShift.closedAt) : referenceMs,
      );
    });
  });

  it("stamps each sale's kardex movements with the sale time and keeps quantities chained", () => {
    sales.forEach((sale) => {
      const movements = db.inventoryMovements.filter(
        (movement) => movement.referenceType === "sale" && movement.referenceId === sale.id,
      );
      expect(movements).toHaveLength(sale.items.length);
      movements.forEach((movement) => expect(movement.createdAt).toBe(sale.createdAt));
    });
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
        net.set(key, before + signed);
      });
    db.inventoryBalances.forEach((balance) => {
      expect(net.get(`${balance.branchId}|${balance.productId}`) ?? 0).toBe(balance.quantity);
    });
  });
});
