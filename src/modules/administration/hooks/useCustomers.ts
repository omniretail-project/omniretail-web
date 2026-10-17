"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isApiMode } from "@/config/api-mode";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { CustomerDto } from "@/modules/administration/application/dto/CustomerDto";
import { ApiCustomersService } from "@/modules/administration/application/services/ApiCustomersService";
import { GetCustomersService } from "@/modules/administration/application/services/GetCustomersService";
import {
  cleanError,
  ensureCanReadCustomers,
} from "@/modules/administration/application/services/serviceHelpers";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useCustomers() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const canRead = hasPermission("admin.customers.read");
  const getMockService = useMemo(() => new GetCustomersService(repositories), [repositories]);
  const apiService = useMemo(() => new ApiCustomersService(), []);
  // En modo api los clientes (incluidos los registrados en la tienda, p. ej. con Google) viven en
  // el backend; el mock local solo los conoce en modo mock.
  const getService = useMemo(
    () => ({
      execute: async (currentTenantId: string, currentPermissions: readonly string[]) => {
        if (!isApiMode()) return getMockService.execute(currentTenantId, currentPermissions);
        ensureCanReadCustomers(currentPermissions);
        return apiService.list();
      },
    }),
    [apiService, getMockService],
  );
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<CustomerDto[]> => {
    if (sessionLoading) return [];
    if (!tenantId) {
      setCustomers([]);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const nextCustomers = await getService.execute(tenantId, permissions);
      setCustomers(nextCustomers);
      return nextCustomers;
    } catch (caughtError) {
      setCustomers([]);
      setError(cleanError(caughtError));
      return [];
    } finally {
      setLoading(false);
    }
  }, [getService, permissions, sessionLoading, tenantId]);

  useDataEvent("customer.changed", reload);

  useEffect(() => {
    let active = true;

    if (!sessionLoading && !tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setCustomers([]);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
    } else if (tenantId) {
      getService
        .execute(tenantId, permissions)
        .then((nextCustomers) => {
          if (!active) return;
          setCustomers(nextCustomers);
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (!active) return;
          setCustomers([]);
          setError(cleanError(caughtError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [getService, permissions, sessionLoading, tenantId]);

  return {
    loading: loading || sessionLoading,
    error,
    customers,
    canRead,
    reload,
  };
}
