import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import { toInventoryAdjustmentError } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

async function failure(path = "/inventory/adjustments") {
  try {
    await backendFetch(path, { method: "POST", body: {} });
  } catch (error) {
    return error;
  }
  throw new Error("Se esperaba un error.");
}

afterEach(() => vi.unstubAllGlobals());

describe("operational location errors from the backend", () => {
  it.each([
    "INVENTORY_LOCATION_NOT_ASSIGNED",
    "INVENTORY_LOCATION_REQUIRED",
    "INVENTORY_LOCATION_CHANGE_BLOCKED",
    "INVENTORY_LOCATION_MISMATCH",
    "INVENTORY_ASSIGNED_LOCATION_INACTIVE",
  ])("translates %s keeping status, code and the original backend message", async (code) => {
    respondWith(409, { code, message: "Texto original del backend", fields: { locationId: "x" } });

    const error = await failure();

    expect(error).toBeInstanceOf(BackendRequestError);
    expect(error).toMatchObject({
      status: 409,
      code,
      backendMessage: "Texto original del backend",
      fields: { locationId: "x" },
    });
    expect((error as BackendRequestError).message).not.toBe("Texto original del backend");
    expect((error as BackendRequestError).message).toMatch(/ubicaci/i);
  });

  it("preserves the status of the same code when it is not a conflict", async () => {
    respondWith(400, { code: "INVENTORY_LOCATION_REQUIRED", message: "Falta ubicacion" });

    expect(await failure()).toMatchObject({ status: 400, code: "INVENTORY_LOCATION_REQUIRED" });
  });

  it("does not turn 401, 403 and other 409 codes into generic errors", async () => {
    respondWith(401, { code: "UNAUTHORIZED", message: "Sesión vencida" });
    expect(await failure()).toMatchObject({ status: 401, message: "Sesión vencida", backendMessage: undefined });

    respondWith(403, { code: "ACCESS_DENIED", message: "Sin acceso a la sucursal" });
    expect(await failure()).toMatchObject({ status: 403, message: "Sin acceso a la sucursal" });

    respondWith(409, { code: "INSUFFICIENT_STOCK", message: "Stock insuficiente" });
    expect(await failure()).toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK", message: "Stock insuficiente" });
  });
});

describe("toInventoryAdjustmentError", () => {
  it("keeps the BackendRequestError identity of adjustment specific codes", () => {
    const original = new BackendRequestError("Texto backend", 409, "INVENTORY_LOCATION_CONFLICT", {
      locationId: "x",
    });

    const translated = toInventoryAdjustmentError(original);

    expect(translated).toBeInstanceOf(BackendRequestError);
    expect(translated).toMatchObject({
      status: 409,
      code: "INVENTORY_LOCATION_CONFLICT",
      backendMessage: "Texto backend",
      fields: { locationId: "x" },
    });
    expect(translated.message).toContain("Regulariza");
  });

  it("returns unknown errors untouched", () => {
    const original = new BackendRequestError("Otro", 403, "ACCESS_DENIED");

    expect(toInventoryAdjustmentError(original)).toBe(original);
  });
});
