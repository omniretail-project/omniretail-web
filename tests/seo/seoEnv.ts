import { vi } from "vitest";

export const COMMERCIAL = "https://marjym.com";

/** Fija las tres variables NEXT_PUBLIC_* que deciden si el build es el sitio comercial oficial. */
export function stubSiteEnv({
  site = "",
  demo = "",
  api = "api",
}: { site?: string; demo?: string; api?: string } = {}) {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", demo);
  vi.stubEnv("NEXT_PUBLIC_API_MODE", api);
}

/** Build del sitio comercial oficial: NEXT_PUBLIC_SITE_URL fijada, sin demo, modo api. */
export function stubCommercialSite() {
  stubSiteEnv({ site: COMMERCIAL });
}

/** Build donde NEXT_PUBLIC_SITE_URL no existe en absoluto (el build arg nunca llego), no solo vacia. */
export function stubNoSiteUrl() {
  stubSiteEnv();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", undefined);
}

/** Instalacion de un cliente: mismo modo api, pero sin la senal del sitio comercial. */
export function stubClientInstall() {
  stubSiteEnv({ site: "" });
}

/** Demo publica: mock + bandera de demo (aunque tenga NEXT_PUBLIC_SITE_URL, la demo nunca se posiciona). */
export function stubPublicDemo(site = "") {
  stubSiteEnv({ site, demo: "true", api: "mock" });
}
