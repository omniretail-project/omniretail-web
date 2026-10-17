import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";
import { toPosCashShiftDto } from "@/modules/pos/application/mappers/PosCashShiftMapper";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";
import {
  requireCashContext,
  type CashShiftOperationContext,
} from "@/modules/pos/application/services/cashShiftServiceContext";

type OpenCashShiftRepositories = Pick<
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

export interface OpenCashShiftRequest extends CashShiftOperationContext {
  registerCode: string;
  openingAmount: number;
}

export class OpenCashShiftService {
  constructor(private readonly repositories: OpenCashShiftRepositories) {}

  async execute(input: OpenCashShiftRequest): Promise<PosCashShiftDto> {
    const { user, branch } = await requireCashContext(
      this.repositories,
      input,
      "pos.cash.open",
      true,
    );
    if (this.repositories.posDataSource === "api") {
      return toPosCashShiftDto(
        await requirePosApi(this.repositories).openCashShift({
          branchId: branch.id,
          registerCode: input.registerCode,
          openingAmount: input.openingAmount,
        }),
      );
    }
    return toPosCashShiftDto(
      await this.repositories.cashShifts.open({
        tenantId: input.tenantId,
        branchId: branch.id,
        userId: user.id,
        registerCode: input.registerCode,
        openingAmount: input.openingAmount,
      }),
    );
  }
}
