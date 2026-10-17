"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataEventBus, useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontProductDetailDto } from "@/modules/storefront/application/dto/StorefrontProductDetailDto";
import { GetStorefrontProductDetailService } from "@/modules/storefront/application/services/GetStorefrontProductDetailService";
import { ApiStorefrontCatalogService } from "@/modules/storefront/application/services/ApiStorefrontCatalogService";
import { isApiMode } from "@/config/api-mode";
import { ProductStatus, ProductType } from "@/core/enums";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

export function useStorefrontProductDetail(productId: string) {
  const repositories = useRepositories();
  const eventBus = useDataEventBus();
  const { tenantId, tenantSlug, loading: tenantLoading, error: tenantError } = usePublicTenant();
  const service = useMemo(
    () => new GetStorefrontProductDetailService(repositories),
    [repositories],
  );
  const apiService = useMemo(() => new ApiStorefrontCatalogService(), []);
  const [data, setData] = useState<StorefrontProductDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!tenantId) {
        if (active) {
          setData(null);
          setError(tenantError ?? "No se pudo determinar la tienda pública.");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const apiProduct = isApiMode()
          ? await apiService.getProduct(tenantSlug, productId)
          : null;
        const nextData = isApiMode()
          ? apiProduct && {
              product: {
                id: apiProduct.id,
                tenantId,
                sku: apiProduct.sku,
                name: apiProduct.name,
                description: apiProduct.description,
                brand: apiProduct.brand,
                productType: ProductType.physical,
                categoryId: apiProduct.categoryId,
                baseUnitId: apiProduct.saleUnitId,
                saleUnitId: apiProduct.saleUnitId,
                salePrice: apiProduct.salePrice,
                status: ProductStatus.published,
                tracking: { stock: true, lot: false, expiration: false, serial: false },
                channels: { ecommerce: true, pos: false, mobileApp: false },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              categoryName: apiProduct.categoryName,
              media: apiProduct.imageSource
                ? [{ source: apiProduct.imageSource, alt: apiProduct.imageAlt }]
                : [],
              attributes: [],
              availableQuantity: apiProduct.availableQuantity,
            }
          : await service.execute(tenantSlug, tenantId, productId);
        if (!active) return;
        if (!nextData) {
          setData(null);
          setError("El producto no está disponible.");
          return;
        }
        setData(nextData);
      } catch {
        if (active) setError("No se pudo cargar el producto. Intenta nuevamente.");
      } finally {
        if (active) setLoading(false);
      }
    };

    window.queueMicrotask(() => {
      if (active && !tenantLoading) void load();
    });

    const shouldReload = (event: { tenantId?: string }) =>
      active && !tenantLoading && event.tenantId === tenantId;
    const unsubscribeProduct = eventBus.subscribe("product.changed", (event) => {
      if (shouldReload(event)) void load();
    });
    const unsubscribeInventory = eventBus.subscribe("inventory.changed", (event) => {
      if (shouldReload(event)) void load();
    });
    const unsubscribeStock = eventBus.subscribe("stock.changed", (event) => {
      if (shouldReload(event)) void load();
    });
    const unsubscribeBranch = eventBus.subscribe("branch.changed", (event) => {
      if (shouldReload(event)) void load();
    });

    return () => {
      active = false;
      unsubscribeProduct();
      unsubscribeInventory();
      unsubscribeStock();
      unsubscribeBranch();
    };
  }, [apiService, eventBus, productId, reloadKey, service, tenantError, tenantId, tenantLoading, tenantSlug]);

  return { data, loading: tenantLoading || loading, error, reload };
}
