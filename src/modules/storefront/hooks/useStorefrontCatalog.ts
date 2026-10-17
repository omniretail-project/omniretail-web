"use client";

import { useCallback, useEffect, useState } from "react";
import type { Product } from "@/core/entities";
import { useDataEventBus, useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

export function useStorefrontCatalog() {
  const { products } = useRepositories();
  const eventBus = useDataEventBus();
  const { tenantId, loading: tenantLoading, error: tenantError } = usePublicTenant();

  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!tenantId) {
        if (active) {
          setItems([]);
          setError(tenantError ?? "No se pudo determinar la tienda pública.");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const publishedProducts = await products.getPublishedForEcommerce(tenantId);
        if (active) setItems(publishedProducts);
      } catch {
        if (active) setError("No se pudo cargar el catálogo. Intenta nuevamente.");
      } finally {
        if (active) setLoading(false);
      }
    };

    window.queueMicrotask(() => {
      if (active && !tenantLoading) void load();
    });

    const unsubscribe = eventBus.subscribe("product.changed", (event) => {
      if (active && !tenantLoading && event.tenantId === tenantId) void load();
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [eventBus, products, reloadKey, tenantError, tenantId, tenantLoading]);

  return {
    items,
    loading: tenantLoading || loading,
    error,
    reload,
  };
}
