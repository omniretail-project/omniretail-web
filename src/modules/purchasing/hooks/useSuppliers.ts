"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SupplierStatus } from "@/core/enums";
import type {
  SupplierListItemReadModel,
  SupplierPurchaseOrderReadModel,
  SupplierStatusFilter,
} from "@/modules/purchasing/application/dto/SupplierReadModel";
import { GetSuppliersReadModelService } from "@/modules/purchasing/application/services/GetSuppliersReadModelService";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import type {
  OperationalSupplierIncidentPageParams,
  OperationalSupplierProductPageParams,
} from "@/core/repositories";
import type { TablePageSize } from "@/shared/components/TablePagination";

interface SupplierFilters {
  search: string;
  status: SupplierStatusFilter;
}

const DEFAULT_FILTERS: SupplierFilters = {
  search: "",
  status: "active",
};
const SEARCH_DEBOUNCE_MS = 350;
const DEFAULT_PAGE_SIZE: TablePageSize = 10;

export function useSuppliers() {
  const repositories = useRepositories();
  const apiMode = repositories.purchaseOrdersDataSource === "api";
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const activeBranchId = currentBranch?.id;
  const tenantId = currentBranch?.tenantId;
  const service = useMemo(() => new GetSuppliersReadModelService(repositories), [repositories]);
  const requestIdRef = useRef(0);
  const [suppliers, setSuppliers] = useState<SupplierListItemReadModel[]>([]);
  const [filters, setFilters] = useState<SupplierFilters>(DEFAULT_FILTERS);
  const [requestSearch, setRequestSearch] = useState("");
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState<TablePageSize>(DEFAULT_PAGE_SIZE);
  const [apiPage, setApiPage] = useState({ totalItems: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadMock = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await service.execute(activeBranchId, tenantId);
      setSuppliers(data.suppliers);
    } catch {
      setError("No se pudieron cargar los proveedores.");
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, service, tenantId]);

  const apiStatus = filters.status === "archived" ? SupplierStatus.archived : SupplierStatus.active;
  const reloadApi = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      // page es base 1 de punta a punta: la UI nunca convierte a base 0.
      const result = await service.executeApiPage({
        status: apiStatus,
        search: requestSearch || undefined,
        page,
        pageSize,
      });
      if (requestId !== requestIdRef.current) return;
      setSuppliers(result.items);
      setApiPage({ totalItems: result.totalItems, totalPages: result.totalPages });
    } catch {
      if (requestId === requestIdRef.current) {
        setError("No se pudieron cargar los proveedores.");
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [apiStatus, page, pageSize, requestSearch, service]);

  const reload = apiMode ? reloadApi : reloadMock;

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

  // Busqueda server-side con debounce; al cambiar search vuelve a la pagina 1.
  useEffect(() => {
    if (!apiMode) return;
    const timeoutId = window.setTimeout(() => {
      setRequestSearch(filters.search.trim());
      setPageState(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [apiMode, filters.search]);

  useDataEvent("supplier.changed", reload);
  useDataEvent("supplier-product.changed", reload);
  useDataEvent("purchase-order.changed", reload);
  useDataEvent("receipt.changed", reload);
  useDataEvent("product.changed", reload);

  const filteredSuppliers = useMemo(
    () => (apiMode ? suppliers : filterSuppliers(suppliers, filters)),
    [apiMode, filters, suppliers],
  );

  // Mock pagina en cliente; API usa exactamente lo que devuelve el backend.
  const totalItems = apiMode ? apiPage.totalItems : filteredSuppliers.length;
  const totalPages = apiMode ? Math.max(1, apiPage.totalPages) : Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = useMemo(
    () =>
      apiMode
        ? suppliers
        : filteredSuppliers.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [apiMode, currentPage, filteredSuppliers, pageSize, suppliers],
  );

  const updateFilters = useCallback((patch: Partial<SupplierFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    if (patch.status !== undefined || (!apiMode && patch.search !== undefined)) setPageState(1);
  }, [apiMode]);

  const setPage = useCallback(
    (value: number) => setPageState(Math.max(1, value)),
    [],
  );
  const setPageSize = useCallback((value: TablePageSize) => {
    setPageSizeState(value);
    setPageState(1);
  }, []);

  const loadSupplierDetail = useCallback(
    (supplierId: string) => service.getApiDetail(supplierId),
    [service],
  );
  const loadSupplierOrders = useCallback(
    (supplierId: string): Promise<SupplierPurchaseOrderReadModel[]> =>
      service.getApiPurchaseOrders(supplierId, activeBranchId),
    [activeBranchId, service],
  );

  const loadSupplierProducts = useCallback(
    (supplierId: string, params: OperationalSupplierProductPageParams) =>
      service.getApiProducts(supplierId, params),
    [service],
  );
  // Incidencias de la sucursal activa, coherente con las ordenes de la pestana Compras.
  const loadSupplierIncidents = useCallback(
    (supplierId: string, params: Omit<OperationalSupplierIncidentPageParams, "branchId">) =>
      service.getApiIncidents(supplierId, { ...params, ...(activeBranchId ? { branchId: activeBranchId } : {}) }),
    [activeBranchId, service],
  );

  return {
    apiMode,
    rows,
    hasSuppliers: apiMode ? totalItems > 0 || Boolean(requestSearch) : suppliers.length > 0,
    filters,
    page: currentPage,
    pageSize,
    totalItems,
    totalPages,
    loading: branchLoading || loading,
    error,
    updateFilters,
    setPage,
    setPageSize,
    loadSupplierDetail,
    loadSupplierOrders,
    loadSupplierProducts,
    loadSupplierIncidents,
  };
}

function filterSuppliers(suppliers: SupplierListItemReadModel[], filters: SupplierFilters) {
  const search = normalize(filters.search);
  return suppliers.filter((supplier) => {
    const matchesStatus = filters.status === "archived" ? supplier.archived : !supplier.archived;
    const matchesSearch = !search || supplier.searchText.includes(search);
    return matchesStatus && matchesSearch;
  });
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
