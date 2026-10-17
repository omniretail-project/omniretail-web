"use client";

import { useMemo, useState } from "react";
import type {
  ReportFilter,
  ReportKind,
  ReportsDataDto,
} from "@/modules/administration/application/dto/ReportDto";
import { getOptions } from "@/modules/administration/application/reportHelpers";
import { Modal } from "@/shared/components/Modal";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";

// I'll create a local Checkbox just in case
function LocalCheckbox({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
      />
      <span className="text-sm font-medium text-[var(--color-text)]">{label}</span>
    </label>
  );
}

export interface ReportsExportModalProps {
  open: boolean;
  onClose: () => void;
  data: ReportsDataDto;
  initialKind: ReportKind;
  initialFilter: ReportFilter;
  onExport: (configs: { kind: ReportKind; filter: ReportFilter }[]) => Promise<void>;
}

export function ReportsExportModal({
  open,
  onClose,
  data,
  initialKind,
  initialFilter,
  onExport,
}: ReportsExportModalProps) {
  const [selectedReports, setSelectedReports] = useState<Record<ReportKind, boolean>>({
    sales: initialKind === "sales",
    purchases: initialKind === "purchases",
    movements: initialKind === "movements",
    payments: initialKind === "payments",
  });

  const [filters, setFilters] = useState<Record<ReportKind, ReportFilter>>({
    sales: initialKind === "sales" ? { ...initialFilter } : { from: initialFilter.from, to: initialFilter.to },
    purchases: initialKind === "purchases" ? { ...initialFilter } : { from: initialFilter.from, to: initialFilter.to },
    movements: initialKind === "movements" ? { ...initialFilter } : { from: initialFilter.from, to: initialFilter.to },
    payments: initialKind === "payments" ? { ...initialFilter } : { from: initialFilter.from, to: initialFilter.to },
  });

  const [isExporting, setIsExporting] = useState(false);

  const canExport = Object.values(selectedReports).some(Boolean);

  const handleExport = async () => {
    if (!canExport) return;
    setIsExporting(true);
    try {
      const configs = (["sales", "purchases", "movements", "payments"] as ReportKind[])
        .filter((k) => selectedReports[k])
        .map((k) => ({ kind: k, filter: filters[k] }));
      await onExport(configs);
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  const updateFilter = (kind: ReportKind, patch: Partial<ReportFilter>) => {
    setFilters((prev) => ({
      ...prev,
      [kind]: { ...prev[kind], ...patch },
    }));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exportar Reportes"
      subtitle="Configurá los reportes a exportar en Excel"
      size="lg"
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isExporting}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleExport} disabled={!canExport || isExporting}>
            {isExporting ? "Generando..." : "Generar Excel"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 text-sm font-bold text-[var(--color-text)]">Reportes a incluir</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <LocalCheckbox
              id="export-sales"
              label="Ventas"
              checked={selectedReports.sales}
              onChange={(c) => setSelectedReports((s) => ({ ...s, sales: c }))}
            />
            <LocalCheckbox
              id="export-purchases"
              label="Compras"
              checked={selectedReports.purchases}
              onChange={(c) => setSelectedReports((s) => ({ ...s, purchases: c }))}
            />
            <LocalCheckbox
              id="export-movements"
              label="Movimientos"
              checked={selectedReports.movements}
              onChange={(c) => setSelectedReports((s) => ({ ...s, movements: c }))}
            />
            <LocalCheckbox
              id="export-payments"
              label="Pagos"
              checked={selectedReports.payments}
              onChange={(c) => setSelectedReports((s) => ({ ...s, payments: c }))}
            />
          </div>
        </section>

        {selectedReports.sales && (
          <FilterSection kind="sales" title="Filtros de Ventas" data={data} filter={filters.sales} onChange={(p) => updateFilter("sales", p)} />
        )}
        {selectedReports.purchases && (
          <FilterSection kind="purchases" title="Filtros de Compras" data={data} filter={filters.purchases} onChange={(p) => updateFilter("purchases", p)} />
        )}
        {selectedReports.movements && (
          <FilterSection kind="movements" title="Filtros de Movimientos" data={data} filter={filters.movements} onChange={(p) => updateFilter("movements", p)} />
        )}
        {selectedReports.payments && (
          <FilterSection kind="payments" title="Filtros de Pagos" data={data} filter={filters.payments} onChange={(p) => updateFilter("payments", p)} />
        )}
      </div>
    </Modal>
  );
}

function FilterSection({
  kind,
  title,
  data,
  filter,
  onChange,
}: {
  kind: ReportKind;
  title: string;
  data: ReportsDataDto;
  filter: ReportFilter;
  onChange: (patch: Partial<ReportFilter>) => void;
}) {
  const options = useMemo(() => getOptions(data, kind), [data, kind]);

  return (
    <section className="rounded-lg border border-[var(--color-border)] p-4 shadow-sm bg-[var(--color-surface)]">
      <h4 className="mb-4 text-sm font-semibold text-[var(--color-text)]">{title}</h4>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1.5" htmlFor={`filter-from-${kind}`}>
          <span className="block text-sm font-semibold text-[var(--color-text)]">Desde</span>
          <Input
            id={`filter-from-${kind}`}
            type="date"
            max={filter.to}
            value={filter.from ?? ""}
            onChange={(e) => onChange({ from: e.target.value })}
          />
        </label>
        <label className="space-y-1.5" htmlFor={`filter-to-${kind}`}>
          <span className="block text-sm font-semibold text-[var(--color-text)]">Hasta</span>
          <Input
            id={`filter-to-${kind}`}
            type="date"
            min={filter.from}
            value={filter.to ?? ""}
            onChange={(e) => onChange({ to: e.target.value })}
          />
        </label>

        {kind === "sales" || kind === "purchases" || kind === "payments" ? (
          <OptionFilter id={`filter-status-${kind}`} label="Estado" options={options.statuses} value={filter.status ?? ""} onChange={(status) => onChange({ status })} />
        ) : null}

        {kind === "sales" || kind === "purchases" || kind === "movements" ? (
          <OptionFilter id={`filter-branch-${kind}`} label="Sucursal" options={options.branches} value={filter.branchId ?? ""} onChange={(branchId) => onChange({ branchId })} />
        ) : null}

        {kind === "purchases" ? (
          <OptionFilter id={`filter-supplier-${kind}`} label="Proveedor" options={options.suppliers} value={filter.supplierId ?? ""} onChange={(supplierId) => onChange({ supplierId })} />
        ) : null}

        {kind === "movements" ? (
          <>
            <OptionFilter id={`filter-type-${kind}`} label="Tipo" options={options.movementTypes} value={filter.movementType ?? ""} onChange={(movementType) => onChange({ movementType })} />
            <OptionFilter id={`filter-product-${kind}`} label="Producto" options={options.products} value={filter.productId ?? ""} onChange={(productId) => onChange({ productId })} />
          </>
        ) : null}

        {kind === "payments" ? (
          <OptionFilter id={`filter-method-${kind}`} label="Método" options={options.methods} value={filter.method ?? ""} onChange={(method) => onChange({ method })} />
        ) : null}
      </div>
    </section>
  );
}

function OptionFilter({ id, label, options, value, onChange }: { id: string; label: string; options: { label: string; value: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1.5" htmlFor={id}>
      <span className="block text-sm font-semibold text-[var(--color-text)]">{label}</span>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    </label>
  );
}
