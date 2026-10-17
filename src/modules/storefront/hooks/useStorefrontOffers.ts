"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogImageSource, Promotion } from "@/core/entities";
import { getProductMediaSource, selectPrimaryProductMedia } from "@/core/media/catalogImage";
import { BranchStatus, PromotionStatus, SalesChannel } from "@/core/enums";
import { calculateEffectivePrice, resolveQuantityPrice } from "@/core/pricing";
import { isBranchScopedResourceAvailable } from "@/core/scopes/branchScope";
import { isApiMode } from "@/config/api-mode";
import { useDataEventBus, useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { ApiStorefrontCatalogService } from "@/modules/storefront/application/services/ApiStorefrontCatalogService";
import { ensurePublicStorefrontTenant } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";

export interface StorefrontOfferItem {
  productId: string;
  name: string;
  sku: string;
  description?: string;
  imageSource?: CatalogImageSource;
  imageAlt?: string;
  basePrice: number;
  effectivePrice: number;
  discount: number;
  promotionName: string;
  promotion?: Pick<Promotion, "id" | "type" | "value">;
}

function isApplicableEcommercePromotion(
  promotion: Promotion,
  tenantId: string,
  productId: string,
  ecommerceBranchId: string,
  now: Date,
): boolean {
  const startsAt = new Date(promotion.startAt).getTime();
  const endsAt = promotion.endAt ? new Date(promotion.endAt).getTime() : Number.POSITIVE_INFINITY;
  return (
    promotion.tenantId === tenantId &&
    promotion.status === PromotionStatus.active &&
    promotion.channels.includes(SalesChannel.ecommerce) &&
    promotion.productIds.includes(productId) &&
    isBranchScopedResourceAvailable(promotion.branchIds, ecommerceBranchId) &&
    startsAt <= now.getTime() &&
    now.getTime() <= endsAt
  );
}

function selectPromotion(promotions: Promotion[], basePrice: number): Promotion | undefined {
  return promotions.reduce<Promotion | undefined>((selected, candidate) => {
    if (!selected) return candidate;
    const selectedPrice = calculateEffectivePrice(basePrice, selected).effectivePrice;
    const candidatePrice = calculateEffectivePrice(basePrice, candidate).effectivePrice;
    // Entre promociones ya válidas para la misma sucursal, gana el menor precio final.
    // El ID resuelve empates para no depender del orden del arreglo.
    if (candidatePrice < selectedPrice) return candidate;
    if (candidatePrice === selectedPrice && candidate.id.localeCompare(selected.id) < 0)
      return candidate;
    return selected;
  }, undefined);
}

export function useStorefrontOffers(quantityOverride?: { productId: string; quantity: number }) {
  const repositories = useRepositories();
  const eventBus = useDataEventBus();
  const { tenantId, tenantSlug, loading: tenantLoading, error: tenantError } = usePublicTenant();
  const apiCatalogService = useMemo(() => new ApiStorefrontCatalogService(), []);
  const { items: cartItems } = useStorefrontCart();
  const overrideProductId = quantityOverride?.productId;
  const overrideQuantity = quantityOverride?.quantity;
  const [items, setItems] = useState<StorefrontOfferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!tenantId) {
        if (active) {
          setItems([]);
          setError(tenantError ?? "La tienda pública no está disponible.");
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      setError(null);
      try {
        if (isApiMode()) {
          const discovery = await apiCatalogService.list(tenantSlug);
          const offers = discovery.products
            .filter((product) => (product.discountAmount ?? 0) > 0)
            .map((product) => ({
              productId: product.id,
              name: product.name,
              sku: product.sku,
              description: product.description,
              imageSource: product.imageSource,
              imageAlt: product.imageAlt,
              basePrice: product.basePrice ?? product.salePrice,
              effectivePrice: product.effectivePrice ?? product.salePrice,
              discount: product.discountAmount ?? 0,
              promotionName: "Oferta especial",
            }));
          if (active) setItems(offers);
          return;
        }
        // Auditoría §15/§30 (BLOCKER): esta lectura pública lee productos/precios directo del
        // repositorio (sin pasar por Discovery/ProductDetail) -- mismo bypass, mismo guard.
        await ensurePublicStorefrontTenant(repositories, tenantSlug, tenantId);
        const ecommerceConfig = await repositories.businessConfig.getEcommerceConfig(tenantId);
        if (!ecommerceConfig?.enabled || !ecommerceConfig.defaultBranchId)
          throw new Error("E-commerce branch is not configured");

        const ecommerceBranchId = ecommerceConfig.defaultBranchId;
        const [ecommerceBranch, products, promotions] = await Promise.all([
          repositories.branches.getById(ecommerceBranchId),
          repositories.products.getPublishedForEcommerce(tenantId),
          repositories.promotions.getActive(),
        ]);
        if (
          !ecommerceBranch ||
          ecommerceBranch.tenantId !== tenantId ||
          ecommerceBranch.status !== BranchStatus.active
        ) {
          throw new Error("E-commerce branch is not available");
        }
        const now = new Date();
        const offers = (
          await Promise.all(
            products.map(async (product) => {
              const quantity =
                product.id === overrideProductId && overrideQuantity !== undefined
                  ? overrideQuantity
                  : (cartItems.find((item) => item.productId === product.id)?.quantity ?? 1);
              const salesPriceTiers = (
                await repositories.productSalesPriceTiers.getByProduct(product.id)
              ).filter(
                (tier) =>
                  tier.tenantId === tenantId && tier.productId === product.id && tier.active,
              );
              const quantityPrice = resolveQuantityPrice({
                basePrice: product.salePrice,
                quantity,
                tiers: salesPriceTiers,
              });
              const promotion = selectPromotion(
                promotions.filter((item) =>
                  isApplicableEcommercePromotion(
                    item,
                    tenantId,
                    product.id,
                    ecommerceBranchId,
                    now,
                  ),
                ),
                quantityPrice,
              );
              if (!promotion) return null;
              const [productMedia, price] = await Promise.all([
                repositories.productMedia.getByProduct(product.id),
                Promise.resolve(calculateEffectivePrice(quantityPrice, promotion)),
              ]);
              const media = selectPrimaryProductMedia(
                productMedia.filter((item) => item.tenantId === tenantId),
              );
              return {
                productId: product.id,
                name: product.name,
                sku: product.sku,
                description: product.description,
                imageSource: media ? (getProductMediaSource(media) ?? undefined) : undefined,
                imageAlt: media?.alt,
                basePrice: price.basePrice,
                effectivePrice: price.effectivePrice,
                discount: price.discountAmount,
                promotionName: promotion.name,
                promotion,
              };
            }),
          )
        ).filter((item) => item !== null) as StorefrontOfferItem[];
        if (active) setItems(offers);
      } catch {
        if (active) setError("No se pudieron cargar las ofertas.");
      } finally {
        if (active) setLoading(false);
      }
    };
    window.queueMicrotask(() => {
      if (active && !tenantLoading) void load();
    });
    const unsubscribe = eventBus.subscribe("promotion.changed", (event) => {
      if (active && event.tenantId === tenantId) void load();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    apiCatalogService,
    cartItems,
    eventBus,
    overrideProductId,
    overrideQuantity,
    repositories,
    tenantError,
    tenantId,
    tenantLoading,
    tenantSlug,
  ]);

  return useMemo(
    () => ({ items, loading: tenantLoading || loading, error }),
    [error, items, loading, tenantLoading],
  );
}
