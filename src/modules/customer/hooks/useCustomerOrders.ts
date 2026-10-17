"use client";

import { useCallback, useEffect, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { CustomerOrderSummaryDto } from "@/modules/customer/application/dto/CustomerOrderSummaryDto";
import { CustomerIdentityError } from "@/modules/customer/application/services/CustomerAuthorizationContext";
import { getCurrentCustomerOrders } from "@/modules/customer/application/services/orderService";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

/**
 * Solo lectura. No recibe ni puede seleccionar customerId/tenantId --
 * getCurrentCustomerOrders() resuelve el scope internamente en cada
 * llamada.
 */
export function useCustomerOrders() {
  const repositories = useRepositories();
  const [orders, setOrders] = useState<CustomerOrderSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const items = await getCurrentCustomerOrders(repositories);
      setOrders(items);
      setError(null);
    } catch (caughtError) {
      setOrders([]);
      setError(
        caughtError instanceof CustomerIdentityError
          ? caughtError.message
          : caughtError instanceof Error
            ? caughtError.message
            : "No se pudieron cargar los pedidos.",
      );
    } finally {
      setLoading(false);
    }
  }, [repositories]);

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

  useDataEvent("order.changed", reload);
  useDataEvent("auth.changed", reload);
  useDataEvent("user.changed", reload);

  return { orders, loading, error, reload };
}
