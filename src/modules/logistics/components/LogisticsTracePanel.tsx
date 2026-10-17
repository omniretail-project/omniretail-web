import type {
  LogisticsItemTraceDto,
  LogisticsTraceAllocationDto,
} from "@/modules/logistics/application/dto/LogisticsItemTraceDto";
import { InlineAlert } from "@/shared/components/InlineAlert";

interface LogisticsTracePanelProps {
  items: LogisticsItemTraceDto[];
  state: "idle" | "loading" | "data" | "empty" | "unauthorized" | "error";
  error: string | null;
}

export function LogisticsTracePanel({ items, state, error }: LogisticsTracePanelProps) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-bold text-[var(--color-title)]">Trazabilidad de preparación</h3>
        <p className="text-sm text-[var(--color-text-muted)]">Selección de Picking y movimientos físicos al finalizar la entrega. Solo lectura.</p>
      </div>
      {state === "loading" ? <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">Consultando trazabilidad...</p> : null}
      {state === "unauthorized" ? <InlineAlert description="No tiene permisos para consultar la trazabilidad de picking." title="Trazabilidad restringida" tone="warning" /> : null}
      {state === "error" ? <InlineAlert description={error ?? "No se pudo consultar la trazabilidad."} title="Error de trazabilidad" /> : null}
      {state === "empty" ? (
        <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">No hay trazabilidad física para mostrar.</p>
      ) : null}
      {state === "data" ? (
        <div className="space-y-3">
          {items.map((item) => (
            <article className="overflow-hidden rounded-lg border border-[var(--color-border)]" key={item.pickingItemId}>
              <header className="bg-[var(--color-app-background)] px-4 py-3">
                <p className="font-semibold text-[var(--color-title)]">{item.name}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{formatTraceQuantities(item)}</p>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead><tr className="border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]"><th className="px-4 py-2">Cantidad</th><th className="px-4 py-2">Ubicación</th><th className="px-4 py-2">Lote</th><th className="px-4 py-2">Vencimiento</th><th className="px-4 py-2">Serie</th></tr></thead>
                  <tbody>{item.allocations.map((allocation, index) => (
                    <tr className="border-t border-[var(--color-border)]" key={allocation.inventoryMovementId ?? `${item.pickingItemId}-${index}`}>
                      <td className="px-4 py-2">{allocation.quantity}</td>
                      <td className="px-4 py-2">{formatTraceLocation(allocation.location)}</td>
                      <td className="px-4 py-2">{allocation.lot?.number ?? "No aplica"}</td>
                      <td className="px-4 py-2">{allocation.lot?.expiresAt ? new Date(allocation.lot.expiresAt).toLocaleDateString("es-GT") : "No aplica"}</td>
                      <td className="px-4 py-2">{allocation.serial?.number ?? "No aplica"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function formatTraceQuantities(item: LogisticsItemTraceDto) {
  const parts = [item.sku, `${item.pickedQuantity} de ${item.requestedQuantity}`];
  if (item.packedQuantity !== undefined) parts.push(`empacado ${formatStageQuantity(item.packedQuantity)}`);
  if (item.dispatchedQuantity !== undefined) {
    parts.push(`despachado ${formatStageQuantity(item.dispatchedQuantity)}`);
  }
  return parts.filter(Boolean).join(" · ");
}

/** `null` no es cero: la etapa todavía no registró una cantidad. */
function formatStageQuantity(quantity: number | null) {
  return quantity === null ? "sin registro" : String(quantity);
}

/** El historial API identifica la ubicación sin código ni nombre: se indica que fue registrada. */
function formatTraceLocation(location: LogisticsTraceAllocationDto["location"]) {
  if (!location) return "No aplica";
  return [location.code, location.name].filter(Boolean).join(" · ") || "Ubicación registrada";
}
