import type { MouseEvent } from "react";
import { DeliveryMethod, OrderStatus } from "@/core/enums";
import type { LogisticsHistoryItemDto } from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface LogisticsHistoryTableProps {
  items: LogisticsHistoryItemDto[];
  canConfirmDispatch: boolean;
  currentPage: number;
  pageSize: number;
  onAddGuide: (item: LogisticsHistoryItemDto) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRowDoubleClick?: (item: LogisticsHistoryItemDto) => void;
  /**
   * Paginación del servidor: `items` ya es la página actual y el total lo informa el backend.
   * Sin este dato la tabla pagina en el cliente sobre todos los registros.
   */
  serverTotalItems?: number;
}

export function LogisticsHistoryTable({
  items,
  canConfirmDispatch,
  currentPage,
  pageSize,
  onAddGuide,
  onPageChange,
  onPageSizeChange,
  onRowDoubleClick,
  serverTotalItems,
}: LogisticsHistoryTableProps) {
  const serverPaginated = serverTotalItems !== undefined;
  const totalItems = serverPaginated ? serverTotalItems : items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const { rangeStart, rangeEnd, visibleItems } = resolvePageWindow(
    items,
    safePage,
    pageSize,
    serverPaginated,
  );
  const showActionColumn = items.some(canAddGuide);

  const columns: DataTableColumn<LogisticsHistoryItemDto>[] = [
    {
      key: "document",
      header: "Documento",
      className: "w-[9%] px-2 py-2 align-top",
      cell: (item) => (
        <div className="min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
            {item.sourceType === "transfer" ? "Traslado" : "Pedido"}
          </span>
          <strong className="block whitespace-nowrap text-sm text-[var(--color-title)]">
            {item.orderReference}
          </strong>
        </div>
      ),
    },
    {
      key: "orderCustomer",
      header: "Pedido / Cliente",
      className: "w-[17%] px-2 py-2 align-top",
      cell: (item) => (
        <div className="min-w-0 space-y-0.5">
          <strong className="block break-words text-sm text-[var(--color-title)]">{item.contactName}</strong>
          <span className="block text-xs text-[var(--color-text-muted)]">
            {deliveryMethodLabel(item)}
          </span>
        </div>
      ),
    },
    {
      key: "result",
      header: "Resultado",
      className: "w-[13%] px-2 py-2 align-top",
      cell: (item) => (
        <div className="whitespace-nowrap">
          <StatusBadge status={item.operationalStatus} />
        </div>
      ),
    },
    {
      key: "pickingCompleted",
      header: "Recolección finalizada",
      className: "w-[13%] px-2 py-2 align-top",
      cell: (item) => <span className="block text-sm leading-5">{formatDateTime(item.pickingCompletedAt)}</span>,
    },
    {
      key: "exit",
      header: "Salida",
      className: "w-[12%] px-2 py-2 align-top",
      cell: (item) => <ExitSummary item={item} />,
    },
    {
      key: "responsible",
      header: "Responsable",
      className: "w-[12%] px-2 py-2 align-top",
      cell: (item) => <span className="block break-words text-sm leading-5">{item.responsibleUserName ?? "—"}</span>,
    },
    {
      key: "package",
      header: "Paquete",
      className: "w-[10%] px-2 py-2 align-top",
      cell: (item) => <span className="block text-sm leading-5">{packageSummary(item)}</span>,
    },
  ];

  if (showActionColumn) {
    columns.push({
      key: "action",
      header: "Acción",
      className: "w-[14%] px-2 py-2 align-top",
      cell: (item) =>
        canAddGuide(item) ? (
          <Button
            className="min-h-9 whitespace-nowrap px-3 py-1.5"
            disabled={!canConfirmDispatch}
            title={canConfirmDispatch ? undefined : "No tienes permiso para confirmar despachos."}
            type="button"
            variant="secondary"
            onClick={(event) => {
              event.stopPropagation();
              onAddGuide(item);
            }}
            onDoubleClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
          >
            + Agregar guía
          </Button>
        ) : (
          <span className="text-[var(--color-text-muted)]">—</span>
        ),
    });
  }

  return (
    <div className="min-w-0">
      <DataTable
        columns={columns}
        data={visibleItems}
        emptyMessage="No hay pedidos que coincidan con los filtros actuales."
        headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
        rowKey={(item) => item.orderId}
        onRowDoubleClick={onRowDoubleClick}
      />
      <div className="mt-3 flex flex-col gap-3 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-text-muted)] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="tabular-nums">
            {items.length === 0
              ? "Mostrando 0 de 0 registros"
              : `Mostrando ${rangeStart}-${rangeEnd} de ${totalItems} registros`}
          </p>
          <label className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-title)]">Filas</span>
            <select
              aria-label="Filas por página"
              className="h-9 rounded-md border border-[var(--color-border)] bg-white px-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
              value={pageSize}
              onChange={(event) => {
                onPageSizeChange(Number(event.target.value));
              }}
            >
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
              aria-label="Página anterior"
              className="min-h-9 px-3 py-1.5"
              disabled={safePage === 1}
              onClick={() => onPageChange(Math.max(1, safePage - 1))}
              type="button"
              variant="secondary"
            >
              &lt;
          </Button>
          <span className="min-w-16 text-center font-semibold tabular-nums text-[var(--color-title)]">
            {safePage} / {totalPages}
          </span>
          <Button
              aria-label="Página siguiente"
              className="min-h-9 px-3 py-1.5"
              disabled={safePage === totalPages}
              onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
              type="button"
              variant="secondary"
            >
              &gt;
          </Button>
        </div>
      </div>
    </div>
  );
}

const deliveryMethodLabels: Record<LogisticsHistoryItemDto["deliveryMethod"], string> = {
  [DeliveryMethod.immediate]: "Entrega inmediata",
  [DeliveryMethod.store_pickup]: "Retiro en tienda/bodega",
  [DeliveryMethod.home_delivery]: "Envío a domicilio",
  transfer: "Traslado entre sucursales",
};

/** La modalidad se deriva del origen: un traslado nunca es retiro ni envío a un cliente. */
export function deliveryMethodLabel(item: Pick<LogisticsHistoryItemDto, "sourceType" | "deliveryMethod">) {
  return item.sourceType === "transfer"
    ? deliveryMethodLabels.transfer
    : deliveryMethodLabels[item.deliveryMethod];
}

/** Con paginación del servidor `items` ya es la página; sin ella se recorta en el cliente. */
function resolvePageWindow(
  items: LogisticsHistoryItemDto[],
  page: number,
  pageSize: number,
  serverPaginated: boolean,
) {
  if (items.length === 0) return { rangeStart: 0, rangeEnd: 0, visibleItems: items };
  const rangeStart = (page - 1) * pageSize + 1;
  if (serverPaginated) {
    return { rangeStart, rangeEnd: rangeStart + items.length - 1, visibleItems: items };
  }
  const rangeEnd = Math.min(page * pageSize, items.length);
  return { rangeStart, rangeEnd, visibleItems: items.slice(rangeStart - 1, rangeEnd) };
}

export function canAddGuide(item: LogisticsHistoryItemDto) {
  return (
    item.deliveryMethod === DeliveryMethod.home_delivery &&
    item.operationalStatus === OrderStatus.ready_for_dispatch &&
    item.packingId !== null &&
    item.packingFinalizedAt !== null &&
    item.dispatchId === null
  );
}

function ExitSummary({ item }: { item: LogisticsHistoryItemDto }) {
  const latestExitAt = item.deliveredAt ?? item.dispatchedAt ?? item.packingFinalizedAt;
  return <span className="block text-sm leading-5">{formatDateTime(latestExitAt)}</span>;
}

function packageSummary(item: LogisticsHistoryItemDto) {
  if (item.deliveryMethod === DeliveryMethod.store_pickup) return "No aplica";
  const parts: string[] = [];
  if (item.totalWeight !== null) parts.push(`${item.totalWeight} kg`);
  if (item.packageCount !== null) {
    parts.push(`${item.packageCount} ${item.packageCount === 1 ? "bulto" : "bultos"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
