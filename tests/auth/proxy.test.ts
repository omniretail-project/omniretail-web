// @vitest-environment node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/app/api/_lib/backend";
import { config, proxy } from "@/proxy";

const ORIGIN = "https://app.example";

function request(pathname: string, withCookie: boolean): NextRequest {
  return new NextRequest(`${ORIGIN}${pathname}`, {
    headers: withCookie ? { cookie: `${SESSION_COOKIE}=jwt` } : undefined,
  });
}

/** Lo que haria Next: si el matcher no cubre la ruta, el proxy ni corre y la pagina carga. */
function run(pathname: string, withCookie = false): { redirectedTo: string | null } {
  if (!unstable_doesMiddlewareMatch({ config, url: `${ORIGIN}${pathname}` })) return { redirectedTo: null };
  const location = proxy(request(pathname, withCookie)).headers.get("location");
  return { redirectedTo: location ? new URL(location).pathname + new URL(location).search : null };
}

/** URLs de todas las paginas bajo `dir` (los grupos `(x)` no aparecen en la URL). */
function pageUrls(dir: string, base = ""): string[] {
  const urls: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) {
      if (entry === "page.tsx") urls.push(base || "/");
      continue;
    }
    const segment = entry.startsWith("(") ? "" : `/${entry.replace(/^\[.*\]$/, "valor")}`;
    urls.push(...pageUrls(full, `${base}${segment}`));
  }
  return urls;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "api");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy: guard de sesion en el servidor (modo api)", () => {
  it.each(["/inicio", "/administracion/usuarios", "/catalogo/productos/p-1/editar", "/pos/terminal", "/perfil"])(
    "sin cookie, %s redirige al login de personal",
    (pathname) => {
      expect(run(pathname).redirectedTo).toBe("/iniciar-sesion");
    },
  );

  it("sin cookie, /cuenta/* redirige a /iniciar-sesion", () => {
    expect(run("/cuenta").redirectedTo).toBe("/iniciar-sesion");
    expect(run("/cuenta/pedidos/o-1").redirectedTo).toBe("/iniciar-sesion");
  });

  it("sin cookie, /tienda/<slug>/cuenta/* redirige al login de ESA tienda", () => {
    expect(run("/tienda/ferrepharma-demo/cuenta").redirectedTo).toBe("/tienda/ferrepharma-demo/iniciar-sesion");
    expect(run("/tienda/otra-tienda/cuenta/pedidos/o-1").redirectedTo).toBe("/tienda/otra-tienda/iniciar-sesion");
  });

  it.each(["/inicio", "/catalogo/unidades", "/cuenta/perfil", "/tienda/ferrepharma-demo/cuenta/seguridad"])(
    "con cookie, %s pasa",
    (pathname) => {
      expect(run(pathname, true).redirectedTo).toBeNull();
    },
  );

  it.each([
    "/",
    "/iniciar-sesion",
    "/registro",
    "/recuperar-contrasena",
    "/restablecer-contrasena/token",
    "/verificar-correo/token",
    "/activar-cuenta/token",
    "/contratar",
    "/catalogo",
    "/catalogo/producto-123",
    "/carrito",
    "/checkout",
    "/pedido/seguimiento/token",
    "/tienda/ferrepharma-demo",
    "/tienda/ferrepharma-demo/catalogo",
    "/tienda/ferrepharma-demo/catalogo/producto-123",
    "/tienda/ferrepharma-demo/iniciar-sesion",
    "/tienda/ferrepharma-demo/checkout",
    "/tienda/ferrepharma-demo/pedido/seguimiento/token",
    "/api/auth/me",
    "/api/backend/catalog/products",
    "/_next/static/chunks/app.js",
    "/favicon.ico",
    "/icon",
  ])("la ruta publica %s pasa sin cookie", (pathname) => {
    expect(run(pathname).redirectedTo).toBeNull();
  });

  it("en modo mock no hace nada", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");

    expect(run("/inicio").redirectedTo).toBeNull();
    expect(run("/cuenta").redirectedTo).toBeNull();
    expect(run("/tienda/ferrepharma-demo/cuenta").redirectedTo).toBeNull();
  });

  it("el matcher cubre TODAS las paginas privadas que existen en src/app", () => {
    const app = join(process.cwd(), "src", "app");
    const privateUrls = [
      ...pageUrls(join(app, "(private)")),
      ...pageUrls(join(app, "(public)", "(accessible)", "cuenta"), "/cuenta"),
      ...pageUrls(join(app, "tienda", "[tenantSlug]", "cuenta"), "/tienda/ferrepharma-demo/cuenta"),
    ];

    expect(privateUrls.length).toBeGreaterThan(40);
    const uncovered = privateUrls.filter((url) => run(url).redirectedTo === null);
    expect(uncovered).toEqual([]);
  });
});
