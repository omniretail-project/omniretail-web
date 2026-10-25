import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOINDEX_SOURCES, buildNoIndexHeaders } from "@/config/seoHeaders";
import type { SiteEnv } from "@/config/siteIdentity";
import nextConfig from "../../next.config";
import { stubClientInstall, stubCommercialSite, stubNoSiteUrl, stubPublicDemo, stubSiteEnv } from "./seoEnv";

afterEach(() => {
  vi.unstubAllEnvs();
});

const root = process.cwd();

describe("cabeceras noindex del sitio comercial", () => {
  it("cada ruta no comercial recibe X-Robots-Tag: noindex, nofollow", () => {
    const rules = buildNoIndexHeaders({ siteUrl: "https://marjym.com", apiMode: "api" });

    expect(rules.map((rule) => rule.source)).toEqual(NOINDEX_SOURCES);
    for (const rule of rules) {
      expect(rule.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
    }
  });

  it("nunca alcanza la landing, solicitar-informacion, /api ni los recursos estaticos", () => {
    for (const source of NOINDEX_SOURCES) {
      expect(source).not.toBe("/");
      expect(source.startsWith("/solicitar-informacion")).toBe(false);
      expect(source.startsWith("/api")).toBe(false);
      expect(source.startsWith("/_next")).toBe(false);
      expect(source).not.toMatch(/robots|sitemap|og$|icon|favicon/);
    }
  });

  it("no declara dos veces la misma ruta", () => {
    expect(new Set(NOINDEX_SOURCES).size).toBe(NOINDEX_SOURCES.length);
  });

  const noHeaders: Array<[string, SiteEnv]> = [
    ["la instalacion de un cliente", { siteUrl: "", apiMode: "api" }],
    ["un build sin NEXT_PUBLIC_SITE_URL", { apiMode: "api" }],
    ["otro dominio", { siteUrl: "https://cliente.example", apiMode: "api" }],
    ["una URL comercial invalida (texto)", { siteUrl: "marjym", apiMode: "api" }],
    ["una URL comercial con ruta", { siteUrl: "https://marjym.com/landing", apiMode: "api" }],
    ["el subdominio www", { siteUrl: "https://www.marjym.com", apiMode: "api" }],
    ["la demo publica", { siteUrl: "https://marjym.com", publicDemo: "true", apiMode: "mock" }],
  ];

  it.each(noHeaders)("no agrega ninguna cabecera en %s", (_label, env) => {
    expect(buildNoIndexHeaders(env)).toEqual([]);
  });

  it("las reglas cubren las rutas privadas y de acceso, y no la landing ni los archivos SEO", () => {
    const matches = (path: string) =>
      NOINDEX_SOURCES.some((source) => {
        const base = source.replace("/:path*", "");
        return path === base || (source.endsWith(":path*") && path.startsWith(`${base}/`));
      });

    for (const path of ["/iniciar-sesion", "/inventario/productos", "/administracion/usuarios", "/tienda/ferrepharma-demo", "/checkout", "/restablecer-contrasena/token"]) {
      expect(matches(path)).toBe(true);
    }
    for (const path of ["/", "/solicitar-informacion", "/robots.txt", "/sitemap.xml", "/og", "/api/health", "/_next/static/app.js", "/favicon.ico"]) {
      expect(matches(path)).toBe(false);
    }
  });
});

describe("headers() de next.config", () => {
  it("lee las variables NEXT_PUBLIC_* del build del sitio comercial", async () => {
    stubCommercialSite();

    const rules = await nextConfig.headers?.();

    expect(rules?.map((rule) => rule.source)).toEqual(NOINDEX_SOURCES);
  });

  it("no devuelve reglas en la instalacion de un cliente ni en la demo", async () => {
    stubClientInstall();
    expect(await nextConfig.headers?.()).toEqual([]);

    stubPublicDemo("https://marjym.com");
    expect(await nextConfig.headers?.()).toEqual([]);
  });

  it("no devuelve reglas si la variable comercial falta o es invalida", async () => {
    stubNoSiteUrl();
    expect(await nextConfig.headers?.()).toEqual([]);

    stubSiteEnv({ site: "marjym.com" });
    expect(await nextConfig.headers?.()).toEqual([]);
  });

  it("conserva las opciones existentes del proyecto", () => {
    expect(nextConfig).toMatchObject({ output: "standalone", poweredByHeader: false, productionBrowserSourceMaps: false });
  });
});

describe("todas las rutas de src/app estan clasificadas", () => {
  const INDEXABLE = new Set(["solicitar-informacion"]);
  /** `api` se excluye del rastreo en robots.txt; `og` es la imagen social del sitio comercial. */
  const NOT_PAGES = new Set(["api", "og"]);

  function firstSegments(dir: string, segments: string[] = []): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        found.push(...firstSegments(join(dir, entry.name), isGroup ? segments : [...segments, entry.name]));
      } else if (/^(page|route)\.tsx?$/.test(entry.name) && segments.length > 0) {
        found.push(segments[0]);
      }
    }
    return found;
  }

  const segments = [...new Set(firstSegments(join(root, "src", "app")))].sort();

  it("encuentra las rutas de primer nivel esperadas", () => {
    expect(segments).toEqual(expect.arrayContaining(["solicitar-informacion", "iniciar-sesion", "tienda", "catalogo"]));
  });

  it.each(segments)("/%s esta clasificada como indexable, no-pagina o noindex", (segment) => {
    const covered = NOINDEX_SOURCES.some((source) => source === `/${segment}` || source.startsWith(`/${segment}/`));

    expect(INDEXABLE.has(segment) || NOT_PAGES.has(segment) || covered).toBe(true);
  });

  it("las rutas indexables no estan tambien marcadas como noindex", () => {
    for (const segment of INDEXABLE) {
      expect(NOINDEX_SOURCES.some((source) => source.startsWith(`/${segment}`))).toBe(false);
    }
  });
});

describe("la variable llega al build de produccion", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  it("el Dockerfile acepta NEXT_PUBLIC_SITE_URL como build arg, vacio por defecto", () => {
    expect(read("Dockerfile")).toMatch(/^ARG NEXT_PUBLIC_SITE_URL=\s*$/m);
  });

  it("el workflow de CD la transmite desde la variable de GitHub", () => {
    expect(read(".github/workflows/cd.yml")).toContain(
      "NEXT_PUBLIC_SITE_URL=${{ vars.NEXT_PUBLIC_SITE_URL }}",
    );
  });

  it("queda documentada en .env.example, vacia", () => {
    expect(read(".env.example")).toMatch(/^NEXT_PUBLIC_SITE_URL=\s*$/m);
  });
});
