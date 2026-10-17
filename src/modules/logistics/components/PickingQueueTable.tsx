import { useMemo, useState } from "react";
import { DeliveryMethod, PickingStatus } from "@/core/enums";
import type { PickingQueueItemDto } from "@/modules/logistics/application/dto/PickingReadModelDto";
import { FormField } from "@/shared/components/FormField";
import { SearchInput } from "@/shared/components/SearchInput";
import { Select } from "@/shared/components/Select";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";

interface PickingQueueProps {
  currentUserId: string | null;
  disabled?: boolean;
  items: PickingQueueItemDto[];
  search: string;
  selectedPickingOrderId: string | null;
  onSearchChange: (value: string) => void;
  onSelect: (item: PickingQueueItemDto) => void;
}

const deliveryLabels: Record<DeliveryMethod | "transfer", string> = {
  transfer: "Traslado entre sucursales",
  [DeliveryMethod.immediate]: "Entrega inmediata",
  [DeliveryMethod.store_pickup]: "Retiro en tienda",
  [DeliveryMethod.home_delivery]: "Envío a domicilio",
};

const statusLabels: Record<PickingStatus, string> = {
  [PickingStatus.pending]: "Pendiente",
  [PickingStatus.assigned]: "Asignado",
  [PickingStatus.in_progress]: "En progreso",
  [PickingStatus.completed]: "Completado",
  [PickingStatus.cancelled]: "Cancelado",
};

export function PickingQueue({
  currentUserId,
  disabled,
  items,
  search,
  selectedPickingOrderId,
  onSearchChange,
  onSelect,
}: PickingQueueProps) {
  const [statusFilter, setStatusFilter] = useState<PickingStatus | "">("");
  const filteredItems = useMemo(
    () => items.filter((item) => !statusFilter || item.status === statusFilter),
    [items, statusFilter],
  );

  return (
    <aside className="rounded-xl border border-[var(--color-border)] bg-white shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-hidden">
      <div className="border-b border-[var(--color-border)] px-4 py-3.5">
        <h2 className="text-lg font-bold text-[var(--color-title)]">Cola de pedidos</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Pedidos disponibles para preparar.</p>
      </div>

      <div className="space-y-2 border-b border-[var(--color-border)] p-3">
        <FormField id="picking-search" label="Buscar pedido">
          <SearchInput
            aria-label="Buscar pedido de picking"
            disabled={disabled}
            id="picking-search"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Pedido o cliente"
            value={search}
          />
        </FormField>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <FormField id="picking-status-filter" label="Estado">
            <Select
              disabled={disabled}
              id="picking-status-filter"
              onChange={(event) => setStatusFilter(event.target.value as PickingStatus | "")}
              value={statusFilter}
            >
              <option value="">Todos los estados</option>
              {Object.values(PickingStatus).map((status) => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              ))}
            </Select>
          </FormField>
          <FormField
            hint="El número de documento no está disponible para filtrar."
            id="picking-document-filter"
            label="Documento"
          >
            <Select disabled id="picking-document-filter" value="">
              <option value="">No disponible</option>
            </Select>
          </FormField>
        </div>
      </div>

      <div className="space-y-2 overflow-y-auto p-3 lg:max-h-[calc(100dvh-23rem)]" aria-label="Pedidos de picking">
        {filteredItems.length === 0 ? (
          <p className="rounded-lg bg-[var(--color-app-background)] p-4 text-center text-sm text-[var(--color-text-muted)]">
            No hay pedidos que coincidan con los filtros.
          </p>
        ) : filteredItems.map((item) => {
          const selected = item.pickingOrderId === selectedPickingOrderId;
          const assignment = !item.assignedUserId
            ? "Sin asignar"
            : item.assignedUserId === currentUserId
              ? "Asignado a ti"
              : "Otro operador";
          return (
            <button
              aria-pressed={selected}
              className={cn(
                "w-full rounded-lg border px-3.5 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
                selected
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 shadow-sm"
                  : "border-[var(--color-border)] bg-white hover:border-[var(--color-structure)] hover:bg-slate-50",
              )}
              disabled={disabled}
              key={item.pickingOrderId}
              onClick={() => onSelect(item)}
              type="button"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-[var(--color-title)]">{item.orderReference}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{item.customerName}</p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <StatusBadge status={statusLabels[item.status]} tone={item.status === PickingStatus.pending ? "warning" : "info"} />
                <span className="text-xs text-[var(--color-text-muted)]">{deliveryLabels[item.deliveryMethod]}</span>
              </div>
              <div className="mt-2.5">
                <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                  <span>{item.progress.pickedQuantity}/{item.progress.requiredQuantity} unidades</span>
                  <span>{item.progress.percentage}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${item.progress.percentage}%` }} />
                </div>
                <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-xs font-medium text-[var(--color-text-muted)]">{assignment}</p>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
