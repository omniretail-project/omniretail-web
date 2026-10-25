import type { MetadataRoute } from "next";
import { getCommercialSiteUrl } from "@/config/site";

/**
 * robots.txt. Solo el sitio comercial oficial de MARJYM declara sitemap y excluye `/api/` (JSON, sin
 * contenido que indexar). En cualquier otro build -- instalaciones de clientes, demo publica o un
 * build sin `NEXT_PUBLIC_SITE_URL` -- no se impone ninguna restriccion: `Allow: /`, equivalente a no
 * tener el archivo.
 *
 * Las rutas que no deben indexarse (login, tokens, backoffice, tienda de demostracion) NO se
 * bloquean aqui: se sirven con `X-Robots-Tag: noindex` (ver `next.config.ts`) y un `Disallow`
 * impediria que el buscador llegue a leer esa cabecera. Tampoco la demo publica se bloquea: ya lleva
 * `noindex` en su metadata y debe poder leerse. Este archivo no es un mecanismo de seguridad.
 */
export default function robots(): MetadataRoute.Robots {
  const site = getCommercialSiteUrl();
  if (!site) return { rules: { userAgent: "*", allow: "/" } };

  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: new URL("/sitemap.xml", site).toString(),
  };
}
