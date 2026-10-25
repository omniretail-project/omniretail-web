import { afterEach, describe, expect, it, vi } from "vitest";
import { getCommercialSiteUrl } from "@/config/site";
import { COMMERCIAL_SITE_ORIGIN, isCommercialSiteEnv, type SiteEnv } from "@/config/siteIdentity";
import { stubClientInstall, stubCommercialSite, stubPublicDemo, stubSiteEnv } from "./seoEnv";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCommercialSiteEnv", () => {
  const cases: Array<[string, SiteEnv, boolean]> = [
    ["el origen oficial", { siteUrl: "https://marjym.com" }, true],
    ["el origen oficial con barra final", { siteUrl: "https://marjym.com/" }, true],
    ["el origen oficial con espacios", { siteUrl: "  https://marjym.com  " }, true],
    ["el origen oficial en modo api", { siteUrl: "https://marjym.com", apiMode: "api" }, true],
    ["con la bandera de demo en falso", { siteUrl: "https://marjym.com", publicDemo: "false" }, true],
    ["la bandera de demo ignorada en modo api (igual que isPublicDemo)", { siteUrl: "https://marjym.com", publicDemo: "true", apiMode: "api" }, true],
    ["el subdominio www", { siteUrl: "https://www.marjym.com" }, false],
    ["http en vez de https", { siteUrl: "http://marjym.com" }, false],
    ["una ruta distinta de la raiz", { siteUrl: "https://marjym.com/landing" }, false],
    ["una consulta", { siteUrl: "https://marjym.com?x=1" }, false],
    ["un fragmento", { siteUrl: "https://marjym.com#inicio" }, false],
    ["el dominio de un cliente", { siteUrl: "https://ferreteria-cliente.example" }, false],
    ["una cadena vacia", { siteUrl: "" }, false],
    ["la variable sin definir", {}, false],
    ["un texto que no es una URL", { siteUrl: "marjym" }, false],
    ["la demo (mock + bandera), aunque tenga la URL oficial", { siteUrl: "https://marjym.com", publicDemo: "true", apiMode: "mock" }, false],
    ["la demo sin modo definido", { siteUrl: "https://marjym.com", publicDemo: "true" }, false],
  ];

  it.each(cases)("%s", (_label, env, expected) => {
    expect(isCommercialSiteEnv(env)).toBe(expected);
  });

  it("el origen oficial es exactamente https://marjym.com", () => {
    expect(COMMERCIAL_SITE_ORIGIN).toBe("https://marjym.com");
  });
});

describe("getCommercialSiteUrl", () => {
  it("devuelve la URL oficial solo en el build del sitio comercial", () => {
    stubCommercialSite();
    expect(getCommercialSiteUrl()?.origin).toBe("https://marjym.com");
  });

  it("devuelve null en la instalacion de un cliente (mismo modo api, sin la senal)", () => {
    stubClientInstall();
    expect(getCommercialSiteUrl()).toBeNull();
  });

  it("devuelve null en la demo publica, incluso con la URL oficial", () => {
    stubPublicDemo("https://marjym.com");
    expect(getCommercialSiteUrl()).toBeNull();
  });

  it("no toma el dominio de otra instalacion como sitio comercial", () => {
    stubSiteEnv({ site: "https://cliente.example" });
    expect(getCommercialSiteUrl()).toBeNull();
  });
});
