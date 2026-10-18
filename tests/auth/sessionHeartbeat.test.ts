import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeSessionExpired } from "@/infrastructure/api/sessionExpiredSignal";
import { pingSession } from "@/infrastructure/api/sessionHeartbeat";

const fetchSpy = vi.fn();
const onExpired = vi.fn();
let unsubscribe: () => void;

beforeEach(() => {
  fetchSpy.mockReset();
  onExpired.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  unsubscribe = subscribeSessionExpired(onExpired);
});

afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
});

describe("pingSession", () => {
  it("llama a /api/auth/me sin cache para que llegue al backend", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));

    await pingSession();

    expect(fetchSpy).toHaveBeenCalledWith("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("un 401 avisa la sesion expirada", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));

    await pingSession();

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("un 503 o un error de red no avisan ni lanzan", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(pingSession()).resolves.toBeUndefined();

    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(pingSession()).resolves.toBeUndefined();

    expect(onExpired).not.toHaveBeenCalled();
  });
});
