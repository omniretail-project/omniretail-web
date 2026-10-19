import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieStore = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => cookieStore,
  headers: async () => new Headers(),
}));

import { isSameOrigin, sameOriginOrForbidden } from "@/app/api/_lib/backend";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as bridgePost } from "@/app/api/backend/[...path]/route";

// Detras de Caddy el contenedor ve la peticion como http://, aunque el navegador use https://.
const INTERNAL_URL = "http://51-222-36-210.sslip.io/api/auth/login";
const PUBLIC_ORIGIN = "https://51-222-36-210.sslip.io";
const INTERNAL_ORIGIN = "http://51-222-36-210.sslip.io";
const BACKEND_URL = "http://backend.internal/api/v1";
const backendFetch = vi.fn();

function post(url: string, origin?: string): Request {
  return new Request(url, { method: "POST", headers: origin ? { Origin: origin } : {} });
}

beforeEach(() => {
  backendFetch.mockReset();
  cookieStore.get.mockReset();
  cookieStore.set.mockReset();
  vi.stubGlobal("fetch", backendFetch);
  vi.stubEnv("OMNIRETAIL_API_URL", BACKEND_URL);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("chequeo de Origin en los Route Handlers que modifican", () => {
  it("sin APP_ORIGIN compara contra el origen de la propia peticion (desarrollo local)", () => {
    expect(
      isSameOrigin(post("http://localhost:3000/api/auth/login", "http://localhost:3000")),
    ).toBe(true);
    expect(isSameOrigin(post("http://localhost:3000/api/auth/login", "http://evil.test"))).toBe(
      false,
    );
  });

  it("con APP_ORIGIN acepta el origen publico aunque el contenedor vea http", () => {
    vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
    expect(isSameOrigin(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBe(true);
    expect(sameOriginOrForbidden(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBeNull();
  });

  it("con APP_ORIGIN normaliza una barra final o una ruta", () => {
    vi.stubEnv("APP_ORIGIN", `${PUBLIC_ORIGIN}/`);
    expect(isSameOrigin(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBe(true);
    vi.stubEnv("APP_ORIGIN", `${PUBLIC_ORIGIN}/tienda?x=1`);
    expect(isSameOrigin(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBe(true);
  });

  it.each([[INTERNAL_ORIGIN], ["https://evil.test"], ["null"], [undefined]])(
    "con APP_ORIGIN rechaza otro origen, Origin: null o la ausencia de Origin (%s)",
    async (origin) => {
      vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
      const response = sameOriginOrForbidden(post(INTERNAL_URL, origin));
      expect(response?.status).toBe(403);
      expect((await response!.json()).code).toBe("FORBIDDEN");
    },
  );

  it("sin APP_ORIGIN tambien rechaza Origin: null", () => {
    expect(isSameOrigin(post("http://localhost:3000/api/auth/login", "null"))).toBe(false);
  });

  it("un APP_ORIGIN mal formado falla cerrado", () => {
    vi.stubEnv("APP_ORIGIN", "no es una url");
    expect(isSameOrigin(post(INTERNAL_URL, PUBLIC_ORIGIN))).toBe(false);
  });

  // `new URL(x).origin` es "null" para estos esquemas: sin la restriccion a http/https, un
  // APP_ORIGIN mal configurado aceptaria `Origin: null` (iframe con sandbox, documento file:).
  it.each([
    ["file:///etc/passwd"],
    ["data:text/html,<h1>x</h1>"],
    ["javascript:alert(1)"],
    ["about:blank"],
    ["blob:https://evil.test/uuid"],
    ["ftp://51-222-36-210.sslip.io"],
    ["ws://51-222-36-210.sslip.io"],
    ["mailto:ops@omniretail.test"],
  ])("un APP_ORIGIN con esquema no http/https falla cerrado (%s)", async (configured) => {
    vi.stubEnv("APP_ORIGIN", configured);
    for (const origin of ["null", PUBLIC_ORIGIN, INTERNAL_ORIGIN, "https://evil.test"]) {
      expect(isSameOrigin(post(INTERNAL_URL, origin))).toBe(false);
      const response = sameOriginOrForbidden(post(INTERNAL_URL, origin));
      expect(response?.status).toBe(403);
      expect((await response!.json()).code).toBe("FORBIDDEN");
    }
  });
});

describe("integracion detras de Caddy (navegador https, contenedor http)", () => {
  const loginBody = JSON.stringify({
    email: "ana@tienda.test",
    password: "x",
    expectedUserType: "employee",
  });

  function loginRequest(origin: string): Request {
    return new Request(INTERNAL_URL, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: loginBody,
    });
  }

  function bridgeRequest(origin: string): NextRequest {
    return new NextRequest(`${INTERNAL_ORIGIN}/api/backend/catalog/products`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Producto" }),
    });
  }

  const bridgeContext = { params: Promise.resolve({ path: ["catalog", "products"] }) };

  it("login: con APP_ORIGIN publico abre la sesion y llama al backend", async () => {
    vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    backendFetch
      .mockResolvedValueOnce(Response.json({ token: "jwt-nuevo", expiresAt }))
      .mockResolvedValueOnce(Response.json({ user: { type: "employee" } }));

    const response = await login(loginRequest(PUBLIC_ORIGIN));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { type: "employee" } });
    expect(backendFetch.mock.calls[0][0]).toBe(`${BACKEND_URL}/auth/login`);
    expect(cookieStore.set).toHaveBeenCalledWith(
      "omniretail_session",
      "jwt-nuevo",
      expect.any(Object),
    );
  });

  it.each([[INTERNAL_ORIGIN], ["https://evil.test"], ["null"]])(
    "login: con APP_ORIGIN publico rechaza Origin %s sin llamar al backend",
    async (origin) => {
      vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
      const response = await login(loginRequest(origin));
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("FORBIDDEN");
      expect(backendFetch).not.toHaveBeenCalled();
      expect(cookieStore.set).not.toHaveBeenCalled();
    },
  );

  it("login: sin APP_ORIGIN el origen https del navegador no coincide con el http interno (fallo original)", async () => {
    const response = await login(loginRequest(PUBLIC_ORIGIN));
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("login: un APP_ORIGIN con esquema no http/https rechaza incluso Origin: null", async () => {
    vi.stubEnv("APP_ORIGIN", "file:///app");
    for (const origin of ["null", PUBLIC_ORIGIN]) {
      const response = await login(loginRequest(origin));
      expect(response.status).toBe(403);
    }
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("puente /api/backend: con APP_ORIGIN publico reenvia el POST al backend", async () => {
    vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
    cookieStore.get.mockReturnValue({ value: "jwt-sesion" });
    backendFetch.mockResolvedValueOnce(Response.json({ id: "p-1" }, { status: 201 }));

    const response = await bridgePost(bridgeRequest(PUBLIC_ORIGIN), bridgeContext);

    expect(response.status).toBe(201);
    expect(backendFetch).toHaveBeenCalledTimes(1);
    expect(backendFetch.mock.calls[0][0]).toBe(`${BACKEND_URL}/catalog/products`);
  });

  it.each([[INTERNAL_ORIGIN], ["https://evil.test"], ["null"]])(
    "puente /api/backend: con APP_ORIGIN publico rechaza Origin %s sin llamar al backend",
    async (origin) => {
      vi.stubEnv("APP_ORIGIN", PUBLIC_ORIGIN);
      cookieStore.get.mockReturnValue({ value: "jwt-sesion" });
      const response = await bridgePost(bridgeRequest(origin), bridgeContext);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("FORBIDDEN");
      expect(backendFetch).not.toHaveBeenCalled();
    },
  );

  it("puente /api/backend: un APP_ORIGIN con esquema no http/https rechaza Origin: null", async () => {
    vi.stubEnv("APP_ORIGIN", "data:text/plain,x");
    const response = await bridgePost(bridgeRequest("null"), bridgeContext);
    expect(response.status).toBe(403);
    expect(backendFetch).not.toHaveBeenCalled();
  });
});
