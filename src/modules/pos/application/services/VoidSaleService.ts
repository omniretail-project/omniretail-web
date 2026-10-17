import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { SaleReversalResultDto } from "@/modules/pos/application/dto/SaleReversalResultDto";
import {
  mapApiVoidResult,
  mapSaleReversalResult,
} from "@/modules/pos/application/mappers/SaleReversalResultMapper";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";
import {
  requireReturnOperationContext,
  type ReturnOperationContext,
} from "@/modules/pos/application/services/returnOperationContext";

export interface VoidPosSaleInput extends ReturnOperationContext {
  saleId: string;
  idempotencyKey: string;
  reason: string;
}

export class VoidSaleService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: VoidPosSaleInput): Promise<SaleReversalResultDto> {
    const context = await requireReturnOperationContext(this.repositories, input, "pos.sales.void");
    if (this.repositories.posDataSource === "api") {
      return mapApiVoidResult(
        await requirePosApi(this.repositories).voidSale(input.saleId, input.idempotencyKey, {
          reason: input.reason,
        }),
      );
    }
    const result = await this.repositories.saleReversals.voidSale({
      tenantId: context.tenantId,
      branchId: context.branchId,
      actorUserId: context.actorUserId,
      saleId: input.saleId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    });
    return mapSaleReversalResult(result);
  }
}
