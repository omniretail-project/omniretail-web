"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isApiMode } from "@/config/api-mode";
import { useDataEventBus, useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontDiscoveryDto } from "@/modules/storefront/application/dto/StorefrontDiscoveryDto";
import { ApiStorefrontCatalogService } from "@/modules/storefront/application/services/ApiStorefrontCatalogService";
import { GetStorefrontDiscoveryService } from "@/modules/storefront/application/services/GetStorefrontDiscoveryService";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

export interface StorefrontCatalogContextValue extends StorefrontDiscoveryDto {
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const emptyDiscovery: StorefrontDiscoveryDto = { categories: [], products: [] };

const StorefrontCatalogContext = createContext<StorefrontCatalogContextValue | null>(null);

/**
 * Catalogo publico compartido por la tienda: se carga una sola vez por tenant y lo consumen el
 * header, las paginas y las ofertas. Antes cada consumidor descargaba el catalogo completo por su
 * cuenta (3-4 veces por pagina).
 */
export function StorefrontCatalogProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const eventBus = useDataEventBus();
  const { tenantId, tenantSlug, loading: tenantLoading, error: tenantError } = usePublicTenant();
  const service = useMemo(() => new GetStorefrontDiscoveryService(repositories), [repositories]);
  const apiService = useMemo(() => new ApiStorefrontCatalogService(), []);
  const [data, setData] = useState<StorefrontDiscoveryDto>(emptyDiscovery);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!tenantId) {
        if (active) {
          setData(emptyDiscovery);
          setError(tenantError ?? "No se pudo determinar la tienda pública.");
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const nextData = isApiMode()
          ? await apiService.list(tenantSlug)
          : await service.execute(tenantSlug, tenantId);
        if (active) setData(nextData);
      } catch {
        if (active) setError("No se pudo cargar la tienda. Intenta nuevamente.");
      } finally {
        if (active) setLoading(false);
      }
    };

    window.queueMicrotask(() => {
      if (active && !tenantLoading) void load();
    });
    const unsubscribeProducts = eventBus.subscribe("product.changed", (event) => {
      if (active && !tenantLoading && event.tenantId === tenantId) void load();
    });
    const unsubscribeCategories = eventBus.subscribe("category.changed", (event) => {
      if (active && !tenantLoading && event.tenantId === tenantId) void load();
    });
    const unsubscribeStock = eventBus.subscribe("stock.changed", (event) => {
      if (active && !tenantLoading && event.tenantId === tenantId) void load();
    });
    return () => {
      active = false;
      unsubscribeProducts();
      unsubscribeCategories();
      unsubscribeStock();
    };
  }, [apiService, eventBus, reloadKey, service, tenantError, tenantId, tenantLoading, tenantSlug]);

  const value = useMemo<StorefrontCatalogContextValue>(
    () => ({ ...data, loading: tenantLoading || loading, error, reload }),
    [data, error, loading, reload, tenantLoading],
  );

  return (
    <StorefrontCatalogContext.Provider value={value}>{children}</StorefrontCatalogContext.Provider>
  );
}

export function useStorefrontCatalogContext() {
  const context = useContext(StorefrontCatalogContext);
  if (!context) {
    throw new Error("useStorefrontCatalogContext must be used inside StorefrontCatalogProvider");
  }
  return context;
}
