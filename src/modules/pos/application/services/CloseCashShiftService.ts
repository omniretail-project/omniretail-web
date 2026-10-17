import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";
import { toPosCashShiftDto } from "@/modules/pos/application/mappers/PosCashShiftMapper";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";
import {
  assertOwnedCashShift,
  requireCashContext,
  type CashShiftOperationContext,
} from "@/modules/pos/application/services/cashShiftServiceContext";

type CloseCashShiftRepositories = Pick<
  RepositoryRegistry,
  | "branches"
  | "cashShifts"
  | "roles"
  | "users"
  | "plans"
  | "tenantSubscriptions"
  | "posApi"
  | "posDataSource"
>;

export interface CloseCashShiftRequest extends CashShiftOperationContext {
  cashShiftId: string;
  countedAmount: number;
}

export class CloseCashShiftService {
  constructor(private readonly repositories: CloseCashShiftRepositories) {}

  async execute(input: CloseCashShiftRequest): Promise<PosCashShiftDto> {
    await requireCashContext(this.repositories, input, "pos.cash.close");
    if (this.repositories.posDataSource === "api") {
      const api = requirePosApi(this.repositories);
      const shift = await api.getOpenCashShift(input.branchId);
      assertOwnedCashShift(shift, input);
      if (shift.id !== input.cashShiftId) {
        throw new Error("El turno de caja no está disponible para el contexto actual.");
      }
      return toPosCashShiftDto(
        await api.closeCashShift({
          cashShiftId: input.cashShiftId,
          countedAmount: input.countedAmount,
        }),
      );
    }
    const shift = await this.repositories.cashShifts.getById(input.tenantId, input.cashShiftId);
    assertOwnedCashShift(shift, input);
    return toPosCashShiftDto(
      await this.repositories.cashShifts.close({
        tenantId: input.tenantId,
        cashShiftId: input.cashShiftId,
        countedAmount: input.countedAmount,
        closedByUserId: input.actorUserId,
      }),
    );
  }
}
