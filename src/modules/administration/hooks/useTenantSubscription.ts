"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { TenantSubscriptionDetailsDto } from "@/modules/administration/application/dto/SubscriptionDto";
import { ChangeTenantPlanService } from "@/modules/administration/application/services/ChangeTenantPlanService";
import { UpdateTenantSubscriptionService } from "@/modules/administration/application/services/UpdateTenantSubscriptionService";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { PLANS_MANAGE_PERMISSION, PLANS_READ_PERMISSION } from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

/**
 * Lee el read model único (GetTenantSubscriptionDetailsService) -- nunca recalcula entitlements/
 * usage acá. Recarga en `user.changed`/`branch.changed` (contadores de uso) y en
 * `tenant-subscription.changed` (cambio de Plan). `changePlan` nunca llama `reload()`: lo hace el
 * evento, una sola vez.
 */
export function useTenantSubscription() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const actorUserId = user?.id ?? null;
  const canRead = hasPermission(PLANS_READ_PERMISSION);
  const canManage = hasPermission(PLANS_MANAGE_PERMISSION);
  const service = useMemo(
    () => new GetTenantSubscriptionDetailsService(repositories),
    [repositories],
  );
  const changeService = useMemo(() => new ChangeTenantPlanService(repositories), [repositories]);
  const updateService = useMemo(() => new UpdateTenantSubscriptionService(repositories), [repositories]);

  const [details, setDetails] = useState<TenantSubscriptionDetailsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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

  const changePlan = useCallback(
    async (targetPlanId: string) => {
      if (!tenantId || !actorUserId) {
        const message = "No se pudo resolver la sesión actual.";
        setError(message);
        throw new Error(message);
      }

      setBusy(true);
      setError(null);
      try {
        return await changeService.execute(tenantId, targetPlanId, permissions, actorUserId);
      } catch (caughtError) {
        const message = cleanError(caughtError);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [actorUserId, changeService, permissions, tenantId],
  );

  const updateAddons = useCallback(async (addonCodes: string[]) => {
    if (!tenantId || !actorUserId) throw new Error("No se pudo resolver la sesión actual.");
    setBusy(true);
    setError(null);
    try {
      const updated = await updateService.execute(tenantId, addonCodes, permissions, actorUserId);
      setDetails(updated);
      return updated;
    } catch (caughtError) {
      const message = cleanError(caughtError);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }, [tenantId, actorUserId, updateService, permissions]);

  return {
    loading: loading || sessionLoading,
    busy,
    error,
    details,
    canRead,
    canManage,
    changePlan,
    updateAddons,
    reload,
  };
}
