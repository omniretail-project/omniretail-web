import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CashShiftStatus } from "@/core/enums";
import type {
  CashShiftDto,
  CashShiftFilter,
} from "@/modules/administration/application/dto/CashShiftDto";
import { Button } from "@/shared/components/Button";
import { BroomIcon } from "@/shared/components/icons";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";

interface CashShiftFiltersProps {
  branchNames: ReadonlyMap<string, string>;
  filter: CashShiftFilter;
  shifts: CashShiftDto[];
  onChange: (filter: CashShiftFilter) => void;
  onReset: () => void;
}

export function CashShiftFilters({
  branchNames,
  filter,
  shifts,
  onChange,
  onReset,
}: CashShiftFiltersProps) {
  const branches = useMemo(
    () =>
      [...new Set(shifts.map((shift) => shift.branchId))]
        .map((id) => ({ id, name: branchNames.get(id) ?? id }))
        .sort((left, right) => left.name.localeCompare(right.name, "es")),
    [branchNames, shifts],
  );

  function update(patch: Partial<CashShiftFilter>) {
    onChange({ ...filter, ...patch });
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm sm:p-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6 xl:items-end">
        <FilterField className="md:col-span-2 xl:col-span-2" label="Buscar" htmlFor="cash-shift-search">
          <Input
            id="cash-shift-search"
            onChange={(event) => update({ search: event.target.value })}
            placeholder="Caja, sucursal o cajero"
            type="search"
            value={filter.search ?? ""}
          />
        </FilterField>
        <FilterField className="xl:col-span-1" label="Estado" htmlFor="cash-shift-status">
          <Select
            id="cash-shift-status"
            onChange={(event) => update({ status: event.target.value })}
            value={filter.status ?? ""}
          >
            <option value="">Todos</option>
            <option value={CashShiftStatus.open}>Abierto</option>
            <option value={CashShiftStatus.closed}>Cerrado</option>
            <option value={CashShiftStatus.closed_with_difference}>Cerrado con diferencia</option>
          </Select>
        </FilterField>
        <FilterField className="xl:col-span-1" label="Sucursal" htmlFor="cash-shift-branch">
          <Select
            id="cash-shift-branch"
            onChange={(event) => update({ branchId: event.target.value })}
            value={filter.branchId ?? ""}
          >
            <option value="">Todas</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </FilterField>
        <div className="flex min-w-0 items-end gap-2 md:col-span-2 xl:col-span-2">
          <DateRangeFilter
            from={filter.from ?? ""}
            onClear={() => update({ from: "", to: "" })}
            onFromChange={(from) => update({ from })}
            onToChange={(to) => update({ to })}
            to={filter.to ?? ""}
          />
          <Button
            className="min-h-[2.6rem] gap-1.5 px-3"
            onClick={onReset}
            title="Limpiar filtros"
            type="button"
            variant="secondary"
          >
            <BroomIcon className="h-4 w-4" />
          </Button>
        </div>
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

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const rangeLabel = from && to
    ? `${formatDateInput(from)} → ${formatDateInput(to)}`
    : from
      ? `${formatDateInput(from)} → Seleccionar fin`
      : to
        ? `Seleccionar inicio → ${formatDateInput(to)}`
        : "Seleccionar rango";

  return (
    <div className="relative min-w-0 flex-1" ref={containerRef}>
      <button
        aria-controls="cash-shift-date-range-popover"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex min-h-[2.6rem] w-full min-w-0 flex-col justify-center rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-left outline-none transition hover:border-[var(--color-structure)] focus-visible:border-[var(--color-structure)] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/40"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="text-xs font-semibold text-[var(--color-text-muted)]">
          Rango de fechas
        </span>
        <span className="truncate text-sm font-medium text-[var(--color-text)]">
          {rangeLabel}
        </span>
      </button>

      {open ? (
        <div
          aria-label="Seleccionar rango de fechas"
          className="absolute left-0 top-full z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-lg sm:left-auto sm:right-0"
          id="cash-shift-date-range-popover"
          role="dialog"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterField label="Desde" htmlFor="cash-shift-from">
              <Input
                id="cash-shift-from"
                onChange={(event) => onFromChange(event.target.value)}
                type="date"
                value={from}
              />
            </FilterField>
            <FilterField label="Hasta" htmlFor="cash-shift-to">
              <Input
                id="cash-shift-to"
                onChange={(event) => onToChange(event.target.value)}
                type="date"
                value={to}
              />
            </FilterField>
          </div>
          <div className="mt-3 flex justify-end border-t border-[var(--color-border)] pt-3">
            <button
              className="rounded-md px-2 py-1 text-sm font-semibold text-[var(--color-structure)] hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
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

function formatDateInput(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function FilterField({
  children,
  className,
  htmlFor,
  label,
}: {
  children: ReactNode;
  className?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <label className={`min-w-0 space-y-1.5 ${className ?? ""}`} htmlFor={htmlFor}>
      <span className="block text-sm font-semibold text-[var(--color-text)]">{label}</span>
      {children}
    </label>
  );
}
