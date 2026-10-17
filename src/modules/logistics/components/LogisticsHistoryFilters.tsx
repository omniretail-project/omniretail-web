"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DeliveryMethod, OrderStatus } from "@/core/enums";
import type { LogisticsHistoryFilters as HistoryFilters } from "@/modules/logistics/hooks/useLogisticsHistory";
import { SearchInput } from "@/shared/components/SearchInput";
import { Select } from "@/shared/components/Select";
import { statusesConfig } from "@/config/statuses";
import { Input } from "@/shared/components/Input";

interface LogisticsHistoryFiltersProps {
  disabled?: boolean;
  filters: HistoryFilters;
  onChange: (patch: Partial<HistoryFilters>) => void;
}

const historyStatuses = [
  OrderStatus.packing,
  OrderStatus.ready_for_dispatch,
  OrderStatus.ready_for_pickup,
  OrderStatus.dispatched,
  OrderStatus.delivered,
  OrderStatus.cancelled,
] as const;

export function LogisticsHistoryFilters({
  disabled = false,
  filters,
  onChange,
}: LogisticsHistoryFiltersProps) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-sm sm:p-3.5">
      <div>
          <h2 className="text-base font-bold text-[var(--color-title)] sm:text-lg">Filtros del historial</h2>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
          Localiza una operación preparada o finalizada.
          </p>
      </div>
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <FilterField className="sm:col-span-2 xl:col-span-1" label="Buscar">
          <SearchInput
            disabled={disabled}
            placeholder="Pedido o cliente"
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value })}
          />
        </FilterField>
        <FilterField label="Resultado">
          <Select
            disabled={disabled}
            value={filters.status}
            onChange={(event) =>
              onChange({ status: event.target.value as HistoryFilters["status"] })
            }
          >
            <option value="all">Todos los resultados</option>
            {historyStatuses.map((status) => (
              <option key={status} value={status}>
                {statusesConfig[status].label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Modalidad de entrega">
          <Select
            disabled={disabled}
            value={filters.deliveryMethod}
            onChange={(event) =>
              onChange({
                deliveryMethod: event.target.value as HistoryFilters["deliveryMethod"],
              })
            }
          >
            <option value="all">Todas</option>
            <option value={DeliveryMethod.store_pickup}>Retiro en tienda/bodega</option>
            <option value={DeliveryMethod.home_delivery}>Envío a domicilio</option>
          </Select>
        </FilterField>
        <DateRangeFilter
          disabled={disabled}
          from={filters.from}
          to={filters.to}
          onChange={onChange}
        />
      </div>
    </section>
  );
}

function DateRangeFilter({
  disabled,
  from,
  to,
  onChange,
}: {
  disabled: boolean;
  from: string;
  to: string;
  onChange: (patch: Partial<HistoryFilters>) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="relative space-y-1" ref={containerRef}>
      <span className="block text-xs font-semibold text-[var(--color-title)]">
        Rango de fechas
      </span>
      <button
        aria-controls="logistics-history-date-range"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-left text-sm text-[var(--color-text)] outline-none transition hover:border-[var(--color-structure)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="truncate">{getDateRangeLabel(from, to)}</span>
        <svg
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[var(--color-structure)]"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path d="M6 2v4M18 2v4M3 9h18" />
          <rect height="18" rx="2" width="18" x="3" y="4" />
        </svg>
      </button>

      {open ? (
        <div
          aria-label="Seleccionar rango de fechas"
          className="absolute right-0 z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-lg"
          id="logistics-history-date-range"
          role="dialog"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--color-title)]">Desde</span>
              <Input
                disabled={disabled}
                type="date"
                value={from}
                onChange={(event) => onChange({ from: event.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-[var(--color-title)]">Hasta</span>
              <Input
                disabled={disabled}
                type="date"
                value={to}
                onChange={(event) => onChange({ to: event.target.value })}
              />
            </label>
          </div>
          <div className="flex justify-end border-t border-[var(--color-border)] pt-2">
            <button
              className="text-xs font-semibold text-[var(--color-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled || (!from && !to)}
              onClick={() => onChange({ from: "", to: "" })}
              type="button"
            >
              Borrar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getDateRangeLabel(from: string, to: string) {
  if (from && to) return `${formatFilterDate(from)} - ${formatFilterDate(to)}`;
  if (from) return `Desde ${formatFilterDate(from)}`;
  if (to) return `Hasta ${formatFilterDate(to)}`;
  return "Seleccionar rango";
}

function formatFilterDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function FilterField({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="text-xs font-semibold text-[var(--color-title)]">{label}</span>
      {children}
    </label>
  );
}
