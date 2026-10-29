import { describe, expect, it, vi } from "vitest";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { announceLogisticsChange } from "@/modules/logistics/hooks/logisticsChangeEvents";

const base = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  branchId: "10000000-0000-4000-8000-000000000002",
  origin: "hook-instance-1",
};
const pickingOrderId = "10000000-0000-4000-8000-000000000003";
const packingId = "10000000-0000-4000-8000-000000000004";
const orderId = "10000000-0000-4000-8000-000000000005";

function recordedBus() {
  const eventBus = new DataEventBus();
  const events: Array<{ event: DataEventName; payload: DataEventPayload }> = [];
  (["picking.changed", "packing.changed", "order.changed"] as const).forEach((event) =>
    eventBus.subscribe(event, (payload) => events.push({ event, payload })),
  );
  return { eventBus, events };
}

describe("announceLogisticsChange", () => {
  it("picking: publica picking.changed con tenant, sucursal, pedido, origen y la accion exactos", () => {
    const { eventBus, events } = recordedBus();

    announceLogisticsChange({ eventBus, ...base, orderId }, { event: "picking.changed", pickingOrderId });

    expect(events).toEqual([{
      event: "picking.changed",
      payload: {
        tenantId: base.tenantId,
        branchId: base.branchId,
        pickingOrderId,
        orderId,
        action: "updated",
        metadata: { origin: base.origin },
      },
    }]);
  });

  it("packing: publica packing.changed con el id de la preparacion", () => {
    const { eventBus, events } = recordedBus();

    announceLogisticsChange({ eventBus, ...base, orderId }, { event: "packing.changed", packingId });

    expect(events).toEqual([{
      event: "packing.changed",
      payload: {
        tenantId: base.tenantId,
        branchId: base.branchId,
        packingId,
        orderId,
        action: "updated",
        metadata: { origin: base.origin },
      },
    }]);
  });

  it("sin orderId no agrega la propiedad", () => {
    const { eventBus, events } = recordedBus();

    announceLogisticsChange({ eventBus, ...base }, { event: "picking.changed", pickingOrderId });

    expect(events[0]?.payload).not.toHaveProperty("orderId");
  });

  it("orderChanged publica ademas order.changed (status_changed) con el mismo origen", () => {
    const { eventBus, events } = recordedBus();

    announceLogisticsChange({ eventBus, ...base, orderId, orderChanged: true }, { event: "packing.changed", packingId });

    expect(events.map((entry) => entry.event)).toEqual(["packing.changed", "order.changed"]);
    expect(events[1]?.payload).toEqual({
      tenantId: base.tenantId,
      branchId: base.branchId,
      orderId,
      action: "status_changed",
      metadata: { origin: base.origin },
    });
  });

  it("sin orderChanged no publica order.changed", () => {
    const { eventBus, events } = recordedBus();

    announceLogisticsChange({ eventBus, ...base, orderId, orderChanged: false }, { event: "picking.changed", pickingOrderId });

    expect(events.map((entry) => entry.event)).toEqual(["picking.changed"]);
  });

  it("sin tenant no publica nada", () => {
    const { eventBus, events } = recordedBus();

    announceLogisticsChange({ eventBus, ...base, tenantId: undefined, orderChanged: true }, { event: "picking.changed", pickingOrderId });

    expect(events).toEqual([]);
  });

  it("un oyente ajeno que falla no invalida la operacion ya confirmada", () => {
    const eventBus = new DataEventBus();
    eventBus.subscribe("picking.changed", () => {
      throw new Error("oyente roto");
    });
    const later = vi.fn();
    eventBus.subscribe("order.changed", later);

    expect(() =>
      announceLogisticsChange({ eventBus, ...base, orderChanged: true }, { event: "picking.changed", pickingOrderId }),
    ).not.toThrow();
    // Igual que antes de la extraccion: el fallo corta la publicacion restante, sin propagarse.
    expect(later).not.toHaveBeenCalled();
  });
});
