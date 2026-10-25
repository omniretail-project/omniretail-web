/**
 * Identidad del SITIO COMERCIAL OFICIAL de MARJYM (`https://marjym.com`), distinta de las
 * instalaciones de los clientes.
 *
 * MARJYM se despliega como Single-Tenant: cada empresa cliente corre su propia copia del frontend
 * en su propio dominio, con el mismo codigo y el mismo `NEXT_PUBLIC_API_MODE=api`. Por eso el modo
 * API NO identifica al sitio comercial. La unica senal es `NEXT_PUBLIC_SITE_URL`, que solo el build
 * de marjym.com fija a su origen oficial. Sin esa senal (o con cualquier otro valor) la
 * configuracion SEO de MARJYM (canonical, Open Graph, sitemap, datos estructurados, cabeceras
 * `noindex`) no se aplica y el despliegue se comporta como una instalacion normal.
 *
 * Este archivo no importa nada: los valores `NEXT_PUBLIC_*` los entrega quien lo llama, con la
 * referencia literal que Next necesita para incrustarlos en el build. Tambien lo usa `seoHeaders.ts`
 * (importado por `next.config.ts` con ruta relativa), por eso no debe importar nada con alias `@/`.
 */
export const COMMERCIAL_SITE_ORIGIN = "https://marjym.com";

export interface SiteEnv {
  /** `NEXT_PUBLIC_SITE_URL` */
  siteUrl?: string;
  /** `NEXT_PUBLIC_PUBLIC_DEMO` */
  publicDemo?: string;
  /** `NEXT_PUBLIC_API_MODE` */
  apiMode?: string;
}

/** Origen (sin ruta, consulta ni fragmento) de una URL absoluta; null si no es una URL valida. */
function bareOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    const hasExtras = (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash;
    return hasExtras ? null : url.origin;
  } catch {
    return null;
  }
}

/** Misma regla que `isPublicDemo()`: bandera de demo y modo mock (cualquier modo distinto de api). */
function isDemoEnv(env: SiteEnv): boolean {
  return env.publicDemo === "true" && env.apiMode !== "api";
}

/**
 * true solo en el build del sitio comercial oficial: `NEXT_PUBLIC_SITE_URL` es exactamente
 * `https://marjym.com` y el build no es la demo publica (la demo nunca se posiciona).
 */
export function isCommercialSiteEnv(env: SiteEnv): boolean {
  if (isDemoEnv(env)) return false;
  return bareOrigin(env.siteUrl) === COMMERCIAL_SITE_ORIGIN;
}
