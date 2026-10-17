import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";
import { toPosCashShiftDto } from "@/modules/pos/application/mappers/PosCashShiftMapper";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";
import {
  assertOwnedCashShift,
  requireCashContext,
  type CashShiftOperationContext,
} from "@/modules/pos/application/services/cashShiftServiceContext";

type OpenCashShiftQueryRepositories = Pick<
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

export class GetOpenCashShiftService {
  constructor(private readonly repositories: OpenCashShiftQueryRepositories) {}

  async execute(input: CashShiftOperationContext): Promise<PosCashShiftDto | null> {
    const { branch, user } = await requireCashContext(this.repositories, input, "pos.cash.read");
    if (this.repositories.posDataSource === "api") {
      const shift = await requirePosApi(this.repositories).getOpenCashShift(branch.id);
      if (shift) assertOwnedCashShift(shift, input);
      return shift ? toPosCashShiftDto(shift) : null;
    }
    const shift = await this.repositories.cashShifts.getOpenByUserAndBranch(
      input.tenantId,
      user.id,
      branch.id,
    );
    if (shift) assertOwnedCashShift(shift, input);
    return shift ? toPosCashShiftDto(shift) : null;
  }
}
