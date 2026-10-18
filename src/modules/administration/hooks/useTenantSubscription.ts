"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { TenantSubscriptionDetailsDto } from "@/modules/administration/application/dto/SubscriptionDto";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { PLANS_READ_PERMISSION } from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

/**
 * Lectura del plan y los modulos del negocio (GetTenantSubscriptionDetailsService), SOLO lectura:
 * el aprovisionamiento de modulos lo controla MARJYM, no el cliente. Nunca recalcula entitlements
 * ni uso aqui. Recarga en `user.changed`/`branch.changed` (contadores de uso) y en
 * `tenant-subscription.changed`.
 */
export function useTenantSubscription() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const canRead = hasPermission(PLANS_READ_PERMISSION);
  const service = useMemo(
    () => new GetTenantSubscriptionDetailsService(repositories),
    [repositories],
  );

  const [details, setDetails] = useState<TenantSubscriptionDetailsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (sessionLoading) return;
    if (!tenantId) {
      setDetails(null);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await service.execute(tenantId, permissions);
      setDetails(result);
    } catch (caughtError) {
      setDetails(null);
      setError(cleanError(caughtError));
    } finally {
      setLoading(false);
    }
  }, [permissions, service, sessionLoading, tenantId]);

  useDataEvent("user.changed", reload);
  useDataEvent("branch.changed", reload);
  useDataEvent("tenant-subscription.changed", reload);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  return {
    loading: loading || sessionLoading,
    error,
    details,
    canRead,
    reload,
  };
}
