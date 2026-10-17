import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  type ApiSessionEntitlements,
  ApiSessionEntitlementsClient,
  isSessionPlanId,
  toSessionPlan,
  toSessionSubscription,
} from "@/infrastructure/api/ApiSessionEntitlementsClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";

const TENANT = "tenant-1";

const ENTITLEMENTS: ApiSessionEntitlements = {
  tenantId: TENANT,
  planCode: "basic",
  planStatus: "active",
  subscriptionStatus: "active",
  isEntitlementActive: true,
  capabilities: ["pos", "inventory", "delivery"],
  effectiveCapabilities: ["pos", "inventory", "delivery"],
  limits: { maxBranches: 2 },
};

function createEventBus() {
  const handlers = new Map<string, () => void>();
  const eventBus = {
    subscribe: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
    emit: vi.fn(),
  } as unknown as DataEventBus;
  return { eventBus, handlers };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("ApiSessionEntitlementsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lee /api/auth/session/entitlements (BFF) con la cookie de la sesion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(ENTITLEMENTS));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new ApiSessionEntitlementsClient(createEventBus().eventBus).get();

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session/entitlements", {
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(result).toEqual(ENTITLEMENTS);
  });

  it("404 (sin suscripcion) devuelve null para que el resolver falle cerrado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 404)));

    expect(await new ApiSessionEntitlementsClient(createEventBus().eventBus).get()).toBeNull();
  });

  it("propaga el status de otros errores", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 403)));

    const error = await new ApiSessionEntitlementsClient(createEventBus().eventBus)
      .get()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BackendRequestError);
    expect((error as BackendRequestError).status).toBe(403);
  });

  it("cachea la lectura y la invalida con tenant-subscription.changed y auth.changed", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse(ENTITLEMENTS));
    vi.stubGlobal("fetch", fetchMock);
    const { eventBus, handlers } = createEventBus();
    const client = new ApiSessionEntitlementsClient(eventBus);

    await client.get();
    await client.get();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    handlers.get("tenant-subscription.changed")?.();
    await client.get();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    handlers.get("auth.changed")?.();
    await client.get();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("solo se ejecuta en el navegador: sin window falla sin llamar al backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", undefined);

    await expect(new ApiSessionEntitlementsClient(createEventBus().eventBus).get()).rejects.toThrow(
      "solo se pueden leer desde el navegador",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("derivacion de suscripcion y plan", () => {
  it("la suscripcion no repite complementos: las capacidades ya vienen fusionadas", () => {
    expect(toSessionSubscription(ENTITLEMENTS)).toMatchObject({
      tenantId: TENANT,
      status: "active",
      addonCodes: [],
      planId: `session-plan:${TENANT}`,
    });
  });

  it("el plan lleva codigo, estado, capacidades y limites del endpoint", () => {
    const plan = toSessionPlan({ ...ENTITLEMENTS, planStatus: "archived" });

    expect(plan).toMatchObject({
      id: `session-plan:${TENANT}`,
      code: "basic",
      status: "archived",
      capabilities: ["pos", "inventory", "delivery"],
      limits: { maxBranches: 2 },
    });
    expect(isSessionPlanId(plan.id)).toBe(true);
    expect(isSessionPlanId("00000000-0000-0000-0000-000000000199")).toBe(false);
  });
});
