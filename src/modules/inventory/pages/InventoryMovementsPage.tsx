"use client";

import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { cn } from "@/shared/utils/cn";
import { formatNumber } from "@/shared/utils/formatNumber";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import {
  API_MOVEMENT_DISPLAY_TYPES,
  type InventoryMovementRow,
  type MovementDisplayType,
  type MovementPeriodFilter,
  type MovementTypeFilter,
} from "@/modules/inventory/application/dto/InventoryMovementsDto";
import { exportInventoryMovementsXlsx } from "@/modules/inventory/application/services/exportInventoryMovementsXlsx";
import {
  MOVEMENT_PERIOD_OPTIONS,
  useInventoryMovements,
} from "@/modules/inventory/hooks/useInventoryMovements";

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const MOVEMENT_DISPLAY_ORDER: MovementDisplayType[] = [
  "sale",
  "store_pickup",
  "dispatch",
  "return",
  "void",
  "purchase_in",
  "transfer_out",
  "transfer_in",
  "inventory_adjustment",
  "shrinkage",
  "manual_in",
  "manual_out",
  "in",
  "out",
  "adjustment",
  "transfer",
];

type MovementTone = "success" | "danger" | "warning" | "info";
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const movementDisplayConfig: Record<
  MovementDisplayType,
  { label: string; icon: IconComponent; tone: MovementTone; badgeClassName: string }
> = {
  purchase_in: {
    label: "Entrada por compra",
    icon: PackagePlusIcon,
    tone: "success",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  transfer_out: {
    label: "Salida por traslado",
    icon: TruckIcon,
    tone: "info",
    badgeClassName: "border-violet-200 bg-violet-50 text-violet-800",
  },
  transfer_in: {
    label: "Entrada por traslado",
    icon: TruckIcon,
    tone: "success",
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-800",
  },
  inventory_adjustment: {
    label: "Ajuste de inventario",
    icon: SlidersIcon,
    tone: "warning",
    badgeClassName: "border-indigo-200 bg-indigo-50 text-indigo-800",
  },
  shrinkage: {
    label: "Merma",
    icon: AlertIcon,
    tone: "danger",
    badgeClassName: "border-red-200 bg-red-50 text-red-800",
  },
  manual_in: {
    label: "Entrada manual",
    icon: ArrowDownLeftIcon,
    tone: "success",
    badgeClassName: "border-teal-200 bg-teal-50 text-teal-800",
  },
  manual_out: {
    label: "Salida manual",
    icon: ArrowUpRightIcon,
    tone: "danger",
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-800",
  },
  sale: {
    label: "Venta",
    icon: ReceiptIcon,
    tone: "danger",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-900",
  },
  dispatch: {
    label: "Despacho",
    icon: TruckIcon,
    tone: "danger",
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-800",
  },
  return: {
    label: "Devolución",
    icon: ArrowDownLeftIcon,
    tone: "success",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  void: {
    label: "Anulación",
    icon: ReceiptIcon,
    tone: "success",
    badgeClassName: "border-teal-200 bg-teal-50 text-teal-800",
  },
  store_pickup: {
    label: "Retiro en tienda",
    icon: ArrowUpRightIcon,
    tone: "danger",
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-900",
  },
  in: {
    label: "Entrada",
    icon: ArrowDownLeftIcon,
    tone: "success",
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  out: {
    label: "Salida",
    icon: ArrowUpRightIcon,
    tone: "danger",
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-800",
  },
  adjustment: {
    label: "Ajuste",
    icon: SlidersIcon,
    tone: "warning",
    badgeClassName: "border-indigo-200 bg-indigo-50 text-indigo-800",
  },
  transfer: {
    label: "Traslado",
    icon: TruckIcon,
    tone: "info",
    badgeClassName: "border-violet-200 bg-violet-50 text-violet-800",
  },
};

const MOVEMENT_TYPE_OPTIONS: Array<{ value: MovementTypeFilter; label: string }> = [
  { value: "all", label: "Todos los tipos" },
  ...MOVEMENT_DISPLAY_ORDER.map((value) => ({
    value,
    label: movementDisplayConfig[value].label,
  })),
];
const API_MOVEMENT_TYPE_OPTIONS: Array<{ value: MovementTypeFilter; label: string }> = [
  { value: "all", label: "Todos los tipos" },
  ...API_MOVEMENT_DISPLAY_TYPES.map((value) => ({
    value,
    label: movementDisplayConfig[value].label,
  })),
];

export function InventoryMovementsPage() {
  const {
    data,
    paginatedRows,
    kpis,
    loading,
    error,
    search,
    period,
    type,
    branchId,
    productId,
    productName,
    productSku,
    filtersOpen,
    page,
    pageSize,
    totalItems,
    totalPages,
    apiMode,
    loadExportData,
    setSearch,
    setPeriod,
    setType,
    setBranchId,
    setProductId,
    setFiltersOpen,
    setPage,
    setPageSize,
  } = useInventoryMovements();
  const [selectedMovement, setSelectedMovement] = useState<InventoryMovementRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const movementTypeOptions = apiMode ? API_MOVEMENT_TYPE_OPTIONS : MOVEMENT_TYPE_OPTIONS;
  const firstVisible = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min((page - 1) * pageSize + paginatedRows.length, totalItems);
  const selectedBranchLabel =
    branchId === "all"
      ? "Todas las sucursales"
      : (data.branches.find((branch) => branch.id === branchId)?.name ?? "Sucursal seleccionada");
  const selectedPeriodLabel =
    MOVEMENT_PERIOD_OPTIONS.find((option) => option.value === period)?.label ??
    "Periodo seleccionado";
  const selectedTypeLabel =
    movementTypeOptions.find((option) => option.value === type)?.label ?? "Tipo seleccionado";
  // Nunca se muestra el UUID: nombre (y SKU) del contexto, o el de la fila; si no, un texto neutro.
  const resolvedProductName =
    productName || data.rows.find((row) => row.productId === productId)?.productName || "";
  const productFilterLabel = productId
    ? resolvedProductName
      ? productSku
        ? `${resolvedProductName} · ${productSku}`
        : resolvedProductName
      : "Producto seleccionado"
    : "";

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const exportData = await loadExportData();
      await exportInventoryMovementsXlsx({
        rows: exportData.rows,
        kpis: exportData.kpis,
        periodLabel: selectedPeriodLabel,
        typeLabel: selectedTypeLabel,
        branchLabel: selectedBranchLabel,
      });
    } catch {
      setExportError("No se pudo exportar el historial de movimientos.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <header className="flex min-w-0 flex-col gap-4 border-b border-[var(--color-border)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Inventario &gt; Movimientos
          </p>
          <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-title)]">
            Historial de movimientos
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Auditoria de entradas, salidas, ajustes, traslados, ventas y mermas.
          </p>
        </div>
        <Button
          className="w-full sm:w-auto"
          disabled={exporting}
          onClick={handleExport}
          type="button"
          variant="primary"
        >
          <DownloadIcon />
          {exporting ? "Exportando..." : "Exportar"}
        </Button>
      </header>

      {error ? <InlineAlert title={error} tone="danger" /> : null}
      {exportError ? <InlineAlert title={exportError} tone="danger" /> : null}

      <section className="max-w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <MovementFilters
          branchId={branchId}
          branches={data.branches}
          filtersOpen={filtersOpen}
          period={period}
          search={search}
          type={type}
          typeOptions={movementTypeOptions}
          productFilterLabel={productFilterLabel}
          onBranchChange={setBranchId}
          onPeriodChange={setPeriod}
          onSearchChange={setSearch}
          onProductFilterClear={() => setProductId("")}
          onToggleFilters={() => setFiltersOpen((current) => !current)}
          onTypeChange={setType}
        />
      </section>

      <MovementKpis incoming={kpis.incoming} net={kpis.net} outgoing={kpis.outgoing} />

      <section className="max-w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        {loading ? (
          <p className="border-t border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
            Cargando movimientos...
          </p>
        ) : (
          <MovementTable
            rows={paginatedRows}
            selectedMovementId={selectedMovement?.id ?? null}
            onOpen={setSelectedMovement}
          />
        )}

        {totalItems > 0 ? (
          <MovementTableFooter
            firstVisible={firstVisible}
            lastVisible={lastVisible}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            page={page}
            pageSize={pageSize}
            totalItems={totalItems}
            totalPages={totalPages}
          />
        ) : null}
      </section>

      {selectedMovement ? (
        <MovementDetailPanel
          movement={selectedMovement}
          onClose={() => setSelectedMovement(null)}
        />
      ) : null}
    </div>
  );
}

function MovementKpis({
  incoming,
  outgoing,
  net,
}: {
  incoming: number;
  outgoing: number;
  net: number;
}) {
  return (
    <section className="grid gap-3 md:grid-cols-3">
      <KpiCard
        icon={ArrowDownLeftIcon}
        label="Entradas"
        tone="success"
        value={formatQuantity(incoming)}
      />
      <KpiCard
        icon={ArrowUpRightIcon}
        label="Salidas"
        tone="danger"
        value={formatQuantity(outgoing)}
      />
      <KpiCard
        icon={ActivityIcon}
        label="Movimiento neto"
        tone={net < 0 ? "danger" : "info"}
        value={formatSignedQuantity(net)}
      />
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  tone: MovementTone;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-l-4 border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-sm",
        tone === "success" && "border-l-emerald-400",
        tone === "danger" && "border-l-orange-400",
        tone === "info" && "border-l-blue-400",
        tone === "warning" && "border-l-indigo-400",
      )}
    >
      <p className="flex items-center gap-2 text-xs font-bold uppercase text-[var(--color-text-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <strong className="mt-1 block text-3xl font-bold leading-none tracking-tight text-[var(--color-title)]">
        {value}
      </strong>
    </div>
  );
}

function MovementFilters({
  branchId,
  branches,
  filtersOpen,
  period,
  search,
  type,
  typeOptions,
  productFilterLabel,
  onBranchChange,
  onPeriodChange,
  onProductFilterClear,
  onSearchChange,
  onToggleFilters,
  onTypeChange,
}: {
  branchId: string;
  branches: Array<{ id: string; name: string }>;
  filtersOpen: boolean;
  period: MovementPeriodFilter;
  search: string;
  type: MovementTypeFilter;
  typeOptions: Array<{ value: MovementTypeFilter; label: string }>;
  productFilterLabel: string;
  onBranchChange: (value: string) => void;
  onPeriodChange: (value: MovementPeriodFilter) => void;
  onProductFilterClear: () => void;
  onSearchChange: (value: string) => void;
  onToggleFilters: () => void;
  onTypeChange: (value: MovementTypeFilter) => void;
}) {
  return (
    <div className="space-y-3 p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_190px_auto] lg:items-center">
        <Input
          aria-label="Buscar movimientos"
          maxLength={TEXT_LIMITS.search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por producto, SKU, referencia, usuario o sucursal..."
          type="search"
          value={search}
        />
        <Select
          aria-label="Periodo"
          onChange={(event) => onPeriodChange(event.target.value as MovementPeriodFilter)}
          value={period}
        >
          {MOVEMENT_PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Tipo de movimiento"
          onChange={(event) => onTypeChange(event.target.value as MovementTypeFilter)}
          value={type}
        >
          {typeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Button
          className={cn(
            "min-h-10 px-4 py-2",
            filtersOpen && "border-[var(--color-structure)] bg-[var(--color-primary)]/10",
          )}
          onClick={onToggleFilters}
          type="button"
          variant="secondary"
        >
          <FilterIcon />
          Filtros
        </Button>
      </div>
      {filtersOpen ? (
        <div className="grid gap-3 border-t border-[var(--color-border)] pt-3 md:grid-cols-2">
          <Select
            aria-label="Sucursal"
            onChange={(event) => onBranchChange(event.target.value)}
            value={branchId}
          >
            <option value="all">Todas las sucursales</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          {productFilterLabel ? (
            <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3">
              <span className="truncate text-sm font-semibold text-[var(--color-title)]">
                {productFilterLabel}
              </span>
              <button
                className="shrink-0 text-xs font-bold text-[var(--color-structure)] hover:underline"
                onClick={onProductFilterClear}
                type="button"
              >
                Quitar producto
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MovementTable({
  rows,
  selectedMovementId,
  onOpen,
}: {
  rows: InventoryMovementRow[];
  selectedMovementId: string | null;
  onOpen: (row: InventoryMovementRow) => void;
}) {
  return (
    <div className="overflow-x-auto border-t border-[var(--color-border)]">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-sm xl:min-w-0">
        <colgroup>
          <col className="w-[18%] xl:w-[11%]" />
          <col className="w-[28%] xl:w-[17%]" />
          <col className="w-[24%] xl:w-[14%]" />
          <col className="hidden md:table-column md:w-[16%] xl:w-[12%]" />
          <col className="hidden xl:table-column xl:w-[7%]" />
          <col className="w-[14%] xl:w-[7%]" />
          <col className="hidden lg:table-column xl:w-[7%]" />
          <col className="hidden lg:table-column xl:w-[16%]" />
          <col className="hidden xl:table-column xl:w-[9%]" />
        </colgroup>
        <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
          <tr>
            <th className="px-3 py-3 font-semibold">Fecha y hora</th>
            <th className="px-3 py-3 font-semibold">Producto</th>
            <th className="px-3 py-3 font-semibold">Tipo</th>
            <th className="hidden px-3 py-3 font-semibold md:table-cell">Referencia</th>
            <th className="hidden px-3 py-3 text-right font-semibold xl:table-cell">Anterior</th>
            <th className="px-3 py-3 text-right font-semibold">Cambio</th>
            <th className="hidden px-3 py-3 text-right font-semibold lg:table-cell">Resultante</th>
            <th className="hidden px-3 py-3 font-semibold lg:table-cell">Sucursal / ubicacion</th>
            <th className="hidden px-3 py-3 font-semibold xl:table-cell">Usuario</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[var(--color-text-muted)]" colSpan={9}>
                <div className="mx-auto flex max-w-sm flex-col items-center gap-2">
                  <HistoryIcon className="h-6 w-6 text-[var(--color-structure)]" />
                  <p className="font-bold text-[var(--color-title)]">
                    No se encontraron movimientos
                  </p>
                  <p className="text-sm">Ajusta los filtros o cambia el periodo seleccionado.</p>
                </div>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const dateParts = formatDateParts(row.createdAt);
              return (
                <tr
                  className={cn(
                    "cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus-visible:bg-[var(--color-primary)]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--color-structure)]",
                    selectedMovementId === row.id &&
                      "border-l-4 border-l-[var(--color-structure)] bg-[var(--color-primary)]/10",
                  )}
                  key={row.id}
                  onClick={() => onOpen(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onOpen(row);
                  }}
                  tabIndex={0}
                >
                  <td className="px-3 py-2.5 font-medium text-[var(--color-text)]">
                    <span className="block truncate">{dateParts.date}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                      {dateParts.time}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="truncate font-medium text-[var(--color-title)]" title={row.productName}>
                      {row.productName}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-text-muted)]" title={row.sku}>
                      {row.sku}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <MovementTypeBadge row={row} />
                  </td>
                  <td className="hidden px-3 py-2.5 font-medium text-[var(--color-structure)] md:table-cell">
                    <span className="block truncate" title={row.referenceLabel}>{row.referenceLabel}</span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-[var(--color-text-muted)] xl:table-cell">
                    {formatOptionalQuantity(row.quantityBefore)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span
                      className={cn(
                        "font-black",
                        getQuantityClass(row.signedQuantity, row.displayType),
                      )}
                    >
                      {formatMovementChange(row)}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-[var(--color-text)] lg:table-cell">
                    {formatOptionalQuantity(row.quantityAfter)}
                  </td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
                    <p className="break-words font-medium leading-tight text-[var(--color-title)]">
                      {row.branchName}
                    </p>
                    <p className="mt-1 break-words text-xs font-medium leading-tight text-[var(--color-text-muted)]">
                      {row.locationLabel}
                    </p>
                  </td>
                  <td className="hidden break-words px-3 py-2.5 leading-tight text-[var(--color-text)] xl:table-cell">
                    {row.userLabel}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function MovementTypeBadge({ row }: { row: InventoryMovementRow }) {
  const config = movementDisplayConfig[row.displayType];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        config.badgeClassName,
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{config.label}</span>
    </span>
  );
}

function MovementTableFooter({
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
          Mostrando {firstVisible}-{lastVisible} de {totalItems} movimientos
        </p>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          Filas
          <Select
            aria-label="Filas por pagina"
            className="h-9 w-20 rounded-md px-2"
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
        aria-label="Paginacion de movimientos"
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
          {"<"}
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
          {">"}
        </Button>
      </nav>
    </div>
  );
}

function MovementDetailPanel({
  movement,
  onClose,
}: {
  movement: InventoryMovementRow;
  onClose: () => void;
}) {
  const isTransfer = Boolean(movement.transferDetail);
  const isAdjustment = Boolean(movement.adjustmentDetail);

  return (
    <>
      <button
        aria-label="Cerrar detalle de movimiento"
        className="fixed inset-0 z-30 bg-[var(--color-topbar)]/35"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="Detalle de movimiento historico"
        aria-modal="true"
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-hidden border-l border-[var(--color-border)] bg-white shadow-xl sm:max-w-[460px] lg:max-w-[500px]"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Movimiento historico
            </p>
            <h2 className="mt-1 break-words text-lg font-bold text-[var(--color-title)]">
              {movement.referenceLabel !== "-" ? movement.referenceLabel : movement.typeLabel}
            </h2>
            <div className="mt-2">
              <MovementTypeBadge row={movement} />
            </div>
          </div>
          <button
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
            onClick={onClose}
            type="button"
          >
            x
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <dl className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 sm:grid-cols-2">
              <DetailItem label="Fecha y hora" value={formatDateTime(movement.createdAt)} />
              <DetailItem label="Producto" value={movement.productName} />
              <DetailItem label="SKU" value={movement.sku} />
              <DetailItem
                label="Cantidad anterior"
                value={formatOptionalQuantity(movement.quantityBefore)}
              />
              <DetailItem
                label="Cambio"
                value={
                  <span className={getQuantityClass(movement.signedQuantity, movement.displayType)}>
                    {formatMovementChange(movement)}
                  </span>
                }
              />
              <DetailItem
                label="Cantidad resultante"
                value={formatOptionalQuantity(movement.quantityAfter)}
              />
              <DetailItem label="Usuario" value={movement.userLabel} />
              <DetailItem label="Sucursal" value={movement.branchName} />
              <DetailItem label="Ubicacion" value={movement.locationLabel} />
              <DetailItem label="Referencia" value={movement.referenceLabel} />
              <DetailItem label="Motivo" value={movement.reason || "-"} />
            </dl>

            {isAdjustment ? (
              <section className="rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-bold uppercase text-indigo-800">
                  <SlidersIcon className="h-3.5 w-3.5" />
                  Ajuste
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <AdjustmentInlineDetail
                    label="Operacion"
                    value={movement.adjustmentDetail?.operationLabel ?? "-"}
                  />
                  <AdjustmentInlineDetail
                    label="Documento"
                    value={movement.adjustmentDetail?.number ?? "-"}
                  />
                  {movement.adjustmentDetail?.notes ? (
                    <AdjustmentInlineDetail
                      label="Observaciones"
                      value={movement.adjustmentDetail.notes}
                    />
                  ) : null}
                </dl>
              </section>
            ) : null}

            {isTransfer ? (
              <section className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="flex items-center gap-2 text-xs font-bold uppercase text-blue-800">
                  <TruckIcon className="h-3.5 w-3.5" />
                  Traslado
                </p>
                <p className="mt-1 text-sm font-semibold text-blue-950">
                  {movement.transferDetail?.directionLabel}
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <InlineDetail label="Numero" value={movement.transferDetail?.number ?? "-"} />
                  <InlineDetail
                    label="Origen"
                    value={movement.transferDetail?.sourceBranchName ?? "-"}
                  />
                  <InlineDetail
                    label="Destino"
                    value={movement.transferDetail?.destinationBranchName ?? "-"}
                  />
                  <InlineDetail
                    label="Producto"
                    value={movement.transferDetail?.productName ?? "-"}
                  />
                  <InlineDetail
                    label="Solicitado"
                    value={formatNumber(movement.transferDetail?.requestedQuantity ?? 0)}
                  />
                  <InlineDetail
                    label="Despachado"
                    value={formatNumber(movement.transferDetail?.dispatchedQuantity ?? 0)}
                  />
                  <InlineDetail
                    label="Recibido"
                    value={formatNumber(movement.transferDetail?.receivedQuantity ?? 0)}
                  />
                </dl>
              </section>
            ) : null}

            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
              Movimiento historico de solo lectura. Las correcciones deben registrarse como un nuevo
              ajuste o movimiento correctivo.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function InlineDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="font-semibold text-blue-900">{label}</dt>
      <dd className="text-right font-bold text-blue-950">{value}</dd>
    </div>
  );
}

function AdjustmentInlineDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="font-semibold text-indigo-900">{label}</dt>
      <dd className="text-right font-bold text-indigo-950">{value}</dd>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateParts(value: string) {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat("es-GT", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("es-GT", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
  };
}

function formatQuantity(value: number) {
  return formatNumber(Math.abs(value));
}

function formatSignedQuantity(value: number) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "-"}${formatNumber(Math.abs(value))}`;
}

function formatMovementChange(row: InventoryMovementRow) {
  return formatSignedQuantity(row.signedQuantity);
}

function getQuantityClass(value: number, type: InventoryMovementRow["displayType"]) {
  if (type === "transfer") return "text-blue-700";
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-red-700";
  return "text-[var(--color-text)]";
}

function formatOptionalQuantity(value?: number) {
  return typeof value === "number" ? formatNumber(value) : "-";
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

function ArrowDownLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m17 7-10 10" />
      <path d="M7 7v10h10" />
    </Icon>
  );
}

function ArrowUpRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m7 17 10-10" />
      <path d="M7 7h10v10" />
    </Icon>
  );
}

function PackagePlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m3 7 9 5 9-5" />
      <path d="M12 22V12" />
      <path d="M21 7v10l-9 5-9-5V7l9-5 9 5Z" />
      <path d="M16 14h4" />
      <path d="M18 12v4" />
    </Icon>
  );
}

function TruckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 17h4V5H2v12h3" />
      <path d="M14 8h4l4 4v5h-3" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
    </Icon>
  );
}

function SlidersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 21v-7" />
      <path d="M4 10V3" />
      <path d="M12 21v-9" />
      <path d="M12 8V3" />
      <path d="M20 21v-5" />
      <path d="M20 12V3" />
      <path d="M2 14h4" />
      <path d="M10 8h4" />
      <path d="M18 16h4" />
    </Icon>
  );
}

function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m12 3 10 18H2L12 3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

function ReceiptIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 3v18l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z" />
      <path d="M8 9h8" />
      <path d="M8 13h6" />
    </Icon>
  );
}

function ActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </Icon>
  );
}

function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Icon>
  );
}

function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 5h18" />
      <path d="M6 12h12" />
      <path d="M10 19h4" />
    </Icon>
  );
}

function HistoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}
