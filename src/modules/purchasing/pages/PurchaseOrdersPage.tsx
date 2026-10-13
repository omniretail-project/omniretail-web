"use client";

import {
  getPurchaseOrderStatusLabel as getStatusLabel,
  PurchaseOrderStatusBadge as OrderStatusBadge,
} from "@/modules/purchasing/components/PurchaseOrderStatusBadge";
import {
  clearOrdersNavContext,
  readOrdersNavContext,
  saveOrdersNavContext,
} from "@/modules/purchasing/application/services/purchaseOrdersNavContext";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SVGProps,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import { PageHeader } from "@/shared/components/PageHeader";
import { Select } from "@/shared/components/Select";
import { TablePagination, type TablePageSize } from "@/shared/components/TablePagination";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import type {
  PurchaseOrderAction,
  PurchaseOrderRowReadModel,
  PurchaseOrderStatusFilter,
  ReorderSuggestionReadModel,
} from "@/modules/purchasing/application/dto/PurchaseOrderReadModel";
import { usePurchaseOrders } from "@/modules/purchasing/hooks/usePurchaseOrders";
import { PurchaseOrderPdfService } from "@/modules/purchasing/application/services/PurchaseOrderPdfService";

export function PurchaseOrdersPage({ initialOrderId }: { initialOrderId?: string }) {
  const router = useRouter();
  const repositories = useRepositories();
  const { showToast } = useToast();
  const {
    apiMode,
    data,
    detailOrder,
    filters,
    paginatedOrders,
    totalItems,
    totalPages,
    page,
    pageSize,
    currentBranch,
    loading,
    error,
    mutationPending,
    canCreatePurchaseOrders,
    suggestions: reorderSuggestions,
    updateFilters,
    setPage,
    setPageSize,
    loadOrderById,
    updateStatus,
  } = usePurchaseOrders();
  const pdfService = useMemo(() => new PurchaseOrderPdfService(repositories), [repositories]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [openActionsOrderId, setOpenActionsOrderId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    order: PurchaseOrderRowReadModel;
    action: PurchaseOrderAction;
  } | null>(null);
  // Contexto temporal (sessionStorage) en lugar de ?orderId=<UUID>; el id solo vive en memoria.
  const [contextOrderId, setContextOrderId] = useState<string | null>(null);
  const activeOrderId = initialOrderId?.trim() || contextOrderId || undefined;
  const appliedOrderIdRef = useRef<string | null>(null);
  const locatingOrderIdRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      const legacyOrderId = initialOrderId?.trim();
      if (legacyOrderId) {
        // URL antigua con ?orderId=: se hidrata el contexto y el flujo existente limpia la URL.
        saveOrdersNavContext({ orderId: legacyOrderId, orderNumber: "", source: "supplier" });
        return;
      }
      const stored = readOrdersNavContext();
      if (stored) setContextOrderId(stored.orderId);
    });
    return () => {
      active = false;
    };
  }, [initialOrderId]);
  const directlyLocatedOrder = useMemo(() => {
    const orderId = activeOrderId;
    if (!orderId) return null;
    const candidates = detailOrder ? [...data.orders, detailOrder] : data.orders;
    return (
      candidates.find(
        (candidate) =>
          candidate.id === orderId &&
          (apiMode ||
            (candidate.branchId === currentBranch?.id &&
              candidate.tenantId === currentBranch?.tenantId)),
      ) ?? null
    );
  }, [
    apiMode,
    currentBranch?.id,
    currentBranch?.tenantId,
    data.orders,
    detailOrder,
    activeOrderId,
  ]);
  const visibleOrders = useMemo(
    () => (directlyLocatedOrder ? [directlyLocatedOrder] : paginatedOrders),
    [directlyLocatedOrder, paginatedOrders],
  );
  const currentPage = directlyLocatedOrder ? 1 : Math.min(page, Math.max(1, totalPages));
  const visibleTotalItems = directlyLocatedOrder ? 1 : totalItems;
  const selectedOrder = useMemo(
    () => visibleOrders.find((order) => order.id === selectedOrderId) ?? null,
    [selectedOrderId, visibleOrders],
  );
  const emptyMessage = (apiMode ? totalItems === 0 : data.orders.length === 0)
    ? "No hay ordenes de compra registradas."
    : "No se encontraron ordenes.";

  useEffect(() => {
    const orderId = activeOrderId;
    if (!orderId) {
      appliedOrderIdRef.current = null;
      locatingOrderIdRef.current = null;
      return;
    }
    if (loading || appliedOrderIdRef.current === orderId) return;

    if (!directlyLocatedOrder) {
      if (apiMode) {
        if (locatingOrderIdRef.current === orderId) return;
        locatingOrderIdRef.current = orderId;
        let active = true;
        void loadOrderById(orderId).then((locatedOrder) => {
          if (!active) return;
          if (!locatedOrder) {
            appliedOrderIdRef.current = orderId;
            router.replace("/compras/ordenes", { scroll: false });
          }
        });
        return () => {
          active = false;
        };
      }
      appliedOrderIdRef.current = orderId;
      router.replace("/compras/ordenes", { scroll: false });
      return;
    }

    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      appliedOrderIdRef.current = orderId;
      locatingOrderIdRef.current = null;
      setSelectedOrderId(null);
      setOpenActionsOrderId(null);
      if (!apiMode) {
        updateFilters({
          search: directlyLocatedOrder.number,
          status: "all",
          supplierId: "all",
        });
      }
    });
    return () => {
      active = false;
    };
  }, [apiMode, directlyLocatedOrder, activeOrderId, loadOrderById, loading, router, updateFilters]);

  function clearOrderLocator() {
    if (!activeOrderId) return;
    clearOrdersNavContext();
    setContextOrderId(null);
    appliedOrderIdRef.current = null;
    if (initialOrderId) router.replace("/compras/ordenes", { scroll: false });
  }

  function handleSearchChange(search: string) {
    clearOrderLocator();
    setSelectedOrderId(null);
    setOpenActionsOrderId(null);
    updateFilters({ search });
  }

  function handleStatusChange(status: PurchaseOrderStatusFilter) {
    clearOrderLocator();
    setSelectedOrderId(null);
    setOpenActionsOrderId(null);
    updateFilters({ status });
  }

  function handleSupplierChange(supplierId: string) {
    clearOrderLocator();
    setSelectedOrderId(null);
    setOpenActionsOrderId(null);
    updateFilters({ supplierId });
  }

  function openSuggestionOrder(suggestion: ReorderSuggestionReadModel) {
    router.push(
      `/compras/ordenes/nueva?${buildQueryString({
        productId: suggestion.productId,
        branchId: suggestion.branchId,
        supplierId: suggestion.preferredSupplierId,
        suggestedQuantity: suggestion.suggestedQuantity,
        source: "reorder-suggestion",
      })}`,
    );
  }

  function changePage(nextPage: number) {
    setSelectedOrderId(null);
    setOpenActionsOrderId(null);
    setPage(Math.min(Math.max(nextPage, 1), Math.max(1, totalPages)));
  }

  function handlePageSizeChange(nextPageSize: TablePageSize) {
    setPageSize(nextPageSize);
    setSelectedOrderId(null);
    setOpenActionsOrderId(null);
  }

  function handleSelectOrder(orderId: string) {
    setOpenActionsOrderId(null);
    setSelectedOrderId(orderId);
  }

  async function handleAction(order: PurchaseOrderRowReadModel, action: PurchaseOrderAction) {
    setOpenActionsOrderId(null);
    if (mutationPending) return;
    if (!action.enabled) {
      showToast({
        title: action.label,
        description: action.unavailableReason ?? "Accion preparada para una siguiente feature.",
        tone: "info",
      });
      return;
    }
    if (action.id === "edit-draft") {
      router.push(`/compras/ordenes/${order.id}/editar`);
      return;
    }
    if (action.id === "continue-receiving" && action.enabled) {
      router.push(`/compras/recepciones/purchase_order/${order.id}`);
      return;
    }
    if (action.id === "download-purchase-order-pdf" || action.id === "download-receiving-pdf") {
      await downloadPdf(order, action.id);
      return;
    }
    if (action.id === "cancel" || action.id === "approve") {
      setPendingAction({ order, action });
      return;
    }
    if (!action.statusTarget) return;

    try {
      await updateStatus(order.id, action.statusTarget);
      setSelectedOrderId(null);
      showToast({ title: "Orden actualizada", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo actualizar la orden",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function confirmPendingAction(cancellationReason?: string) {
    if (!pendingAction?.action.statusTarget || mutationPending) return;
    try {
      await updateStatus(
        pendingAction.order.id,
        pendingAction.action.statusTarget,
        cancellationReason,
      );
      setSelectedOrderId(null);
      setPendingAction(null);
      if (pendingAction.action.id === "approve") {
        // El backend envia el correo (con PDF) de forma asincrona; el exito de la aprobacion no
        // depende ni informa de la entrega SMTP.
        showToast({
          title: `Orden ${pendingAction.order.number} aprobada correctamente`,
          description:
            "El proveedor será notificado automáticamente si tiene un correo configurado.",
          tone: "success",
        });
      } else {
        showToast({ title: "Orden actualizada", tone: "success" });
      }
    } catch (caughtError) {
      showToast({
        title: "No se pudo actualizar la orden",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function downloadPdf(
    order: PurchaseOrderRowReadModel,
    actionId: PurchaseOrderAction["id"],
  ) {
    try {
      if (actionId === "download-purchase-order-pdf") {
        await pdfService.downloadPurchaseOrder(order.id);
      } else if (actionId === "download-receiving-pdf") {
        await pdfService.downloadReceivingReport(order.id);
      }
      showToast({ title: "PDF generado", description: order.number, tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo generar el PDF",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Compras
        </p>
        <PageHeader
          title="Ordenes de compra"
          description="Consulta ordenes, recepcion, proveedores y necesidades de reposicion."
          actions={
            canCreatePurchaseOrders ? (
              <Button onClick={() => router.push("/compras/ordenes/nueva")} type="button">
                <PlusIcon />
                Nueva orden
              </Button>
            ) : undefined
          }
        />
      </div>

      <ReorderSuggestions
        canCreateOrder={canCreatePurchaseOrders}
        error={reorderSuggestions.error}
        expanded={reorderSuggestions.expanded}
        loaded={reorderSuggestions.loaded}
        loading={reorderSuggestions.loading}
        notice={reorderSuggestions.notice}
        suggestions={reorderSuggestions.items}
        onCreateOrder={openSuggestionOrder}
        onToggle={reorderSuggestions.toggle}
      />

      {error ? <InlineAlert title={error} tone="danger" /> : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-white p-2.5 shadow-sm">
        <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_220px]")}>
          <Input
            aria-label="Buscar ordenes"
            maxLength={TEXT_LIMITS.search}
            className="h-10"
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Buscar por numero, proveedor o producto..."
            type="search"
            value={filters.search}
          />
          <Select
            aria-label="Estado"
            className="h-10 rounded-md"
            onChange={(event) =>
              handleStatusChange(event.target.value as PurchaseOrderStatusFilter)
            }
            value={filters.status}
          >
            <option value="all">Todos los estados</option>
            {data.statuses.map((status) => (
              <option key={status} value={status}>
                {getStatusLabel(status)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Proveedor"
            className="h-10 rounded-md"
            onChange={(event) => handleSupplierChange(event.target.value)}
            value={filters.supplierId}
          >
            <option value="all">Todos los proveedores</option>
            {data.suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
        {loading ? (
          <p className="p-5 text-sm text-[var(--color-text-muted)]">Cargando ordenes...</p>
        ) : (
          <>
            <PurchaseOrdersTable
              emptyMessage={emptyMessage}
              openActionsOrderId={openActionsOrderId}
              orders={visibleOrders}
              selectedOrderId={selectedOrderId}
              onActionsOpenChange={setOpenActionsOrderId}
              onAction={handleAction}
              onSelect={handleSelectOrder}
            />
            <TablePagination
              ariaLabel="Paginacion de ordenes"
              itemLabel="ordenes"
              page={currentPage}
              pageSize={pageSize}
              totalItems={visibleTotalItems}
              onPageChange={changePage}
              onPageSizeChange={handlePageSizeChange}
            />
          </>
        )}
      </section>

      {selectedOrder ? (
        <PurchaseOrderDrawer
          order={selectedOrder}
          onAction={handleAction}
          onClose={() => setSelectedOrderId(null)}
        />
      ) : null}

      {pendingAction ? (
        <ConfirmActionDialog
          action={pendingAction.action}
          order={pendingAction.order}
          submitting={mutationPending}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      ) : null}
    </div>
  );
}

function ReorderSuggestions({
  canCreateOrder,
  error,
  expanded,
  loaded,
  loading,
  notice,
  suggestions,
  onCreateOrder,
  onToggle,
}: {
  canCreateOrder: boolean;
  error?: string;
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  notice?: string;
  suggestions: ReorderSuggestionReadModel[];
  onCreateOrder: (suggestion: ReorderSuggestionReadModel) => void;
  onToggle: () => void;
}) {
  const requiringPurchase = suggestions.length;
  const requiringCompletion = 0;
  const inProgress = 0;

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-title)]">
            Reposicion sugerida
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {loaded
              ? `${formatNumber(requiringPurchase)} requieren compra · ${formatNumber(requiringCompletion)} requieren completar compra · ${formatNumber(inProgress)} en curso`
              : "Las necesidades de reposicion se calculan al abrir el panel."}
          </p>
        </div>
        <Button
          className="min-h-9 px-3 py-1.5"
          onClick={onToggle}
          type="button"
          variant="secondary"
        >
          {expanded ? "Ocultar sugerencias" : "Revisar sugerencias"}
        </Button>
      </div>

      {expanded ? (
        <div className="space-y-2 border-t border-[var(--color-border)] px-4 py-3">
          {error ? <InlineAlert title={error} tone="danger" /> : null}
          {notice ? <InlineAlert title={notice} tone="warning" /> : null}
          {loading && !loaded ? (
            <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-4 py-3 text-sm font-medium text-[var(--color-text-muted)]">
              Cargando sugerencias...
            </p>
          ) : suggestions.length === 0 && !error ? (
            <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-4 py-3 text-sm font-medium text-[var(--color-text-muted)]">
              Sin sugerencias de reposicion por ahora.
            </p>
          ) : (
            suggestions.map((suggestion) => (
              <article
                className="grid gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 xl:grid-cols-[minmax(0,1.6fr)_80px_80px_90px_90px_minmax(120px,0.9fr)_auto] xl:items-center"
                key={suggestion.id}
              >
                <div className="min-w-0">
                  <p className="truncate font-bold text-[var(--color-title)]">
                    {suggestion.productName}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">{suggestion.sku}</p>
                </div>
                <SmallMetric label="Fisico" value={formatNumber(suggestion.currentStock)} />
                <SmallMetric
                  label="Reservado"
                  value={formatNumber(suggestion.reservedStock ?? 0)}
                />
                <SmallMetric
                  label="Disponible"
                  value={formatNumber(suggestion.availableStock ?? suggestion.currentStock)}
                />
                <SmallMetric label="Minimo" value={formatNumber(suggestion.minStock)} />
                <SmallMetric label="Sugerido" value={formatNumber(suggestion.suggestedQuantity)} />
                <SmallMetric label="Faltante" value={formatNumber(suggestion.shortage)} />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">
                    Proveedor
                  </p>
                  <p
                    className={cn(
                      "truncate text-sm font-semibold",
                      suggestion.preferredSupplierName.startsWith("Sin ")
                        ? "text-[var(--color-text-muted)]"
                        : "text-[var(--color-title)]",
                    )}
                  >
                    {suggestion.preferredSupplierName}
                  </p>
                </div>
                <div className="flex justify-start sm:justify-end">
                  {canCreateOrder ? (
                    <Button
                      className="min-h-9 px-3 py-1.5"
                      onClick={() => onCreateOrder(suggestion)}
                      type="button"
                      variant="secondary"
                    >
                      Crear orden
                    </Button>
                  ) : (
                    <span className="text-xs font-semibold text-[var(--color-text-muted)]">
                      Solo consulta
                    </span>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      <p className="text-sm font-bold text-[var(--color-title)]">{value}</p>
    </div>
  );
}

function PurchaseOrdersTable({
  orders,
  selectedOrderId,
  openActionsOrderId,
  emptyMessage,
  onSelect,
  onActionsOpenChange,
  onAction,
}: {
  orders: PurchaseOrderRowReadModel[];
  selectedOrderId: string | null;
  openActionsOrderId: string | null;
  emptyMessage: string;
  onSelect: (orderId: string) => void;
  onActionsOpenChange: (orderId: string | null) => void;
  onAction: (order: PurchaseOrderRowReadModel, action: PurchaseOrderAction) => void;
}) {
  return (
    <div className="overflow-x-auto overflow-y-visible">
      <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-sm">
        <colgroup>
          <col className="w-[14%]" />
          <col className="w-[22%]" />
          <col className="w-[13%]" />
          <col className="w-[12%]" />
          <col className="w-[12%]" />
          <col className="w-[17%]" />
          <col className="w-[10%]" />
        </colgroup>
        <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Numero</th>
            <th className="px-4 py-2.5 font-semibold">Proveedor</th>
            <th className="px-4 py-2.5 font-semibold">Entrega</th>
            <th className="px-4 py-2.5 text-right font-semibold">Productos</th>
            <th className="px-4 py-2.5 text-right font-semibold">Total</th>
            <th className="px-4 py-2.5 font-semibold">Recepcion</th>
            <th className="px-4 py-2.5 text-center font-semibold">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[var(--color-text-muted)]" colSpan={7}>
                <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                  <ClipboardIcon className="h-6 w-6 text-[var(--color-structure)]" />
                  <p className="font-bold text-[var(--color-title)]">{emptyMessage}</p>
                </div>
              </td>
            </tr>
          ) : (
            orders.map((order) => (
              <tr
                className={cn(
                  "cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus-visible:bg-[var(--color-primary)]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)]",
                  selectedOrderId === order.id &&
                    "border-l-4 border-l-[var(--color-structure)] bg-[var(--color-primary)]/10",
                )}
                key={order.id}
                onClick={() => onSelect(order.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSelect(order.id);
                }}
                tabIndex={0}
              >
                <td className="px-4 py-2.5">
                  <p className="font-bold text-[var(--color-title)]">{order.number}</p>
                  <div className="mt-1">
                    <OrderStatusBadge status={order.status} />
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <p className="truncate font-semibold text-[var(--color-title)]">
                    {order.supplierName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {order.supplierContactLabel}
                  </p>
                </td>
                <td className="px-4 py-2.5 font-medium text-[var(--color-text)]">
                  {order.expectedDate ? formatDate(order.expectedDate) : "-"}
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-[var(--color-title)]">
                  {order.productCount > 0 ? formatNumber(order.productCount) : "-"}
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-[var(--color-title)]">
                  {formatCurrency(order.total)}
                </td>
                <td className="px-4 py-2.5">
                  <ReceptionProgress reception={order.reception} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <RowActions
                    open={openActionsOrderId === order.id}
                    order={order}
                    onAction={onAction}
                    onOpenChange={(open) => onActionsOpenChange(open ? order.id : null)}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function ReceptionProgress({ reception }: { reception: PurchaseOrderRowReadModel["reception"] }) {
  if (reception.percentage <= 0) {
    return (
      <p className="text-xs font-semibold text-[var(--color-text-muted)]">{reception.label}</p>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-[var(--color-text)]">{reception.label}</p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-app-background)]">
        <div
          className={cn(
            "h-full rounded-full",
            reception.tone === "success" && "bg-emerald-500",
            reception.tone === "warning" && "bg-amber-500",
            reception.tone === "info" && "bg-blue-500",
            reception.tone === "neutral" && "bg-slate-300",
          )}
          style={{ width: `${reception.percentage}%` }}
        />
      </div>
    </div>
  );
}

function RowActions({
  open,
  order,
  onAction,
  onOpenChange,
}: {
  open: boolean;
  order: PurchaseOrderRowReadModel;
  onAction: (order: PurchaseOrderRowReadModel, action: PurchaseOrderAction) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    left: 0,
    top: 0,
    visibility: "hidden",
  });

  useEffect(() => {
    if (!open) return;

    function positionMenu() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const menuWidth = 208;
      const estimatedMenuHeight = Math.max(44, order.actions.length * 40 + 8);
      const viewportPadding = 8;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const opensUp = spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow;
      const rawTop = opensUp ? rect.top - estimatedMenuHeight - gap : rect.bottom + gap;
      const maxTop = window.innerHeight - estimatedMenuHeight - viewportPadding;
      const top = Math.min(Math.max(viewportPadding, rawTop), Math.max(viewportPadding, maxTop));
      const maxLeft = window.innerWidth - menuWidth - viewportPadding;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - menuWidth),
        Math.max(viewportPadding, maxLeft),
      );

      setMenuStyle({
        left,
        top,
        width: menuWidth,
        visibility: "visible",
      });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open, order.actions.length]);

  if (order.actions.length === 0) {
    return <span className="text-xs font-semibold text-[var(--color-text-muted)]">Consulta</span>;
  }

  return (
    <div className="inline-flex justify-center">
      <button
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Acciones para ${order.number}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-lg font-bold leading-none text-[var(--color-text-muted)] transition hover:border-[var(--color-border)] hover:bg-[var(--color-app-background)] hover:text-[var(--color-title)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
        onClick={(event) => {
          event.stopPropagation();
          onOpenChange(!open);
        }}
        type="button"
      >
        {"\u22EE"}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-50 overflow-hidden rounded-md border border-[var(--color-border)] bg-white py-1 text-left shadow-lg"
              role="menu"
              style={menuStyle}
            >
              {order.actions.map((action) => (
                <button
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold transition hover:bg-[var(--color-app-background)]",
                    action.id === "cancel"
                      ? "text-[var(--color-danger)]"
                      : "text-[var(--color-title)]",
                    !action.enabled && "text-[var(--color-text-muted)]",
                  )}
                  key={action.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenChange(false);
                    onAction(order, action);
                  }}
                  role="menuitem"
                  type="button"
                >
                  {getActionIcon(action.id)}
                  {action.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function PurchaseOrderDrawer({
  order,
  onClose,
  onAction,
}: {
  order: PurchaseOrderRowReadModel;
  onClose: () => void;
  onAction: (order: PurchaseOrderRowReadModel, action: PurchaseOrderAction) => void;
}) {
  return (
    <>
      <button
        aria-label="Cerrar detalle de orden"
        className="fixed inset-0 z-30 bg-[var(--color-topbar)]/35"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="Detalle de orden de compra"
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-hidden border-l border-[var(--color-border)] bg-white shadow-xl md:max-w-[72vw] lg:max-w-[520px] xl:max-w-[35vw]"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 bg-[var(--color-structure)] p-4 text-white">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-50/85">
              Orden de compra
            </p>
            <h2 className="mt-1 text-xl font-bold">{order.number}</h2>
            <p className="mt-1 truncate text-sm text-blue-50/85">{order.supplierName}</p>
          </div>
          <button
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/25 text-lg font-bold text-white transition hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-5">
            <dl className="grid gap-x-5 gap-y-3 border-b border-[var(--color-border)] pb-4 sm:grid-cols-2">
              <DetailItem label="Proveedor" value={order.supplierName} />
              <DetailItem label="Estado" value={<OrderStatusBadge status={order.status} />} />
              <DetailItem label="Sucursal destino" value={order.branchName} />
              <DetailItem
                label="Entrega esperada"
                value={order.expectedDate ? formatDate(order.expectedDate) : "-"}
              />
              <DetailItem label="Total acordado" value={formatCurrency(order.total)} />
              <DetailItem label="Recepcion" value={order.reception.label} />
            </dl>

            <section>
              <h3 className="text-sm font-bold uppercase text-[var(--color-text-muted)]">
                Productos y costos acordados
              </h3>
              {order.lines.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] p-4 text-sm font-medium text-[var(--color-text-muted)]">
                  Las lineas de esta orden no estan disponibles en el contrato actual.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {order.lines.map((line) => (
                    <article
                      className="rounded-md border border-[var(--color-border)] bg-white p-3"
                      key={line.id}
                    >
                      <p className="font-bold text-[var(--color-title)]">{line.productName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{line.sku}</p>
                      <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
                        <InlineItem
                          label="Cantidad"
                          value={`${formatNumber(line.quantity)} ${line.unitLabel}`}
                        />
                        <InlineItem label="Costo acordado" value={formatCurrency(line.unitCost)} />
                        <InlineItem
                          label="Recibido"
                          value={
                            typeof line.receivedQuantity === "number"
                              ? formatNumber(line.receivedQuantity)
                              : "-"
                          }
                        />
                        <InlineItem
                          label="Costo registrado"
                          value={
                            typeof line.registeredCost === "number"
                              ? formatCurrency(line.registeredCost)
                              : "-"
                          }
                        />
                      </dl>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
        <footer className="flex flex-col gap-2 border-t border-[var(--color-border)] bg-white p-4 sm:flex-row sm:flex-wrap">
          {order.actions.length === 0 ? (
            <Button
              className="w-full sm:w-auto"
              onClick={onClose}
              type="button"
              variant="secondary"
            >
              Cerrar
            </Button>
          ) : (
            order.actions.map((action) => (
              <Button
                className="min-h-9 w-full px-3 py-1.5 sm:w-auto"
                key={action.id}
                onClick={() => onAction(order, action)}
                type="button"
                variant={action.id === "cancel" ? "danger" : "secondary"}
              >
                {getActionIcon(action.id)}
                {action.label}
              </Button>
            ))
          )}
        </footer>
      </aside>
    </>
  );
}

function ConfirmActionDialog({
  order,
  action,
  submitting,
  onCancel,
  onConfirm,
}: {
  order: PurchaseOrderRowReadModel;
  action: PurchaseOrderAction;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (cancellationReason?: string) => void;
}) {
  const isCancel = action.id === "cancel";
  const [cancellationReason, setCancellationReason] = useState("");
  const trimmedReason = cancellationReason.trim();
  const confirmDisabled = submitting || (isCancel && trimmedReason.length === 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-topbar)]/35 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          {order.number}
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-title)]">
          {isCancel ? "¿Cancelar esta orden de compra?" : "¿Confirmar aprobacion de la orden?"}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text)]">
          {isCancel
            ? "Esta accion cambiara el estado de la orden a Cancelada."
            : "La orden pasara a Aprobada despues de recibir autorizacion externa."}
        </p>
        {isCancel ? (
          <label className="mt-4 block">
            <span className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
              Motivo de cancelacion
            </span>
            <textarea
              className="mt-1 min-h-24 w-full resize-y rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-structure)]/15 disabled:cursor-not-allowed disabled:bg-[var(--color-app-background)]"
              disabled={submitting}
              maxLength={500}
              onChange={(event) => setCancellationReason(event.target.value)}
              placeholder="Describe por que se cancela esta orden"
              required
              value={cancellationReason}
            />
            <span className="mt-1 block text-right text-xs text-[var(--color-text-muted)]">
              {cancellationReason.length}/500
            </span>
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={submitting} onClick={onCancel} type="button" variant="secondary">
            Volver
          </Button>
          <Button
            disabled={confirmDisabled}
            onClick={() => onConfirm(isCancel ? trimmedReason : undefined)}
            type="button"
            variant={isCancel ? "danger" : "primary"}
          >
            {submitting ? "Procesando..." : isCancel ? "Cancelar orden" : "Aprobar orden"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function InlineItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-right font-bold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-GT").format(value);
}

function formatDate(value: string) {
  const dateValue = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(dateValue));
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === "") return;
    searchParams.set(key, String(value));
  });
  return searchParams.toString();
}

function getActionIcon(actionId: PurchaseOrderAction["id"]) {
  const className = "h-4 w-4 shrink-0";
  if (actionId === "edit-draft") return <PencilIcon className={className} />;
  if (actionId === "send-approval") return <SendIcon className={className} />;
  if (actionId === "approve") return <CheckIcon className={className} />;
  if (actionId === "cancel") return <XIcon className={className} />;
  if (actionId === "continue-receiving") return <PackageIcon className={className} />;
  if (actionId === "download-receiving-pdf") {
    return <ClipboardDownloadIcon className={className} />;
  }
  return <FileDownloadIcon className={className} />;
}

function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
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

function ClipboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 5h6" />
      <path d="M9 3h6v4H9z" />
      <path d="M5 5h2" />
      <path d="M17 5h2v16H5V5" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </Icon>
  );
}

function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m14 4 6 6" />
      <path d="M4 20h6L20 10l-6-6L4 14v6Z" />
    </Icon>
  );
}

function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </Icon>
  );
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m20 6-11 11-5-5" />
    </Icon>
  );
}

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

function PackageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m3 7 9 5 9-5" />
      <path d="M12 22V12" />
      <path d="M21 7v10l-9 5-9-5V7l9-5 9 5Z" />
    </Icon>
  );
}

function FileDownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M12 12v6" />
      <path d="m9 15 3 3 3-3" />
    </Icon>
  );
}

function ClipboardDownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 5h6" />
      <path d="M9 3h6v4H9z" />
      <path d="M5 5h2" />
      <path d="M17 5h2v16H5V5" />
      <path d="M12 11v6" />
      <path d="m9 14 3 3 3-3" />
    </Icon>
  );
}
