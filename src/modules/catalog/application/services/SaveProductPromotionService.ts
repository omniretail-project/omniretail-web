import type { Promotion } from "@/core/entities";
import { ProductStatus, PromotionStatus, PromotionType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  CatalogServiceError,
  ensureCanManagePromotions,
  ensureCanUpdateProducts,
  ensureProduct,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";
import {
  MAX_PERCENTAGE,
  MAX_SAFE_CURRENCY,
  MONEY_DECIMAL_PLACES,
  PERCENTAGE_DECIMAL_PLACES,
} from "@/shared/utils/inputLimits";
import { hasAtMostDecimalPlaces } from "@/shared/utils/numberInput";

export type SaveProductPromotionInput = Pick<
  Promotion,
  "type" | "value" | "startAt" | "endAt" | "channels" | "untilStockEnds"
> & {
  promotionId?: string;
  productId: string;
  tenantId: string;
  productName: string;
};

export class SaveProductPromotionService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: SaveProductPromotionInput): Promise<Promotion> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    if (this.repositories.productRelationsDataSource === "api") {
      ensureCanManagePromotions(permissions);
    } else {
      ensureCanUpdateProducts(permissions);
    }
    const product = ensureProduct(
      await this.repositories.products.getByIdScoped(tenantId, input.productId),
    );
    if (product.status === ProductStatus.archived) {
      throw new CatalogServiceError("Restaura el producto para gestionar promociones.");
    }
    assertValidPromotionValue(input.type, input.value);
    const startTime = new Date(input.startAt).getTime();
    const endTime = input.endAt ? new Date(input.endAt).getTime() : undefined;
    if (
      !Number.isFinite(startTime) ||
      (endTime !== undefined && (!Number.isFinite(endTime) || endTime < startTime))
    ) {
      throw new CatalogServiceError("La fecha final debe ser igual o posterior a la inicial.");
    }

    const status =
      new Date(input.startAt).getTime() > Date.now()
        ? PromotionStatus.scheduled
        : PromotionStatus.active;
    const currentPromotion = input.promotionId
      ? await this.repositories.promotions.getByIdScoped(tenantId, input.promotionId)
      : null;
    if (
      input.promotionId &&
      (!currentPromotion || !currentPromotion.productIds.includes(input.productId))
    ) {
      throw new CatalogServiceError("La promocion solicitada no existe.");
    }
    const payload = {
      tenantId,
      name: currentPromotion?.name ?? `Promoción ${input.productName}`,
      description: currentPromotion?.description,
      type: input.type,
      value: input.value,
      channels: input.channels,
      startAt: input.startAt,
      endAt: input.endAt,
      untilStockEnds: input.untilStockEnds,
      branchIds: currentPromotion?.branchIds ?? [],
      productIds: currentPromotion?.productIds ?? [input.productId],
      status,
    };

    try {
      if (input.promotionId) {
        return await this.repositories.promotions.updateScoped(
          tenantId,
          input.promotionId,
          payload,
        );
      }
      return await this.repositories.promotions.create(payload);
    } catch (error) {
      if (error instanceof Error && error.message.includes("overlaps")) {
        throw new Error(
          "No se puede guardar porque existe otra promoción que coincide en fechas, canales y alcance.",
        );
      }
      throw error;
    }
  }
}

export function assertValidPromotionValue(type: PromotionType, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CatalogServiceError("Ingresa un valor promocional valido.");
  }
  const maximum = type === PromotionType.percentage ? MAX_PERCENTAGE : MAX_SAFE_CURRENCY;
  if (value > maximum) {
    throw new CatalogServiceError(
      type === PromotionType.percentage
        ? "El porcentaje no puede superar 100."
        : "El valor promocional no puede superar Q9,999,999.99.",
    );
  }
  const maximumDecimalPlaces =
    type === PromotionType.percentage ? PERCENTAGE_DECIMAL_PLACES : MONEY_DECIMAL_PLACES;
  if (!hasAtMostDecimalPlaces(value, maximumDecimalPlaces)) {
    throw new CatalogServiceError(
      type === PromotionType.percentage
        ? "El porcentaje admite hasta 2 decimales."
        : "El valor promocional admite hasta 2 decimales.",
    );
  }
}
