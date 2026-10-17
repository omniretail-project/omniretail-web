import type { ConfirmOrderPaymentResult } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

export class ConfirmStorefrontPaymentService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute({
    tenantId,
    branchId,
    orderId,
    paymentId,
  }: {
    tenantId: string;
    branchId: string;
    orderId: string;
    paymentId: string;
  }): Promise<ConfirmOrderPaymentResult> {
    return this.repositories.orderPaymentConfirmations.confirm({
      tenantId,
      branchId,
      orderId,
      paymentId,
    });
  }
}
