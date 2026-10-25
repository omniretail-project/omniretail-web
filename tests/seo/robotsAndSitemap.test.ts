import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { NOINDEX_SOURCES } from "@/config/seoHeaders";
import { stubClientInstall, stubCommercialSite, stubNoSiteUrl, stubPublicDemo, stubSiteEnv } from "./seoEnv";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("robots.txt", () => {
  it("en el sitio comercial permite el rastreo, excluye solo /api/ y declara el sitemap", () => {
    stubCommercialSite();

    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: "/api/" },
      sitemap: "https://marjym.com/sitemap.xml",
    });
  });

  it("no bloquea ninguna ruta que se sirva con noindex (el buscador debe poder leer la cabecera)", () => {
    stubCommercialSite();
    const rules = robots().rules;
    const disallowed = [rules].flat().flatMap((rule) => [rule.disallow ?? []].flat());

    expect(disallowed).toEqual(["/api/"]);
    for (const source of NOINDEX_SOURCES) {
      expect(disallowed.some((blocked) => source.startsWith(blocked))).toBe(false);
    }
  });

  it("no bloquea las paginas comerciales", () => {
    stubCommercialSite();
    const rules = [robots().rules].flat();

    expect(rules.every((rule) => !rule.disallow || !["/", "/solicitar-informacion"].includes(String(rule.disallow)))).toBe(true);
    expect(rules[0].allow).toBe("/");
  });

  it("en la instalacion de un cliente no impone restricciones ni declara sitemap", () => {
    stubClientInstall();

    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
  });

  it("en la demo publica no bloquea el sitio (su noindex debe poder leerse) ni declara sitemap", () => {
    stubPublicDemo("https://marjym.com");

    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
  });

  it("un dominio distinto del oficial no hereda el sitemap de marjym.com", () => {
    stubSiteEnv({ site: "https://cliente.example" });

    expect(robots().sitemap).toBeUndefined();
  });

  it("sin la variable comercial, o con una URL invalida, no declara sitemap", () => {
    stubNoSiteUrl();
    expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });

    for (const site of ["marjym.com", "https://marjym.com/landing", "https://www.marjym.com"]) {
      stubSiteEnv({ site });
      expect(robots()).toEqual({ rules: { userAgent: "*", allow: "/" } });
    }
  });
});

describe("sitemap.xml", () => {
  it("en el sitio comercial lista unicamente la landing y solicitar-informacion", () => {
    stubCommercialSite();

    expect(sitemap()).toEqual([
      { url: "https://marjym.com/" },
      { url: "https://marjym.com/solicitar-informacion" },
    ]);
  });

  it("no inventa fechas, frecuencias ni prioridades", () => {
    stubCommercialSite();

    for (const entry of sitemap()) {
      expect(Object.keys(entry)).toEqual(["url"]);
    }
  });

  it("no incluye rutas privadas, de acceso, de tienda, de API ni con tokens", () => {
    stubCommercialSite();
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);

    for (const source of NOINDEX_SOURCES) {
      const prefix = source.replace("/:path*", "");
      expect(paths.some((path) => path === prefix || path.startsWith(`${prefix}/`))).toBe(false);
    }
    expect(paths.some((path) => path.startsWith("/api"))).toBe(false);
    expect(paths.some((path) => path.startsWith("/tienda"))).toBe(false);
  });

  it("en la instalacion de un cliente queda vacio: nunca expone URLs de marjym.com", () => {
    stubClientInstall();

    expect(sitemap()).toEqual([]);
  });

  it("en la demo publica queda vacio", () => {
    stubPublicDemo("https://marjym.com");

    expect(sitemap()).toEqual([]);
  });

  it("sin la variable comercial, o con una URL invalida, queda vacio", () => {
    stubNoSiteUrl();
    expect(sitemap()).toEqual([]);

    for (const site of ["marjym.com", "https://marjym.com/landing", "https://www.marjym.com"]) {
      stubSiteEnv({ site });
      expect(sitemap()).toEqual([]);
    }
  });
});
