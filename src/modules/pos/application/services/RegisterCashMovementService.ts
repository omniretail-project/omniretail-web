import type { CashMovementType } from "@/core/enums";
import type { PosApiCashMovement } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  assertOwnedCashShift,
  requireCashContext,
  type CashShiftOperationContext,
} from "@/modules/pos/application/services/cashShiftServiceContext";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";

type CashMovementRepositories = Pick<
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

export interface RegisterCashMovementRequest extends CashShiftOperationContext {
  cashShiftId: string;
  type: CashMovementType;
  amount: number;
  reason: string;
}

export class RegisterCashMovementService {
  constructor(private readonly repositories: CashMovementRepositories) {}

  async execute(input: RegisterCashMovementRequest): Promise<PosApiCashMovement> {
    await requireCashContext(this.repositories, input, "pos.cash.movement.create");
    if (this.repositories.posDataSource === "api") {
      const api = requirePosApi(this.repositories);
      const shift = await api.getOpenCashShift(input.branchId);
      assertOwnedCashShift(shift, input);
      if (shift.id !== input.cashShiftId) {
        throw new Error("El turno de caja no está disponible para el contexto actual.");
      }
      return api.registerCashMovement({
        cashShiftId: input.cashShiftId,
        type: input.type,
        amount: input.amount,
        reason: input.reason,
      });
    }
    const shift = await this.repositories.cashShifts.getById(input.tenantId, input.cashShiftId);
    assertOwnedCashShift(shift, input);

    return this.repositories.cashMovements.register({
      tenantId: input.tenantId,
      cashShiftId: input.cashShiftId,
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      createdByUserId: input.actorUserId,
    });
  }
}
