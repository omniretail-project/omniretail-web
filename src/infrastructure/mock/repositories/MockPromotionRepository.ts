import type { Promotion } from "@/core/entities";
import { PromotionStatus, PromotionType } from "@/core/enums";
import type { PromotionApplicabilityCriteria, PromotionRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

const activePromotionStatuses = new Set<PromotionStatus>([
  PromotionStatus.scheduled,
  PromotionStatus.active,
]);

function hasIntersection(left: string[], right: string[]): boolean {
  return left.some((item) => right.includes(item));
}

function branchScopesOverlap(left: string[], right: string[]): boolean {
  return left.length === 0 || right.length === 0 || hasIntersection(left, right);
}

function dateRangesOverlap(left: Promotion, right: Promotion): boolean {
  const leftStart = new Date(left.startAt).getTime();
  const leftEnd = left.endAt ? new Date(left.endAt).getTime() : Number.POSITIVE_INFINITY;
  const rightStart = new Date(right.startAt).getTime();
  const rightEnd = right.endAt ? new Date(right.endAt).getTime() : Number.POSITIVE_INFINITY;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function isApplicable(promotion: Promotion, criteria: PromotionApplicabilityCriteria): boolean {
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

export class MockPromotionRepository extends BaseMockRepository implements PromotionRepository {
  async getAll() {
    return this.read((db) => db.promotions);
  }

  async getActive() {
    return this.read((db) =>
      db.promotions.filter((item) => item.status === PromotionStatus.active),
    );
  }

  async getActiveByTenant(tenantId: string) {
    return this.read((db) =>
      db.promotions.filter(
        (item) => item.tenantId === tenantId && item.status === PromotionStatus.active,
      ),
    );
  }

  async getByProduct(productId: string) {
    return this.read((db) => db.promotions.filter((item) => item.productIds.includes(productId)));
  }

  async getByProductScoped(tenantId: string, productId: string) {
    return this.read((db) =>
      db.promotions.filter(
        (item) => item.tenantId === tenantId && item.productIds.includes(productId),
      ),
    );
  }

  async getByIdScoped(tenantId: string, id: string) {
    return this.read(
      (db) => db.promotions.find((item) => item.id === id && item.tenantId === tenantId) ?? null,
    );
  }

  async getApplicable(criteria: PromotionApplicabilityCriteria) {
    return this.read((db) => db.promotions.find((item) => isApplicable(item, criteria)) ?? null);
  }

  async create(input: Parameters<PromotionRepository["create"]>[0]) {
    const item = this.store.mutate((db) => {
      this.assertValidPromotion(input, db.products);
      this.assertNoOverlap(input, db.promotions);
      const now = this.now();
      const created = { ...input, id: this.id("promotion"), createdAt: now, updatedAt: now };
      db.promotions.push(created);
      return created;
    });
    this.emit("promotion.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "created",
    });
    return item;
  }

  async update(id: string, input: Parameters<PromotionRepository["update"]>[1]) {
    const item = this.store.mutate((db) => {
      const current = db.promotions.find((promotion) => promotion.id === id);
      if (!current) throw this.missing("Promotion", id);
      const next = { ...current, ...input };
      this.assertValidPromotion(next, db.products);
      this.assertNoOverlap(next, db.promotions, id);
      return this.updateById(db.promotions, id, input, "Promotion");
    });
    this.emit("promotion.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "updated",
    });
    return item;
  }

  async updateScoped(
    tenantId: string,
    id: string,
    input: Parameters<PromotionRepository["updateScoped"]>[2],
  ) {
    if ("tenantId" in input && input.tenantId !== tenantId) {
      throw new Error("Cross-tenant promotion update denied");
    }
    if (!(await this.getByIdScoped(tenantId, id))) throw this.missing("Promotion", id);
    return this.update(id, input);
  }

  async endScoped(tenantId: string, id: string) {
    return this.updateScoped(tenantId, id, {
      status: PromotionStatus.ended,
      endAt: new Date().toISOString(),
    });
  }

  async cancelScoped(tenantId: string, id: string) {
    return this.updateScoped(tenantId, id, { status: PromotionStatus.cancelled });
  }

  private assertValidPromotion(
    promotion: Omit<Promotion, "id" | "createdAt" | "updatedAt"> | Promotion,
    products: { id: string; tenantId: string; salePrice: number }[],
  ): void {
    if (promotion.channels.length === 0) {
      throw new Error("Promotion must include at least one channel");
    }
    if (promotion.productIds.length === 0) {
      throw new Error("Promotion must include at least one product");
    }
    if (
      promotion.type === PromotionType.percentage &&
      (promotion.value <= 0 || promotion.value >= 100)
    ) {
      throw new Error("Percentage promotion value must be greater than 0 and less than 100");
    }
    for (const productId of promotion.productIds) {
      const product = products.find((item) => item.id === productId);
      if (!product) continue;
      if (product.tenantId !== promotion.tenantId) {
        throw new Error("Promotion products must belong to the same tenant");
      }
      if (
        (promotion.type === PromotionType.fixedDiscount ||
          promotion.type === PromotionType.fixedPrice) &&
        (promotion.value <= 0 || promotion.value >= product.salePrice)
      ) {
        throw new Error(
          "Fixed promotion value must be greater than 0 and less than product sale price",
        );
      }
    }
  }

  private assertNoOverlap(
    promotion: Omit<Promotion, "id" | "createdAt" | "updatedAt"> | Promotion,
    existingPromotions: Promotion[],
    currentPromotionId?: string,
  ): void {
    if (!activePromotionStatuses.has(promotion.status)) return;
    const overlaps = existingPromotions.some((item) => {
      if (item.id === currentPromotionId) return false;
      if (!activePromotionStatuses.has(item.status)) return false;
      return (
        item.tenantId === promotion.tenantId &&
        hasIntersection(item.productIds, promotion.productIds) &&
        hasIntersection(item.channels, promotion.channels) &&
        branchScopesOverlap(item.branchIds, promotion.branchIds) &&
        dateRangesOverlap(item, promotion as Promotion)
      );
    });
    if (overlaps) {
      throw new Error(
        "Promotion overlaps with an existing promotion for the same product, channel and branch scope",
      );
    }
  }
}
