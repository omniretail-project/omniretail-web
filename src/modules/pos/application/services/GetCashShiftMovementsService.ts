import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { CashMovementDto } from "@/modules/pos/application/dto/CashMovementDto";
import { toCashMovementDto } from "@/modules/pos/application/mappers/CashMovementMapper";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";
import {
  assertOwnedCashShift,
  requireCashContext,
  type CashShiftOperationContext,
} from "@/modules/pos/application/services/cashShiftServiceContext";

type CashMovementQueryRepositories = Pick<
  RepositoryRegistry,
  | "branches"
  | "cashMovements"
  | "cashShifts"
  | "roles"
  | "sales"
  | "users"
  | "plans"
  | "tenantSubscriptions"
  | "posApi"
  | "posDataSource"
>;

export interface GetCashShiftMovementsRequest extends CashShiftOperationContext {
  cashShiftId: string;
}

export class GetCashShiftMovementsService {
  constructor(private readonly repositories: CashMovementQueryRepositories) {}

  async execute(input: GetCashShiftMovementsRequest): Promise<CashMovementDto[]> {
    await requireCashContext(this.repositories, input, "pos.cash.read");
    if (this.repositories.posDataSource === "api") {
      const api = requirePosApi(this.repositories);
      const shift = await api.getOpenCashShift(input.branchId);
      assertOwnedCashShift(shift, input);
      if (shift.id !== input.cashShiftId) {
        throw new Error("El turno de caja no está disponible para el contexto actual.");
      }
      return api.getCashShiftMovements(input.cashShiftId);
    }
    const shift = await this.repositories.cashShifts.getById(input.tenantId, input.cashShiftId);
    assertOwnedCashShift(shift, input);
    const movements = await this.repositories.cashMovements.listByCashShift(
      input.tenantId,
      input.cashShiftId,
    );
    const saleIds = [
      ...new Set(
        movements
          .filter((movement) => movement.referenceType === "sale")
          .map((movement) => movement.referenceId)
          .filter((saleId): saleId is string => Boolean(saleId)),
      ),
    ];
    const sales = await Promise.all(
      saleIds.map((saleId) =>
        this.repositories.sales.getByIdScoped(input.tenantId, input.branchId, saleId),
      ),
    );
    const saleNumbersById = new Map(
      sales.filter((sale) => sale !== null).map((sale) => [sale.id, sale.number]),
    );

    return movements.map((movement) => ({
      ...toCashMovementDto(movement),
      saleNumber:
        movement.referenceType === "sale" && movement.referenceId
          ? saleNumbersById.get(movement.referenceId)
          : undefined,
    }));
  }
}
