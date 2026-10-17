"use client";

import { useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontCheckoutResultDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import { GetStorefrontOrderConfirmationService } from "@/modules/storefront/application/services/GetStorefrontOrderConfirmationService";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

export function useStorefrontOrderConfirmation(trackingToken?: string) {
  const repositories = useRepositories();
  const { tenantSlug, loading: tenantLoading } = usePublicTenant();
  const service = useMemo(() => new GetStorefrontOrderConfirmationService(repositories), [repositories]);
  const [data, setData] = useState<StorefrontCheckoutResultDto | null>(null);
  const [loading, setLoading] = useState(Boolean(trackingToken));

  useEffect(() => {
    let active = true;
    if (!trackingToken) {
      return () => { active = false; };
    }
    if (tenantLoading) return () => { active = false; };

    window.queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      void service.execute({ tenantSlug, trackingToken })
        .then((result) => { if (active) setData(result); })
        .catch(() => { if (active) setData(null); })
        .finally(() => { if (active) setLoading(false); });
    });
    return () => { active = false; };
  }, [service, tenantLoading, tenantSlug, trackingToken]);

  return { data, loading: tenantLoading || loading };
}
