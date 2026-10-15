"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ReceivingDocumentsService } from "@/modules/receiving/application/services/ReceivingDocumentsService";
import type {
  ReceivingIncidentRow,
  ReceivingDocumentRow,
  ReceivingReadModel,
  ReceivingStatus,
  ReceivingTab,
} from "@/modules/receiving/application/dto/ReceivingDocumentsDto";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";

interface ReceivingFilters {
  search: string;
  status: ReceivingStatus | "all";
  tab: ReceivingTab;
}

const DEFAULT_FILTERS: ReceivingFilters = {
  search: "",
  status: "all",
  tab: "orders",
};

const EMPTY_DATA: ReceivingReadModel = {
  documents: [],
  incidents: [],
  incidentTypes: [],
};

export function useReceivingDocuments() {
  const repositories = useRepositories();
  const { sessionId, user } = useCurrentSession();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const activeBranchId = currentBranch?.id;
  const contextKey = `${sessionId ?? ""}:${user?.id ?? ""}:${user?.tenantId ?? ""}:${activeBranchId ?? ""}`;
  const service = useMemo(() => new ReceivingDocumentsService(repositories), [repositories]);
  const [data, setData] = useState<ReceivingReadModel>(EMPTY_DATA);
  const [filters, setFilters] = useState<ReceivingFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [incrementalError, setIncrementalError] = useState<string | null>(null);
  const [renderedContextKey, setRenderedContextKey] = useState(contextKey);
  const requestIdRef = useRef(0);
  const loadedBranchIdRef = useRef<string | undefined>(undefined);
  const contextKeyRef = useRef(contextKey);
  const loadMoreRequestIdRef = useRef<number | null>(null);

  if (renderedContextKey !== contextKey) {
    setRenderedContextKey(contextKey);
    setData(EMPTY_DATA);
    setLoadingMore(false);
    setIncrementalError(null);
    setError(null);
    setLoading(true);
  }

  useLayoutEffect(() => {
    contextKeyRef.current = contextKey;
    requestIdRef.current += 1;
    loadedBranchIdRef.current = activeBranchId;
    loadMoreRequestIdRef.current = null;
  }, [activeBranchId, contextKey]);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const requestedContextKey = contextKey;
    loadedBranchIdRef.current = activeBranchId;
    loadMoreRequestIdRef.current = null;
    setData(EMPTY_DATA);
    setIncrementalError(null);
    setLoadingMore(false);
    setLoading(true);
    setError(null);
    try {
      const nextData = await service.execute(activeBranchId);
      if (
        requestId !== requestIdRef.current ||
        requestedContextKey !== contextKeyRef.current ||
        loadedBranchIdRef.current !== activeBranchId
      ) {
        return;
      }
      setData(nextData);
    } catch {
      if (
        requestId !== requestIdRef.current ||
        requestedContextKey !== contextKeyRef.current ||
        loadedBranchIdRef.current !== activeBranchId
      ) {
        return;
      }
      setError("No se pudieron cargar las recepciones.");
    } finally {
      if (requestId === requestIdRef.current && requestedContextKey === contextKeyRef.current) {
        setLoading(false);
      }
    }
  }, [activeBranchId, contextKey, service]);

  const loadMore = useCallback(async () => {
    const pagination = data.pagination;
    if (
      !activeBranchId ||
      !pagination?.hasMore ||
      loadMoreRequestIdRef.current !== null
    ) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const requestedContextKey = contextKey;
    loadMoreRequestIdRef.current = requestId;
    setLoadingMore(true);
    setIncrementalError(null);
    try {
      const nextData = await service.loadMore(activeBranchId, pagination);
      if (
        requestId !== requestIdRef.current ||
        requestedContextKey !== contextKeyRef.current ||
        loadedBranchIdRef.current !== activeBranchId
      ) {
        return;
      }
      setData((current) => mergeReceivingReadModels(current, nextData));
    } catch {
      if (
        requestId !== requestIdRef.current ||
        requestedContextKey !== contextKeyRef.current ||
        loadedBranchIdRef.current !== activeBranchId
      ) {
        return;
      }
      setIncrementalError(
        "No se pudieron cargar más recepciones. Intenta nuevamente.",
      );
    } finally {
      if (loadMoreRequestIdRef.current === requestId) {
        loadMoreRequestIdRef.current = null;
      }
      if (requestId === requestIdRef.current && requestedContextKey === contextKeyRef.current) {
        setLoadingMore(false);
      }
    }
  }, [activeBranchId, contextKey, data.pagination, service]);

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

  useDataEvent("purchase-order.changed", reload);
  useDataEvent("inventory-transfer.changed", reload);
  useDataEvent("receipt.changed", reload);
  useDataEvent("incident-type.changed", reload);
  useDataEvent("supplier.changed", reload);
  useDataEvent("product.changed", reload);

  const filteredDocuments = useMemo(() => {
    const search = normalize(filters.search);
    return data.documents.filter((document) => {
      const matchesSearch = !search || document.searchText.includes(search);
      const matchesStatus = filters.status === "all" || document.status === filters.status;
      return matchesSearch && matchesStatus;
    });
  }, [data.documents, filters.search, filters.status]);

  const updateFilters = useCallback((patch: Partial<ReceivingFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  const createIncidentType = useCallback(
    async (name: string) => {
      await service.createIncidentType(name);
      await reload();
    },
    [reload, service],
  );

  const archiveIncidentType = useCallback(
    async (id: string) => {
      await service.archiveIncidentType(id);
      await reload();
    },
    [reload, service],
  );

  const deleteIncidentType = useCallback(
    async (id: string) => {
      await service.deleteIncidentType(id);
      await reload();
    },
    [reload, service],
  );

  return {
    data,
    filters,
    filteredDocuments,
    currentBranch,
    loading: branchLoading || loading,
    loadingMore,
    error,
    incrementalError,
    hasMore: data.pagination?.hasMore ?? false,
    receiptHistoryIncomplete: data.pagination?.receiptHistoryIncomplete ?? false,
    incidentManagementAvailable: repositories.receivingDataSource !== "api",
    updateFilters,
    createIncidentType,
    archiveIncidentType,
    deleteIncidentType,
    loadMore,
    reload,
  };
}

export function mergeReceivingReadModels(
  current: ReceivingReadModel,
  next: ReceivingReadModel,
): ReceivingReadModel {
  if (shouldReplaceReceivingBranch(current.pagination?.branchId, next.pagination?.branchId)) {
    return next;
  }

  return {
    ...current,
    documents: mergeReceivingDocuments(current.documents, next.documents),
    incidents: mergeReceivingIncidents(current.incidents, next.incidents),
    incidentListIncomplete:
      Boolean(current.incidentListIncomplete) || Boolean(next.incidentListIncomplete),
    pagination: next.pagination ?? current.pagination,
  };
}

function mergeReceivingIncidents(
  current: ReceivingIncidentRow[],
  next: ReceivingIncidentRow[],
): ReceivingIncidentRow[] {
  const incidentsById = new Map(current.map((incident) => [incident.id, incident]));
  next.forEach((incident) => {
    const stored = incidentsById.get(incident.id);
    if (!stored || incident.date >= stored.date) incidentsById.set(incident.id, incident);
  });
  return [...incidentsById.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function mergeReceivingDocuments(
  current: ReceivingDocumentRow[],
  next: ReceivingDocumentRow[],
): ReceivingDocumentRow[] {
  const documentsById = new Map<string, ReceivingDocumentRow>();
  for (const document of current) {
    documentsById.set(document.documentId, document);
  }
  for (const document of next) {
    const stored = documentsById.get(document.documentId);
    if (!stored || document.lastUpdatedAt >= stored.lastUpdatedAt) {
      documentsById.set(document.documentId, document);
    }
  }
  return [...documentsById.values()].sort((left, right) =>
    right.lastUpdatedAt.localeCompare(left.lastUpdatedAt),
  );
}

export function shouldReplaceReceivingBranch(
  currentBranchId: string | undefined,
  nextBranchId: string | undefined,
): boolean {
  return Boolean(
    currentBranchId && nextBranchId && currentBranchId !== nextBranchId,
  );
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
