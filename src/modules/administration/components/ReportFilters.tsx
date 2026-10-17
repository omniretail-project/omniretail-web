import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ReportFilter,
  ReportKind,
  ReportsDataDto,
} from "@/modules/administration/application/dto/ReportDto";
import { getDateRangeLabel, getOptions } from "@/modules/administration/application/reportHelpers";
import { ReportKindSelector } from "@/modules/administration/components/ReportKindSelector";
import { Button } from "@/shared/components/Button";
import { BroomIcon } from "@/shared/components/icons";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";

interface ReportFiltersProps {
  data: ReportsDataDto;
  filter: ReportFilter;
  kind: ReportKind;
  onChange: (filter: ReportFilter) => void;
  onKindChange: (kind: ReportKind) => void;
  onReset: () => void;
}

export function ReportFilters({
  data,
  filter,
  kind,
  onChange,
  onKindChange,
  onReset,
}: ReportFiltersProps) {
  const options = useMemo(() => getOptions(data, kind), [data, kind]);

  function update(patch: Partial<ReportFilter>) {
    onChange({ ...filter, ...patch });
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
        <ReportKindSelector kind={kind} onChange={onKindChange} />

        <DateRangeFilter
          from={filter.from ?? ""}
          onClear={() => update({ from: "", to: "" })}
          onFromChange={(from) => update({ from })}
          onToChange={(to) => update({ to })}
          to={filter.to ?? ""}
        />

        {kind === "sales" ? (
          <>
            <OptionFilter
              id="report-status"
              label="Estado"
              options={options.statuses}
              value={filter.status ?? ""}
              onChange={(status) => update({ status })}
            />
            <OptionFilter
              id="report-branch"
              label="Sucursal"
              options={options.branches}
              value={filter.branchId ?? ""}
              onChange={(branchId) => update({ branchId })}
            />
          </>
        ) : null}

        {kind === "purchases" ? (
          <>
            <OptionFilter
              id="report-status"
              label="Estado"
              options={options.statuses}
              value={filter.status ?? ""}
              onChange={(status) => update({ status })}
            />
            <OptionFilter
              id="report-supplier"
              label="Proveedor"
              options={options.suppliers}
              value={filter.supplierId ?? ""}
              onChange={(supplierId) => update({ supplierId })}
            />
            <OptionFilter
              id="report-branch"
              label="Sucursal"
              options={options.branches}
              value={filter.branchId ?? ""}
              onChange={(branchId) => update({ branchId })}
            />
          </>
        ) : null}

        {kind === "movements" ? (
          <>
            <OptionFilter
              id="report-movement-type"
              label="Tipo"
              options={options.movementTypes}
              value={filter.movementType ?? ""}
              onChange={(movementType) => update({ movementType })}
            />
            <OptionFilter
              id="report-branch"
              label="Sucursal"
              options={options.branches}
              value={filter.branchId ?? ""}
              onChange={(branchId) => update({ branchId })}
            />
            <OptionFilter
              id="report-product"
              label="Producto"
              options={options.products}
              value={filter.productId ?? ""}
              onChange={(productId) => update({ productId })}
            />
          </>
        ) : null}

        {kind === "payments" ? (
          <>
            <OptionFilter
              id="report-method"
              label="Método"
              options={options.methods}
              value={filter.method ?? ""}
              onChange={(method) => update({ method })}
            />
            <OptionFilter
              id="report-status"
              label="Estado"
              options={options.statuses}
              value={filter.status ?? ""}
              onChange={(status) => update({ status })}
            />
          </>
        ) : null}

        <Button
          className="min-h-[2.6rem] gap-1.5 px-3 sm:w-fit"
          onClick={onReset}
          title="Limpiar filtros"
          type="button"
          variant="secondary"
        >
          <BroomIcon className="h-4 w-4" />
        </Button>
      </div>
    </section>
  );
}

function DateRangeFilter({
  from,
  onClear,
  onFromChange,
  onToChange,
  to,
}: {
  from: string;
  onClear: () => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  to: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = "report-date-range-popover";

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative min-w-0 space-y-1.5" ref={containerRef}>
      <span className="block text-sm font-semibold text-[var(--color-text)]">Rango de fechas</span>
      <button
        aria-controls={popoverId}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex min-h-[2.6rem] w-full items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-left text-sm text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-structure)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="min-w-0 truncate">{getDateRangeLabel(from, to)}</span>
        <span aria-hidden="true" className="ml-2 text-xs text-[var(--color-text-muted)]">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open ? (
        <div
          aria-label="Seleccionar rango de fechas"
          className="absolute left-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg sm:left-auto sm:right-0"
          id={popoverId}
          role="dialog"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterField htmlFor="report-from" label="Desde">
              <Input
                id="report-from"
                max={to}
                onChange={(event) => onFromChange(event.target.value)}
                type="date"
                value={from}
              />
            </FilterField>
            <FilterField htmlFor="report-to" label="Hasta">
              <Input
                id="report-to"
                min={from}
                onChange={(event) => onToChange(event.target.value)}
                type="date"
                value={to}
              />
            </FilterField>
          </div>
          <div className="mt-3 flex justify-end border-t border-[var(--color-border)] pt-3">
            <button
              className="rounded-md px-2 py-1 text-sm font-medium text-[var(--color-primary)] hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              onClick={onClear}
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

function OptionFilter({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FilterField htmlFor={id} label={label}>
      <Select id={id} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </FilterField>
  );
}

function FilterField({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <label className="space-y-1.5" htmlFor={htmlFor}>
      <span className="block text-sm font-semibold text-[var(--color-text)]">{label}</span>
      {children}
    </label>
  );
}
