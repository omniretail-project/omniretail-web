import { calculateCashShiftTotals } from "@/core/cash/cashShiftTotals";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { CashShiftSummaryDto } from "@/modules/pos/application/dto/CashShiftSummaryDto";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";
import {
  assertOwnedCashShift,
  requireCashContext,
  type CashShiftOperationContext,
} from "@/modules/pos/application/services/cashShiftServiceContext";

type CashShiftSummaryRepositories = Pick<
  RepositoryRegistry,
  | "branches"
  | "cashMovements"
  | "cashShifts"
  | "roles"
  | "users"
  | "plans"
  | "tenantSubscriptions"
  | "posApi"
  | "posDataSource"
>;

export interface GetCashShiftSummaryRequest extends CashShiftOperationContext {
  cashShiftId: string;
}

export class GetCashShiftSummaryService {
  constructor(private readonly repositories: CashShiftSummaryRepositories) {}

  async execute(input: GetCashShiftSummaryRequest): Promise<CashShiftSummaryDto> {
    await requireCashContext(this.repositories, input, "pos.cash.read");
    if (this.repositories.posDataSource === "api") {
      const api = requirePosApi(this.repositories);
      const openShift = await api.getOpenCashShift(input.branchId);
      assertOwnedCashShift(openShift, input);
      if (openShift.id !== input.cashShiftId) {
        throw new Error("El turno de caja no está disponible para el contexto actual.");
      }
      const [summary, movements] = await Promise.all([
        api.getCashShiftSummary(input.cashShiftId),
        api.getCashShiftMovements(input.cashShiftId),
      ]);
      const saleIds = new Set(
        movements
          .filter((movement) => movement.referenceType === "sale" && movement.referenceId)
          .map((movement) => movement.referenceId),
      );
      return {
        cashShiftId: summary.cashShiftId,
        status: summary.status,
        openedAt: summary.openedAt,
        openingAmount: summary.openingAmount,
        cashSalesAmount: summary.salesCashIn,
        manualCashIn: summary.manualCashIn,
        manualCashOut: summary.manualCashOut,
        expectedCash: summary.expectedAmount,
        movementCount: movements.length,
        saleCount: saleIds.size,
      };
    }
    const shift = await this.repositories.cashShifts.getById(input.tenantId, input.cashShiftId);
    assertOwnedCashShift(shift, input);
    const movements = await this.repositories.cashMovements.listByCashShift(
      input.tenantId,
      input.cashShiftId,
    );
    const totals = calculateCashShiftTotals(shift.openingAmount, movements);

    return {
      cashShiftId: shift.id,
      status: shift.status,
      openedAt: shift.openedAt,
      ...totals,
    };
  }
}
