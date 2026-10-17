"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { DashboardSummaryDto } from "@/modules/administration/application/dto/DashboardDto";
import { GetDashboardSummaryService } from "@/modules/administration/application/services/GetDashboardSummaryService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { DASHBOARD_READ_PERMISSION } from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useDashboardSummary() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? "";
  const canRead = hasPermission(DASHBOARD_READ_PERMISSION);
  const service = useMemo(() => new GetDashboardSummaryService(repositories), [repositories]);
  const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (sessionLoading || !canRead) return;

    setLoading(true);
    setError(null);
    try {
      const nextSummary = await service.execute(tenantId, permissions);
      setSummary(nextSummary);
    } catch (caughtError) {
      setError(cleanError(caughtError));
    } finally {
      setLoading(false);
    }
  }, [canRead, permissions, service, sessionLoading, tenantId]);

  useDataEvent("sale.changed", reload);
  useDataEvent("order.changed", reload);
  useDataEvent("stock.changed", reload);
  useDataEvent("receipt.changed", reload);

  useEffect(() => {
    let active = true;

    if (sessionLoading) {
      return () => {
        active = false;
      };
    }

    if (!canRead) {
      window.queueMicrotask(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    service
      .execute(tenantId, permissions)
      .then((nextSummary) => {
        if (!active) return;
        setSummary(nextSummary);
        setError(null);
      })
      .catch((caughtError: unknown) => {
        if (active) setError(cleanError(caughtError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canRead, permissions, service, sessionLoading, tenantId]);

  return {
    loading: loading || sessionLoading,
    error,
    summary,
    canRead,
    reload,
  };
}
