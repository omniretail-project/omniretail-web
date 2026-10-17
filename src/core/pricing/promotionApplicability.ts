import type { Promotion } from "@/core/entities";
import { PromotionStatus } from "@/core/enums";
import type { PromotionApplicabilityCriteria } from "@/core/repositories";

/**
 * Regla canonica de aplicabilidad de una promocion: misma semantica que
 * `PromotionRepository.getApplicable`, evaluada sobre una lista ya cargada para no consultar la
 * promocion producto por producto.
 */
export function isPromotionApplicable(
  promotion: Promotion,
  criteria: PromotionApplicabilityCriteria,
): boolean {
  const at = new Date(criteria.at).getTime();
  const startsAt = new Date(promotion.startAt).getTime();
  const endsAt = promotion.endAt ? new Date(promotion.endAt).getTime() : Number.POSITIVE_INFINITY;
  const branchApplies =
    promotion.branchIds.length === 0 ||
    (criteria.branchId ? promotion.branchIds.includes(criteria.branchId) : false);

  return (
    promotion.tenantId === criteria.tenantId &&
    promotion.productIds.includes(criteria.productId) &&
    promotion.status === PromotionStatus.active &&
    startsAt <= at &&
    at <= endsAt &&
    promotion.channels.includes(criteria.channel) &&
    branchApplies
  );
}
