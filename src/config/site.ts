import { COMMERCIAL_SITE_ORIGIN, isCommercialSiteEnv } from "@/config/siteIdentity";

/**
 * URL del sitio comercial oficial de MARJYM, o null si este build NO es ese sitio (instalaciones de
 * clientes, demo publica o build sin `NEXT_PUBLIC_SITE_URL`). Todo el SEO comercial depende de este
 * valor: con null no se emite canonical, Open Graph, datos estructurados ni sitemap.
 *
 * Las variables NEXT_PUBLIC_* se referencian de forma literal para que Next las incruste en el build
 * (el contenedor de produccion no las tiene en tiempo de ejecucion).
 */
export function getCommercialSiteUrl(): URL | null {
  const commercial = isCommercialSiteEnv({
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    publicDemo: process.env.NEXT_PUBLIC_PUBLIC_DEMO,
    apiMode: process.env.NEXT_PUBLIC_API_MODE,
  });
  return commercial ? new URL(COMMERCIAL_SITE_ORIGIN) : null;
}
