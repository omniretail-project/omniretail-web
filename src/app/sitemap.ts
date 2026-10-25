import type { MetadataRoute } from "next";
import { getCommercialSiteUrl } from "@/config/site";

/** Paginas comerciales que se quieren posicionar. Agregar una ruta aqui es una decision explicita. */
const SITEMAP_PATHS = ["/", "/solicitar-informacion"] as const;

/**
 * sitemap.xml. Solo el sitio comercial oficial publica URLs, y solo las de SITEMAP_PATHS: sin rutas
 * privadas, login, tienda, tenants ni URLs con tokens. Sin `lastModified`, `changeFrequency` ni
 * `priority`: no hay una fecha real por pagina y esos valores no se inventan. En cualquier otro build
 * (clientes, demo, sin NEXT_PUBLIC_SITE_URL) el sitemap queda vacio y nunca expone URLs de marjym.com.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = getCommercialSiteUrl();
  if (!site) return [];

  return SITEMAP_PATHS.map((path) => ({ url: new URL(path, site).toString() }));
}
