// Importe relativo (sin alias `@/`): `next.config.ts` carga este archivo antes de que existan los alias.
import { isCommercialSiteEnv, type SiteEnv } from "./siteIdentity";

/**
 * Rutas del dominio comercial que NO deben indexarse: acceso, tokens, backoffice, cuenta de cliente
 * y la tienda de demostracion. La landing (`/`) y `/solicitar-informacion` quedan fuera a proposito, y
 * tambien `/api` (robots.txt lo excluye del rastreo), `/robots.txt`, `/sitemap.xml`, `/og` y los
 * recursos estaticos. Se usa la cabecera `X-Robots-Tag` en lugar de metadata para no tocar el codigo
 * de esas paginas, y esas rutas NO se bloquean en robots.txt para que el buscador pueda leer el
 * `noindex`. Una ruta nueva debe agregarse aqui: `tests/seo/seoHeaders.test.ts` falla si alguna
 * carpeta de `src/app` queda sin clasificar.
 */
export const NOINDEX_SOURCES = [
  "/iniciar-sesion",
  "/registro",
  "/recuperar-contrasena",
  "/restablecer-contrasena/:path*",
  "/verificar-correo/:path*",
  "/activar-cuenta/:path*",
  "/contratar",
  "/inicio/:path*",
  "/perfil/:path*",
  "/administracion/:path*",
  "/compras/:path*",
  "/inventario/:path*",
  "/logistica/:path*",
  "/pos/:path*",
  "/cuenta/:path*",
  "/catalogo/:path*",
  "/carrito",
  "/checkout",
  "/ofertas",
  "/ayuda",
  "/sucursales",
  "/pedido/:path*",
  "/tienda/:path*",
];

/**
 * Reglas `headers()` de Next con `X-Robots-Tag: noindex, nofollow`. Solo existen en el build del sitio
 * comercial oficial (misma regla que el resto del SEO, ver `siteIdentity.ts`): en una instalacion de
 * cliente, en la demo o sin `NEXT_PUBLIC_SITE_URL` devuelve `[]` y no se agrega ninguna cabecera.
 */
export function buildNoIndexHeaders(env: SiteEnv) {
  if (!isCommercialSiteEnv(env)) return [];

  return NOINDEX_SOURCES.map((source) => ({
    source,
    headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
  }));
}
