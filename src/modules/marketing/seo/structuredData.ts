import { LANDING_DESCRIPTION } from "@/modules/marketing/seo/marketingMetadata";

type JsonLdObject = Record<string, unknown>;

const SITE_NAME = "MARJYM";

/**
 * Datos estructurados de MARJYM como organizacion y sitio web. Solo informacion verdadera y visible
 * en la landing: sin logo (no hay un asset de al menos 112 px), telefono, direccion, redes
 * sociales, opiniones, calificaciones, clientes, precios ni productos de la demo.
 */
export function buildOrganizationJsonLd(site: URL): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": new URL("/#organization", site).toString(),
    name: SITE_NAME,
    url: new URL("/", site).toString(),
    description: LANDING_DESCRIPTION,
  };
}

/** Sin `SearchAction`: el sitio no tiene buscador. */
export function buildWebSiteJsonLd(site: URL): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": new URL("/#website", site).toString(),
    name: SITE_NAME,
    url: new URL("/", site).toString(),
    inLanguage: "es-GT",
    publisher: { "@id": new URL("/#organization", site).toString() },
  };
}

/** JSON seguro para incrustar en un <script>: `<` se escapa para que nada cierre la etiqueta. */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
