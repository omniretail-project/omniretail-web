import { beforeEach, describe, expect, it } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  type PendingSaleConfirmation,
  PendingSaleConfirmationStore,
  canDiscardAfterRejection,
  isDefinitiveSaleRejection,
  isUncertainSaleFailure,
  pendingSaleScopeKey,
} from "@/modules/pos/application/services/pendingSaleConfirmation";

const record = (contextKey = "u:t:b:s"): PendingSaleConfirmation => ({
  version: 1,
  contextKey,
  confirmationId: "conf-1",
  input: { branchId: "b", cashShiftId: "s", ticket: {} as never, checkout: {} as never },
  createdAt: "2026-10-10T12:00:00.000Z",
  attempts: 1,
});

describe("clasificación de fallos de confirmación", () => {
  it("la red caída, el timeout y los 5xx son inciertos", () => {
    for (const status of [0, 408, 429, 500, 502, 503, 504]) {
      expect(isUncertainSaleFailure(new BackendRequestError("x", status))).toBe(true);
      expect(isDefinitiveSaleRejection(new BackendRequestError("x", status))).toBe(false);
    }
    expect(isUncertainSaleFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("un 4xx es un rechazo definitivo y un error local no lo es", () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(isDefinitiveSaleRejection(new BackendRequestError("x", status))).toBe(true);
      expect(isUncertainSaleFailure(new BackendRequestError("x", status))).toBe(false);
    }
    expect(isDefinitiveSaleRejection(new Error("local"))).toBe(false);
    expect(isUncertainSaleFailure(new Error("local"))).toBe(false);
  });
});

describe("PendingSaleConfirmationStore", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("guarda, recupera y borra por contexto", () => {
    const store = new PendingSaleConfirmationStore();
    store.save(record());

    expect(store.load("u:t:b:s")?.confirmationId).toBe("conf-1");
    expect(store.load("otro:t:b:s")).toBeNull();
    store.clear("u:t:b:s");
    expect(store.load("u:t:b:s")).toBeNull();
  });

  it("conserva la seleccion fisica y el confirmationId exactos para un reintento", () => {
    const store = new PendingSaleConfirmationStore();
    const pending: PendingSaleConfirmation = {
      ...record(),
      confirmationId: "confirmation-with-tracking",
      input: {
        ...record().input,
        ticket: {
          items: [
            {
              productId: "product-1",
              sku: "TRACE-001",
              name: "Producto trazable",
              quantity: 1.25,
              baseUnitPrice: 10,
              unitPrice: 10,
              discount: 0,
              subtotal: 12.5,
              availableQuantity: 5,
              saleUnitId: "unit-1",
              saleUnitName: "Unidad",
              tracksStock: true,
              requiresUnsupportedTraceability: true,
              trackingSelections: [
                {
                  productId: "product-1",
                  locationId: "location-1",
                  lotId: "lot-1",
                  quantity: 1.25,
                  serialNumbers: ["SER-001"],
                },
              ],
            },
          ],
          subtotal: 12.5,
          discountTotal: 0,
          total: 12.5,
          hasUnsupportedTraceability: true,
        },
      },
    };

    expect(store.save(pending)).toBe(true);
    expect(store.load(pending.contextKey)).toEqual(pending);
  });

  it("ignora datos corruptos, de otra versión o de otro contexto", () => {
    const store = new PendingSaleConfirmationStore();
    window.sessionStorage.setItem("omniretail.pos.pending-sale.u:t:b:s", "{no es json");
    expect(store.load("u:t:b:s")).toBeNull();

    window.sessionStorage.setItem(
      "omniretail.pos.pending-sale.u:t:b:s",
      JSON.stringify({ ...record(), version: 2 }),
    );
    expect(store.load("u:t:b:s")).toBeNull();

    window.sessionStorage.setItem(
      "omniretail.pos.pending-sale.u:t:b:s",
      JSON.stringify(record("intruso")),
    );
    expect(store.load("u:t:b:s")).toBeNull();
  });
});

describe("descartar tras un rechazo", () => {
  it("solo el primer envío puede descartarse por un 4xx", () => {
    const rejection = new BackendRequestError("No autorizado", 401);

    expect(canDiscardAfterRejection(rejection, 1)).toBe(true);
    expect(canDiscardAfterRejection(rejection, 2)).toBe(false);
    expect(canDiscardAfterRejection(new BackendRequestError("x", 503), 1)).toBe(false);
    expect(canDiscardAfterRejection(new Error("local"), 1)).toBe(false);
  });
});

describe("alcance y contador", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("el alcance no depende del turno de caja", () => {
    expect(pendingSaleScopeKey("u", "t", "b")).toBe("u:t:b");
  });

  it("save informa si no pudo guardar y load normaliza registros sin contador", () => {
    const store = new PendingSaleConfirmationStore();
    expect(store.save(record())).toBe(true);

    const legacy: Partial<PendingSaleConfirmation> = record();
    delete legacy.attempts;
    window.sessionStorage.setItem("omniretail.pos.pending-sale.u:t:b:s", JSON.stringify(legacy));
    expect(store.load("u:t:b:s")?.attempts).toBe(1);
  });
});
