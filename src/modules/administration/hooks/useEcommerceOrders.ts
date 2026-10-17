"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OrderStatus } from "@/core/enums";
import type { PaginatedResult } from "@/core/types";
import type { EcommerceOrderDto } from "@/modules/administration/application/dto/EcommerceOrderDto";
import { ApiEcommerceOrdersService } from "@/modules/administration/application/services/ApiEcommerceOrdersService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { ORDERS_MANAGE_PERMISSION, ORDERS_READ_PERMISSION } from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type { TablePageSize } from "@/shared/components/TablePagination";

const EMPTY_PAGE: PaginatedResult<EcommerceOrderDto> = {
  items: [],
  page: 1,
  pageSize: 10,
  totalItems: 0,
  totalPages: 0,
};

export type EcommerceOrderStatusFilter = OrderStatus | "all";

export function useEcommerceOrders() {
  const { hasPermission, loading: sessionLoading } = useCurrentSession();
  const canManage = hasPermission(ORDERS_MANAGE_PERMISSION);
  const canRead = hasPermission(ORDERS_READ_PERMISSION) || canManage;
  const service = useMemo(() => new ApiEcommerceOrdersService(), []);
  const [result, setResult] = useState<PaginatedResult<EcommerceOrderDto>>(EMPTY_PAGE);
  const [status, setStatus] = useState<EcommerceOrderStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (sessionLoading) return;
    if (!canRead) {
      setResult(EMPTY_PAGE);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setResult(await service.list({ page, pageSize, status }));
    } catch (caughtError) {
      setResult(EMPTY_PAGE);
      setError(cleanError(caughtError));
    } finally {
      setLoading(false);
    }
  }, [canRead, page, pageSize, service, sessionLoading, status]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  const changeStatus = useCallback(
    async (order: EcommerceOrderDto, nextStatus: OrderStatus) => {
      setBusy(true);
      setError(null);
      try {
        const updated = await service.updateStatus(order.id, nextStatus);
        setResult((current) => ({
          ...current,
          items: current.items.map((item) => (item.id === updated.id ? updated : item)),
        }));
        return updated;
      } catch (caughtError) {
        const message = cleanError(caughtError);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [service],
  );

  const setFilter = useCallback((nextStatus: EcommerceOrderStatusFilter) => {
    setStatus(nextStatus);
    setPage(1);
  }, []);

  const changePageSize = useCallback((nextPageSize: TablePageSize) => {
    setPageSize(nextPageSize);
    setPage(1);
  }, []);

  return {
    busy,
    canManage,
    canRead,
    error,
    loading: loading || sessionLoading,
    page,
    pageSize,
    result,
    status,
    changePage: setPage,
    changePageSize,
    changeStatus,
    reload,
    setFilter,
  };
}
