"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isApiMode } from "@/config/api-mode";
import { useDataEventBus, useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { PublicStorefrontConfigDto } from "@/modules/storefront/application/dto/PublicStorefrontConfigDto";
import { GetPublicStorefrontConfigService } from "@/modules/storefront/application/services/GetPublicStorefrontConfigService";
import { ApiPublicStorefrontConfigService } from "@/modules/storefront/application/services/ApiPublicStorefrontConfigService";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";
import { shouldRefreshPublicConfig } from "@/modules/storefront/application/services/publicConfigReactivity";

interface PublicTenantContextValue {
  tenantId: string | null;
  tenantSlug: string;
  config: PublicStorefrontConfigDto | null;
  loading: boolean;
  error: string | null;
}

const PublicTenantContext = createContext<PublicTenantContextValue | null>(null);

export function PublicTenantProvider({ children, tenantSlug }: { children: ReactNode; tenantSlug: string }) {
  const repositories = useRepositories();
  const eventBus = useDataEventBus();
  const configService = useMemo(
    () => new GetPublicStorefrontConfigService(repositories),
    [repositories],
  );
  const apiConfigService = useMemo(() => new ApiPublicStorefrontConfigService(), []);
  const contextService = useMemo(
    () => new ResolvePublicStorefrontContextService(repositories),
    [repositories],
  );
  const resolvedTenantIdRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicStorefrontConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      try {
        if (isApiMode()) {
          const publicConfig = await apiConfigService.execute(tenantSlug);
          if (!active || requestId !== requestIdRef.current) return;
          resolvedTenantIdRef.current = publicConfig.tenantId;
          setConfig(publicConfig.config);
          setTenantId(publicConfig.tenantId);
          setError(null);
          return;
        }
        const [nextConfig, context] = await Promise.all([
          configService.execute(tenantSlug),
          contextService.execute({ tenantSlug, allowDisabled: true }),
        ]);
        if (!active || requestId !== requestIdRef.current) return;
        resolvedTenantIdRef.current = context.tenantId;
        setConfig(nextConfig);
        setTenantId(context.tenantId);
        setError(null);
      } catch {
        if (!active || requestId !== requestIdRef.current) return;
        resolvedTenantIdRef.current = null;
        setTenantId(null);
        setConfig(null);
        setError("La tienda publica no esta disponible.");
      } finally {
        if (active && requestId === requestIdRef.current) setLoading(false);
      }
    };

    const unsubscribeConfig = eventBus.subscribe("business-config.changed", (event) => {
      if (active && shouldRefreshPublicConfig(event.tenantId, resolvedTenantIdRef.current)) {
        void load();
      }
    });
    const unsubscribeBranches = eventBus.subscribe("branch.changed", (event) => {
      if (active && shouldRefreshPublicConfig(event.tenantId, resolvedTenantIdRef.current)) {
        void load();
      }
    });
    const unsubscribeSubscription = eventBus.subscribe("tenant-subscription.changed", (event) => {
      if (active && shouldRefreshPublicConfig(event.tenantId, resolvedTenantIdRef.current)) {
        void load();
      }
    });

    void load();
    return () => {
      active = false;
      requestIdRef.current += 1;
      unsubscribeConfig();
      unsubscribeBranches();
      unsubscribeSubscription();
    };
  }, [apiConfigService, configService, contextService, eventBus, tenantSlug]);

  const value = useMemo<PublicTenantContextValue>(
    () => ({ tenantId, tenantSlug, config, loading, error }),
    [config, error, loading, tenantId, tenantSlug],
  );

  return <PublicTenantContext.Provider value={value}>{children}</PublicTenantContext.Provider>;
}

export function usePublicTenant() {
  const context = useContext(PublicTenantContext);
  if (!context) throw new Error("usePublicTenant must be used inside PublicTenantProvider");
  return context;
}

export function useOptionalPublicTenant() {
  return useContext(PublicTenantContext);
}
