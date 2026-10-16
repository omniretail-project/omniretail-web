import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "jwt" }), set: vi.fn(), delete: vi.fn() }),
}));

import { GET } from "@/app/api/backend/[...path]/route";

/**
 * El puente `/api/backend/*` nunca debe alcanzar `/auth/**` (`/auth/login` devuelve el JWT en el
 * cuerpo). Next entrega los segmentos ya decodificados; se prueban tambien variantes que el
 * backend podria normalizar a `auth` (matrix params, codificaciones sobrevivientes, espacios).
 */

const BACKEND = "http://backend.internal/api/v1";
const backendFetch = vi.fn();

function callBridge(path: string[]) {
  const request = new NextRequest(`http://localhost/api/backend/${path.map(encodeURIComponent).join("/")}`);
  return GET(request, { params: Promise.resolve({ path }) });
}

beforeEach(() => {
  backendFetch.mockReset();
  backendFetch.mockResolvedValue(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubEnv("OMNIRETAIL_API_URL", BACKEND);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
  vi.stubGlobal("fetch", backendFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("puente /api/backend: variantes de /auth", () => {
  it.each([
    [["auth", "login"]],
    [["AUTH", "login"]],
    [["Auth", "me"]],
    [["auth;x", "login"]],
    [["auth;jsessionid=1", "login"]],
    [["AUTH;x"]],
    [["auth%3Bx", "login"]],
    [["%61uth", "login"]],
    [["auth%2Flogin"]],
    [["auth ", "login"]],
    [[" auth", "login"]],
    [["auth\t", "login"]],
    [["", "auth", "login"]],
    [["..", "auth", "login"]],
    [["auth/login"]],
  ])("%j -> 404 sin llamar al backend", async (path) => {
    const response = await callBridge(path);
    expect(response.status).toBe(404);
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("una ruta normal se reenvia codificada", async () => {
    const response = await callBridge(["catalog", "products"]);
    expect(response.status).toBe(200);
    expect(backendFetch).toHaveBeenCalledWith(`${BACKEND}/catalog/products`, expect.anything());
  });

  it("los demas segmentos pueden llevar %, espacios o ; (ids y codigos de otros modulos)", async () => {
    const response = await callBridge(["catalog", "products", "SKU 10%;A"]);
    expect(response.status).toBe(200);
    expect(backendFetch).toHaveBeenCalledWith(`${BACKEND}/catalog/products/SKU%2010%25%3BA`, expect.anything());
  });

  it("un primer segmento que solo empieza con auth no se bloquea", async () => {
    const response = await callBridge(["authorizations"]);
    expect(response.status).toBe(200);
  });

  it("auth en un segmento posterior no se bloquea", async () => {
    const response = await callBridge(["me", "auth"]);
    expect(response.status).toBe(200);
  });
});
