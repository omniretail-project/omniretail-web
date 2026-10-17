import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { InventoryMovementDisplayType } from "@/core/repositories";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import {
  API_MOVEMENT_DISPLAY_TYPES,
  type InventoryMovementKpis,
  type InventoryMovementRow,
  type InventoryMovementsData,
  type MovementPeriodFilter,
  type MovementTypeFilter,
} from "@/modules/inventory/application/dto/InventoryMovementsDto";
import {
  GetInventoryMovementsService,
  type GetInventoryMovementsParams,
} from "@/modules/inventory/application/services/GetInventoryMovementsService";

const EMPTY_KPIS: InventoryMovementKpis = { incoming: 0, outgoing: 0, net: 0 };
const EMPTY_DATA: InventoryMovementsData = {
  rows: [],
  branches: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 0,
  summary: EMPTY_KPIS,
};
const SEARCH_DEBOUNCE_MS = 350;
const DEFAULT_SORT = "createdAt,desc" as const;

export const MOVEMENT_PERIOD_OPTIONS: Array<{ value: MovementPeriodFilter; label: string }> = [
  { value: "7d", label: "Ultimos 7 dias" },
  { value: "30d", label: "Ultimos 30 dias" },
  { value: "90d", label: "Ultimos 90 dias" },
  { value: "all", label: "Todos" },
];

export function useInventoryMovements() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Contrato canonico: /inventario/movimientos?productId=<uuid>&branchId=<uuid>. La URL es la fuente
  // de verdad de ambos filtros (copiable, refresh, nueva pestana, Back/Forward).
  const productId = searchParams.get("productId") ?? "";
  const branchId = searchParams.get("branchId") || "all";
  const repositories = useRepositories();
  const { currentBranch, branches: activeBranches, loading: branchLoading } = useActiveBranch();
  const activeBranchId = currentBranch?.id;
  const apiMode = repositories.inventoryMovementsDataSource === "api";
  const mockActiveBranchId = apiMode ? undefined : activeBranchId;
  const service = useMemo(() => new GetInventoryMovementsService(repositories), [repositories]);
  const requestIdRef = useRef(0);
  const [data, setData] = useState<InventoryMovementsData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearchState] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [period, setPeriodState] = useState<MovementPeriodFilter>("30d");
  const [type, setTypeState] = useState<MovementTypeFilter>("all");
  // El panel de filtros abre de inicio si la URL ya trae un filtro de producto o sucursal.
  const [filtersOpen, setFiltersOpenState] = useState(
    () => Boolean(searchParams.get("productId") || searchParams.get("branchId")),
  );
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(20);
  // Un cambio de filtros desde la URL (SPA, Back/Forward) reinicia la pagina y muestra "cargando".
  const urlFiltersKey = `${productId}|${branchId}`;
  const [previousUrlFiltersKey, setPreviousUrlFiltersKey] = useState(urlFiltersKey);
  if (previousUrlFiltersKey !== urlFiltersKey) {
    setPreviousUrlFiltersKey(urlFiltersKey);
    setPageState(1);
    setLoading(true);
    setError(null);
  }

  const mockRequestParams = useMemo<GetInventoryMovementsParams>(
    () => ({
      activeBranchId: mockActiveBranchId,
      page: 1,
      pageSize: 100,
      sort: DEFAULT_SORT,
    }),
    [mockActiveBranchId],
  );
  const apiRequestParams = useMemo<GetInventoryMovementsParams>(() => {
    const range = getPeriodRange(period);
    return {
      branchId: branchId === "all" ? undefined : branchId,
      productId: productId || undefined,
      displayType: getApiDisplayType(type),
      from: range.from,
      to: range.to,
      search: requestSearch.trim() || undefined,
      page,
      pageSize,
      sort: DEFAULT_SORT,
    };
  }, [branchId, page, pageSize, period, productId, requestSearch, type]);
  const requestParams = apiMode ? apiRequestParams : mockRequestParams;

  const applyRequest = useCallback(
    (params: GetInventoryMovementsParams) => {
      const requestId = ++requestIdRef.current;
      return service
        .execute(params)
        .then((nextData) => {
          if (requestId !== requestIdRef.current) return;
          if (apiMode && nextData.totalPages > 0 && nextData.page > nextData.totalPages) {
            setPageState(nextData.totalPages);
            return;
          }
          setData(nextData);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setError("No se pudo cargar el historial de movimientos.");
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    },
    [apiMode, service],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    await applyRequest(requestParams);
  }, [applyRequest, requestParams]);

  useEffect(() => {
    void applyRequest(requestParams);
    return () => {
      requestIdRef.current += 1;
    };
  }, [applyRequest, requestParams]);

  useEffect(() => {
    if (!apiMode) return;
    const timeoutId = window.setTimeout(() => {
      setPageState(1);
      setRequestSearch(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [apiMode, search]);

  useDataEvent("inventory.changed", reload);
  useDataEvent("stock.changed", reload);
  useDataEvent("product.changed", reload);
  useDataEvent("branch.changed", reload);
  useDataEvent("inventory-transfer.changed", reload);

  // El nombre/SKU del filtro de producto se resuelven desde las filas cargadas (no viajan en la URL).
  const productRow = productId ? data.rows.find((row) => row.productId === productId) : undefined;

  const filteredRows = useMemo(
    () =>
      apiMode ? data.rows : filterRows(data.rows, { search, period, type, branchId, productId }),
    [apiMode, branchId, data.rows, period, productId, search, type],
  );
  const localKpis = useMemo(() => getMovementKpis(filteredRows), [filteredRows]);
  const kpis = apiMode ? data.summary : localKpis;
  const totalItems = apiMode ? data.totalItems : filteredRows.length;
  const totalPages = apiMode
    ? Math.max(1, data.totalPages)
    : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = apiMode ? page : Math.min(page, totalPages);
  const paginatedRows = apiMode
    ? data.rows
    : filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const displayData = useMemo<InventoryMovementsData>(
    () => ({
      ...data,
      branches: apiMode
        ? activeBranches
            .map((branch) => ({ id: branch.id, name: branch.name }))
            .sort((left, right) => left.name.localeCompare(right.name))
        : data.branches,
    }),
    [activeBranches, apiMode, data],
  );

  const startApiRequest = useCallback(() => {
    if (!apiMode) return;
    requestIdRef.current += 1;
    setLoading(true);
    setError(null);
  }, [apiMode]);
  const resetPage = useCallback(() => setPageState(1), []);
  const setPage = useCallback(
    (value: number) => {
      startApiRequest();
      setPageState(value);
    },
    [startApiRequest],
  );
  const setSearch = useCallback(
    (value: string) => {
      setSearchState(value);
      if (!apiMode) resetPage();
      startApiRequest();
    },
    [apiMode, resetPage, startApiRequest],
  );
  const setPeriod = useCallback(
    (value: MovementPeriodFilter) => {
      setPeriodState(value);
      resetPage();
      startApiRequest();
    },
    [resetPage, startApiRequest],
  );
  const setType = useCallback(
    (value: MovementTypeFilter) => {
      setTypeState(value);
      resetPage();
      startApiRequest();
    },
    [resetPage, startApiRequest],
  );
  // productId/branchId viven en la URL: el setter solo la actualiza (preservando otros parametros)
  // y el filtro se deriva de ella; limpiar un filtro elimina unicamente su parametro.
  const setUrlFilter = useCallback(
    (name: "productId" | "branchId", value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") params.set(name, value);
      else params.delete(name);
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const setBranchId = useCallback((value: string) => setUrlFilter("branchId", value), [setUrlFilter]);
  const setProductId = useCallback(
    (value: string) => setUrlFilter("productId", value),
    [setUrlFilter],
  );
  const setPageSize = useCallback(
    (value: number) => {
      setPageSizeState(value);
      resetPage();
      startApiRequest();
    },
    [resetPage, startApiRequest],
  );
  const setFiltersOpen = useCallback(
    (value: boolean | ((current: boolean) => boolean)) => {
      setFiltersOpenState(value);
      resetPage();
    },
    [resetPage],
  );

  const loadExportData = useCallback(async () => {
    if (!apiMode) return { rows: filteredRows, kpis: localKpis };
    const range = getPeriodRange(period);
    const exportData = await service.exportAll({
      branchId: branchId === "all" ? undefined : branchId,
      productId: productId || undefined,
      displayType: getApiDisplayType(type),
      from: range.from,
      to: range.to,
      search: search.trim() || undefined,
      page: 1,
      pageSize: 100,
      sort: DEFAULT_SORT,
    });
    return { rows: exportData.rows, kpis: exportData.summary };
  }, [apiMode, branchId, filteredRows, localKpis, period, productId, search, service, type]);

  return {
    data: displayData,
    rows: filteredRows,
    paginatedRows,
    kpis,
    loading: branchLoading || loading,
    error,
    apiMode,
    search,
    period,
    type,
    branchId,
    productId,
    productName: productRow?.productName ?? "",
    productSku: productRow?.sku ?? "",
    filtersOpen,
    page: currentPage,
    pageSize,
    totalItems,
    totalPages,
    loadExportData,
    setSearch,
    setPeriod,
    setType,
    setBranchId,
    setProductId,
    setFiltersOpen,
    setPage,
    setPageSize,
  };
}

function getApiDisplayType(type: MovementTypeFilter): InventoryMovementDisplayType | undefined {
  if (type === "all") return undefined;
  return API_MOVEMENT_DISPLAY_TYPES.find((candidate) => candidate === type);
}

function getPeriodRange(period: MovementPeriodFilter) {
  if (period === "all") return { from: undefined, to: undefined };
  const now = Date.now();
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return {
    from: new Date(now - days * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(now).toISOString(),
  };
}

function filterRows(
  rows: InventoryMovementRow[],
  filters: {
    search: string;
    period: MovementPeriodFilter;
    type: MovementTypeFilter;
    branchId: string;
    productId: string;
  },
) {
  const query = filters.search.trim().toLowerCase();
  const threshold = getPeriodThreshold(filters.period);
  return rows.filter((row) => {
    const createdAt = new Date(row.createdAt).getTime();
    const matchesPeriod = !threshold || createdAt >= threshold;
    const matchesType = filters.type === "all" || row.displayType === filters.type;
    const matchesBranch = filters.branchId === "all" || row.branchId === filters.branchId;
    const matchesProduct = !filters.productId || row.productId === filters.productId;
    const matchesSearch =
      !query ||
      [
        row.productName,
        row.sku,
        row.referenceLabel,
        row.userLabel,
        row.branchName,
        row.locationLabel,
        row.reason,
        row.typeLabel,
        row.adjustmentDetail?.number,
        row.adjustmentDetail?.notes,
        row.transferDetail?.number,
      ].some((value) => (value ?? "").toLowerCase().includes(query));
    return matchesPeriod && matchesType && matchesBranch && matchesProduct && matchesSearch;
  });
}

function getMovementKpis(rows: InventoryMovementRow[]): InventoryMovementKpis {
  const incoming = rows
    .filter((row) => row.signedQuantity > 0)
    .reduce((total, row) => total + row.signedQuantity, 0);
  const outgoing = rows
    .filter((row) => row.signedQuantity < 0)
    .reduce((total, row) => total + Math.abs(row.signedQuantity), 0);
  return { incoming, outgoing, net: incoming - outgoing };
}

function getPeriodThreshold(period: MovementPeriodFilter) {
  if (period === "all") return null;
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return Date.now() - days * 24 * 60 * 60 * 1000;
}
