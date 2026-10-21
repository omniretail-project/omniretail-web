import { calculateShippingCost } from "@/config/shipping-policy";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  POS_SALES_CREATE_PERMISSION,
  ensurePosPermission,
  requirePosApi,
  resolvePosSessionContext,
} from "@/modules/pos/application/services/posServiceContext";

/** Envío a domicilio que se sumará al cobro de una venta diferida. */
export interface PosShippingQuoteDto {
  shippingTotal: number;
  freeShippingThreshold?: number;
}

/**
 * Cotiza el envío del canal POS para el subtotal con descuentos del ticket. En modo api lo calcula
 * el backend (misma regla con la que validará la venta); en modo mock, la config del tenant.
 */
export class GetPosShippingQuoteService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(subtotal: number): Promise<PosShippingQuoteDto> {
    if (this.repositories.posDataSource === "api") {
      const quote = await requirePosApi(this.repositories).getShippingQuote(subtotal);
      return {
        shippingTotal: quote.shippingTotal,
        freeShippingThreshold: quote.freeShippingThreshold,
      };
    }

    const context = await resolvePosSessionContext(this.repositories);
    ensurePosPermission(context.permissions, POS_SALES_CREATE_PERMISSION);
    const { pos } = await this.repositories.shippingConfig.get(context.tenantId);
    return {
      shippingTotal: calculateShippingCost(pos, subtotal),
      freeShippingThreshold: pos.enabled ? pos.freeShippingThreshold : undefined,
    };
  }
}
