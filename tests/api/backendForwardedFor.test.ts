import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incoming = vi.hoisted(() => ({ headers: new Headers() as Headers | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
  headers: async () => {
    if (!incoming.headers) throw new Error("headers() fuera de un request");
    return incoming.headers;
  },
}));

import { callBackend } from "@/app/api/_lib/backend";

const fetchSpy = vi.fn();

beforeEach(() => {
  incoming.headers = new Headers();
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("OMNIRETAIL_API_URL", "http://backend.internal/api");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function forwardedFor(): Promise<string | undefined> {
  const response = await callBackend("/public/tienda/tracking/abc", { method: "GET" });
  expect(response?.status).toBe(200);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const init = fetchSpy.mock.calls[0][1] as RequestInit;
  return (init.headers as Record<string, string>)["X-Forwarded-For"];
}

describe("callBackend reenvia la IP del cliente en X-Forwarded-For", () => {
  it("reenvia solo la primera IP de la lista", async () => {
    incoming.headers = new Headers({ "X-Forwarded-For": " 203.0.113.7 , 10.0.0.2" });
    expect(await forwardedFor()).toBe("203.0.113.7");
  });

  it("reenvia una IPv6 valida", async () => {
    incoming.headers = new Headers({ "X-Forwarded-For": "2001:DB8::1" });
    expect(await forwardedFor()).toBe("2001:DB8::1");
  });

  it("no envia la cabecera si no viene en el request", async () => {
    expect(await forwardedFor()).toBeUndefined();
  });

  it.each(["evil.com", "1.2.3.4<script>", "", " , 1.2.3.4", "1".repeat(46)])(
    "no envia la cabecera con un valor invalido (%s)",
    async (value) => {
      incoming.headers = new Headers({ "X-Forwarded-For": value });
      expect(await forwardedFor()).toBeUndefined();
    },
  );

  it("no envia la cabecera si headers() falla fuera de un request", async () => {
    incoming.headers = null;
    expect(await forwardedFor()).toBeUndefined();
  });

  it("no altera Authorization ni Content-Type", async () => {
    incoming.headers = new Headers({ "X-Forwarded-For": "198.51.100.4" });
    await callBackend("/auth/me", { method: "POST", token: "jwt", body: "{}" });
    const sent = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(sent).toMatchObject({
      "X-Forwarded-For": "198.51.100.4",
      Authorization: "Bearer jwt",
      "Content-Type": "application/json",
    });
  });
});
