import type { ReactNode } from "react";
import { DeliveryMethod, OrderStatus, SaleStatus } from "@/core/enums";
import type { PosSaleHistoryFilters } from "@/modules/pos/application/dto/PosSaleHistoryDto";
import {
  orderStatusPresentation,
  saleStatusPresentation,
} from "@/modules/pos/application/services/GetPosSalesHistoryService";
import { Button } from "@/shared/components/Button";
import { SearchInput } from "@/shared/components/SearchInput";
import { Select } from "@/shared/components/Select";

interface PosSalesHistoryFiltersProps {
  disabled?: boolean;
  filters: PosSaleHistoryFilters;
  onChange: (patch: Partial<PosSaleHistoryFilters>) => void;
  onReset: () => void;
}

export function PosSalesHistoryFilters({
  disabled = false,
  filters,
  onChange,
  onReset,
}: PosSalesHistoryFiltersProps) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-sm">
      <div className="grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(15rem,1.35fr)_repeat(3,minmax(0,1fr))]">
        <label className="space-y-1 xl:col-span-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Buscar venta</span>
          <SearchInput
            disabled={disabled}
            placeholder="Factura, ticket, cliente o SKU"
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value })}
          />
        </label>
        <FilterField label="Tipo de entrega">
          <Select
            disabled={disabled}
            value={filters.deliveryMethod}
            onChange={(event) =>
              onChange({
                deliveryMethod: event.target.value as PosSaleHistoryFilters["deliveryMethod"],
              })
            }
          >
            <option value="all">Todas</option>
            <option value={DeliveryMethod.immediate}>Entrega inmediata</option>
            <option value={DeliveryMethod.store_pickup}>Retiro en tienda/bodega</option>
            <option value={DeliveryMethod.home_delivery}>Envío a domicilio</option>
          </Select>
        </FilterField>
        <FilterField label="Estado de venta">
          <Select
            disabled={disabled}
            value={filters.saleStatus}
            onChange={(event) =>
              onChange({ saleStatus: event.target.value as PosSaleHistoryFilters["saleStatus"] })
            }
          >
            <option value="all">Todos los estados</option>
            {Object.values(SaleStatus).map((status) => (
              <option key={status} value={status}>
                {saleStatusPresentation[status].label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Estado operativo">
          <Select
            disabled={disabled}
            value={filters.operationalStatus}
            onChange={(event) =>
              onChange({
                operationalStatus: event.target.value as PosSaleHistoryFilters["operationalStatus"],
              })
            }
          >
            <option value="all">Todos los estados</option>
            {Object.values(OrderStatus).map((status) => (
              <option key={status} value={status}>
                {orderStatusPresentation[status].label}
              </option>
            ))}
          </Select>
        </FilterField>
      </div>
      <div className="mt-2 flex justify-end border-t border-[var(--color-border)] pt-2">
        <Button disabled={disabled} type="button" variant="ghost" onClick={onReset}>
          Limpiar filtros
        </Button>
      </div>
    </section>
  );
}

function FilterField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</span>
      {children}
    </label>
  );
}
