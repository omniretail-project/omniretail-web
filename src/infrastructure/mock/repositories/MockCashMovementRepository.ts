import type { CashMovementRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { registerCashMovementInTransaction } from "@/infrastructure/mock/repositories/cashMovementMutations";

export class MockCashMovementRepository
  extends BaseMockRepository
  implements CashMovementRepository
{
  async listByCashShift(tenantId: string, cashShiftId: string) {
    return this.read((db) => {
      const shift = db.cashShifts.find(
        (item) => item.id === cashShiftId && item.tenantId === tenantId,
      );
      if (!shift) throw this.missing("CashShift", cashShiftId);

      return db.cashMovements
        .filter((movement) => movement.cashShiftId === shift.id)
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        );
    });
  }

  async register(input: Parameters<CashMovementRepository["register"]>[0]) {
    const item = this.store.transact((db) =>
      registerCashMovementInTransaction(db, input, {
        createId: (prefix) => this.id(prefix),
        now: () => this.now(),
      }),
    );
    this.emit("cash-shift.changed", {
      entityId: item.shift.id,
      tenantId: item.shift.tenantId,
      branchId: item.shift.branchId,
      action: "updated",
    });
    return item.movement;
  }
}
