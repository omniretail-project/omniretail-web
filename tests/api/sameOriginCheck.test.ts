import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));

import { isSameOrigin, sameOriginOrForbidden } from "@/app/api/_lib/backend";

// Detras de Caddy el contenedor ve la peticion como http://, aunque el navegador use https://.
const INTERNAL_URL = "http://51-222-36-210.sslip.io/api/auth/login";
const PUBLIC_ORIGIN = "https://51-222-36-210.sslip.io";

function post(url: string, origin?: string): Request {
  return new Request(url, { method: "POST", headers: origin ? { Origin: origin } : {} });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chequeo de Origin en los Route Handlers que modifican", () => {
  it("sin APP_ORIGIN compara contra el origen de la propia peticion (desarrollo local)", () => {
    expect(isSameOrigin(post("http://localhost:3000/api/auth/login", "http://localhost:3000"))).toBe(true);
    expect(isSameOrigin(post("http://localhost:3000/api/auth/login", "http://evil.test"))).toBe(false);
  });

  it("con APP_ORIGIN acepta el origen publico aunque el contenedor vea http", () => {
    vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
    expect(isSameOrigin(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBe(true);
    expect(sameOriginOrForbidden(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBeNull();
  });

  it("con APP_ORIGIN normaliza una barra final o una ruta", () => {
    vi.stubEnv("APP_ORIGIN", `${PUBLIC_ORIGIN}/`);
    expect(isSameOrigin(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBe(true);
  });

  it.each([["http://51-222-36-210.sslip.io"], ["https://evil.test"], [undefined]])(
    "con APP_ORIGIN rechaza otro origen o la ausencia de Origin (%s)",
    async (origin) => {
      vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
      const response = sameOriginOrForbidden(post(INTERNAL_URL, origin));
      expect(response?.status).toBe(403);
      expect((await response!.json()).code).toBe("FORBIDDEN");
    },
  );

  it("un APP_ORIGIN mal formado falla cerrado", () => {
    vi.stubEnv("APP_ORIGIN", "no es una url");
    expect(isSameOrigin(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBe(false);
  });
});
