import { DeliveryMethod } from "@/core/enums";
import type { PackingQueueItemDto } from "@/modules/logistics/application/dto/PackingReadModelDto";
import { FormField } from "@/shared/components/FormField";
import { SearchInput } from "@/shared/components/SearchInput";
import { Select } from "@/shared/components/Select";

interface PackingOrderSelectorProps {
  disabled: boolean;
  items: PackingQueueItemDto[];
  search: string;
  selectedPackingId: string | null;
  onClear: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (packingId: string) => void;
}

const deliveryLabels: Record<DeliveryMethod | "transfer", string> = {
  transfer: "Traslado entre sucursales",
  [DeliveryMethod.immediate]: "Entrega inmediata",
  [DeliveryMethod.store_pickup]: "Retiro en tienda/bodega",
  [DeliveryMethod.home_delivery]: "Envío a domicilio",
};

export function PackingOrderSelector({
  disabled,
  items,
  search,
  selectedPackingId,
  onClear,
  onSearchChange,
  onSelect,
}: PackingOrderSelectorProps) {
  const selectedIsVisible = Boolean(
    selectedPackingId && items.some((item) => item.packingId === selectedPackingId),
  );
  const hasSearch = search.trim().length > 0;
  const noMatches = hasSearch && items.length === 0;
  const singleMatchSuggestion = selectedPackingId || items.length !== 1 ? null : items[0];

  return (
    <div className="space-y-2">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <FormField id="packing-search" label="Buscar pedido preparado">
          <SearchInput
            disabled={disabled}
            id="packing-search"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por pedido o cliente"
            value={search}
          />
        </FormField>
        <FormField id="packing-order" label="Pedido preparado">
          <Select
            disabled={disabled || (items.length === 0 && !selectedPackingId)}
            id="packing-order"
            onChange={(event) => {
              const packingId = event.target.value;
              if (!packingId) {
                onClear();
                onSearchChange("");
                return;
              }
              onSelect(packingId);
            }}
            value={selectedPackingId ?? ""}
          >
            {!selectedIsVisible && selectedPackingId ? (
              <option value={selectedPackingId}>Pedido seleccionado · fuera del filtro actual</option>
            ) : null}
            <option disabled={!selectedPackingId} hidden={Boolean(singleMatchSuggestion)} value="">
              {noMatches
                ? "No hay coincidencias"
                : singleMatchSuggestion
                  ? `${singleMatchSuggestion.orderReference} · ${singleMatchSuggestion.customerName} · ${deliveryLabels[singleMatchSuggestion.deliveryMethod]}`
                  : items.length
                    ? "Selecciona un pedido"
                    : "No hay pedidos para preparar"}
            </option>
            {items.map((item) => (
              <option key={item.packingId} value={item.packingId}>
                {item.orderReference} · {item.customerName} · {deliveryLabels[item.deliveryMethod]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <p aria-live="polite" className="inline-flex rounded-full bg-[var(--color-app-background)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)]">
        {noMatches
          ? "No hay coincidencias. Limpia la búsqueda para restaurar la cola completa."
          : hasSearch
            ? `${items.length} coincidencia${items.length === 1 ? "" : "s"}.`
            : `${items.length} pedido${items.length === 1 ? "" : "s"} disponible${items.length === 1 ? "" : "s"}.`}
      </p>
    </div>
  );
}
