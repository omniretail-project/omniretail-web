import type { Metadata } from "next";
import { getCommercialSiteUrl } from "@/config/site";

export const LANDING_TITLE = "MARJYM | Software de inventario, compras y punto de venta";
export const LANDING_DESCRIPTION =
  "MARJYM es un software en la nube para gestionar inventario, compras, recepciones, punto de venta y sucursales de ferreterías, farmacias y comercios en Guatemala.";
export const INFORMATION_REQUEST_TITLE = "Solicitar información";
export const INFORMATION_REQUEST_DESCRIPTION =
  "Cuéntanos sobre tu negocio y nuestro equipo te contactará con una propuesta personalizada de MARJYM.";

/** Imagen social (Route Handler `(marketing)/og`), 1200x630. */
export const OG_IMAGE_PATH = "/og";
const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
const SITE_NAME = "MARJYM";

interface MarketingMetadataInput {
  /** Titulo del documento. Con `{ absolute }` ignora la plantilla `%s | MARJYM` del layout. */
  title: Metadata["title"];
  /** Titulo completo para redes sociales (Open Graph / Twitter), sin plantilla. */
  socialTitle: string;
  description: string;
  /** Ruta propia de la pagina; su canonical es SIEMPRE esta URL, nunca la portada. */
  path: string;
}

/**
 * Metadata de una pagina COMERCIAL de MARJYM. Titulo y descripcion se aplican siempre; canonical,
 * Open Graph y Twitter solo en el build del sitio comercial oficial (marjym.com): una instalacion de
 * cliente o la demo nunca apuntan a marjym.com. Cada pagina declara su propio canonical y su propio
 * Open Graph porque Next fusiona la metadata de forma superficial: lo definido en un layout se
 * heredaria tal cual en las paginas hijas.
 */
export function buildMarketingMetadata({
  title,
  socialTitle,
  description,
  path,
}: MarketingMetadataInput): Metadata {
  const site = getCommercialSiteUrl();
  const base: Metadata = { title, description };
  if (!site) return base;

  const url = new URL(path, site).toString();
  const image = new URL(OG_IMAGE_PATH, site).toString();

  return {
    ...base,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "es_GT",
      url,
      title: socialTitle,
      description,
      images: [{ url: image, ...OG_IMAGE_SIZE, alt: "MARJYM: software de inventario, compras y punto de venta" }],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [image],
    },
  };
}
