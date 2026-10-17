import { calculateCashShiftTotals, normalizeMoney, roundMoney } from "@/core/cash/cashShiftTotals";
import { BranchStatus, CashShiftStatus, TenantStatus, UserStatus, UserType } from "@/core/enums";
import type { CashShiftRepository } from "@/core/repositories";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

export class MockCashShiftRepository extends BaseMockRepository implements CashShiftRepository {
  async listByTenant(tenantId: string) {
    return this.read((db) => db.cashShifts.filter((item) => item.tenantId === tenantId));
  }

  async getById(tenantId: string, cashShiftId: string) {
    return this.read(
      (db) =>
        db.cashShifts.find((item) => item.id === cashShiftId && item.tenantId === tenantId) ?? null,
    );
  }

  async getOpenByUser(tenantId: string, userId: string) {
    return this.read(
      (db) =>
        db.cashShifts.find(
          (item) =>
            item.tenantId === tenantId &&
            item.userId === userId &&
            item.status === CashShiftStatus.open,
        ) ?? null,
    );
  }

  async getOpenByUserAndBranch(tenantId: string, userId: string, branchId: string) {
    return this.read(
      (db) =>
        db.cashShifts.find(
          (item) =>
            item.tenantId === tenantId &&
            item.userId === userId &&
            item.branchId === branchId &&
            item.status === CashShiftStatus.open,
        ) ?? null,
    );
  }

  async open(input: Parameters<CashShiftRepository["open"]>[0]) {
    const item = this.store.transact((db) => {
      assertOpenReferences(input, db);
      if (!input.registerCode.trim()) throw new Error("registerCode is required.");

      const duplicate = db.cashShifts.some(
        (shift) =>
          shift.tenantId === input.tenantId &&
          shift.userId === input.userId &&
          shift.branchId === input.branchId &&
          shift.status === CashShiftStatus.open,
      );
      if (duplicate) {
        throw new Error("An open cash shift already exists for this user and branch.");
      }

      const now = this.now();
      const created = {
        id: this.id("cash-shift"),
        tenantId: input.tenantId,
        branchId: input.branchId,
        userId: input.userId,
        registerCode: input.registerCode.trim(),
        status: CashShiftStatus.open,
        openedAt: now,
        openingAmount: normalizeMoney(input.openingAmount),
        createdAt: now,
        updatedAt: now,
      };
      db.cashShifts.push(created);
      return created;
    });
    this.emit("cash-shift.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      branchId: item.branchId,
      action: "created",
    });
    return item;
  }

  async close(input: Parameters<CashShiftRepository["close"]>[0]) {
    const item = this.store.transact((db) => {
      const shift = db.cashShifts.find(
        (candidate) => candidate.id === input.cashShiftId && candidate.tenantId === input.tenantId,
      );
      if (!shift) throw this.missing("CashShift", input.cashShiftId);
      if (shift.status !== CashShiftStatus.open) {
        throw new Error("Only an open cash shift can be closed.");
      }
      assertCashActor(db, input.tenantId, input.closedByUserId);
      if (shift.userId !== input.closedByUserId) {
        throw new Error("The cash shift can only be closed by its assigned user.");
      }
      const branch = db.branches.find(
        (candidate) => candidate.id === shift.branchId && candidate.tenantId === input.tenantId,
      );
      if (!branch) throw new Error("CashShift branch is not valid for tenant.");

      const countedAmount = normalizeMoney(input.countedAmount);
      const movements = db.cashMovements.filter((movement) => movement.cashShiftId === shift.id);
      const totals = calculateCashShiftTotals(shift.openingAmount, movements);
      const difference = roundMoney(countedAmount - totals.expectedCash);
      const now = this.now();
      Object.assign(shift, {
        countedAmount,
        expectedAmount: totals.expectedCash,
        difference,
        closedAt: now,
        updatedAt: now,
        status: difference === 0 ? CashShiftStatus.closed : CashShiftStatus.closed_with_difference,
      });
      return shift;
    });
    this.emit("cash-shift.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      branchId: item.branchId,
      action: "status_changed",
    });
    return item;
  }
}

function assertOpenReferences(
  input: Parameters<CashShiftRepository["open"]>[0],
  db: MockDatabase,
): void {
  if (
    !db.tenants.some(
      (tenant) => tenant.id === input.tenantId && tenant.status === TenantStatus.active,
    )
  ) {
    throw new Error(`Active tenant not found: ${input.tenantId}`);
  }
  const branch = db.branches.find(
    (item) => item.id === input.branchId && item.tenantId === input.tenantId,
  );
  if (!branch || branch.status !== BranchStatus.active) {
    throw new Error(`Active branch not found for tenant: ${input.branchId}`);
  }
  assertCashActor(db, input.tenantId, input.userId);
}

function assertCashActor(db: MockDatabase, tenantId: string, userId: string): void {
  const user = db.users.find((item) => item.id === userId && item.tenantId === tenantId);
  if (!user || user.type !== UserType.employee || user.status !== UserStatus.active) {
    throw new Error(`Active employee not found for tenant: ${userId}`);
  }
}
