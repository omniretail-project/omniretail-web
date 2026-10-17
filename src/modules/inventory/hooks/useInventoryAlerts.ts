"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LocationStatus, SaasCapabilityKey } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { createReloadCoalescer } from "@/shared/utils/reloadCoalescer";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import type {
  AdjustStockDto,
  InventoryAlertsData,
  InventoryKpis,
  InventoryProductRow,
  InventoryStatus,
  TransferRequestDto,
} from "@/modules/inventory/application/dto/InventoryAlertsDto";
import {
  GetInventoryAlertsService,
  isExpiringSoon,
  type GetInventoryAlertsParams,
} from "@/modules/inventory/application/services/GetInventoryAlertsService";
import {
  InventoryAdjustmentLookupService,
  RegisterInventoryAdjustmentService,
} from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import {
  ApproveTransferRequestService,
  CancelTransferRequestService,
  CreateTransferRequestService,
  RejectTransferRequestService,
} from "@/modules/inventory/application/services/TransferRequestServices";
import { GetInventoryKitAvailabilityService } from "@/modules/inventory/application/services/GetInventoryKitAvailabilityService";
import { InventoryOtherBranchesService } from "@/modules/inventory/application/services/InventoryOtherBranchesService";
import { InventoryCountService } from "@/modules/inventory/application/services/InventoryCountService";
import { downloadInventoryCountPdf } from "@/modules/inventory/application/services/InventoryCountPdfService";
import type { ReconcileCountInput } from "@/core/repositories";
import { CancelInventoryTransferService } from "@/modules/inventory/application/services/InventoryTransferServices";
import {
  INVENTORY_ADJUSTMENT_CREATE_PERMISSION,
  INVENTORY_TRANSFERS_MANAGE_PERMISSION,
  cleanInventoryError,
} from "@/modules/inventory/application/services/serviceHelpers";

/** `low_stock` es un agregado de UI (near_minimum + critical); a la API viaja como lowStock=true. */
export type InventoryStatusFilter = InventoryStatus | "low_stock" | "all";
export type InventoryKpiFilter = "all" | "active" | "lowStock" | "expiringSoon" | "outOfStock";

const EMPTY_KPIS: InventoryKpis = {
  activeProducts: 0,
  lowStock: 0,
  expiringSoon: 0,
  outOfStock: 0,
};
const EMPTY_DATA: InventoryAlertsData = {
  supportsMultipleLocations: true,
  rows: [],
  alerts: [],
  alertTotalItems: 0,
  transferRequests: [],
  kpis: EMPTY_KPIS,
  visibility: {
    supportsExpiration: false,
    hasExpirationProducts: false,
    showExpirationFeatures: false,
  },
  branches: [],
  categories: [],
  locations: [],
  page: 1,
  pageSize: 20,
  totalItems: 0,
  totalPages: 0,
};
const SEARCH_DEBOUNCE_MS = 350;
const DEFAULT_SORT = "productName,asc" as const;

export function useInventoryAlerts() {
  const repositories = useRepositories();
  const { hasPermission, loading: sessionLoading } = useCurrentSession();
  const { hasCapability } = useEntitlement();
  const { currentBranch, branches: headerBranches, loading: branchLoading } = useActiveBranch();
  const apiMode = repositories.inventoryStockDataSource === "api";
  const getService = useMemo(() => new GetInventoryAlertsService(repositories), [repositories]);
  const adjustmentService = useMemo(
    () => new RegisterInventoryAdjustmentService(repositories),
    [repositories],
  );
  // Lookups bajo demanda del modal de ajuste; solo existen en modo API (sin N+1 en el listado).
  const adjustmentLookup = useMemo(
    () => (apiMode ? new InventoryAdjustmentLookupService(repositories) : null),
    [apiMode, repositories],
  );
  const kitAvailabilityService = useMemo(
    () => (apiMode ? new GetInventoryKitAvailabilityService(repositories) : null),
    [apiMode, repositories],
  );
  const otherBranchesService = useMemo(
    () => (apiMode ? new InventoryOtherBranchesService(repositories) : null),
    [apiMode, repositories],
  );
  const countService = useMemo(
    () => (apiMode ? new InventoryCountService(repositories) : null),
    [apiMode, repositories],
  );
  const transferServices = useMemo(
    () => ({
      create: new CreateTransferRequestService(repositories),
      approve: new ApproveTransferRequestService(repositories),
      cancel: new CancelTransferRequestService(repositories),
      reject: new RejectTransferRequestService(repositories),
    }),
    [repositories],
  );
  const cancelInventoryTransferService = useMemo(
    () => new CancelInventoryTransferService(repositories),
    [repositories],
  );
  const requestIdRef = useRef(0);
  const alertRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const alertsLoadedBranchIdRef = useRef("");
  const transferMutationPendingRef = useRef(false);
  const [data, setData] = useState<InventoryAlertsData>(EMPTY_DATA);
  const [detailRow, setDetailRow] = useState<InventoryProductRow | null>(null);
  const [branchId, setBranchIdState] = useState("");
  const currentBranchId = currentBranch?.id ?? "";
  const [previousCurrentBranchId, setPreviousCurrentBranchId] = useState(currentBranchId);
  if (previousCurrentBranchId !== currentBranchId) {
    setPreviousCurrentBranchId(currentBranchId);
    setBranchIdState("");
  }
  const [search, setSearchState] = useState("");
  const [requestSearch, setRequestSearch] = useState("");
  const [categoryId, setCategoryIdState] = useState("all");
  const [status, setStatusState] = useState<InventoryStatusFilter>("all");
  const [kpiFilter, setKpiFilterState] = useState<InventoryKpiFilter>("all");
  const [filtersOpen, setFiltersOpenState] = useState(false);
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(20);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [loadedBranchId, setLoadedBranchId] = useState("");
  const effectiveBranchId =
    previousCurrentBranchId === currentBranchId ? branchId || currentBranchId : currentBranchId;
  const effectiveBranchIdRef = useRef(effectiveBranchId);
  useLayoutEffect(() => {
    effectiveBranchIdRef.current = effectiveBranchId;
  }, [effectiveBranchId]);
  const effectiveBranchName =
    headerBranches.find((branch) => branch.id === effectiveBranchId)?.name ??
    currentBranch?.name ??
    "Sucursal";
  const canAdjustStock =
    hasPermission(INVENTORY_ADJUSTMENT_CREATE_PERMISSION) &&
    hasCapability(SaasCapabilityKey.inventory);
  const canManageTransfers =
    hasPermission(INVENTORY_TRANSFERS_MANAGE_PERMISSION) &&
    hasCapability(SaasCapabilityKey.inventory) &&
    (!apiMode || (Boolean(effectiveBranchId) && effectiveBranchId === currentBranchId));

  const apiRequestParams = useMemo<GetInventoryAlertsParams>(
    () => ({
      branchId: effectiveBranchId,
      branchName: effectiveBranchName,
      search: requestSearch.trim() || undefined,
      categoryId: categoryId === "all" ? undefined : categoryId,
      status: status === "all" ? undefined : status,
      page,
      pageSize,
      sort: DEFAULT_SORT,
    }),
    [categoryId, effectiveBranchId, effectiveBranchName, page, pageSize, requestSearch, status],
  );
  const requestInput: string | GetInventoryAlertsParams = apiMode
    ? apiRequestParams
    : effectiveBranchId;

  const applyRequest = useCallback(
    (input: string | GetInventoryAlertsParams, requestedBranchId: string) => {
      const requestId = ++requestIdRef.current;
      return getService
        .execute(input)
        .then((nextData) => {
          if (requestId !== requestIdRef.current) return;
          if (apiMode && nextData.totalPages > 0 && nextData.page > nextData.totalPages) {
            setPageState(nextData.totalPages);
            return;
          }
          setData((current) => ({
            ...nextData,
            alerts:
              apiMode && alertsLoadedBranchIdRef.current === requestedBranchId
                ? current.alerts
                : nextData.alerts,
            alertTotalItems:
              apiMode && alertsLoadedBranchIdRef.current === requestedBranchId
                ? current.alertTotalItems
                : nextData.alertTotalItems,
          }));
          setLoadedBranchId(requestedBranchId);
          setLastUpdatedAt(new Date());
          setError(null);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setError("No se pudo cargar el inventario.");
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    },
    [apiMode, getService],
  );

  const reload = useCallback(async () => {
    if (!effectiveBranchId || branchLoading || sessionLoading) return;
    setLoading(true);
    setError(null);
    await applyRequest(requestInput, effectiveBranchId);
  }, [applyRequest, branchLoading, effectiveBranchId, requestInput, sessionLoading]);

  // Coalescing LOCAL, solo para el stock: inventory.changed + stock.changed + el reload explicito
  // de adjustStock/applyCount comparten una carga efectiva; una invalidacion durante el vuelo
  // genera UNA recarga trailing. Transfers, product/category/business-config conservan `reload`.
  // Un coalescer pertenece a un contexto (sucursal + filtros/pagina) y NO captura refs: la carga
  // vigente se enlaza desde un efecto y se retira al cambiar de contexto, asi un coalescer viejo
  // nunca ejecuta la carga del contexto nuevo.
  const reloadContextKey = `${effectiveBranchId}|${JSON.stringify(requestInput)}`;
  const reloadCoalescer = useMemo(
    () => createReloadCoalescer(null, reloadContextKey),
    [reloadContextKey],
  );
  useEffect(() => {
    reloadCoalescer.setLoader(reload);
    return () => reloadCoalescer.setLoader(null);
  }, [reload, reloadCoalescer]);
  const invalidateStockReload = useCallback(() => {
    void reloadCoalescer.invalidate();
  }, [reloadCoalescer]);

  useEffect(() => {
    if (!effectiveBranchId || branchLoading || sessionLoading) return;
    void applyRequest(requestInput, effectiveBranchId);
    return () => {
      requestIdRef.current += 1;
    };
  }, [applyRequest, branchLoading, effectiveBranchId, requestInput, sessionLoading]);

  useEffect(() => {
    alertRequestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    alertsLoadedBranchIdRef.current = "";
  }, [effectiveBranchId]);

  useEffect(() => {
    if (!apiMode) return;
    const timeoutId = window.setTimeout(() => {
      setPageState(1);
      setRequestSearch(search);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [apiMode, search]);

  useDataEvent("inventory.changed", invalidateStockReload);
  useDataEvent("stock.changed", invalidateStockReload);
  useDataEvent("inventory-transfer-request.changed", reload);
  useDataEvent("inventory-transfer.changed", reload);
  useDataEvent("product.changed", reload);
  useDataEvent("category.changed", reload);
  useDataEvent("business-config.changed", reload);

  const effectiveKpiFilter: InventoryKpiFilter =
    !data.visibility.showExpirationFeatures && kpiFilter === "expiringSoon"
      ? "all"
      : kpiFilter;
  const baseFilteredRows = useMemo(
    () =>
      apiMode ? data.rows : filterRows(data.rows, search, categoryId, status, "all"),
    [apiMode, categoryId, data.rows, search, status],
  );
  const filteredRows = useMemo(
    () =>
      apiMode
        ? data.rows
        : filterRows(baseFilteredRows, "", "all", "all", effectiveKpiFilter),
    [apiMode, baseFilteredRows, data.rows, effectiveKpiFilter],
  );
  const localKpis = useMemo(
    () => ({
      activeProducts: baseFilteredRows.length,
      lowStock: baseFilteredRows.filter(
        (row) => row.status === "critical" || row.status === "near_minimum",
      ).length,
      expiringSoon: data.visibility.showExpirationFeatures
        ? baseFilteredRows.filter(
            (row) => row.tracksExpiration && isExpiringSoon(row.nextExpirationDate),
          ).length
        : 0,
      outOfStock: baseFilteredRows.filter((row) => row.status === "out_of_stock").length,
    }),
    [baseFilteredRows, data.visibility.showExpirationFeatures],
  );
  const kpis = apiMode ? data.kpis : localKpis;
  const totalItems = apiMode ? data.totalItems : filteredRows.length;
  const totalPages = apiMode
    ? Math.max(1, data.totalPages)
    : Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = apiMode ? page : Math.min(page, totalPages);
  const paginatedRows = apiMode
    ? data.rows
    : filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const activeBranch =
    headerBranches.find((branch) => branch.id === effectiveBranchId) ??
    data.branches.find((branch) => branch.id === effectiveBranchId) ??
    currentBranch;
  const activeLocations = data.locations.filter(
    (location) => location.status === LocationStatus.active,
  );

  const startApiRequest = useCallback(() => {
    if (!apiMode) return;
    requestIdRef.current += 1;
    setLoading(true);
    setError(null);
  }, [apiMode]);
  const resetPage = useCallback(() => setPageState(1), []);
  const setBranchId = useCallback(
    (value: string) => {
      startApiRequest();
      alertRequestIdRef.current += 1;
      detailRequestIdRef.current += 1;
      alertsLoadedBranchIdRef.current = "";
      setBranchIdState(value);
      setDetailRow(null);
      setSearchState("");
      setRequestSearch("");
      setCategoryIdState("all");
      setStatusState("all");
      setKpiFilterState("all");
      resetPage();
    },
    [resetPage, startApiRequest],
  );
  const setSearch = useCallback(
    (value: string) => {
      setSearchState(value);
      if (!apiMode) resetPage();
      startApiRequest();
    },
    [apiMode, resetPage, startApiRequest],
  );
  const setCategoryId = useCallback(
    (value: string) => {
      setCategoryIdState(value);
      setKpiFilterState("all");
      resetPage();
      startApiRequest();
    },
    [resetPage, startApiRequest],
  );
  const setStatus = useCallback(
    (value: InventoryStatusFilter) => {
      setStatusState(value);
      setKpiFilterState(
        value === "out_of_stock" ? "outOfStock" : value === "low_stock" ? "lowStock" : "all",
      );
      resetPage();
      startApiRequest();
    },
    [resetPage, startApiRequest],
  );
  const setKpiFilter = useCallback(
    (value: InventoryKpiFilter) => {
      if (apiMode) {
        if (value === "expiringSoon") return;
        const nextStatus: InventoryStatusFilter =
          value === "outOfStock" ? "out_of_stock" : value === "lowStock" ? "low_stock" : "all";
        setKpiFilterState(value);
        setStatusState(nextStatus);
        resetPage();
        if (status !== nextStatus || page !== 1) startApiRequest();
        return;
      }
      setKpiFilterState(value);
      resetPage();
      if (value === "lowStock") setStatusState("low_stock");
      if (value === "outOfStock") setStatusState("out_of_stock");
      if (value === "active") setStatusState("all");
    },
    [apiMode, page, resetPage, startApiRequest, status],
  );
  const setPage = useCallback(
    (value: number) => {
      setPageState(value);
      startApiRequest();
    },
    [startApiRequest],
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
    (value: boolean | ((current: boolean) => boolean)) => setFiltersOpenState(value),
    [],
  );

  const loadAlerts = useCallback(async () => {
    if (!apiMode || !effectiveBranchId) return;
    if (alertsLoadedBranchIdRef.current === effectiveBranchId) return;
    const requestId = ++alertRequestIdRef.current;
    try {
      const alertPage = await getService.getApiAlerts({
        branchId: effectiveBranchId,
        branchName: effectiveBranchName,
      });
      if (requestId !== alertRequestIdRef.current) return;
      alertsLoadedBranchIdRef.current = effectiveBranchId;
      setData((current) => ({
        ...current,
        alerts: alertPage.items,
        alertTotalItems: alertPage.totalItems,
      }));
    } catch {
      if (requestId === alertRequestIdRef.current) {
        setError("No se pudieron cargar las alertas de inventario.");
      }
    }
  }, [apiMode, effectiveBranchId, effectiveBranchName, getService]);

  const loadProductRow = useCallback(
    async (productId: string) => {
      const existing =
        data.rows.find((row) => row.productId === productId) ??
        (detailRow?.productId === productId && detailRow.branchId === effectiveBranchId
          ? detailRow
          : undefined);
      if (existing || !apiMode || !effectiveBranchId) return existing ?? null;
      const requestId = ++detailRequestIdRef.current;
      try {
        const row = await getService.getApiProductRow({
          branchId: effectiveBranchId,
          branchName: effectiveBranchName,
          productId,
        });
        if (requestId !== detailRequestIdRef.current) return null;
        setDetailRow(row);
        return row;
      } catch {
        if (requestId === detailRequestIdRef.current) {
          setError("No se pudo cargar el detalle de inventario del producto.");
        }
        return null;
      }
    },
    [apiMode, data.rows, detailRow, effectiveBranchId, effectiveBranchName, getService],
  );

  async function adjustStock(dto: AdjustStockDto) {
    const versionBefore = reloadCoalescer.version();
    setBusy(true);
    setError(null);
    try {
      const result = await adjustmentService.execute(dto);
      await reloadCoalescer.reloadAfter(versionBefore);
      return result;
    } catch (caughtError) {
      const message = cleanInventoryError(caughtError, "No se pudo registrar el ajuste.");
      setError(message);
      throw caughtError;
    } finally {
      setBusy(false);
    }
  }

  // Conteo fisico trazable: una sola reconciliacion; el PDF solo se genera DESPUES del exito y
  // un fallo de PDF nunca invalida el conteo ya aplicado.
  async function applyCount(input: ReconcileCountInput) {
    if (!countService) throw new Error("El conteo fisico trazable requiere modo API.");
    const versionBefore = reloadCoalescer.version();
    setBusy(true);
    try {
      const result = await countService.reconcile(input);
      let pdfFailed = false;
      try {
        await downloadInventoryCountPdf(result);
      } catch {
        pdfFailed = true;
      }
      await reloadCoalescer.reloadAfter(versionBefore);
      return { result, pdfFailed };
    } finally {
      setBusy(false);
    }
  }

  async function requestTransfer(dto: TransferRequestDto) {
    const mutationBranchId = effectiveBranchIdRef.current;
    beginTransferMutation(mutationBranchId);
    setBusy(true);
    setError(null);
    try {
      if (
        !activeBranch ||
        (apiMode && mutationBranchId !== currentBranchId) ||
        dto.requesterBranchId !== mutationBranchId
      ) {
        throw new Error("La sucursal solicitante debe estar activa para crear la solicitud.");
      }
      await transferServices.create.execute(dto);
      await reloadMutationBranch(mutationBranchId);
    } catch (caughtError) {
      const message = cleanInventoryError(caughtError, "No se pudo crear la solicitud.");
      if (effectiveBranchIdRef.current === mutationBranchId) setError(message);
      throw new Error(message);
    } finally {
      transferMutationPendingRef.current = false;
      setBusy(false);
    }
  }

  async function cancelTransfer(transferId: string, reason: string, operationId: string) {
    const mutationBranchId = effectiveBranchIdRef.current;
    beginTransferMutation(mutationBranchId);
    setBusy(true);
    setError(null);
    try {
      const result = await cancelInventoryTransferService.execute(transferId, reason, operationId);
      await reloadMutationBranch(mutationBranchId);
      return result.transfer;
    } catch (caughtError) {
      const message = cleanInventoryError(caughtError, "No se pudo cancelar el traslado.");
      if (effectiveBranchIdRef.current === mutationBranchId) setError(message);
      throw new Error(message);
    } finally {
      transferMutationPendingRef.current = false;
      setBusy(false);
    }
  }

  async function approveTransferRequest(requestId: string) {
    const mutationBranchId = effectiveBranchIdRef.current;
    beginTransferMutation(mutationBranchId);
    setBusy(true);
    setError(null);
    try {
      const transfer = await transferServices.approve.execute(requestId);
      await reloadMutationBranch(mutationBranchId);
      return transfer;
    } catch (caughtError) {
      const message = cleanInventoryError(caughtError, "No se pudo aprobar la solicitud.");
      if (effectiveBranchIdRef.current === mutationBranchId) setError(message);
      throw new Error(message);
    } finally {
      transferMutationPendingRef.current = false;
      setBusy(false);
    }
  }

  async function rejectTransferRequest(requestId: string, rejectionReason: string) {
    const mutationBranchId = effectiveBranchIdRef.current;
    beginTransferMutation(mutationBranchId);
    setBusy(true);
    setError(null);
    try {
      await transferServices.reject.execute(requestId, rejectionReason);
      await reloadMutationBranch(mutationBranchId);
    } catch (caughtError) {
      const message = cleanInventoryError(caughtError, "No se pudo rechazar la solicitud.");
      if (effectiveBranchIdRef.current === mutationBranchId) setError(message);
      throw new Error(message);
    } finally {
      transferMutationPendingRef.current = false;
      setBusy(false);
    }
  }

  async function cancelTransferRequest(requestId: string) {
    const mutationBranchId = effectiveBranchIdRef.current;
    beginTransferMutation(mutationBranchId);
    setBusy(true);
    setError(null);
    try {
      const result = await transferServices.cancel.execute(requestId);
      await reloadMutationBranch(mutationBranchId);
      return result;
    } catch (caughtError) {
      const message = cleanInventoryError(caughtError, "No se pudo cancelar la solicitud.");
      if (effectiveBranchIdRef.current === mutationBranchId) setError(message);
      throw new Error(message);
    } finally {
      transferMutationPendingRef.current = false;
      setBusy(false);
    }
  }

  function beginTransferMutation(branch: string) {
    if (!branch || (apiMode && branch !== currentBranchId)) {
      throw new Error("La sucursal seleccionada debe estar activa para gestionar traslados.");
    }
    if (transferMutationPendingRef.current) {
      throw new Error("Hay otra operacion de traslado en curso.");
    }
    transferMutationPendingRef.current = true;
  }

  async function reloadMutationBranch(mutationBranchId: string) {
    if (effectiveBranchIdRef.current === mutationBranchId) await reload();
  }

  return {
    data,
    detailRow,
    kpis,
    rows: filteredRows,
    paginatedRows,
    totalItems,
    totalPages,
    page: currentPage,
    pageSize,
    apiMode,
    branchId: effectiveBranchId,
    currentBranchId,
    activeBranch,
    branches: apiMode ? headerBranches : data.branches.length ? data.branches : headerBranches,
    categories: data.categories,
    locations: activeLocations,
    supportsMultipleLocations: data.supportsMultipleLocations,
    search,
    categoryId,
    status,
    kpiFilter: effectiveKpiFilter,
    filtersOpen,
    loading:
      branchLoading ||
      sessionLoading ||
      loading ||
      (Boolean(effectiveBranchId) && loadedBranchId !== effectiveBranchId),
    busy,
    error,
    lastUpdatedAt,
    setBranchId,
    setSearch,
    setCategoryId,
    setStatus,
    setKpiFilter,
    setFiltersOpen,
    setPage,
    setPageSize,
    loadAlerts,
    loadProductRow,
    reload,
    canAdjustStock,
    canManageTransfers,
    adjustmentLookup,
    countService,
    otherBranchesService,
    kitAvailabilityService,
    applyCount,
    adjustStock,
    requestTransfer,
    cancelTransfer,
    approveTransferRequest,
    rejectTransferRequest,
    cancelTransferRequest,
  };
}

function filterRows(
  rows: InventoryAlertsData["rows"],
  search: string,
  categoryId: string,
  status: InventoryStatusFilter,
  kpiFilter: InventoryKpiFilter,
) {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    const matchesSearch =
      !query ||
      [row.productName, row.sku, row.categoryName, row.defaultLocationName].some((value) =>
        value.toLowerCase().includes(query),
      );
    const matchesCategory = categoryId === "all" || row.categoryId === categoryId;
    const matchesStatus =
      status === "all" ||
      (status === "low_stock"
        ? row.status === "near_minimum" || row.status === "critical"
        : row.status === status);
    const matchesKpi =
      kpiFilter === "all" ||
      kpiFilter === "active" ||
      (kpiFilter === "lowStock" && (row.status === "critical" || row.status === "near_minimum")) ||
      (kpiFilter === "expiringSoon" &&
        row.tracksExpiration &&
        isExpiringSoon(row.nextExpirationDate)) ||
      (kpiFilter === "outOfStock" && row.status === "out_of_stock");
    return matchesSearch && matchesCategory && matchesStatus && matchesKpi;
  });
}
