"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Branch, StorageLocation } from "@/core/entities";
import type { AdjustmentLotOption, AdjustmentSerialOption } from "@/core/repositories";
import type {
  InventoryAdjustmentLookupService,
  InventoryStockBreakdown,
} from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import { STOCK_ELSEWHERE_ADJUSTMENT_MESSAGE } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import { useSerialBatchPrecheck } from "@/shared/hooks/useSerialBatchPrecheck";
import {
  INVENTORY_MOVEMENTS_READ_PERMISSION,
  INVENTORY_STOCK_READ_PERMISSION,
} from "@/modules/inventory/application/services/serviceHelpers";
import { TraceableCountFlow } from "@/modules/inventory/components/TraceableCountFlow";
import type { InventoryOtherBranchesService } from "@/modules/inventory/application/services/InventoryOtherBranchesService";
import type { OtherBranchAvailability } from "@/core/repositories";
import type { InventoryKitAvailability } from "@/core/repositories";
import type { GetInventoryKitAvailabilityService } from "@/modules/inventory/application/services/GetInventoryKitAvailabilityService";
import type { InventoryCountService } from "@/modules/inventory/application/services/InventoryCountService";
import type { ReconcileCountInput } from "@/core/repositories";
import { getLocalCalendarDate } from "@/core/inventory/expirationDate";
import {
  InventoryTransferReason,
  InventoryTransferRequestStatus,
  BranchStatus,
  LocationStatus,
  SaasCapabilityKey,
} from "@/core/enums";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { Select } from "@/shared/components/Select";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import { QUANTITY_DECIMAL_PLACES, TEXT_LIMITS } from "@/shared/utils/inputLimits";
import {
  hasAtMostDecimalPlaces,
  parseUnitQuantityInput,
  toFiniteNumber,
  type NumericInputValue,
} from "@/shared/utils/numberInput";
import type {
  AdjustStockDto,
  AlertPanelMode,
  InventoryAlert,
  InventoryProductRow,
  InventoryTransferRequestRow,
  TransferRequestDto,
} from "@/modules/inventory/application/dto/InventoryAlertsDto";
import { getSuggestedReorderQuantity } from "@/modules/inventory/application/services/GetInventoryAlertsService";
import { InventoryProductTransfersModal } from "@/modules/inventory/components/InventoryProductTransfersModal";
import {
  useInventoryAlerts,
  type InventoryKpiFilter,
  type InventoryStatusFilter,
} from "@/modules/inventory/hooks/useInventoryAlerts";
import {
  hasValidationErrors,
  validateAdjustment,
  validateTransfer,
  type AdjustmentValidationErrors,
  type TransferValidationErrors,
} from "@/modules/inventory/validation/inventoryAlerts.validation";

type ActionMode =
  | "adjust"
  | "other-branches"
  | "request-transfer"
  | "product-transfers"
  | "transfer-request-detail"
  | null;

type EditableAdjustStockDto = Omit<AdjustStockDto, "quantity" | "serialNumbers"> & {
  quantity: NumericInputValue;
  serialNumbersText: string;
};

type EditableTransferRequestDto = Omit<TransferRequestDto, "quantity"> & {
  quantity: NumericInputValue;
};

const STATUS_OPTIONS: Array<{ value: InventoryStatusFilter; label: string }> = [
  { value: "all", label: "Todos los estados" },
  { value: "out_of_stock", label: "Sin existencias" },
  { value: "low_stock", label: "Stock bajo" },
  { value: "critical", label: "Critico" },
  { value: "near_minimum", label: "Proximo al minimo" },
  { value: "normal", label: "Normal" },
];

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const VIEWED_TRANSFER_ALERTS_STORAGE_KEY = "omniretail:inventory:viewed-transfer-alerts:v1";

const TRANSFER_REASONS: Array<{ value: InventoryTransferReason; label: string }> = [
  { value: InventoryTransferReason.replenishment, label: "Reposicion de inventario" },
  { value: InventoryTransferReason.demandCoverage, label: "Cobertura de demanda" },
  { value: InventoryTransferReason.urgentRequest, label: "Solicitud urgente" },
  { value: InventoryTransferReason.inventoryBalancing, label: "Balanceo entre sucursales" },
  { value: InventoryTransferReason.other, label: "Otro" },
];

export function InventoryAlertsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { hasPermission } = useCurrentSession();
  const { hasCapability } = useEntitlement();
  // Consultar existencias en otras sucursales es lectura de stock; traslados siguen aparte.
  const canViewOtherBranches =
    hasPermission(INVENTORY_STOCK_READ_PERMISSION) && hasCapability(SaasCapabilityKey.inventory);
  const canCreatePurchaseOrder =
    hasPermission("purchasing.orders.create") && hasCapability(SaasCapabilityKey.purchasing);
  // /inventario/movimientos exige inventory.movements.read: sin él (Cajero, Bodeguero) el acceso no se ofrece.
  const canViewMovements = hasPermission(INVENTORY_MOVEMENTS_READ_PERMISSION);
  const {
    data,
    detailRow,
    kpis,
    rows,
    paginatedRows,
    totalItems,
    totalPages,
    page,
    pageSize,
    apiMode,
    branchId,
    currentBranchId,
    activeBranch,
    branches,
    categories,
    locations,
    search,
    categoryId,
    status,
    kpiFilter,
    filtersOpen,
    loading,
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
    adjustmentLookup,
    supportsMultipleLocations,
    countService,
    otherBranchesService,
    kitAvailabilityService,
    applyCount,
    canAdjustStock,
    canManageTransfers,
    adjustStock,
    requestTransfer,
    cancelTransfer,
    cancelTransferRequest,
    approveTransferRequest,
    rejectTransferRequest,
  } = useInventoryAlerts();
  // El panel de contexto vive en la URL: ?panel=alerts | ?panel=product-detail&productId=<uuid>.
  // Compatibilidad: ?productId=<uuid> (con o sin openAdjustment=1) se interpreta como product-detail.
  const panelParam = searchParams.get("panel");
  const productIdParam = searchParams.get("productId") || null;
  const openAdjustmentParam = searchParams.get("openAdjustment");
  const selectedProductId = productIdParam;
  const panelMode: AlertPanelMode =
    productIdParam && (panelParam === "product-detail" || !panelParam)
      ? "product-detail"
      : "alerts";
  const contextPanelExpanded = Boolean(panelParam || productIdParam);
  const [previousCurrentBranchId, setPreviousCurrentBranchId] = useState(currentBranchId);
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [requestProviderBranchId, setRequestProviderBranchId] = useState<string | null>(null);
  const [selectedTransferRequestId, setSelectedTransferRequestId] = useState<string | null>(null);
  const [viewedTransferAlertKeys, setViewedTransferAlertKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [hasRestoredViewedTransferAlerts, setHasRestoredViewedTransferAlerts] = useState(false);
  if (previousCurrentBranchId !== currentBranchId) {
    setPreviousCurrentBranchId(currentBranchId);
    setSelectedTransferRequestId(null);
    setActionMode(null);
  }
  // Helpers locales de query params: solo se tocan los parametros indicados, los ajenos se preservan.
  const buildUrl = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    },
    [pathname, searchParams],
  );
  const navigatePanel = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      router.push(buildUrl(mutate), { scroll: false });
    },
    [buildUrl, router],
  );
  const selectedRow =
    rows.find((row) => row.productId === selectedProductId) ??
    data.rows.find((row) => row.productId === selectedProductId) ??
    data.alerts.find((alert) => alert.productId === selectedProductId)?.row ??
    (detailRow?.productId === selectedProductId ? detailRow : null) ??
    null;
  const selectedTransferRequest =
    data.transferRequests.find((request) => request.id === selectedTransferRequestId) ?? null;
  const branchLocations = useMemo(
    () => locations.filter((location) => location.branchId === branchId),
    [branchId, locations],
  );
  const stockProbe = useMemo(
    () =>
      adjustmentLookup
        ? { lookup: adjustmentLookup, locations: branchLocations, supportsMultipleLocations }
        : null,
    [adjustmentLookup, branchLocations, supportsMultipleLocations],
  );
  // Solo un producto con stock propio (TRACKED) admite ajustes; servicio y kit no.
  const canAdjustSelectedRow = canAdjustStock && selectedRow?.inventoryMode === "TRACKED";
  const firstVisible = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min((page - 1) * pageSize + paginatedRows.length, totalItems);
  const unreadAlertCount = hasRestoredViewedTransferAlerts
    ? data.transferRequests.filter(
        (request) => !viewedTransferAlertKeys.has(getTransferAlertKey(branchId, request)),
      ).length
    : 0;

  // Product creation hands off to this existing adjustment UI. It only
  // selects a product; RegisterInventoryAdjustmentService remains the sole
  // stock mutation boundary and retains all traceability validation.
  // Deep-link del panel: si el producto de ?productId= no esta en la pagina visible, se carga por id
  // (loadProductRow reutiliza la fila cargada y solo pide lo que falta). Solo lee la URL.
  useEffect(() => {
    if (!productIdParam || loading) return;
    void loadProductRow(productIdParam);
  }, [loading, loadProductRow, productIdParam]);

  // El handoff (?productId=&openAdjustment=1) es un trigger ONE-SHOT: al consumirlo se elimina SOLO
  // openAdjustment (replace); panel, productId y otros parametros se preservan, asi ningun refetch
  // posterior lo repite ni se crea una entrada artificial de historial.
  const handoffConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!productIdParam || openAdjustmentParam !== "1") return;
    // Espera a sesion/sucursal para decidir con permisos reales (no consumir en falso).
    if (loading) return;
    if (handoffConsumedRef.current === productIdParam) return;
    let active = true;
    void loadProductRow(productIdParam).then((row) => {
      if (!active || !row) return;
      handoffConsumedRef.current = productIdParam;
      if (canAdjustStock && row.inventoryMode === "TRACKED") {
        setActionMode("adjust");
      }
      router.replace(
        buildUrl((params) => params.delete("openAdjustment")),
        { scroll: false },
      );
    });
    return () => {
      active = false;
    };
  }, [
    buildUrl,
    canAdjustStock,
    loadProductRow,
    loading,
    openAdjustmentParam,
    productIdParam,
    router,
  ]);

  // Cambiar la sucursal activa (cabecera) descarta la seleccion del panel: solo se quitan sus
  // parametros. Un solo flujo URL: no hay efecto estado -> URL que se retroalimente.
  const previousBranchForUrlRef = useRef(currentBranchId);
  useEffect(() => {
    const previous = previousBranchForUrlRef.current;
    previousBranchForUrlRef.current = currentBranchId;
    if (!previous || previous === currentBranchId) return;
    if (!searchParams.has("panel") && !searchParams.has("productId")) return;
    router.replace(
      buildUrl((params) => {
        params.delete("panel");
        params.delete("productId");
        params.delete("openAdjustment");
      }),
      { scroll: false },
    );
  }, [buildUrl, currentBranchId, router, searchParams]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      setViewedTransferAlertKeys(readViewedTransferAlertKeys());
      setHasRestoredViewedTransferAlerts(true);
    });
    return () => {
      active = false;
    };
  }, []);

  function selectProduct(productId: string) {
    void loadAlerts();
    navigatePanel((params) => {
      params.set("panel", "product-detail");
      params.set("productId", productId);
    });
  }

  function selectRow(row: InventoryProductRow) {
    selectProduct(row.productId);
  }

  function openAlertsPanel() {
    void loadAlerts();
    navigatePanel((params) => {
      params.set("panel", "alerts");
      params.delete("productId");
      params.delete("openAdjustment");
    });
  }

  function closePanel() {
    navigatePanel((params) => {
      params.delete("panel");
      params.delete("productId");
      params.delete("openAdjustment");
    });
  }

  function changePanelMode(mode: AlertPanelMode) {
    if (mode === "alerts") openAlertsPanel();
  }

  function openAdjust(row?: InventoryProductRow) {
    if (row && row.inventoryMode !== "TRACKED") return;
    if (row) selectRow(row);
    setActionMode("adjust");
  }

  function openTransfer(row: InventoryProductRow, providerBranchId?: string) {
    selectRow(row);
    setRequestProviderBranchId(providerBranchId ?? null);
    setActionMode("request-transfer");
  }

  function openOtherBranches(row: InventoryProductRow) {
    selectRow(row);
    setActionMode("other-branches");
  }

  function openMovementHistory(row: InventoryProductRow) {
    // Contrato canonico: solo identidad/filtros (productId + branchId); nada de nombre ni SKU.
    const params = new URLSearchParams({ productId: row.productId, branchId: row.branchId });
    router.push(`/inventario/movimientos?${params.toString()}`);
  }

  function openPurchaseOrder(row: InventoryProductRow, source: "inventory" | "inventory-alert") {
    router.push(
      `/compras/ordenes/nueva?${buildQueryString({
        productId: row.productId,
        branchId: row.branchId,
        suggestedQuantity: getSuggestedReorderQuantity(row),
        source,
      })}`,
    );
  }

  async function addTransferRequest(dto: TransferRequestDto) {
    await requestTransfer(dto);
    setActionMode(null);
    showToast({ title: "Solicitud de traslado creada", tone: "success" });
  }

  function openTransferRequestDetail(request: InventoryTransferRequestRow) {
    const alertKey = getTransferAlertKey(branchId, request);
    setViewedTransferAlertKeys((current) => {
      const next = new Set(current).add(alertKey);
      persistViewedTransferAlertKeys(next);
      return next;
    });
    setSelectedTransferRequestId(request.id);
    setActionMode("transfer-request-detail");
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4">
      <header className="flex min-w-0 flex-col gap-3 border-b border-[var(--color-border)] pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Inventario &gt; Panel de inventario y alertas
          </p>
          <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-title)]">
            Inventario y alertas
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Supervisa las existencias y atiende productos con stock bajo, caducidad proxima u otras
            situaciones que requieren revision.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button
              className="w-full sm:w-auto"
              disabled={!canAdjustSelectedRow}
              onClick={() => canAdjustSelectedRow && openAdjust(selectedRow ?? undefined)}
              type="button"
            >
              + Registrar ajuste
            </Button>
          </div>
          <LastUpdatedLabel lastUpdatedAt={lastUpdatedAt} />
        </div>
      </header>

      {error ? <InlineAlert title={error} tone="danger" /> : null}

      <KpiGrid
        activeProducts={kpis.activeProducts}
        expiringSoon={kpis.expiringSoon}
        selectedFilter={kpiFilter}
        showExpiration={data.visibility.showExpirationFeatures}
        lowStock={kpis.lowStock}
        outOfStock={kpis.outOfStock}
        onFilterChange={(filter) => {
          setKpiFilter(filter);
        }}
      />

      <section
        className={cn(
          "grid min-w-0 items-start gap-4",
          contextPanelExpanded
            ? "xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-3"
            : "xl:grid-cols-[minmax(0,1fr)]",
        )}
      >
        <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
          <InventoryFilters
            branchId={branchId}
            branches={branches}
            categories={categories}
            categoryId={categoryId}
            filtersOpen={filtersOpen}
            compact={contextPanelExpanded}
            search={search}
            showAlertsLauncher={!contextPanelExpanded}
            status={status}
            unreadAlertCount={unreadAlertCount}
            onBranchChange={(value) => {
              setBranchId(value);
              // Otra sucursal descarta el producto seleccionado: panel de alertas si estaba abierto.
              navigatePanel((params) => {
                if (params.has("panel") || params.has("productId")) params.set("panel", "alerts");
                params.delete("productId");
                params.delete("openAdjustment");
              });
            }}
            onCategoryChange={(value) => {
              setCategoryId(value);
            }}
            onSearchChange={(value) => {
              setSearch(value);
            }}
            onStatusChange={(value) => {
              setStatus(value);
            }}
            onToggleFilters={() => {
              setFiltersOpen((current) => !current);
            }}
            onOpenAlerts={openAlertsPanel}
          />
          {loading ? (
            <p className="border-t border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
              Cargando inventario...
            </p>
          ) : (
            <InventoryTable
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              page={page}
              pageSize={pageSize}
              rows={paginatedRows}
              selectedProductId={selectedProductId}
              showExpiration={data.visibility.showExpirationFeatures}
              totalItems={totalItems}
              totalPages={totalPages}
              canAdjustStock={canAdjustStock}
              canManageTransfers={canManageTransfers}
              compact={contextPanelExpanded}
              onAdjust={openAdjust}
              onOpen={selectRow}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              onTransfer={openTransfer}
              onViewHistory={canViewMovements ? openMovementHistory : undefined}
            />
          )}
        </div>

        <ContextPanel
          activeBranchName={activeBranch?.name ?? "Sucursal"}
          activeBranchId={branchId}
          alerts={data.alerts}
          alertTotalItems={data.alertTotalItems}
          mode={panelMode}
          row={selectedRow}
          canAdjustStock={canAdjustStock}
          canCreatePurchaseOrder={canCreatePurchaseOrder}
          canViewOtherBranches={canViewOtherBranches}
          kitAvailabilityService={kitAvailabilityService}
          stockProbe={stockProbe}
          desktopExpanded={contextPanelExpanded}
          onAdjust={() => selectedRow && canAdjustStock && openAdjust(selectedRow)}
          onCreateOrder={() => selectedRow && openPurchaseOrder(selectedRow, "inventory-alert")}
          onOtherBranches={() => selectedRow && openOtherBranches(selectedRow)}
          onViewHistory={
            canViewMovements ? () => selectedRow && openMovementHistory(selectedRow) : undefined
          }
          // Solicitudes y traslados del producto exigen inventory.transfers.manage en el backend.
          onViewProductTransfers={
            canManageTransfers
              ? () => selectedRow && setActionMode("product-transfers")
              : undefined
          }
          onCloseProduct={closePanel}
          onCollapse={closePanel}
          onModeChange={changePanelMode}
          onSelectProduct={selectProduct}
          onSelectTransferRequest={openTransferRequestDetail}
          transferRequests={data.transferRequests}
          hasRestoredViewedTransferAlerts={hasRestoredViewedTransferAlerts}
          viewedTransferAlertKeys={viewedTransferAlertKeys}
        />
      </section>

      {selectedRow && selectedRow.inventoryMode === "TRACKED" && actionMode === "adjust" ? (
        <AdjustStockGate
          busy={busy}
          locations={branchLocations}
          supportsMultipleLocations={supportsMultipleLocations}
          lookup={adjustmentLookup}
          countService={countService}
          row={selectedRow}
          onApplyCount={async (input) => {
            const { pdfFailed } = await applyCount(input);
            setActionMode(null);
            showToast({
              title: pdfFailed
                ? "Conteo aplicado, pero no se pudo generar el comprobante PDF."
                : "Conteo físico aplicado correctamente.",
              tone: pdfFailed ? "info" : "success",
            });
          }}
          onClose={() => setActionMode(null)}
          onSubmit={async (dto) => {
            const result = await adjustStock(dto);
            setActionMode(null);
            showToast({
              title: result.adjustmentNumber
                ? `Ajuste ${result.adjustmentNumber} registrado correctamente.`
                : "Ajuste registrado correctamente.",
              tone: "success",
            });
          }}
        />
      ) : null}
      {selectedRow && actionMode === "other-branches" ? (
        <OtherBranchesStockModal
          open
          activeBranchId={branchId}
          row={selectedRow}
          service={otherBranchesService}
          onClose={() => setActionMode(null)}
          canManageTransfers={canManageTransfers}
          onRequest={(providerBranchId) => openTransfer(selectedRow, providerBranchId)}
        />
      ) : null}
      {selectedRow && actionMode === "request-transfer" ? (
        <RequestTransferModal
          apiMode={apiMode}
          branches={branches}
          key={`${selectedRow.branchId}:${selectedRow.productId}`}
          open
          providerBranchId={requestProviderBranchId}
          row={selectedRow}
          service={otherBranchesService}
          onClose={() => setActionMode(null)}
          onSubmit={addTransferRequest}
        />
      ) : null}
      {selectedRow && actionMode === "product-transfers" ? (
        <InventoryProductTransfersModal
          key={`${branchId}:${selectedRow.productId}`}
          branchId={branchId}
          productId={selectedRow.productId}
          productName={selectedRow.productName}
          busy={busy}
          canManageTransfers={canManageTransfers}
          onClose={() => setActionMode(null)}
          onReview={(requestId) => {
            const request = data.transferRequests.find((item) => item.id === requestId);
            if (request) openTransferRequestDetail(request);
          }}
          onCancelRequest={async (requestId) => {
            await cancelTransferRequest(requestId);
          }}
          onCancelTransfer={cancelTransfer}
        />
      ) : null}
      {selectedTransferRequest && actionMode === "transfer-request-detail" ? (
        <TransferRequestDetailModal
          open
          request={selectedTransferRequest}
          busy={busy}
          canManageTransfers={canManageTransfers}
          onApprove={async () => {
            const transfer = await approveTransferRequest(selectedTransferRequest.id);
            setActionMode(null);
            showToast({
              title: "Solicitud aprobada",
              description: `Traslado ${transfer.number} creado y preparado para Picking.`,
              tone: "success",
            });
          }}
          onClose={() => setActionMode(null)}
          onReject={async (rejectionReason) => {
            await rejectTransferRequest(selectedTransferRequest.id, rejectionReason);
            setActionMode(null);
            showToast({ title: "Solicitud rechazada", tone: "warning" });
          }}
        />
      ) : null}
    </div>
  );
}

function KpiGrid({
  activeProducts,
  expiringSoon,
  lowStock,
  outOfStock,
  selectedFilter,
  showExpiration,
  onFilterChange,
}: {
  activeProducts: number;
  expiringSoon: number;
  lowStock: number;
  outOfStock: number;
  selectedFilter: InventoryKpiFilter;
  showExpiration: boolean;
  onFilterChange: (filter: InventoryKpiFilter) => void;
}) {
  return (
    <section
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        showExpiration ? "xl:grid-cols-4" : "xl:grid-cols-3",
      )}
    >
      <KpiCard
        description="Productos publicados que controlan stock"
        filter="active"
        icon="P"
        label="Productos activos"
        selected={selectedFilter === "active"}
        value={activeProducts}
        onSelect={onFilterChange}
      />
      <KpiCard
        description="Bajo minimo o cerca del minimo"
        filter="lowStock"
        icon="B"
        label="Stock bajo"
        selected={selectedFilter === "lowStock"}
        tone="warning"
        value={lowStock}
        onSelect={onFilterChange}
      />
      {showExpiration ? (
        <KpiCard
          description="Lotes dentro de la ventana de revision"
          filter="expiringSoon"
          icon="C"
          label="Proximos a caducar"
          selected={selectedFilter === "expiringSoon"}
          tone="warning"
          value={expiringSoon}
          onSelect={onFilterChange}
        />
      ) : null}
      <KpiCard
        description="Sin disponibilidad en la sucursal"
        filter="outOfStock"
        icon="S"
        label="Sin existencias"
        selected={selectedFilter === "outOfStock"}
        tone="danger"
        value={outOfStock}
        onSelect={onFilterChange}
      />
    </section>
  );
}

function KpiCard({
  description,
  filter,
  icon,
  label,
  selected,
  disabled = false,
  tone = "info",
  value,
  onSelect,
}: {
  description: string;
  filter: InventoryKpiFilter;
  icon: string;
  label: string;
  selected: boolean;
  disabled?: boolean;
  tone?: "info" | "warning" | "danger";
  value: number;
  onSelect: (filter: InventoryKpiFilter) => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex min-h-24 items-start justify-between gap-3 rounded-lg border bg-white p-4 text-left shadow-sm transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
        tone === "warning" && "border-amber-200",
        tone === "danger" && "border-red-200",
        tone === "info" && "border-[var(--color-border)]",
        selected && "border-[var(--color-structure)] ring-2 ring-[var(--color-primary)]/25",
        disabled && "cursor-default hover:border-amber-200 hover:bg-white",
      )}
      disabled={disabled}
      onClick={() => onSelect(selected ? "all" : filter)}
      type="button"
    >
      <div className="min-w-0">
        <p className="text-sm font-bold text-[var(--color-text-muted)]">{label}</p>
        <strong className="mt-2 block text-3xl font-bold leading-none text-[var(--color-title)]">
          {value}
        </strong>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">{description}</p>
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-black",
          tone === "warning" && "bg-amber-100 text-amber-700",
          tone === "danger" && "bg-red-100 text-red-700",
          tone === "info" && "bg-blue-100 text-blue-700",
        )}
      >
        {icon}
      </span>
    </button>
  );
}

function InventoryFilters({
  branchId,
  branches,
  categories,
  categoryId,
  compact,
  filtersOpen,
  search,
  showAlertsLauncher,
  status,
  unreadAlertCount,
  onBranchChange,
  onCategoryChange,
  onOpenAlerts,
  onSearchChange,
  onStatusChange,
  onToggleFilters,
}: {
  branchId: string;
  branches: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  categoryId: string;
  compact: boolean;
  filtersOpen: boolean;
  search: string;
  showAlertsLauncher: boolean;
  status: InventoryStatusFilter;
  unreadAlertCount: number;
  onBranchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onOpenAlerts: () => void;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: InventoryStatusFilter) => void;
  onToggleFilters: () => void;
}) {
  return (
    <div
      className={cn(
        "relative space-y-3 p-4",
        compact && "xl:p-3",
        showAlertsLauncher && "xl:pr-16",
      )}
    >
      {showAlertsLauncher ? (
        <button
          aria-label={
            unreadAlertCount > 0 ? `Abrir alertas, ${unreadAlertCount} nuevas` : "Abrir alertas"
          }
          className="absolute right-3 top-3 hidden h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-structure)] text-white shadow-md transition hover:bg-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] xl:inline-flex"
          onClick={onOpenAlerts}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
          </svg>
          {unreadAlertCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
              {unreadAlertCount > 9 ? "9+" : unreadAlertCount}
            </span>
          ) : null}
        </button>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(18rem,2fr)_repeat(3,minmax(10rem,1fr))] xl:items-center">
        <Input
          aria-label="Buscar productos en inventario"
          className="sm:col-span-2 xl:col-span-1"
          maxLength={TEXT_LIMITS.search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por nombre, SKU, categoria o ubicacion..."
          type="search"
          value={search}
        />
        <Select
          aria-label="Sucursal"
          onChange={(event) => onBranchChange(event.target.value)}
          value={branchId}
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Categoria"
          className={cn(!filtersOpen && "hidden xl:block")}
          onChange={(event) => onCategoryChange(event.target.value)}
          value={categoryId}
        >
          <option value="all">Todas las categorias</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Estado"
          className={cn(!filtersOpen && "hidden xl:block")}
          onChange={(event) => onStatusChange(event.target.value as InventoryStatusFilter)}
          value={status}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button className="xl:hidden" onClick={onToggleFilters} type="button" variant="secondary">
          Filtros
        </Button>
      </div>
    </div>
  );
}

function InventoryTable({
  firstVisible,
  lastVisible,
  page,
  pageSize,
  rows,
  selectedProductId,
  showExpiration,
  totalItems,
  totalPages,
  canAdjustStock,
  canManageTransfers,
  compact,
  onAdjust,
  onOpen,
  onPageChange,
  onPageSizeChange,
  onTransfer,
  onViewHistory,
}: {
  firstVisible: number;
  lastVisible: number;
  page: number;
  pageSize: number;
  rows: InventoryProductRow[];
  selectedProductId: string | null;
  showExpiration: boolean;
  totalItems: number;
  totalPages: number;
  canAdjustStock: boolean;
  canManageTransfers: boolean;
  compact: boolean;
  onAdjust: (row: InventoryProductRow) => void;
  onOpen: (row: InventoryProductRow) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onTransfer: (row: InventoryProductRow) => void;
  onViewHistory?: (row: InventoryProductRow) => void;
}) {
  return (
    <div className="border-t border-[var(--color-border)]">
      <div className="overflow-x-auto">
        <table
          className={cn(
            "w-full min-w-[820px] border-collapse text-left text-sm",
            compact && "xl:text-[13px] xl:[&_td]:px-2.5 xl:[&_td]:py-2.5 xl:[&_th]:px-2.5",
          )}
        >
          <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Producto</th>
              <th className="px-3 py-2.5 text-right font-semibold">Existencia operativa</th>
              <th className="px-3 py-2.5 text-right font-semibold">Reservado</th>
              <th className="px-3 py-2.5 text-right font-semibold">Disponible</th>
              <th className="hidden px-3 py-2.5 text-right font-semibold md:table-cell">
                Nivel minimo
              </th>
              <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">Ubicacion</th>
              <th className="px-3 py-2.5 font-semibold">Estado</th>
              {showExpiration ? (
                <th className="hidden px-3 py-2.5 font-semibold lg:table-cell">Caducidad</th>
              ) : null}
              <th className="w-20 px-3 py-2.5 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                  colSpan={showExpiration ? 9 : 8}
                >
                  No hay productos que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  className={cn(
                    "cursor-pointer border-t border-[var(--color-border)] transition odd:bg-white even:bg-[var(--color-app-background)]/40 hover:bg-[var(--color-primary)]/5 focus:bg-[var(--color-primary)]/5 focus:outline focus:outline-2 focus:outline-inset focus:outline-[var(--color-structure)]",
                    selectedProductId === row.productId && "bg-[var(--color-primary)]/10",
                  )}
                  key={row.productId}
                  onClick={() => onOpen(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onOpen(row);
                  }}
                  tabIndex={0}
                >
                  <td className="min-w-[190px] px-3 py-3">
                    <p className="font-semibold text-[var(--color-title)]">{row.productName}</p>
                    <p className="mt-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                      {row.sku}
                    </p>
                  </td>
                  <StockCells row={row} />
                  <td className="hidden px-3 py-3 font-semibold text-[var(--color-text)] lg:table-cell">
                    {row.defaultLocationName}
                  </td>
                  <td className="px-3 py-3">
                    <InventoryStatusBadge row={row} />
                  </td>
                  {showExpiration ? (
                    <td className="hidden px-3 py-3 text-[var(--color-text)] lg:table-cell">
                      <ExpirationCell row={row} />
                    </td>
                  ) : null}
                  <td className="px-3 py-3">
                    {row.inventoryMode === "TRACKED" ? (
                      <RowActionsMenu
                        row={row}
                        canAdjustStock={canAdjustStock}
                        canManageTransfers={canManageTransfers}
                        onAdjust={onAdjust}
                        onTransfer={onTransfer}
                        onViewHistory={onViewHistory}
                      />
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <InventoryTableFooter
        firstVisible={firstVisible}
        lastVisible={lastVisible}
        page={page}
        pageSize={pageSize}
        totalItems={totalItems}
        totalPages={totalPages}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function InventoryTableFooter({
  firstVisible,
  lastVisible,
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  firstVisible: number;
  lastVisible: number;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          Mostrando {firstVisible}-{lastVisible} de {totalItems} productos
        </p>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          Filas
          <Select
            aria-label="Filas por pagina"
            className="h-9 w-20 px-2"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            value={pageSize}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <nav
        aria-label="Paginacion de existencias por producto"
        className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start"
      >
        <Button
          aria-label="Pagina anterior"
          className="min-h-9 px-3 py-1.5"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
          variant="secondary"
        >
          &lt;
        </Button>
        <span className="min-w-12 text-center text-sm font-semibold text-[var(--color-text)]">
          {page} / {totalPages}
        </span>
        <Button
          aria-label="Pagina siguiente"
          className="min-h-9 px-3 py-1.5"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
          variant="secondary"
        >
          &gt;
        </Button>
      </nav>
    </div>
  );
}

/**
 * Celdas Existencia / Reservado / Disponible / Nivel minimo. Solo un producto TRACKED muestra stock
 * propio; servicio y kit no inventan existencias ni usan la barra de nivel fisico.
 */
function StockCells({ row }: { row: InventoryProductRow }) {
  if (row.inventoryMode === "NONE") {
    return (
      <>
        <td className="px-3 py-3 text-right font-semibold text-[var(--color-text-muted)]">—</td>
        <td className="px-3 py-3 text-right font-semibold text-[var(--color-text-muted)]">—</td>
        <td className="px-3 py-3 text-right font-semibold text-[var(--color-text-muted)]">—</td>
        <td className="hidden px-3 py-3 text-right font-semibold text-[var(--color-text-muted)] md:table-cell">
          —
        </td>
      </>
    );
  }
  if (row.inventoryMode === "DERIVED_KIT") {
    return (
      <>
        <td className="px-3 py-3 text-right text-base font-bold text-[var(--color-title)]">
          {row.availableQuantity} Kit
        </td>
        <td className="px-3 py-3 text-right font-semibold text-[var(--color-text-muted)]">—</td>
        <td className="px-3 py-3 text-right font-bold text-[var(--color-title)]">
          {row.availableQuantity} Kit
        </td>
        <td className="hidden px-3 py-3 text-right font-semibold text-[var(--color-text-muted)] md:table-cell">
          —
        </td>
      </>
    );
  }
  return (
    <>
      <td className="px-3 py-3 text-right">
        <p className="text-base font-bold text-[var(--color-title)]">
          {formatStockQuantity(row.sellableQuantity)} {row.saleUnitName}
        </p>
        {row.inventoryUnitId !== row.unitId && row.inventoryUnitId !== row.saleUnitId ? (
          <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
            {formatStockQuantity(row.inventoryPresentationQuantity)} {row.inventoryUnitName}{" "}
            inventario
          </p>
        ) : null}
        <StockLevelBar row={row} />
      </td>
      <td className="px-3 py-3 text-right font-semibold text-[var(--color-text)]">
        {formatStockQuantity(row.sellableReservedQuantity)} {row.saleUnitName}
      </td>
      <td className="px-3 py-3 text-right font-bold text-[var(--color-title)]">
        <p>
          {formatStockQuantity(row.sellableAvailableQuantity)} {row.saleUnitName}
        </p>
        {row.inventoryUnitId !== row.saleUnitId ? (
          <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
            {formatStockQuantity(row.inventoryPresentationAvailableQuantity)}{" "}
            {row.inventoryUnitName} inventario
          </p>
        ) : null}
      </td>
      <td className="hidden px-3 py-3 text-right font-semibold text-[var(--color-text)] md:table-cell">
        {row.minStock}
      </td>
    </>
  );
}

/** Cantidad que puede no estar determinada con los datos cargados: nunca se fabrica un valor. */
function formatOptionalStock(value: number | null | undefined, unitName: string) {
  return value == null ? "No disponible" : `${formatStockQuantity(value)} ${unitName}`;
}

/**
 * Avisa cuando el producto no puede operar sus existencias (sin ubicacion operativa) o conserva
 * stock fuera de su balance operativo, y enlaza a la regularizacion explicita existente.
 */
export function OperationalStockNotice({
  canRegularize,
  row,
}: {
  canRegularize: boolean;
  row: InventoryProductRow;
}) {
  const unassigned = !row.defaultLocationId;
  const outsideOperational = row.requiresRegularization === true;
  if (!unassigned && !outsideOperational) return null;
  return (
    <div
      className="mt-3 rounded-md border border-[var(--color-warning)] bg-[var(--color-app-background)] px-3 py-2 text-xs leading-5 text-[var(--color-text)]"
      role="note"
    >
      <p className="font-semibold">
        {unassigned
          ? "Sin ubicacion operativa asignada: el producto no puede recibir, reservar ni vender existencias."
          : "Stock heredado: el producto conserva existencias fuera de su ubicacion operativa."}
      </p>
      {outsideOperational && canRegularize ? (
        <Link
          className="mt-1 inline-block font-bold text-[var(--color-structure)] underline"
          href="/inventario/regularizacion"
        >
          Ir a regularizacion de ubicaciones
        </Link>
      ) : null}
    </div>
  );
}

const stockQuantityFormat = new Intl.NumberFormat("es-GT", {
  maximumFractionDigits: QUANTITY_DECIMAL_PLACES,
  useGrouping: false,
});

/** 2 -> "2", 1.5 -> "1.5"; sin ceros de relleno ni redondeo mas alla de la precision de cantidades. */
function formatStockQuantity(value: number) {
  return stockQuantityFormat.format(value);
}

function StockLevelBar({ row }: { row: InventoryProductRow }) {
  const target = Math.max(row.minStock || 0, row.availableQuantity || 0, 1);
  const percent = Math.min(100, Math.round((row.availableQuantity / target) * 100));
  return (
    <div className="ml-auto mt-2 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
      <span
        className={cn(
          "block h-full rounded-full",
          row.status === "normal" && "bg-emerald-500",
          row.status === "near_minimum" && "bg-amber-500",
          row.status === "critical" && "bg-orange-500",
          row.status === "out_of_stock" && "bg-red-500",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function ExpirationCell({ row }: { row: InventoryProductRow }) {
  if (!row.nextExpirationDate) {
    return <span className="text-sm font-semibold text-[var(--color-text-muted)]">-</span>;
  }
  const days = getDaysUntil(row.nextExpirationDate);
  return (
    <div className="space-y-1">
      <span
        className={cn(
          "inline-flex rounded-md px-2 py-1 text-xs font-bold",
          days <= 7 ? "bg-orange-100 text-orange-800" : "bg-amber-100 text-amber-800",
        )}
      >
        {days} dias
      </span>
      <p className="text-xs font-semibold text-[var(--color-text-muted)]">
        {row.nextExpirationLabel}
      </p>
    </div>
  );
}

/** Badge por `displayStatus`: el estado fisico de un TRACKED no se mezcla con servicio ni kit. */
function InventoryStatusBadge({
  row,
}: {
  row: Pick<InventoryProductRow, "displayStatus" | "statusLabel">;
}) {
  const { displayStatus } = row;
  const label =
    displayStatus === "NOT_CONTROLLED"
      ? "No controla inventario"
      : displayStatus === "KIT_AVAILABLE"
        ? "Disponible"
        : displayStatus === "KIT_UNAVAILABLE"
          ? "Sin disponibilidad"
          : row.statusLabel;
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-xs font-bold",
        displayStatus === "NORMAL" && "bg-emerald-100 text-emerald-800",
        displayStatus === "NEAR_MINIMUM" && "bg-amber-100 text-amber-800",
        displayStatus === "CRITICAL" && "bg-orange-100 text-orange-800",
        displayStatus === "OUT_OF_STOCK" && "bg-red-100 text-red-800",
        displayStatus === "NOT_CONTROLLED" && "bg-slate-100 text-slate-700",
        displayStatus === "KIT_AVAILABLE" && "bg-emerald-100 text-emerald-800",
        displayStatus === "KIT_UNAVAILABLE" && "bg-red-50 text-red-700",
      )}
    >
      {label}
    </span>
  );
}

function RowActionsMenu({
  row,
  canAdjustStock,
  canManageTransfers,
  onAdjust,
  onTransfer,
  onViewHistory,
}: {
  row: InventoryProductRow;
  canAdjustStock: boolean;
  canManageTransfers: boolean;
  onAdjust: (row: InventoryProductRow) => void;
  onTransfer: (row: InventoryProductRow) => void;
  onViewHistory?: (row: InventoryProductRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = 148;
      const hasSpaceBelow = window.innerHeight - rect.bottom >= menuHeight + 12;
      setMenuStyle({
        right: Math.max(12, window.innerWidth - rect.right),
        top: hasSpaceBelow ? rect.bottom + 6 : Math.max(12, rect.top - menuHeight - 6),
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function select(action: (row: InventoryProductRow) => void) {
    setOpen(false);
    action(row);
  }

  if (!canAdjustStock && !canManageTransfers && !onViewHistory) return null;

  return (
    <div
      className="relative flex justify-end"
      onClick={(event) => event.stopPropagation()}
      ref={containerRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Acciones de ${row.productName}`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] bg-white text-xl font-bold leading-none text-[var(--color-title)] transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
        type="button"
      >
        ...
      </button>
      {open ? (
        <div
          className="fixed z-50 w-[min(15rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--color-border)] bg-white py-2 shadow-lg"
          role="menu"
          style={menuStyle}
        >
          {canAdjustStock ? (
            <MenuItem icon={<AdjustIcon />} onClick={() => select(onAdjust)}>
              Ajustar existencias
            </MenuItem>
          ) : null}
          {canManageTransfers ? (
            <MenuItem icon={<TransferIcon />} onClick={() => select(onTransfer)}>
              Solicitar traslado
            </MenuItem>
          ) : null}
          {onViewHistory ? (
            <MenuItem icon={<HistoryIcon />} onClick={() => select(onViewHistory)}>
              Historial de movimientos
            </MenuItem>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  disabled,
  icon,
  onClick,
}: {
  children: string;
  disabled?: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex min-h-10 w-full items-center gap-3 px-3 py-2 text-left text-sm font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className="shrink-0 text-[var(--color-structure)]">{icon}</span>
      {children}
    </button>
  );
}

function ActionMenuIcon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

function AdjustIcon() {
  return (
    <ActionMenuIcon>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </ActionMenuIcon>
  );
}

function TransferIcon() {
  return (
    <ActionMenuIcon>
      <path d="M7 7h13M17 4l3 3-3 3M17 17H4M7 14l-3 3 3 3" />
    </ActionMenuIcon>
  );
}

function HistoryIcon() {
  return (
    <ActionMenuIcon>
      <path d="M3 12a9 9 0 1 0 3-6.7M3 3v6h6" />
      <path d="M12 7v5l3 2" />
    </ActionMenuIcon>
  );
}

function BranchesIcon() {
  return (
    <ActionMenuIcon>
      <path d="M4 21V9l8-5 8 5v12M9 21v-6h6v6M9 11h.01M15 11h.01" />
    </ActionMenuIcon>
  );
}

function PurchaseOrderIcon() {
  return (
    <ActionMenuIcon>
      <path d="M9 4h6v3H9zM8 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2" />
      <path d="M9 12h6M9 16h4" />
    </ActionMenuIcon>
  );
}

interface StockProbe {
  lookup: InventoryAdjustmentLookupService;
  locations: StorageLocation[];
  supportsMultipleLocations: boolean;
}

function ContextPanel({
  activeBranchId,
  activeBranchName,
  alertTotalItems,
  canAdjustStock,
  canViewOtherBranches,
  kitAvailabilityService,
  stockProbe,
  desktopExpanded,
  alerts,
  canCreatePurchaseOrder,
  mode,
  row,
  transferRequests,
  hasRestoredViewedTransferAlerts,
  viewedTransferAlertKeys,
  onAdjust,
  onCollapse,
  onCreateOrder,
  onCloseProduct,
  onModeChange,
  onOtherBranches,
  onSelectProduct,
  onSelectTransferRequest,
  onViewHistory,
  onViewProductTransfers,
}: {
  activeBranchId: string;
  activeBranchName: string;
  alertTotalItems: number;
  canAdjustStock: boolean;
  canViewOtherBranches: boolean;
  kitAvailabilityService: GetInventoryKitAvailabilityService | null;
  stockProbe: StockProbe | null;
  desktopExpanded: boolean;
  alerts: InventoryAlert[];
  canCreatePurchaseOrder: boolean;
  mode: AlertPanelMode;
  row: InventoryProductRow | null;
  transferRequests: InventoryTransferRequestRow[];
  hasRestoredViewedTransferAlerts: boolean;
  viewedTransferAlertKeys: Set<string>;
  onAdjust: () => void;
  onCollapse: () => void;
  onCreateOrder: () => void;
  onCloseProduct: () => void;
  onModeChange: (mode: AlertPanelMode) => void;
  onOtherBranches: () => void;
  onSelectProduct: (productId: string) => void;
  onSelectTransferRequest: (request: InventoryTransferRequestRow) => void;
  onViewHistory?: () => void;
  onViewProductTransfers?: () => void;
}) {
  const productAlerts = row ? alerts.filter((alert) => alert.productId === row.productId) : [];
  const totalAlerts = alertTotalItems + transferRequests.length;

  const showProduct = mode === "product-detail" && Boolean(row);

  return (
    <>
      {showProduct ? (
        <button
          aria-label="Cerrar detalle de producto"
          className="fixed inset-0 z-40 bg-slate-950/25 xl:hidden"
          onClick={onCloseProduct}
          type="button"
        />
      ) : null}
      <aside
        className={cn(
          "min-w-0 overflow-hidden border border-[var(--color-border)] bg-white shadow-sm",
          !desktopExpanded && "xl:hidden",
          showProduct
            ? "fixed inset-y-0 right-0 z-50 w-[min(100%,42rem)] overflow-y-auto rounded-none sm:rounded-l-xl xl:static xl:z-auto xl:w-auto xl:self-start xl:overflow-hidden xl:rounded-xl"
            : "self-start rounded-xl",
        )}
      >
        {mode === "product-detail" ? (
          <button
            className="flex w-full items-center justify-between border-b border-[var(--color-border)] px-4 py-3 text-left text-sm font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)]"
            onClick={() => onModeChange("alerts")}
            type="button"
          >
            <span>Alertas {totalAlerts}</span>
            <span aria-hidden="true">v</span>
          </button>
        ) : (
          <AlertsPanel
            activeBranchId={activeBranchId}
            alerts={alerts}
            alertTotalItems={alertTotalItems}
            transferRequests={transferRequests}
            hasRestoredViewedTransferAlerts={hasRestoredViewedTransferAlerts}
            viewedTransferAlertKeys={viewedTransferAlertKeys}
            onCollapse={onCollapse}
            onSelectProduct={onSelectProduct}
            onSelectTransferRequest={onSelectTransferRequest}
          />
        )}

        {mode === "product-detail" && row ? (
          <ProductPanel
            activeBranchName={activeBranchName}
            alerts={productAlerts}
            row={row}
            canAdjustStock={canAdjustStock}
            canCreatePurchaseOrder={canCreatePurchaseOrder}
            canViewOtherBranches={canViewOtherBranches}
            kitAvailabilityService={kitAvailabilityService}
            stockProbe={stockProbe}
            onAdjust={onAdjust}
            onCreateOrder={onCreateOrder}
            onClose={onCloseProduct}
            onOtherBranches={onOtherBranches}
            onViewHistory={onViewHistory}
            onViewProductTransfers={onViewProductTransfers}
          />
        ) : null}
      </aside>
    </>
  );
}

function AlertsPanel({
  activeBranchId,
  alerts,
  alertTotalItems,
  transferRequests,
  hasRestoredViewedTransferAlerts,
  viewedTransferAlertKeys,
  onCollapse,
  onSelectProduct,
  onSelectTransferRequest,
}: {
  activeBranchId: string;
  alerts: InventoryAlert[];
  alertTotalItems: number;
  transferRequests: InventoryTransferRequestRow[];
  hasRestoredViewedTransferAlerts: boolean;
  viewedTransferAlertKeys: Set<string>;
  onCollapse: () => void;
  onSelectProduct: (productId: string) => void;
  onSelectTransferRequest: (request: InventoryTransferRequestRow) => void;
}) {
  const feedItems = buildAlertFeed(
    activeBranchId,
    alerts,
    transferRequests,
    hasRestoredViewedTransferAlerts,
    viewedTransferAlertKeys,
  );
  const loadedAlertCount = alerts.length + transferRequests.length;
  const totalAlertCount = alertTotalItems + transferRequests.length;

  return (
    <section>
      <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-app-background)]/45 px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Alertas prioritarias
          </p>
          <h2 className="mt-1 text-base font-bold text-[var(--color-title)]">
            Alertas {totalAlertCount}
          </h2>
          {loadedAlertCount < totalAlertCount ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Mostrando {loadedAlertCount} alertas cargadas
            </p>
          ) : null}
        </div>
        <button
          aria-label="Cerrar panel de alertas"
          className="hidden h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold text-[var(--color-title)] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] xl:inline-flex"
          onClick={onCollapse}
          type="button"
        >
          ×
        </button>
        <span
          aria-hidden="true"
          className="text-sm font-bold text-[var(--color-text-muted)] xl:hidden"
        >
          ^
        </span>
      </header>
      <div className="max-h-[420px] space-y-2.5 overflow-y-auto p-3 sm:p-4">
        {feedItems.length === 0 ? (
          <p className="rounded-md border border-[var(--color-border)] bg-white p-3 text-sm text-[var(--color-text-muted)]">
            No hay alertas prioritarias para la sucursal seleccionada.
          </p>
        ) : (
          feedItems.map((item) =>
            item.kind === "transfer" ? (
              <button
                className={cn(
                  "block w-full rounded-lg border border-l-4 bg-white p-3 text-left shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
                  getTransferRequestToneClass(item.request),
                )}
                key={item.id}
                onClick={() => onSelectTransferRequest(item.request)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {item.isNew ? (
                    <span
                      aria-label="Nueva"
                      className="inline-flex h-2 w-2 shrink-0 rounded-full bg-[var(--color-primary)]"
                    />
                  ) : null}
                  <strong className="block min-w-0 text-sm text-[var(--color-title)]">
                    {getTransferRequestAlertTitle(item.request)}
                  </strong>
                  {item.isNew ? (
                    <span className="rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-xs font-bold text-white">
                      Nueva
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
                  {getTransferRequestAlertMessage(item.request)}
                </span>
                <span
                  className={cn(
                    "mt-2 block text-xs font-bold uppercase",
                    getTransferRequestTextClass(item.request),
                  )}
                >
                  {formatTransferRequestStatus(item.request.status)}
                </span>
              </button>
            ) : (
              <button
                className={cn(
                  "block w-full rounded-lg border border-l-4 bg-white p-3 text-left shadow-sm transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
                  item.alert.tone === "danger" && "border-red-200",
                  item.alert.tone === "warning" && "border-amber-200",
                  item.alert.tone === "info" && "border-blue-200",
                )}
                key={item.id}
                onClick={() => onSelectProduct(item.alert.productId)}
                type="button"
              >
                <strong className="block text-sm text-[var(--color-title)]">
                  {item.alert.title}
                </strong>
                <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
                  {item.alert.message}
                </span>
                {item.alert.suggestedReorder ? (
                  <span className="mt-2 block text-xs font-bold uppercase text-[var(--color-text-muted)]">
                    Reposicion sugerida: {item.alert.suggestedReorder}
                  </span>
                ) : null}
              </button>
            ),
          )
        )}
      </div>
    </section>
  );
}

function ProductPanel({
  activeBranchName,
  alerts,
  canAdjustStock,
  canCreatePurchaseOrder,
  canViewOtherBranches,
  kitAvailabilityService,
  stockProbe,
  row,
  onAdjust,
  onCreateOrder,
  onClose,
  onOtherBranches,
  onViewHistory,
  onViewProductTransfers,
}: {
  activeBranchName: string;
  alerts: InventoryAlert[];
  canAdjustStock: boolean;
  canCreatePurchaseOrder: boolean;
  canViewOtherBranches: boolean;
  kitAvailabilityService: GetInventoryKitAvailabilityService | null;
  stockProbe: StockProbe | null;
  row: InventoryProductRow;
  onAdjust: () => void;
  onCreateOrder: () => void;
  onClose: () => void;
  onOtherBranches: () => void;
  onViewHistory?: () => void;
  onViewProductTransfers?: () => void;
}) {
  if (row.inventoryMode === "NONE") {
    return (
      <section>
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Servicio
            </p>
            <h2 className="mt-1 break-words text-xl font-bold text-[var(--color-title)]">
              {row.productName}
            </h2>
            <p className="mt-1 text-sm font-semibold uppercase text-[var(--color-text-muted)]">
              {row.sku}
            </p>
          </div>
          <button
            aria-label="Cerrar detalle de servicio"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </header>
        <div className="space-y-4 p-4">
          <section className="rounded-lg border border-[var(--color-border)] bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-[var(--color-title)]">Estado</p>
              <InventoryStatusBadge row={row} />
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailTile label="Tipo" value="Servicio" />
              <DetailTile label="Existencia" value="No aplica" />
              <DetailTile label="Categoria" value={row.categoryName} />
              <DetailTile label="Sucursal" value={activeBranchName} />
            </dl>
            <p className="mt-4 rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text)]">
              Los servicios no controlan existencias de inventario.
            </p>
          </section>
        </div>
      </section>
    );
  }
  if (row.inventoryMode === "DERIVED_KIT") {
    return (
      <KitProductPanel
        activeBranchName={activeBranchName}
        key={`${row.branchId}|${row.productId}`}
        onClose={onClose}
        row={row}
        service={kitAvailabilityService}
      />
    );
  }
  return (
    <PhysicalProductPanel
      activeBranchName={activeBranchName}
      alerts={alerts}
      canAdjustStock={canAdjustStock}
      canCreatePurchaseOrder={canCreatePurchaseOrder}
      canViewOtherBranches={canViewOtherBranches}
      // Al cambiar de producto/sucursal el panel se remonta: vuelve a "Informacion y existencias".
      key={`${row.branchId}|${row.productId}`}
      onAdjust={onAdjust}
      onClose={onClose}
      onCreateOrder={onCreateOrder}
      onOtherBranches={onOtherBranches}
      onViewHistory={onViewHistory}
      onViewProductTransfers={onViewProductTransfers}
      row={row}
      stockProbe={stockProbe}
    />
  );
}

type ProductPanelSection = "information" | "actions" | null;

// Acciones compactas del panel fisico: filas de ancho completo (~40px) sin partir el texto.
const PANEL_ACTION_CLASS =
  "flex min-h-10 w-full items-center rounded-md border px-3 py-2 text-left text-[13px] font-semibold leading-tight transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]";
// Secundarias en cuadricula 2x2: icono a la izquierda y acento azul suave (la primaria domina).
const PANEL_SECONDARY_ACTION_CLASS =
  "flex min-h-16 w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/40 px-2.5 py-2.5 text-left text-[12px] font-semibold leading-snug text-[var(--color-title)] transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] [&>svg]:shrink-0 [&>svg]:text-[var(--color-structure)]";

/** Variante compacta de DetailTile, solo para el panel fisico (Servicio y Kit no la usan). */
function CompactTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-[13px] font-semibold leading-snug text-[var(--color-text)]">
        {value}
      </dd>
    </div>
  );
}

/** Seccion de acordeon: encabezado con boton real (aria-expanded/aria-controls) y chevron. */
function PanelAccordionSection({
  children,
  id,
  onToggle,
  open,
  summary,
  title,
}: {
  children: ReactNode;
  id: string;
  onToggle: () => void;
  open: boolean;
  summary?: ReactNode;
  title: string;
}) {
  const headerId = `${id}-header`;
  const panelId = `${id}-panel`;
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-white">
      <h3>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-structure)]"
          id={headerId}
          onClick={onToggle}
          type="button"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold leading-tight text-[var(--color-title)]">
              {title}
            </span>
            {summary ? (
              <span className="mt-0.5 block text-[11px] font-semibold leading-tight text-[var(--color-text-muted)]">
                {summary}
              </span>
            ) : null}
          </span>
          <svg
            aria-hidden="true"
            className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </h3>
      <div
        aria-labelledby={headerId}
        className="border-t border-[var(--color-border)] p-3"
        hidden={!open}
        id={panelId}
        role="region"
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Producto fisico: encabezado fijo + acordeon de dos secciones (una abierta a la vez). Abre en
 * "Informacion y existencias"; se remonta por producto, asi nunca conserva "Acciones" al cambiar.
 */
function PhysicalProductPanel({
  activeBranchName,
  alerts,
  canAdjustStock,
  canCreatePurchaseOrder,
  canViewOtherBranches,
  row,
  stockProbe,
  onAdjust,
  onClose,
  onCreateOrder,
  onOtherBranches,
  onViewHistory,
  onViewProductTransfers,
}: {
  activeBranchName: string;
  alerts: InventoryAlert[];
  canAdjustStock: boolean;
  canCreatePurchaseOrder: boolean;
  canViewOtherBranches: boolean;
  row: InventoryProductRow;
  stockProbe: StockProbe | null;
  onAdjust: () => void;
  onClose: () => void;
  onCreateOrder: () => void;
  onOtherBranches: () => void;
  onViewHistory?: () => void;
  onViewProductTransfers?: () => void;
}) {
  const baseId = useId();
  const [openSection, setOpenSection] = useState<ProductPanelSection>("information");
  const toggle = (section: Exclude<ProductPanelSection, null>) =>
    setOpenSection((current) => (current === section ? null : section));
  // Desglose fisico/operativo/heredado bajo demanda (una lectura por producto abierto, solo API).
  const probeKey = `${row.branchId}|${row.productId}`;
  const [breakdown, setBreakdown] = useState<{
    key: string;
    value: InventoryStockBreakdown;
  } | null>(null);
  useEffect(() => {
    if (!stockProbe) return;
    let active = true;
    stockProbe.lookup
      .getStockBreakdown({
        branchId: row.branchId,
        productId: row.productId,
        usesLocations: stockProbe.supportsMultipleLocations,
        knownLocations: stockProbe.locations,
      })
      .then((value) => {
        if (active) setBreakdown({ key: probeKey, value });
      })
      .catch(() => {
        // Informativo: si falla el panel conserva las cantidades como "No disponible".
      });
    return () => {
      active = false;
    };
  }, [probeKey, row.branchId, row.productId, stockProbe]);
  const shownRow: InventoryProductRow =
    breakdown?.key === probeKey
      ? {
          ...row,
          physicalQuantity: breakdown.value.physicalQuantity,
          unlocatedQuantity: breakdown.value.legacyQuantity,
          requiresRegularization: breakdown.value.requiresRegularization,
        }
      : row;

  return (
    <section>
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-3 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Producto
          </p>
          <h2 className="mt-0.5 break-words text-base font-bold leading-tight text-[var(--color-title)]">
            {row.productName}
          </h2>
          <p className="mt-0.5 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            {row.sku}
          </p>
          <div className="mt-1.5 [&>span]:px-2 [&>span]:py-1 [&>span]:text-[11px]">
            <InventoryStatusBadge row={row} />
          </div>
        </div>
        <button
          aria-label="Cerrar detalle de producto"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-base font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </header>
      <div className="space-y-2 p-3">
        <PanelAccordionSection
          id={`${baseId}-information`}
          onToggle={() => toggle("information")}
          open={openSection === "information"}
          summary={`${formatStockQuantity(row.sellableAvailableQuantity)} ${row.saleUnitName} disponibles`}
          title="Información y existencias"
        >
          <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Existencias
          </h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
            <CompactTile
              label="Existencia operativa"
              value={`${formatStockQuantity(row.sellableQuantity)} ${row.saleUnitName}`}
            />
            <CompactTile
              label="Reservado (operativo)"
              value={`${formatStockQuantity(row.sellableReservedQuantity)} ${row.saleUnitName}`}
            />
            <CompactTile
              label="Disponible para venta"
              value={`${formatStockQuantity(row.sellableAvailableQuantity)} ${row.saleUnitName}`}
            />
            <CompactTile label="Nivel minimo" value={String(row.minStock)} />
            <CompactTile
              label="Existencia fisica total"
              value={formatOptionalStock(shownRow.physicalQuantity, row.unitName)}
            />
            <CompactTile
              label="Saldo heredado (sin ubicacion)"
              value={formatOptionalStock(shownRow.unlocatedQuantity, row.unitName)}
            />
            {row.inventoryUnitId !== row.unitId ? (
              <>
                <CompactTile
                  label="Presentación inventario"
                  value={`${formatStockQuantity(row.inventoryPresentationQuantity)} ${row.inventoryUnitName}`}
                />
                <CompactTile
                  label="Equivalencia"
                  value={`1 ${row.inventoryUnitName} = ${formatStockQuantity(row.inventoryToBaseFactor)} ${row.unitName}`}
                />
              </>
            ) : null}
            {row.inventoryConversionUnavailableUnitName ? (
              <>
                <CompactTile
                  label="Presentación inventario"
                  value={row.inventoryConversionUnavailableUnitName}
                />
                <CompactTile label="Equivalencia" value="No disponible" />
              </>
            ) : null}
            {row.saleConversionUnavailableUnitName ? (
              <>
                <CompactTile
                  label="Unidad de venta"
                  value={row.saleConversionUnavailableUnitName}
                />
                <CompactTile label="Equivalencia de venta" value="No disponible" />
              </>
            ) : null}
          </dl>
          <OperationalStockNotice canRegularize={canAdjustStock} row={shownRow} />
          <h4 className="mt-3 border-t border-[var(--color-border)] pt-3 text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Información del producto
          </h4>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
            <CompactTile label="Ubicacion" value={row.defaultLocationName} />
            <CompactTile label="Categoria" value={row.categoryName} />
            <CompactTile label="Unidad minima" value={row.unitName} />
            <CompactTile label="Sucursal" value={activeBranchName} />
          </dl>
          <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-2">
            <p className="text-[10px] font-bold uppercase text-blue-800">Reposicion sugerida</p>
            <p className="mt-0.5 text-xs font-semibold text-[var(--color-title)]">
              {formatSuggestedReorder(row)}
            </p>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
            <h4 className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Alertas asociadas
            </h4>
            {alerts.length ? (
              alerts.map((alert) => (
                <p
                  className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-snug text-[var(--color-text)]"
                  key={alert.id}
                >
                  {alert.message}
                </p>
              ))
            ) : (
              <p className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]">
                Sin alertas asociadas.
              </p>
            )}
          </div>
        </PanelAccordionSection>
        <PanelAccordionSection
          id={`${baseId}-actions`}
          onToggle={() => toggle("actions")}
          open={openSection === "actions"}
          title="Acciones"
        >
          <div className="space-y-1.5">
            {canAdjustStock ? (
              <button
                className={cn(
                  PANEL_ACTION_CLASS,
                  "justify-center gap-2 border-[var(--color-primary)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]",
                )}
                onClick={onAdjust}
                type="button"
              >
                <AdjustIcon />
                Ajustar existencias
              </button>
            ) : null}
            <div className="grid grid-cols-1 gap-2 min-[340px]:grid-cols-2">
              {canViewOtherBranches ? (
                <button
                  className={PANEL_SECONDARY_ACTION_CLASS}
                  onClick={onOtherBranches}
                  type="button"
                >
                  <BranchesIcon />
                  <span className="min-w-0">Ver existencias en otras sucursales</span>
                </button>
              ) : null}
              {onViewHistory ? (
                <button
                  className={PANEL_SECONDARY_ACTION_CLASS}
                  onClick={onViewHistory}
                  type="button"
                >
                  <HistoryIcon />
                  <span className="min-w-0">Ver historial de movimientos</span>
                </button>
              ) : null}
              {onViewProductTransfers ? (
                <button
                  className={PANEL_SECONDARY_ACTION_CLASS}
                  onClick={onViewProductTransfers}
                  type="button"
                >
                  <TransferIcon />
                  <span className="min-w-0">Ver solicitudes y traslados</span>
                </button>
              ) : null}
              {canCreatePurchaseOrder ? (
                <button
                  className={PANEL_SECONDARY_ACTION_CLASS}
                  onClick={onCreateOrder}
                  type="button"
                >
                  <PurchaseOrderIcon />
                  <span className="min-w-0">Crear orden de compra</span>
                </button>
              ) : null}
            </div>
          </div>
        </PanelAccordionSection>
      </div>
    </section>
  );
}

/**
 * Detalle de un Kit. La disponibilidad explicativa (componentes y limitantes) se pide SOLO al abrir
 * este panel, una vez por kit/sucursal (y de nuevo si la disponibilidad del listado cambia). Un
 * fallo del endpoint se queda aqui: el resumen de la fila sigue visible.
 */
function KitProductPanel({
  activeBranchName,
  row,
  service,
  onClose,
}: {
  activeBranchName: string;
  row: InventoryProductRow;
  service: GetInventoryKitAvailabilityService | null;
  onClose: () => void;
}) {
  const kitProductId = row.productId;
  const branchId = row.branchId;
  const listAvailable = row.availableQuantity;
  const key = `${branchId}|${kitProductId}`;
  const [state, setState] = useState<{
    key: string;
    availability?: InventoryKitAvailability;
    failed?: boolean;
  } | null>(null);

  useEffect(() => {
    if (!service) return;
    // `active` descarta la respuesta de un kit/sucursal anterior o de un panel ya desmontado.
    let active = true;
    service
      .execute({ kitProductId, branchId })
      .then((availability) => {
        if (active) setState({ key, availability });
      })
      .catch(() => {
        if (active) setState({ key, failed: true });
      });
    return () => {
      active = false;
    };
  }, [service, key, kitProductId, branchId, listAvailable]);

  const current = state?.key === key ? state : null;
  const availability = current?.availability;
  // La lectura del detalle es la mas reciente: se prefiere a la de la fila, sin tocar la fila.
  const availableKits = availability?.availableKits ?? listAvailable;
  const components = availability?.components ?? [];
  const limitingComponents = components.filter((component) => component.limiting);
  const loading = Boolean(service) && !current;
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <section>
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Kit
          </p>
          <h2 className="mt-1 text-xl font-bold text-[var(--color-title)]">{row.productName}</h2>
          <p className="mt-1 text-sm font-semibold uppercase text-[var(--color-text-muted)]">
            {row.sku}
          </p>
        </div>
        <button
          aria-label="Cerrar detalle de kit"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </header>
      <div className="space-y-4 p-4">
        <section className="rounded-lg border border-[var(--color-border)] bg-white p-4">
          <div className="flex justify-between">
            <p className="text-sm font-bold text-[var(--color-title)]">Disponibilidad derivada</p>
            <InventoryStatusBadge
              row={{
                displayStatus: availableKits > 0 ? "KIT_AVAILABLE" : "KIT_UNAVAILABLE",
                statusLabel: row.statusLabel,
              }}
            />
          </div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <DetailTile label="Disponible" value={formatKitCount(availableKits)} />
            <DetailTile label="Categoria" value={row.categoryName} />
            <DetailTile label="Sucursal" value={activeBranchName} />
            <DetailTile label="Ubicacion" value="Calculado por componentes" />
          </dl>
          <p className="mt-4 rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text)]">
            La disponibilidad se calcula a partir de sus componentes.
          </p>
        </section>

        {service ? (
          <section className="rounded-lg border border-[var(--color-border)] bg-white p-4">
            <p className="text-sm text-[var(--color-text-muted)]">
              Consulta qué componentes determinan cuántos Kits pueden formarse.
            </p>
            <Button
              className="mt-3 w-full"
              disabled={loading || !availability}
              onClick={() => setDetailOpen(true)}
              type="button"
              variant="secondary"
            >
              {loading ? "Cargando detalle..." : "Ver detalle de disponibilidad"}
            </Button>
            {current?.failed ? (
              <p className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                No se pudo cargar el detalle de disponibilidad.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
      {availability ? (
        <Modal
          maxWidth="960px"
          onClose={() => setDetailOpen(false)}
          open={detailOpen}
          subtitle={`${row.productName} · ${row.sku}`}
          title="Detalle de disponibilidad del Kit"
        >
          <div className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-3">
              <DetailTile
                label="Disponibilidad derivada"
                value={formatKitCount(availability.availableKits)}
              />
              <DetailTile
                label="Estado"
                value={
                  <InventoryStatusBadge
                    row={{
                      displayStatus: availableKits > 0 ? "KIT_AVAILABLE" : "KIT_UNAVAILABLE",
                      statusLabel: row.statusLabel,
                    }}
                  />
                }
              />
              <DetailTile label="Sucursal" value={activeBranchName} />
            </dl>
            {components.length === 0 ? (
              <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                Este Kit no tiene componentes configurados.
              </p>
            ) : (
              <>
                <div className="rounded-md bg-[var(--color-app-background)] px-3 py-2">
                  <p className="text-sm font-bold text-[var(--color-title)]">
                    {limitingComponents.length === 1
                      ? "Componente limitante"
                      : "Componentes limitantes"}
                  </p>
                  <p className="mt-1 text-sm text-[var(--color-text)]">
                    {limitingComponents.length === 1
                      ? "La disponibilidad del Kit está limitada por este componente."
                      : "Estos componentes limitan conjuntamente la disponibilidad del Kit."}
                  </p>
                </div>
                <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">Componente</th>
                        <th className="px-3 py-2.5 font-semibold">SKU</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Disponible</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Necesario por Kit</th>
                        <th className="px-3 py-2.5 text-right font-semibold">Capacidad</th>
                        <th className="px-3 py-2.5 font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {components.map((component) => (
                        <tr
                          className={cn(
                            "border-t border-[var(--color-border)]",
                            component.limiting && "bg-[var(--color-primary)]/10",
                          )}
                          key={component.componentProductId}
                        >
                          <td className="px-3 py-3 font-semibold text-[var(--color-title)]">
                            {component.productName}
                          </td>
                          <td className="px-3 py-3 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                            {component.sku}
                          </td>
                          <td className="px-3 py-3 text-right">{component.availableQuantity}</td>
                          <td className="px-3 py-3 text-right">{component.quantityPerKit}</td>
                          <td className="px-3 py-3 text-right font-semibold">
                            {formatKitCount(component.kitCapacity)}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2 py-1 text-xs font-bold",
                                component.limiting
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-700",
                              )}
                            >
                              {component.limiting ? "Limitante" : "Normal"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function formatKitCount(count: number) {
  return `${count} ${count === 1 ? "Kit" : "Kits"}`;
}

function DetailTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

/**
 * API: el tracking real del producto se resuelve una sola vez al abrir el ajuste (sin N+1 en el
 * listado). Mock: abre el modal directamente con la fila del read model.
 */
function AdjustStockGate({
  busy,
  locations,
  supportsMultipleLocations,
  lookup,
  countService,
  row,
  onApplyCount,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  locations: StorageLocation[];
  supportsMultipleLocations: boolean;
  lookup: InventoryAdjustmentLookupService | null;
  countService: InventoryCountService | null;
  row: InventoryProductRow;
  onApplyCount: (input: ReconcileCountInput) => Promise<void>;
  onClose: () => void;
  onSubmit: (dto: AdjustStockDto) => Promise<void>;
}) {
  const [resolved, setResolved] = useState<{
    key: string;
    tracking: InventoryProductRow["tracking"];
    operational: Awaited<ReturnType<InventoryAdjustmentLookupService["resolveOperationalStock"]>>;
  } | null>(null);
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null);
  const productId = row.productId;
  const key = `${row.branchId}|${productId}`;

  useEffect(() => {
    if (!lookup) return;
    let active = true;
    // Tracking real y balance operativo real (no el agregado de /inventory/stock).
    Promise.all([
      lookup.resolveTracking(productId),
      lookup.resolveOperationalStock({
        branchId: row.branchId,
        productId,
        usesLocations: supportsMultipleLocations,
        knownLocations: locations,
      }),
    ])
      .then(([tracking, operational]) => {
        if (active) setResolved({ key, tracking, operational });
      })
      .catch((caughtError) => {
        if (active) {
          setLoadError({
            key,
            message:
              caughtError instanceof Error
                ? caughtError.message
                : "No se pudo cargar la trazabilidad del producto.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [locations, lookup, key, productId, row.branchId, supportsMultipleLocations]);

  if (!lookup) {
    return (
      <AdjustStockModal
        busy={busy}
        locations={locations}
        supportsMultipleLocations={supportsMultipleLocations}
        lookup={null}
        countService={null}
        onApplyCount={onApplyCount}
        open
        row={row}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
  }
  if (resolved?.key === key) {
    return (
      <AdjustStockModal
        busy={busy}
        locations={locations}
        supportsMultipleLocations={supportsMultipleLocations}
        lookup={lookup}
        countService={countService}
        onApplyCount={onApplyCount}
        open
        row={{
          ...row,
          tracking: resolved.tracking,
          tracksExpiration: resolved.tracking.expiration,
          quantity: resolved.operational.quantity,
          availableQuantity: resolved.operational.availableQuantity,
          hasStockOutsideOperationalBalance: resolved.operational.hasStockElsewhere,
        }}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
  }
  return (
    <Modal
      maxWidth="480px"
      onClose={onClose}
      open
      subtitle={row.productName}
      title="Registrar ajuste de inventario"
    >
      {loadError?.key === key ? (
        <InlineAlert title={loadError.message} tone="danger" />
      ) : (
        <p className="text-sm font-semibold text-[var(--color-text-muted)]">
          Cargando trazabilidad del producto...
        </p>
      )}
    </Modal>
  );
}

function AdjustStockModal({
  busy,
  locations,
  supportsMultipleLocations,
  lookup,
  countService,
  onApplyCount,
  open,
  row,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  locations: StorageLocation[];
  supportsMultipleLocations: boolean;
  lookup: InventoryAdjustmentLookupService | null;
  countService: InventoryCountService | null;
  onApplyCount: (input: ReconcileCountInput) => Promise<void>;
  open: boolean;
  row: InventoryProductRow;
  onClose: () => void;
  onSubmit: (dto: AdjustStockDto) => Promise<void>;
}) {
  // La ubicacion se deriva solo de la configuracion producto+sucursal; nunca de la primera opcion.
  const operationalLocation = supportsMultipleLocations
    ? locations.find(
        (location) =>
          location.id === row.defaultLocationId && location.status === LocationStatus.active,
      )
    : undefined;
  const defaultLocationId = operationalLocation?.id ?? "";
  const [value, setValue] = useState<EditableAdjustStockDto>(() => ({
    productId: row.productId,
    branchId: row.branchId,
    locationId: defaultLocationId,
    unitId: row.unitId,
    movementKind: "in",
    quantity: 1,
    reason: "",
    notes: "",
    serialNumbersText: "",
  }));
  const [errors, setErrors] = useState<AdjustmentValidationErrors>({});
  // El modal opera contra una sola ubicacion. En API, /inventory/stock ya es el read model
  // autoritativo; en mock se usa exclusivamente el balance de la ubicacion configurada.
  const operationalStock = useMemo(
    () =>
      lookup
        ? { quantity: row.quantity, availableQuantity: row.availableQuantity }
        : !supportsMultipleLocations || !value.locationId
          ? {
              quantity: row.unlocatedQuantity ?? 0,
              availableQuantity: row.unlocatedAvailableQuantity ?? 0,
            }
          : {
              quantity: row.locationQuantities[value.locationId] ?? 0,
              availableQuantity: row.locationAvailableQuantities[value.locationId] ?? 0,
            },
    [
      lookup,
      row.availableQuantity,
      row.locationAvailableQuantities,
      row.locationQuantities,
      row.quantity,
      row.unlocatedAvailableQuantity,
      row.unlocatedQuantity,
      supportsMultipleLocations,
      value.locationId,
    ],
  );
  const selectedUnit =
    row.adjustmentUnits.find((option) => option.unitId === value.unitId) ?? row.adjustmentUnits[0];
  const canonicalInputQuantity = toFiniteNumber(value.quantity) * (selectedUnit?.toBaseFactor ?? 1);
  const finalQuantity =
    value.movementKind === "in"
      ? operationalStock.quantity + canonicalInputQuantity
      : value.movementKind === "out" || value.movementKind === "waste"
        ? operationalStock.quantity - canonicalInputQuantity
        : canonicalInputQuantity;
  const delta = finalQuantity - operationalStock.quantity;
  const traceQuantity = Math.abs(delta);
  const isEntry = delta > 0;
  const parsedSerials = parseSerialNumbers(value.serialNumbersText);
  const dynamicLookup = lookup !== null;
  const repeatedSerials = findRepeatedSerialNumbers(parsedSerials);
  const needsLotLookup = dynamicLookup && !isEntry && traceQuantity > 0 && row.tracking.lot;
  const needsSerialLookup =
    dynamicLookup &&
    !isEntry &&
    traceQuantity > 0 &&
    row.tracking.serial &&
    (!row.tracking.lot || Boolean(value.lotId));
  const lotsKey = `${row.branchId}|${row.productId}|${value.locationId}`;
  const serialsKey = `${lotsKey}|${value.lotId ?? ""}`;
  const [lotsState, setLotsState] = useState<{
    key: string;
    items: AdjustmentLotOption[];
    error?: string;
  } | null>(null);
  const [serialsState, setSerialsState] = useState<{
    key: string;
    items: AdjustmentSerialOption[];
    error?: string;
  } | null>(null);
  const branchId = row.branchId;
  const productId = row.productId;
  const locationId = value.locationId;
  const selectedLotId = value.lotId;

  // Lotes existentes con disponibilidad real; se recargan al cambiar ubicacion y se ignoran las
  // respuestas viejas (cleanup) para no mostrar datos de otra ubicacion.
  useEffect(() => {
    if (!lookup || !needsLotLookup) return;
    let active = true;
    lookup
      .listLots({ branchId, productId, locationId: locationId || undefined })
      .then((items) => {
        if (active) setLotsState({ key: lotsKey, items });
      })
      .catch((caughtError) => {
        if (active) {
          setLotsState({
            key: lotsKey,
            items: [],
            error:
              caughtError instanceof Error
                ? caughtError.message
                : "No se pudieron cargar los lotes.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, locationId, lookup, lotsKey, needsLotLookup, productId]);

  useEffect(() => {
    if (!lookup || !needsSerialLookup) return;
    let active = true;
    lookup
      .listSerials({
        branchId,
        productId,
        locationId: locationId || undefined,
        lotId: selectedLotId || undefined,
      })
      .then((items) => {
        if (active) setSerialsState({ key: serialsKey, items });
      })
      .catch((caughtError) => {
        if (active) {
          setSerialsState({
            key: serialsKey,
            items: [],
            error:
              caughtError instanceof Error
                ? caughtError.message
                : "No se pudieron cargar las series.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [branchId, locationId, lookup, needsSerialLookup, productId, selectedLotId, serialsKey]);

  const serialPrecheck = useSerialBatchPrecheck({
    serials: parsedSerials,
    enabled: dynamicLookup && row.tracking.serial && isEntry && traceQuantity > 0,
    validate: (serials) =>
      lookup
        ? lookup.validateNewSerials({ productId, serialNumbers: serials })
        : Promise.resolve({ duplicates: [] }),
  });
  const currentLots = lotsState?.key === lotsKey ? lotsState : null;
  const currentSerials = serialsState?.key === serialsKey ? serialsState : null;
  const lookupLoading = (needsLotLookup && !currentLots) || (needsSerialLookup && !currentSerials);
  const lookupError =
    (needsLotLookup && currentLots?.error) || (needsSerialLookup && currentSerials?.error) || null;
  const availableLots = dynamicLookup
    ? (currentLots?.items ?? []).map((lot) => ({
        id: lot.lotId,
        lotNumber: lot.lotNumber,
        expirationDate: lot.expirationDate,
        // Capacidad de salida = disponible (nunca la cantidad fisica).
        quantity: lot.availableQuantity,
        locationId: lot.locationId,
      }))
    : row.availableLots.filter((lot) => !value.locationId || lot.locationId === value.locationId);
  if (dynamicLookup) {
    // Orden FEFO solo informativo (vencimiento asc, luego lote); nunca se autoselecciona.
    availableLots.sort(
      (left, right) =>
        (left.expirationDate ?? "9999-12-31").localeCompare(right.expirationDate ?? "9999-12-31") ||
        left.lotNumber.localeCompare(right.lotNumber),
    );
  }
  const selectedLot = availableLots.find((lot) => lot.id === value.lotId);
  const noLotsAvailable =
    needsLotLookup && currentLots !== null && !currentLots.error && availableLots.length === 0;
  const availableSerials = dynamicLookup
    ? (currentSerials?.items ?? []).map((serial) => ({
        serialNumber: serial.serialNumber,
        lotId: serial.lotId,
        locationId: serial.locationId,
      }))
    : row.availableSerials.filter(
        (serial) =>
          (!value.locationId || serial.locationId === value.locationId) &&
          (!value.lotId || serial.lotId === value.lotId),
      );
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Conteo de producto trazable (solo API): flujo separado de snapshot -> revision -> reconcile.
  const traceableCount =
    countService !== null &&
    value.movementKind === "count" &&
    (row.tracking.lot || row.tracking.expiration || row.tracking.serial);
  const adjustmentDto = toAdjustStockDto(value);
  const adjustmentValidationErrors = validateAdjustment(
    { ...adjustmentDto, quantity: canonicalInputQuantity },
    row,
    operationalStock,
    undefined,
    // Un producto heredado sin asignacion opera su balance sin ubicacion: no exige ubicacion.
    supportsMultipleLocations && Boolean(row.defaultLocationId),
  );
  if (
    lookup &&
    row.hasStockOutsideOperationalBalance &&
    (value.movementKind === "in" || value.movementKind === "count")
  ) {
    adjustmentValidationErrors.locationId = STOCK_ELSEWHERE_ADJUSTMENT_MESSAGE;
  }
  const adjustmentQuantityError = getUnitQuantityInputError(
    value.quantity,
    selectedUnit?.unitAllowsDecimals ?? false,
  );
  if (adjustmentQuantityError) adjustmentValidationErrors.quantity = adjustmentQuantityError;
  if (dynamicLookup) {
    if (isEntry && row.tracking.serial && traceQuantity > 0) {
      if (repeatedSerials.length > 0) {
        adjustmentValidationErrors.serialNumbers = `Series repetidas: ${repeatedSerials.join(", ")}.`;
      } else if (serialPrecheck.remoteDuplicates.length > 0) {
        adjustmentValidationErrors.serialNumbers = `Series ya registradas: ${serialPrecheck.remoteDuplicates.join(", ")}.`;
      }
    }
    if (!isEntry && selectedLot && traceQuantity > selectedLot.quantity) {
      adjustmentValidationErrors.lotId = "El lote no tiene suficientes unidades disponibles.";
    }
  }
  const adjustmentInvalid = hasValidationErrors(adjustmentValidationErrors) || lookupLoading;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (traceableCount) return;
    setErrors(adjustmentValidationErrors);
    if (adjustmentInvalid) return;
    setSubmitError(null);
    try {
      await onSubmit(adjustmentDto);
    } catch (caughtError) {
      setSubmitError(
        caughtError instanceof Error ? caughtError.message : "No se pudo registrar el ajuste.",
      );
    }
  }

  // No se permite capturar una salida superior a lo disponible (lote seleccionado o existencia).
  function clampOutQuantity(rawPatch: Partial<EditableAdjustStockDto>) {
    if (!dynamicLookup || typeof rawPatch.quantity !== "number") return rawPatch;
    const kind = rawPatch.movementKind ?? value.movementKind;
    if (kind !== "out" && kind !== "waste") return rawPatch;
    const unit =
      row.adjustmentUnits.find((option) => option.unitId === (rawPatch.unitId ?? value.unitId)) ??
      row.adjustmentUnits[0];
    const capacityBase = selectedLot ? selectedLot.quantity : operationalStock.availableQuantity;
    const maxInput = Math.floor((capacityBase / (unit?.toBaseFactor ?? 1)) * 1000) / 1000;
    return rawPatch.quantity > maxInput ? { ...rawPatch, quantity: maxInput } : rawPatch;
  }

  function update(rawPatch: Partial<EditableAdjustStockDto>) {
    const patch = clampOutQuantity(rawPatch);
    const nextValue = { ...value, ...patch };
    const nextSelectedUnit =
      row.adjustmentUnits.find((option) => option.unitId === nextValue.unitId) ??
      row.adjustmentUnits[0];
    const nextCanonicalQuantity =
      toFiniteNumber(nextValue.quantity) * (nextSelectedUnit?.toBaseFactor ?? 1);
    const nextValidationErrors = validateAdjustment(
      { ...toAdjustStockDto(nextValue), quantity: nextCanonicalQuantity },
      row,
      lookup
        ? { quantity: row.quantity, availableQuantity: row.availableQuantity }
        : !supportsMultipleLocations || !nextValue.locationId
          ? {
              quantity: row.unlocatedQuantity ?? 0,
              availableQuantity: row.unlocatedAvailableQuantity ?? 0,
            }
          : {
              quantity: row.locationQuantities[nextValue.locationId] ?? 0,
              availableQuantity: row.locationAvailableQuantities[nextValue.locationId] ?? 0,
            },
      undefined,
      supportsMultipleLocations && Boolean(row.defaultLocationId),
    );
    const nextQuantityError = getUnitQuantityInputError(
      nextValue.quantity,
      nextSelectedUnit?.unitAllowsDecimals ?? false,
    );
    if (nextQuantityError) nextValidationErrors.quantity = nextQuantityError;
    const affectedFields = new Set<keyof AdjustmentValidationErrors>();
    if (patch.locationId !== undefined) {
      affectedFields.add("locationId");
      affectedFields.add("lotId");
      affectedFields.add("serialNumbers");
    }
    if (
      patch.movementKind !== undefined ||
      patch.unitId !== undefined ||
      patch.quantity !== undefined
    ) {
      affectedFields.add("quantity");
      affectedFields.add("lotId");
      affectedFields.add("lotNumber");
      affectedFields.add("expirationDate");
      affectedFields.add("serialNumbers");
    }
    if (patch.lotId !== undefined) affectedFields.add("lotId");
    if (patch.lotNumber !== undefined) affectedFields.add("lotNumber");
    if (patch.expirationDate !== undefined) affectedFields.add("expirationDate");
    if (patch.serialNumbersText !== undefined) affectedFields.add("serialNumbers");
    if (patch.reason !== undefined) affectedFields.add("reason");
    if (patch.notes !== undefined) affectedFields.add("notes");
    setValue(nextValue);
    setErrors((current) => {
      const nextErrors = { ...current };
      for (const field of affectedFields) {
        if (!current[field]) continue;
        if (nextValidationErrors[field]) nextErrors[field] = nextValidationErrors[field];
        else delete nextErrors[field];
      }
      return nextErrors;
    });
  }

  return (
    <Modal
      footer={
        traceableCount ? undefined : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={onClose} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button disabled={busy || adjustmentInvalid} form="inventory-adjust-form" type="submit">
              {busy ? "Registrando..." : "Confirmar ajuste"}
            </Button>
          </div>
        )
      }
      onClose={onClose}
      open={open}
      maxWidth="720px"
      subtitle={row.productName}
      title="Registrar ajuste de inventario"
    >
      <form className="space-y-4" id="inventory-adjust-form" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ReadonlyField label="Producto" value={row.productName} />
          <ReadonlyField label="Codigo" value={row.sku} />
          <ReadonlyField label="Existencia ajustable" value={String(operationalStock.quantity)} />
          <ReadonlyField
            label="Disponible ajustable"
            value={String(operationalStock.availableQuantity)}
          />
          <ReadonlyField label="Nivel minimo" value={String(row.minStock)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {supportsMultipleLocations ? (
            <div className="space-y-2">
              <ReadonlyField
                label="Ubicacion operativa asignada"
                value={
                  operationalLocation
                    ? `${operationalLocation.code} - ${operationalLocation.name}`
                    : row.defaultLocationId
                      ? "Sin ubicacion operativa activa"
                      : "Balance sin ubicacion (historico)"
                }
              />
              {(errors.locationId ?? adjustmentValidationErrors.locationId) ? (
                <p className="text-sm font-semibold text-[var(--color-danger)]">
                  {errors.locationId ?? adjustmentValidationErrors.locationId}
                </p>
              ) : null}
            </div>
          ) : null}
          <Field id="adjust-kind" label="Tipo de ajuste">
            <Select
              id="adjust-kind"
              onChange={(event) =>
                update({
                  movementKind: event.target.value as AdjustStockDto["movementKind"],
                  lotId: undefined,
                  lotNumber: "",
                  expirationDate: "",
                  serialNumbersText: "",
                })
              }
              value={value.movementKind}
            >
              <option value="in">Entrada manual</option>
              <option value="out">Salida manual</option>
              <option value="waste">Merma</option>
              <option value="count">Conteo / Correccion exacta</option>
            </Select>
          </Field>
        </div>
        {traceableCount && countService ? (
          <TraceableCountFlow
            busy={busy}
            countService={countService}
            locationId={value.locationId}
            row={row}
            onApply={onApplyCount}
            onCancel={onClose}
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="adjust-unit" label="Unidad">
                <Select
                  id="adjust-unit"
                  onChange={(event) =>
                    update({ unitId: event.target.value, serialNumbersText: "" })
                  }
                  value={value.unitId}
                >
                  {row.adjustmentUnits.map((option) => (
                    <option key={option.unitId} value={option.unitId}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="adjust-quantity"
                label={value.movementKind === "count" ? "Existencia fisica contada" : "Cantidad"}
                error={errors.quantity ?? adjustmentValidationErrors.quantity}
              >
                <Input
                  id="adjust-quantity"
                  inputMode={selectedUnit?.unitAllowsDecimals ? "decimal" : "numeric"}
                  maxLength={selectedUnit?.unitAllowsDecimals ? 12 : 6}
                  onChange={(event) =>
                    update({
                      quantity: parseUnitQuantityInput(
                        event.target.value,
                        selectedUnit?.unitAllowsDecimals ?? false,
                      ),
                    })
                  }
                  type="text"
                  value={value.quantity}
                />
              </Field>
            </div>
            {selectedUnit && selectedUnit.toBaseFactor !== 1 ? (
              <p className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-title)]">
                {toFiniteNumber(value.quantity)} {selectedUnit.unitName} = {canonicalInputQuantity}{" "}
                {row.unitName}
              </p>
            ) : null}
            {row.tracking.lot && traceQuantity > 0 ? (
              isEntry ? (
                <Field id="adjust-lot-number" label="Lote *" error={errors.lotNumber}>
                  <Input
                    id="adjust-lot-number"
                    maxLength={TEXT_LIMITS.lotNumber}
                    onChange={(event) => update({ lotNumber: event.target.value })}
                    value={value.lotNumber ?? ""}
                  />
                </Field>
              ) : (
                <Field id="adjust-lot" label="Lote existente *" error={errors.lotId}>
                  <Select
                    disabled={lookupLoading}
                    id="adjust-lot"
                    onChange={(event) =>
                      update({ lotId: event.target.value, serialNumbersText: "" })
                    }
                    value={value.lotId ?? ""}
                  >
                    <option value="">Seleccionar lote</option>
                    {availableLots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.lotNumber} · {lot.quantity} disponibles
                        {lot.expirationDate ? ` · vence ${formatLotDate(lot.expirationDate)}` : ""}
                      </option>
                    ))}
                  </Select>
                  {noLotsAvailable ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--color-danger)]">
                      No hay lotes disponibles para este producto en la ubicacion seleccionada.
                    </p>
                  ) : null}
                  {selectedLot && selectedLot.quantity < traceQuantity ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--color-danger)]">
                      El lote no tiene suficientes unidades.
                    </p>
                  ) : null}
                </Field>
              )
            ) : null}
            {row.tracking.expiration && isEntry && traceQuantity > 0 ? (
              <Field
                id="adjust-expiration"
                label="Fecha de vencimiento *"
                error={errors.expirationDate}
              >
                <Input
                  id="adjust-expiration"
                  min={getLocalCalendarDate()}
                  type="date"
                  onChange={(event) => update({ expirationDate: event.target.value })}
                  value={value.expirationDate ?? ""}
                />
              </Field>
            ) : null}
            {row.tracking.serial && traceQuantity > 0 ? (
              <Field
                id="adjust-serials"
                label={isEntry ? "Numeros de serie nuevos *" : "Series existentes que salen *"}
                error={errors.serialNumbers}
              >
                {isEntry ? (
                  <textarea
                    id="adjust-serials"
                    className="min-h-32 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
                    maxLength={TEXT_LIMITS.serialNumbers}
                    placeholder="Una serie por linea"
                    onChange={(event) => update({ serialNumbersText: event.target.value })}
                    value={value.serialNumbersText}
                  />
                ) : (
                  <SerialPicker
                    disabled={lookupLoading}
                    options={availableSerials.map((serial) => serial.serialNumber)}
                    required={traceQuantity}
                    selected={parsedSerials}
                    onChange={(next) => update({ serialNumbersText: next.join("\n") })}
                  />
                )}
                <p className="mt-1 text-sm font-semibold text-[var(--color-text-muted)]">
                  Cantidad del ajuste: {traceQuantity} {row.unitName}. Seriales requeridos:{" "}
                  {traceQuantity}. Registrados: {parsedSerials.length} / {traceQuantity}.
                </p>
                {isEntry && dynamicLookup && serialPrecheck.unavailable ? (
                  <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
                    No se pudo validar los seriales en este momento; se validaran al confirmar.
                  </p>
                ) : null}
              </Field>
            ) : null}
            {lookupLoading ? (
              <p className="text-sm font-semibold text-[var(--color-text-muted)]">
                Cargando lotes y series disponibles...
              </p>
            ) : null}
            {lookupError ? <InlineAlert title={lookupError} tone="danger" /> : null}
            <Field id="adjust-reason" label="Motivo *" error={errors.reason}>
              <textarea
                className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
                id="adjust-reason"
                maxLength={TEXT_LIMITS.reason}
                onChange={(event) => update({ reason: event.target.value })}
                value={value.reason}
              />
              <CharacterCount current={value.reason.length} maximum={TEXT_LIMITS.reason} />
            </Field>
            <Field id="adjust-notes" label="Observaciones" error={errors.notes}>
              <textarea
                className="min-h-16 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
                id="adjust-notes"
                maxLength={TEXT_LIMITS.notes}
                onChange={(event) => update({ notes: event.target.value })}
                value={value.notes}
              />
              <CharacterCount current={value.notes.length} maximum={TEXT_LIMITS.notes} />
            </Field>
            <AdjustmentSummary
              currentQuantity={operationalStock.quantity}
              delta={delta}
              finalQuantity={finalQuantity}
              row={row}
              value={value}
            />
          </>
        )}
        {submitError ? <InlineAlert title={submitError} tone="danger" /> : null}
      </form>
    </Modal>
  );
}

function AdjustmentSummary({
  currentQuantity,
  delta,
  finalQuantity,
  row,
  value,
}: {
  /** Saldo del balance que realmente se modifica (no el total fisico de la sucursal). */
  currentQuantity: number;
  delta: number;
  finalQuantity: number;
  row: InventoryProductRow;
  value: EditableAdjustStockDto;
}) {
  return (
    <dl className="grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="font-semibold text-[var(--color-text-muted)]">Stock actual</dt>
        <dd className="font-bold text-[var(--color-title)]">
          {currentQuantity} {row.unitName}
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-[var(--color-text-muted)]">
          {getAdjustmentSummaryLabel(value.movementKind)}
        </dt>
        <dd className={cn("font-bold", delta < 0 ? "text-red-700" : "text-emerald-700")}>
          {formatAdjustmentDelta(delta)} {row.unitName}
        </dd>
      </div>
      <div>
        <dt className="font-semibold text-[var(--color-text-muted)]">Stock resultante</dt>
        <dd className="font-bold text-[var(--color-title)]">
          {finalQuantity} {row.unitName}
        </dd>
      </div>
    </dl>
  );
}

function OtherBranchesStockModal({
  open,
  activeBranchId,
  row,
  service,
  canManageTransfers,
  onClose,
  onRequest,
}: {
  open: boolean;
  activeBranchId: string;
  row: InventoryProductRow;
  service: InventoryOtherBranchesService | null;
  canManageTransfers: boolean;
  onClose: () => void;
  onRequest: (providerBranchId: string) => void;
}) {
  return (
    <Modal
      maxWidth="720px"
      onClose={onClose}
      open={open}
      subtitle={row.productName}
      title="Existencias en otras sucursales"
    >
      {service ? (
        <ApiOtherBranchesList
          activeBranchId={activeBranchId}
          productId={row.productId}
          service={service}
          unitName={row.unitName}
        />
      ) : (
        <div className="space-y-3">
          {row.otherBranchStocks.length === 0 ? (
            <p className="rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
              No hay otras sucursales configuradas para comparar existencias.
            </p>
          ) : (
            row.otherBranchStocks.map((stock) => (
              <div
                className="grid gap-3 rounded-lg border border-[var(--color-border)] p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={stock.branchId}
              >
                <div className="min-w-0">
                  <p className="font-bold text-[var(--color-title)]">{stock.branchName}</p>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Disponible: {stock.availableQuantity} {row.unitName}
                  </p>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                    Stock fisico {stock.quantity} - Reservado {stock.reservedQuantity}
                  </p>
                </div>
                <Button
                  disabled={!canManageTransfers || stock.availableQuantity <= 0}
                  onClick={() => onRequest(stock.branchId)}
                  type="button"
                  variant="secondary"
                >
                  Solicitar traslado
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </Modal>
  );
}

/** API: una request por apertura; solo disponibilidad operacional (sin stock fisico/reservado). */
function ApiOtherBranchesList({
  activeBranchId,
  productId,
  service,
  unitName,
}: {
  activeBranchId: string;
  productId: string;
  service: InventoryOtherBranchesService;
  unitName: string;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "success"; items: OtherBranchAvailability[] }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    service
      .execute({ productId, branchId: activeBranchId })
      .then((items) => {
        if (active) setState({ status: "success", items });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [activeBranchId, productId, service]);

  if (state.status === "loading") {
    return (
      <p className="text-sm font-semibold text-[var(--color-text-muted)]">
        Cargando existencias en otras sucursales...
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <InlineAlert
        title="No se pudieron cargar las existencias de otras sucursales."
        tone="danger"
      />
    );
  }
  if (state.items.length === 0) {
    return (
      <p className="rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
        No hay otras sucursales disponibles para consultar.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 text-xs font-bold uppercase text-[var(--color-text-muted)] sm:grid">
        <span>Sucursal</span>
        <span>Disponible</span>
      </div>
      {state.items.map((stock) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-[var(--color-border)] p-3"
          key={stock.branchId}
        >
          <p className="min-w-0 break-words font-bold text-[var(--color-title)]">
            {stock.branchName}
          </p>
          <p className="text-sm font-semibold text-[var(--color-title)]">
            {stock.availableQuantity} {unitName}
          </p>
        </div>
      ))}
    </div>
  );
}

type ApiTransferProvidersState =
  | { contextKey: string; status: "loading"; items: OtherBranchAvailability[] }
  | { contextKey: string; status: "error"; items: OtherBranchAvailability[] }
  | { contextKey: string; status: "success"; items: OtherBranchAvailability[] };

export function RequestTransferModal({
  apiMode,
  branches,
  busy = false,
  open,
  providerBranchId,
  row,
  service,
  onClose,
  onSubmit,
}: {
  apiMode: boolean;
  branches: Branch[];
  busy?: boolean;
  open: boolean;
  providerBranchId: string | null;
  row: InventoryProductRow;
  service: InventoryOtherBranchesService | null;
  onClose: () => void;
  onSubmit: (dto: TransferRequestDto) => Promise<void>;
}) {
  const submittingRef = useRef(false);
  const providerRequestIdRef = useRef(0);
  const [submitError, setSubmitError] = useState("");
  const providerContextKey = `${row.branchId}:${row.productId}`;
  const [apiProvidersState, setApiProvidersState] = useState<ApiTransferProvidersState>(() => ({
    contextKey: providerContextKey,
    status: "loading",
    items: [],
  }));
  const currentApiProvidersState = useMemo<ApiTransferProvidersState>(() => {
    if (!service && apiMode) {
      return { contextKey: providerContextKey, status: "error", items: [] };
    }
    return apiProvidersState.contextKey === providerContextKey
      ? apiProvidersState
      : { contextKey: providerContextKey, status: "loading", items: [] };
  }, [apiMode, apiProvidersState, providerContextKey, service]);
  const availableProviders = useMemo(() => {
    if (!apiMode) return row.otherBranchStocks;
    if (currentApiProvidersState.status !== "success") return [];
    return currentApiProvidersState.items.filter((stock) => {
      if (stock.branchId === row.branchId || stock.availableQuantity <= 0) return false;
      const knownBranch = branches.find((branch) => branch.id === stock.branchId);
      return !knownBranch || knownBranch.status === BranchStatus.active;
    });
  }, [apiMode, branches, currentApiProvidersState, row.branchId, row.otherBranchStocks]);
  const firstProviderWithStock = availableProviders.find((stock) => stock.availableQuantity > 0);
  const initialProvider =
    providerBranchId ??
    (apiMode ? "" : firstProviderWithStock?.branchId ?? availableProviders[0]?.branchId ?? "");
  const [value, setValue] = useState<EditableTransferRequestDto>(() => ({
    productId: row.productId,
    requesterBranchId: row.branchId,
    providerBranchId: initialProvider,
    quantity: 1,
    reason: TRANSFER_REASONS[0].value,
    notes: "",
  }));
  const [errors, setErrors] = useState<TransferValidationErrors>({});
  const effectiveProviderBranchId = availableProviders.some(
    (stock) => stock.branchId === value.providerBranchId,
  )
    ? value.providerBranchId
    : (availableProviders[0]?.branchId ?? "");
  const selectedProvider = availableProviders.find(
    (stock) => stock.branchId === effectiveProviderBranchId,
  );
  const transferDto = toTransferRequestDto({
    ...value,
    providerBranchId: effectiveProviderBranchId,
  });
  const transferValidationErrors = validateTransfer(transferDto, row, availableProviders);
  const transferQuantityError = getUnitQuantityInputError(value.quantity, row.unitAllowsDecimals);
  if (transferQuantityError) transferValidationErrors.quantity = transferQuantityError;
  const transferInvalid = hasValidationErrors(transferValidationErrors);
  const providersLoading = apiMode && currentApiProvidersState.status === "loading";

  useEffect(() => {
    if (!apiMode) return;
    const requestId = ++providerRequestIdRef.current;
    let active = true;
    if (!service) return;
    void service
      .execute({ productId: row.productId, branchId: row.branchId })
      .then((items) => {
        if (!active || requestId !== providerRequestIdRef.current) return;
        setApiProvidersState({ contextKey: providerContextKey, status: "success", items });
      })
      .catch(() => {
        if (!active || requestId !== providerRequestIdRef.current) return;
        setApiProvidersState({ contextKey: providerContextKey, status: "error", items: [] });
      });
    return () => {
      active = false;
    };
  }, [apiMode, providerContextKey, row.branchId, row.productId, service]);

  function update(patch: Partial<EditableTransferRequestDto>) {
    const nextValue = { ...value, ...patch };
    const nextDto = toTransferRequestDto(nextValue);
    const nextValidationErrors = validateTransfer(nextDto, row, availableProviders);
    const nextQuantityError = getUnitQuantityInputError(nextValue.quantity, row.unitAllowsDecimals);
    if (nextQuantityError) nextValidationErrors.quantity = nextQuantityError;
    const affectedFields = new Set<keyof TransferValidationErrors>();
    if (patch.providerBranchId !== undefined) affectedFields.add("providerBranchId");
    if (patch.quantity !== undefined) affectedFields.add("quantity");
    if (patch.reason !== undefined) affectedFields.add("reason");
    if (patch.notes !== undefined) affectedFields.add("notes");
    setValue(nextValue);
    setErrors((current) => {
      const nextErrors = { ...current };
      for (const field of affectedFields) {
        if (!current[field]) continue;
        if (nextValidationErrors[field]) nextErrors[field] = nextValidationErrors[field];
        else delete nextErrors[field];
      }
      return nextErrors;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(transferValidationErrors);
    if (transferInvalid) return;
    if (busy || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitError("");
    try {
      await onSubmit(transferDto);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "No se pudo crear el traslado.");
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <Modal
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button disabled={busy} onClick={onClose} type="button" variant="secondary">
            Cerrar
          </Button>
          <Button
            disabled={transferInvalid || busy || providersLoading}
            form="inventory-transfer-request-form"
            type="submit"
            variant="secondary"
          >
            Solicitar traslado
          </Button>
        </div>
      }
      maxWidth="680px"
      onClose={() => {
        if (!busy && !submittingRef.current) onClose();
      }}
      open={open}
      subtitle={row.productName}
      title="Solicitar traslado de producto"
    >
      <form className="space-y-4" id="inventory-transfer-request-form" onSubmit={submit}>
        {submitError ? <InlineAlert title={submitError} tone="danger" /> : null}
        {providersLoading ? (
          <p className="text-sm font-semibold text-[var(--color-text-muted)]">
            Cargando sucursales proveedoras...
          </p>
        ) : null}
        {apiMode && currentApiProvidersState.status === "error" ? (
          <InlineAlert
            title="No se pudieron cargar las sucursales proveedoras."
            tone="danger"
          />
        ) : null}
        {apiMode &&
        currentApiProvidersState.status === "success" &&
        availableProviders.length === 0 ? (
          <p className="rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)]">
            No hay sucursales proveedoras con existencias disponibles.
          </p>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          <ReadonlyField label="Producto" value={row.productName} />
          <ReadonlyField label="Codigo" value={row.sku} />
          <ReadonlyField label="Sucursal solicitante" value={row.branchName} />
          <ReadonlyField
            label="Sucursal proveedora"
            value={selectedProvider?.branchName ?? "Sin sucursal seleccionada"}
          />
          <ReadonlyField
            label="Existencia conocida"
            value={`${selectedProvider?.availableQuantity ?? 0} ${row.unitName}`}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            id="transfer-provider"
            label="Sucursal proveedora *"
            error={errors.providerBranchId}
          >
            <Select
              disabled={
                busy ||
                providersLoading ||
                (apiMode && currentApiProvidersState.status !== "success") ||
                availableProviders.length === 0
              }
              id="transfer-provider"
              onChange={(event) => update({ providerBranchId: event.target.value })}
              value={effectiveProviderBranchId}
            >
              {availableProviders.length === 0 ? (
                <option value="">
                  {providersLoading ? "Cargando sucursales..." : "Sin sucursales disponibles"}
                </option>
              ) : null}
              {availableProviders.map((stock) => (
                <option
                  disabled={stock.availableQuantity <= 0}
                  key={stock.branchId}
                  value={stock.branchId}
                >
                  {stock.branchName} - disponible {stock.availableQuantity}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="transfer-quantity"
            label="Cantidad solicitada *"
            error={errors.quantity ?? transferValidationErrors.quantity}
          >
            <Input
              id="transfer-quantity"
              inputMode={row.unitAllowsDecimals ? "decimal" : "numeric"}
              maxLength={row.unitAllowsDecimals ? 12 : 6}
              onChange={(event) =>
                update({
                  quantity: parseUnitQuantityInput(event.target.value, row.unitAllowsDecimals),
                })
              }
              type="text"
              value={value.quantity}
            />
          </Field>
        </div>
        <Field id="transfer-reason" label="Motivo *" error={errors.reason}>
          <Select
            id="transfer-reason"
            onChange={(event) => update({ reason: event.target.value as InventoryTransferReason })}
            value={value.reason}
          >
            {TRANSFER_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="transfer-notes" label="Descripcion / observaciones" error={errors.notes}>
          <textarea
            className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
            id="transfer-notes"
            maxLength={TEXT_LIMITS.notes}
            onChange={(event) => update({ notes: event.target.value })}
            value={value.notes}
          />
          <CharacterCount current={value.notes.length} maximum={TEXT_LIMITS.notes} />
        </Field>
      </form>
    </Modal>
  );
}

function TransferRequestDetailModal({
  open,
  request,
  busy,
  canManageTransfers,
  onApprove,
  onClose,
  onReject,
}: {
  open: boolean;
  request: InventoryTransferRequestRow;
  busy: boolean;
  canManageTransfers: boolean;
  onApprove: () => Promise<void>;
  onClose: () => void;
  onReject: (reason: string) => Promise<void>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function confirmReject() {
    if (!reason.trim()) {
      setError("Ingresa el motivo del rechazo.");
      return;
    }
    await onReject(reason);
    setRejecting(false);
  }

  const isReceivedRequest =
    request.context === "received" && request.status === InventoryTransferRequestStatus.requested;

  return (
    <Modal
      footer={
        isReceivedRequest && canManageTransfers ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {rejecting ? (
              <>
                <Button onClick={() => setRejecting(false)} type="button" variant="secondary">
                  Cancelar
                </Button>
                <Button disabled={busy} onClick={confirmReject} type="button" variant="danger">
                  {busy ? "Rechazando..." : "Confirmar rechazo"}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => setRejecting(true)} type="button" variant="secondary">
                  Rechazar
                </Button>
                <Button disabled={busy} onClick={onApprove} type="button">
                  {busy ? "Aprobando..." : "Aceptar solicitud"}
                </Button>
              </>
            )}
          </div>
        ) : undefined
      }
      maxWidth="600px"
      onClose={onClose}
      open={open}
      subtitle={request.productName}
      title={getTransferRequestDetailTitle(request)}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <ReadonlyField label="Producto" value={request.productName} />
          <ReadonlyField label="Codigo" value={request.sku} />
          <ReadonlyField label="Sucursal solicitante" value={request.requestingBranchName} />
          <ReadonlyField label="Sucursal proveedora" value={request.sourceBranchName} />
          <ReadonlyField label="Cantidad solicitada" value={String(request.requestedQuantity)} />
          <ReadonlyField
            label="Disponible conocido"
            value={
              request.availableQuantity === undefined
                ? "No disponible"
                : String(request.availableQuantity)
            }
          />
          <ReadonlyField label="Motivo" value={formatTransferReason(request.reason)} />
          <ReadonlyField label="Estado" value={formatTransferRequestStatus(request.status)} />
          <ReadonlyField label="Fecha de solicitud" value={formatDateTime(request.requestedAt)} />
          {request.approvedAt ? (
            <ReadonlyField label="Fecha de aprobacion" value={formatDateTime(request.approvedAt)} />
          ) : null}
          {request.rejectedAt ? (
            <ReadonlyField label="Fecha de rechazo" value={formatDateTime(request.rejectedAt)} />
          ) : null}
        </div>
        {request.notes ? <ReadonlyField label="Observaciones" value={request.notes} /> : null}
        {request.status === InventoryTransferRequestStatus.approved ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            Pendiente de preparacion y traslado.
          </p>
        ) : null}
        {request.status === InventoryTransferRequestStatus.rejected && request.rejectionReason ? (
          <ReadonlyField label="Motivo del rechazo" value={request.rejectionReason} />
        ) : null}
        {rejecting ? (
          <Field id="transfer-rejection-reason" label="Motivo de rechazo *" error={error}>
            <textarea
              className="min-h-24 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
              id="transfer-rejection-reason"
              maxLength={TEXT_LIMITS.reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError("");
              }}
              value={reason}
            />
            <CharacterCount current={reason.length} maximum={TEXT_LIMITS.reason} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function Field({
  children,
  error,
  id,
  label,
}: {
  children: ReactNode;
  error?: string;
  id: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-[var(--color-text)]" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? <p className="text-sm font-semibold text-[var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

function CharacterCount({ current, maximum }: { current: number; maximum: number }) {
  return (
    <p className="mt-1 text-right text-xs text-[var(--color-text-muted)]">
      {current} / {maximum}
    </p>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2">
      <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-[var(--color-title)]">{value}</p>
    </div>
  );
}

/** Etiqueta con su propio tick de 60 s: solo ella se vuelve a renderizar, no toda la pagina. */
function LastUpdatedLabel({ lastUpdatedAt }: { lastUpdatedAt: Date | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((current) => current + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="text-sm font-semibold text-[var(--color-text-muted)]">
      {formatLastUpdated(lastUpdatedAt)}
    </p>
  );
}

function formatLastUpdated(value: Date | null) {
  if (!value) return "Actualizado hace: pendiente";
  const seconds = Math.max(0, Math.round((Date.now() - value.getTime()) / 1000));
  if (seconds < 5) return "Actualizado hace unos segundos";
  if (seconds < 60) return `Actualizado hace ${seconds} segundos`;
  const minutes = Math.round(seconds / 60);
  return `Actualizado hace ${minutes} min`;
}

function formatSuggestedReorder(row: InventoryProductRow) {
  const suggestedQuantity = getSuggestedReorderQuantity(row);
  return suggestedQuantity ? String(suggestedQuantity) : "Sin reposicion sugerida";
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "") return;
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
}

function getDaysUntil(value: string) {
  const expiration = new Date(value).getTime();
  if (Number.isNaN(expiration)) return 0;
  return Math.max(0, Math.ceil((expiration - Date.now()) / (24 * 60 * 60 * 1000)));
}

function getAlertPriority(alert: InventoryAlert) {
  if (alert.tone === "danger") return 1;
  if (alert.type === "low_stock") return 2;
  if (alert.type === "expiration") return 3;
  return 4;
}

type AlertFeedItem =
  | { id: string; kind: "inventory"; priority: number; alert: InventoryAlert }
  | {
      id: string;
      kind: "transfer";
      priority: number;
      timestamp: number;
      isNew: boolean;
      request: InventoryTransferRequestRow;
    };

function buildAlertFeed(
  activeBranchId: string,
  alerts: InventoryAlert[],
  transferRequests: InventoryTransferRequestRow[],
  hasRestoredViewedTransferAlerts: boolean,
  viewedTransferAlertKeys: Set<string>,
): AlertFeedItem[] {
  const inventoryItems = alerts.map((alert) => ({
    id: alert.id,
    kind: "inventory" as const,
    priority: getAlertPriority(alert),
    alert,
  }));
  const requestItems = transferRequests.map((request) => {
    const alertKey = getTransferAlertKey(activeBranchId, request);
    const isNew = hasRestoredViewedTransferAlerts && !viewedTransferAlertKeys.has(alertKey);
    return {
      id: alertKey,
      kind: "transfer" as const,
      priority: isNew ? 0 : 50,
      timestamp: getTransferAlertTimestamp(request),
      isNew,
      request,
    };
  });
  return [...inventoryItems, ...requestItems].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.kind === "transfer" && right.kind === "transfer" && left.isNew && right.isNew) {
      return right.timestamp - left.timestamp;
    }
    return left.id.localeCompare(right.id);
  });
}

function getTransferAlertKey(branchId: string, request: InventoryTransferRequestRow) {
  return `${branchId}:${request.id}:${request.status}`;
}

function readViewedTransferAlertKeys() {
  try {
    const rawValue = window.sessionStorage.getItem(VIEWED_TRANSFER_ALERTS_STORAGE_KEY);
    if (!rawValue) return new Set<string>();
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return new Set<string>();
    return new Set(parsedValue.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set<string>();
  }
}

function persistViewedTransferAlertKeys(keys: Set<string>) {
  try {
    window.sessionStorage.setItem(VIEWED_TRANSFER_ALERTS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Visual read state is best-effort session UI state.
  }
}

function getTransferAlertTimestamp(request: InventoryTransferRequestRow) {
  const value =
    request.approvedAt ?? request.rejectedAt ?? request.reviewedAt ?? request.requestedAt;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatTransferRequestStatus(status: InventoryTransferRequestStatus) {
  if (status === InventoryTransferRequestStatus.approved) return "Traslado aprobado";
  if (status === InventoryTransferRequestStatus.rejected) return "Traslado rechazado";
  return "Pendiente de revision";
}

function getTransferRequestAlertTitle(request: InventoryTransferRequestRow) {
  if (request.status === InventoryTransferRequestStatus.approved) return "Traslado aprobado";
  if (request.status === InventoryTransferRequestStatus.rejected) return "Traslado rechazado";
  return "Solicitud de traslado";
}

function getTransferRequestDetailTitle(request: InventoryTransferRequestRow) {
  return getTransferRequestAlertTitle(request);
}

function getTransferRequestAlertMessage(request: InventoryTransferRequestRow) {
  if (
    request.context === "response" &&
    request.status === InventoryTransferRequestStatus.approved
  ) {
    return `${request.sourceBranchName} aprobo tu solicitud de ${request.requestedQuantity} unidades de ${request.productName}.`;
  }
  if (
    request.context === "response" &&
    request.status === InventoryTransferRequestStatus.rejected
  ) {
    return `${request.sourceBranchName} rechazo tu solicitud de ${request.requestedQuantity} unidades de ${request.productName}.`;
  }
  return `${request.requestingBranchName} solicita ${request.requestedQuantity} unidades de ${request.productName}.`;
}

function getTransferRequestToneClass(request: InventoryTransferRequestRow) {
  if (request.status === InventoryTransferRequestStatus.approved) {
    return "border-emerald-200 hover:bg-emerald-50";
  }
  if (request.status === InventoryTransferRequestStatus.rejected) {
    return "border-red-200 hover:bg-red-50";
  }
  return "border-blue-200 hover:bg-blue-50";
}

function getTransferRequestTextClass(request: InventoryTransferRequestRow) {
  if (request.status === InventoryTransferRequestStatus.approved) return "text-emerald-700";
  if (request.status === InventoryTransferRequestStatus.rejected) return "text-red-700";
  return "text-blue-700";
}

function formatTransferReason(reason: InventoryTransferReason) {
  return TRANSFER_REASONS.find((option) => option.value === reason)?.label ?? "Otro";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getAdjustmentSummaryLabel(kind: AdjustStockDto["movementKind"]) {
  if (kind === "in") return "Entrada manual";
  if (kind === "out") return "Salida manual";
  if (kind === "waste") return "Merma";
  return "Cambio";
}

function toAdjustStockDto(value: EditableAdjustStockDto): AdjustStockDto {
  return {
    ...value,
    quantity: toFiniteNumber(value.quantity),
    serialNumbers: parseSerialNumbers(value.serialNumbersText),
  };
}

function formatLotDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/** Seleccion de series existentes por click (sin Ctrl/Shift); tope = cantidad requerida. */
function SerialPicker({
  disabled,
  options,
  required,
  selected,
  onChange,
}: {
  disabled: boolean;
  options: string[];
  required: number;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? options.filter((serial) => serial.toLowerCase().includes(normalized))
    : options;
  const limitReached = selected.length >= required;

  function toggle(serial: string) {
    if (selected.includes(serial)) onChange(selected.filter((item) => item !== serial));
    else if (!limitReached) onChange([...selected, serial]);
  }

  return (
    <div className="space-y-2">
      {options.length > 8 ? (
        <Input
          aria-label="Buscar serie"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar serie..."
          value={query}
        />
      ) : null}
      <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border)] bg-white">
        {visible.length === 0 ? (
          <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
            No hay series disponibles.
          </p>
        ) : (
          visible.map((serial) => {
            const checked = selected.includes(serial);
            const blocked = !checked && limitReached;
            return (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-sm last:border-b-0",
                  checked && "bg-blue-50 font-semibold",
                  (blocked || disabled) && "cursor-not-allowed opacity-60",
                )}
                key={serial}
              >
                <input
                  checked={checked}
                  disabled={disabled || blocked}
                  onChange={() => toggle(serial)}
                  type="checkbox"
                />
                <span className="break-all">{serial}</span>
              </label>
            );
          })
        )}
      </div>
      <p className="text-sm font-semibold text-[var(--color-text-muted)]">
        Seleccionados: {selected.length} / {required}
      </p>
    </div>
  );
}

function findRepeatedSerialNumbers(serials: string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  serials.forEach((serial) => {
    if (seen.has(serial)) repeated.add(serial);
    seen.add(serial);
  });
  return [...repeated];
}

function parseSerialNumbers(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toTransferRequestDto(value: EditableTransferRequestDto): TransferRequestDto {
  return {
    ...value,
    quantity: toFiniteNumber(value.quantity),
  };
}

function getUnitQuantityInputError(value: NumericInputValue, unitAllowsDecimals: boolean) {
  if (typeof value !== "number") {
    if (
      unitAllowsDecimals &&
      value !== "" &&
      !value.endsWith(".") &&
      !hasAtMostDecimalPlaces(value, QUANTITY_DECIMAL_PLACES)
    ) {
      return "La cantidad admite hasta 3 decimales.";
    }
    if (!unitAllowsDecimals && value !== "" && !value.endsWith(".")) {
      return "La unidad seleccionada no admite fracciones.";
    }
    return "Ingresa una cantidad valida.";
  }
  if (!unitAllowsDecimals && !Number.isInteger(value)) {
    return "La unidad seleccionada no admite fracciones.";
  }
  if (unitAllowsDecimals && !hasAtMostDecimalPlaces(value, QUANTITY_DECIMAL_PLACES)) {
    return "La cantidad admite hasta 3 decimales.";
  }
  return null;
}

function formatAdjustmentDelta(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "-"}${Math.abs(value)}`;
}
