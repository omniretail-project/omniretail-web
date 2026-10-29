import type { DataEventBus } from "@/infrastructure/events/DataEventBus";

interface LogisticsChangeInput {
  eventBus: DataEventBus;
  tenantId: string | undefined;
  branchId: string;
  /** Instancia del hook que publica: los demas la reciben en `metadata.origin`, ella se ignora a si misma. */
  origin: string;
  orderId?: string;
  /** true: ademas de la entidad de Logistica cambio el estado del pedido (`order.changed`). */
  orderChanged?: boolean;
}

type LogisticsChangeSource =
  | { event: "picking.changed"; pickingOrderId: string }
  | { event: "packing.changed"; packingId: string };

/**
 * Los repositorios API no publican eventos de Logistica: tras una operacion confirmada por el backend se
 * avisa a las demas pantallas (Picking, Packing, Despacho, Historial) por el bus interno. Sin tenant no se
 * publica nada. La operacion ya esta confirmada, asi que un oyente ajeno que falle no la invalida.
 */
export function announceLogisticsChange(
  { eventBus, tenantId, branchId, origin, orderId, orderChanged }: LogisticsChangeInput,
  source: LogisticsChangeSource,
) {
  if (!tenantId) return;
  const metadata = { origin };
  const order = orderId ? { orderId } : {};
  const changed = { tenantId, branchId, ...order, action: "updated" as const, metadata };
  try {
    if (source.event === "picking.changed") {
      eventBus.emit("picking.changed", { ...changed, pickingOrderId: source.pickingOrderId });
    } else {
      eventBus.emit("packing.changed", { ...changed, packingId: source.packingId });
    }
    if (orderChanged) {
      eventBus.emit("order.changed", { tenantId, branchId, ...order, action: "status_changed", metadata });
    }
  } catch {
    // Operacion ya confirmada: ver arriba.
  }
}
