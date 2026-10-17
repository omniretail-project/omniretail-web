"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DeliveryMethod, OrderStatus } from "@/core/enums";
import type { DataEventPayload } from "@/core/types/events.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type {
  LogisticsHistoryDetailDto,
  LogisticsHistoryItemDto,
  LogisticsHistoryQueryDto,
} from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import type { PreparedOrderDetailDto } from "@/modules/logistics/application/dto/DispatchReadModelDto";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { GetLogisticsHistoryService } from "@/modules/logistics/application/services/GetLogisticsHistoryService";
import type { DispatchShipmentValidationResult } from "@/modules/logistics/validation/dispatch.validation";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

export type LogisticsHistoryFilters = LogisticsHistoryQueryDto;

export const LOGISTICS_HISTORY_DEFAULT_PAGE_SIZE = 10;
/** Espera tras la última tecla antes de consultar el backend con el texto de búsqueda. */
export const LOGISTICS_HISTORY_SEARCH_DEBOUNCE_MS = 300;

export const defaultLogisticsHistoryFilters: LogisticsHistoryFilters = {
  search: "",
  status: "all",
  deliveryMethod: "all",
  from: "",
  to: "",
};

export function useLogisticsHistory() {
  const repositories = useRepositories();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    user,
    canAccessBranch,
    hasPermission,
    loading: sessionLoading,
    error: sessionError,
  } = useCurrentSession();
  const service = useMemo(() => new GetLogisticsHistoryService(repositories), [repositories]);
  const dispatchService = useMemo(
    () => new DispatchApplicationService(repositories),
    [repositories],
  );
  const usesApi = service.usesApi;
  const [items, setItems] = useState<LogisticsHistoryItemDto[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(LOGISTICS_HISTORY_DEFAULT_PAGE_SIZE);
  const [serverTotals, setServerTotals] = useState({ totalItems: 0, totalPages: 1 });
  const [appliedSearch, setAppliedSearch] = useState(defaultLogisticsHistoryFilters.search);
  const [loadedBranchId, setLoadedBranchId] = useState<string | null>(null);
  const [filters, setFilters] = useState<LogisticsHistoryFilters>(defaultLogisticsHistoryFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LogisticsHistoryDetailDto | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dispatchDetail, setDispatchDetail] = useState<PreparedOrderDetailDto | null>(null);
  const [dispatchOrderId, setDispatchOrderId] = useState<string | null>(null);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const requestSequenceRef = useRef(0);
  const detailSequenceRef = useRef(0);
  const dispatchSequenceRef = useRef(0);
  const activeBranchIdRef = useRef<string | null>(currentBranch?.id ?? null);
  const detailOrderIdRef = useRef<string | null>(null);
  const detailItemRef = useRef<LogisticsHistoryItemDto | null>(null);
  const dispatchOrderIdRef = useRef<string | null>(null);
  const dispatchOperationIdRef = useRef("");
  const dispatchMutationLockRef = useRef(false);

  const hasBranchAccess = Boolean(
    user &&
      currentBranch &&
      user.tenantId === currentBranch.tenantId &&
      canAccessBranch(currentBranch.id),
  );
  const canRead = hasPermission("logistics.history.read");
  const canReadDispatch = hasPermission("logistics.dispatch.read");
  const canConfirmDispatch =
    canReadDispatch && hasPermission("logistics.dispatch.confirm");
  const contextLoading = branchLoading || sessionLoading;

  // En modo mock los filtros se aplican en el cliente: `apiQuery` es null y no provoca consultas.
  const apiQuery = useMemo(
    () =>
      usesApi
        ? {
            search: appliedSearch,
            status: filters.status,
            deliveryMethod: filters.deliveryMethod,
            from: filters.from,
            to: filters.to,
            page,
            pageSize,
          }
        : null,
    [
      appliedSearch,
      filters.deliveryMethod,
      filters.from,
      filters.status,
      filters.to,
      page,
      pageSize,
      usesApi,
    ],
  );

  const reload = useCallback(async () => {
    const sequence = ++requestSequenceRef.current;
    if (contextLoading) return;
    setLoading(true);
    setError(null);
    if (!currentBranch || !hasBranchAccess || !canRead) {
      setItems([]);
      setLoadedBranchId(null);
      setError(
        sessionError ??
          "Necesitas permiso de historial y acceso a una sucursal activa para consultar estos pedidos.",
      );
      setLoading(false);
      return;
    }

    const branchId = currentBranch.id;
    try {
      if (apiQuery) {
        const result = await service.searchApi(branchId, apiQuery);
        if (sequence !== requestSequenceRef.current || activeBranchIdRef.current !== branchId) return;
        setItems(result.items);
        setServerTotals({ totalItems: result.totalItems, totalPages: Math.max(1, result.totalPages) });
      } else {
        const nextItems = await service.execute(branchId);
        if (sequence !== requestSequenceRef.current || activeBranchIdRef.current !== branchId) return;
        setItems(nextItems);
      }
      setLoadedBranchId(branchId);
    } catch (cause) {
      if (sequence !== requestSequenceRef.current || activeBranchIdRef.current !== branchId) return;
      setItems([]);
      setServerTotals({ totalItems: 0, totalPages: 1 });
      setLoadedBranchId(null);
      setError(toMessage(cause, "No se pudo cargar el historial logístico."));
    } finally {
      if (sequence === requestSequenceRef.current) setLoading(false);
    }
  }, [apiQuery, canRead, contextLoading, currentBranch, hasBranchAccess, service, sessionError]);

  const loadDetail = useCallback(
    async (branchId: string, item: LogisticsHistoryItemDto) => {
      const orderId = item.orderId;
      const sequence = ++detailSequenceRef.current;
      setDetailLoading(true);
      setDetailError(null);
      try {
        const nextDetail = usesApi
          ? await service.getApiDetail(branchId, item)
          : await service.getDetail(branchId, orderId);
        if (
          sequence !== detailSequenceRef.current ||
          activeBranchIdRef.current !== branchId ||
          detailOrderIdRef.current !== orderId
        ) return null;
        setDetail(nextDetail);
        return nextDetail;
      } catch (cause) {
        if (
          sequence === detailSequenceRef.current &&
          activeBranchIdRef.current === branchId &&
          detailOrderIdRef.current === orderId
        ) {
          setDetail(null);
          setDetailError(toMessage(cause, "No se pudo cargar el detalle logístico."));
        }
        return null;
      } finally {
        if (
          sequence === detailSequenceRef.current &&
          activeBranchIdRef.current === branchId
        ) setDetailLoading(false);
      }
    },
    [service, usesApi],
  );

  const openDetail = useCallback(
    async (item: LogisticsHistoryItemDto) => {
      if (!currentBranch || !hasBranchAccess || !canRead) return;
      detailOrderIdRef.current = item.orderId;
      detailItemRef.current = item;
      setDetailOrderId(item.orderId);
      setDetail(null);
      setDetailError(null);
      await loadDetail(currentBranch.id, item);
    },
    [canRead, currentBranch, hasBranchAccess, loadDetail],
  );

  const closeDetail = useCallback(() => {
    detailSequenceRef.current += 1;
    detailOrderIdRef.current = null;
    detailItemRef.current = null;
    setDetailOrderId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const openDispatch = useCallback(
    async (item: LogisticsHistoryItemDto) => {
      if (
        !currentBranch ||
        !hasBranchAccess ||
        !canConfirmDispatch ||
        item.deliveryMethod !== DeliveryMethod.home_delivery ||
        item.operationalStatus !== OrderStatus.ready_for_dispatch ||
        !item.packingId ||
        !item.packingFinalizedAt ||
        item.dispatchId
      ) return;
      const sequence = ++dispatchSequenceRef.current;
      const branchId = currentBranch.id;
      dispatchOrderIdRef.current = item.orderId;
      dispatchOperationIdRef.current = crypto.randomUUID();
      setDispatchOrderId(item.orderId);
      setDispatchDetail(null);
      setDispatchError(null);
      setDispatchLoading(true);
      try {
        const nextDetail = await dispatchService.getPreparedDetail(branchId, item.orderId);
        if (
          sequence !== dispatchSequenceRef.current ||
          activeBranchIdRef.current !== branchId ||
          dispatchOrderIdRef.current !== item.orderId
        ) return;
        setDispatchDetail(nextDetail);
      } catch (cause) {
        if (
          sequence === dispatchSequenceRef.current &&
          activeBranchIdRef.current === branchId &&
          dispatchOrderIdRef.current === item.orderId
        ) setDispatchError(toMessage(cause, "No se pudo abrir el pedido para despacho."));
      } finally {
        if (sequence === dispatchSequenceRef.current) setDispatchLoading(false);
      }
    },
    [canConfirmDispatch, currentBranch, dispatchService, hasBranchAccess],
  );

  const closeDispatch = useCallback(() => {
    if (dispatchMutationLockRef.current) return false;
    dispatchSequenceRef.current += 1;
    dispatchOrderIdRef.current = null;
    dispatchOperationIdRef.current = "";
    setDispatchOrderId(null);
    setDispatchDetail(null);
    setDispatchError(null);
    setDispatchLoading(false);
    return true;
  }, []);

  const confirmDispatch = useCallback(
    async (validation: DispatchShipmentValidationResult) => {
      if (
        !validation.valid ||
        !currentBranch ||
        !dispatchDetail ||
        !canConfirmDispatch ||
        dispatchMutationLockRef.current
      ) return false;
      dispatchMutationLockRef.current = true;
      const branchId = currentBranch.id;
      const orderId = dispatchDetail.orderId;
      setDispatchSubmitting(true);
      setDispatchError(null);
      try {
        await dispatchService.confirm(branchId, {
          orderId,
          operationId: dispatchOperationIdRef.current,
          carrierName: validation.carrierName,
          trackingNumber: validation.trackingNumber,
        });
        if (
          activeBranchIdRef.current !== branchId ||
          dispatchOrderIdRef.current !== orderId
        ) return false;
        dispatchSequenceRef.current += 1;
        dispatchOrderIdRef.current = null;
        dispatchOperationIdRef.current = "";
        setDispatchOrderId(null);
        setDispatchDetail(null);
        setDispatchError(null);
        await reload();
        return true;
      } catch (cause) {
        if (
          activeBranchIdRef.current === branchId &&
          dispatchOrderIdRef.current === orderId
        ) setDispatchError(toMessage(cause, "No se pudo confirmar el despacho."));
        return false;
      } finally {
        dispatchMutationLockRef.current = false;
        setDispatchSubmitting(false);
      }
    },
    [canConfirmDispatch, currentBranch, dispatchDetail, dispatchService, reload],
  );

  useEffect(() => {
    let active = true;
    activeBranchIdRef.current = currentBranch?.id ?? null;
    requestSequenceRef.current += 1;
    detailSequenceRef.current += 1;
    dispatchSequenceRef.current += 1;
    detailOrderIdRef.current = null;
    detailItemRef.current = null;
    dispatchOrderIdRef.current = null;
    dispatchMutationLockRef.current = false;
    dispatchOperationIdRef.current = "";
    window.queueMicrotask(() => {
      if (!active) return;
      setPage(1);
      setDetailOrderId(null);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      setDispatchOrderId(null);
      setDispatchDetail(null);
      setDispatchError(null);
      setDispatchLoading(false);
      setDispatchSubmitting(false);
    });
    return () => {
      active = false;
    };
  }, [currentBranch?.id]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
      requestSequenceRef.current += 1;
    };
  }, [reload]);

  const refreshForScopedEvent = useCallback(
    (payload: DataEventPayload) => {
      if (!currentBranch || payload.tenantId !== currentBranch.tenantId) return;
      if (payload.branchId && payload.branchId !== currentBranch.id) return;
      void reload();
      const item = detailItemRef.current;
      if (item) void loadDetail(currentBranch.id, item);
    },
    [currentBranch, loadDetail, reload],
  );
  useDataEvent("order.changed", refreshForScopedEvent);
  useDataEvent("picking.changed", refreshForScopedEvent);
  useDataEvent("packing.changed", refreshForScopedEvent);
  useDataEvent("dispatch.changed", refreshForScopedEvent);

  useEffect(() => {
    if (!usesApi) return;
    const timer = window.setTimeout(
      () => setAppliedSearch(filters.search.trim()),
      LOGISTICS_HISTORY_SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [filters.search, usesApi]);

  const scopedItems = useMemo(
    () => (loadedBranchId === currentBranch?.id ? items : []),
    [currentBranch?.id, items, loadedBranchId],
  );
  // En modo API la página ya llega filtrada y paginada desde el backend.
  const visibleItems = useMemo(
    () => (usesApi ? scopedItems : filterLogisticsHistory(scopedItems, filters)),
    [filters, scopedItems, usesApi],
  );

  const updateFilters = useCallback((patch: Partial<LogisticsHistoryFilters>) => {
    setPage(1);
    setFilters((current) => ({ ...current, ...patch }));
  }, []);
  const resetFilters = useCallback(() => {
    setPage(1);
    setFilters(defaultLogisticsHistoryFilters);
    setAppliedSearch(defaultLogisticsHistoryFilters.search);
  }, []);
  const goToPage = useCallback((nextPage: number) => setPage(Math.max(1, nextPage)), []);
  const changePageSize = useCallback((nextPageSize: number) => {
    setPage(1);
    setPageSize(nextPageSize);
  }, []);

  return {
    items: visibleItems,
    totalItems: usesApi ? serverTotals.totalItems : scopedItems.length,
    pagination: {
      mode: usesApi ? ("server" as const) : ("client" as const),
      page,
      pageSize,
      totalItems: usesApi ? serverTotals.totalItems : visibleItems.length,
      totalPages: usesApi
        ? serverTotals.totalPages
        : Math.max(1, Math.ceil(visibleItems.length / pageSize)),
    },
    setPage: goToPage,
    setPageSize: changePageSize,
    filters,
    loading: contextLoading || loading,
    error,
    detail,
    detailOpen: detailOrderId !== null,
    detailLoading,
    detailError,
    dispatchDetail,
    dispatchOpen: dispatchOrderId !== null,
    dispatchLoading,
    dispatchSubmitting,
    dispatchError,
    hasBranchAccess,
    canRead,
    canConfirmDispatch,
    currentBranchName: currentBranch?.name ?? "Sin sucursal",
    updateFilters,
    resetFilters,
    reload,
    openDetail,
    closeDetail,
    openDispatch,
    closeDispatch,
    confirmDispatch,
  };
}

export function filterLogisticsHistory(
  items: LogisticsHistoryItemDto[],
  filters: LogisticsHistoryFilters,
) {
  const search = filters.search.trim().toLocaleLowerCase("es");
  const from = toDateBoundary(filters.from, false);
  const to = toDateBoundary(filters.to, true);

  return items.filter((item) => {
    const activityAt = getHistoryActivityAt(item);
    const activityTime = activityAt ? new Date(activityAt).getTime() : null;
    const matchesSearch =
      !search ||
      [item.orderReference, item.contactName]
        .some((value) => value.toLocaleLowerCase("es").includes(search));
    const matchesStatus = filters.status === "all" || item.operationalStatus === filters.status;
    const matchesDelivery =
      filters.deliveryMethod === "all" || item.deliveryMethod === filters.deliveryMethod;
    const matchesFrom = from === null || (activityTime !== null && activityTime >= from);
    const matchesTo = to === null || (activityTime !== null && activityTime <= to);
    return matchesSearch && matchesStatus && matchesDelivery && matchesFrom && matchesTo;
  });
}

export function getHistoryActivityAt(item: LogisticsHistoryItemDto) {
  return (
    item.deliveredAt ??
    item.dispatchedAt ??
    item.packingFinalizedAt ??
    item.pickingCompletedAt
  );
}

function toDateBoundary(value: string, endOfDay: boolean) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
