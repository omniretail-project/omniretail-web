import type { Metadata } from "next";
import { getCommercialSiteUrl } from "@/config/site";
import LandingNavbar from "@/modules/marketing/components/LandingNavbar";
import LandingFooter from "@/modules/marketing/components/LandingFooter";
import { LANDING_DESCRIPTION, LANDING_TITLE } from "@/modules/marketing/seo/marketingMetadata";

const commercialSite = getCommercialSiteUrl();

/**
 * Base comun de las paginas comerciales. La plantilla `%s | MARJYM` aplica solo aqui (no al resto de
 * la aplicacion) y `metadataBase` solo en el sitio comercial oficial. Canonical y Open Graph NO van
 * en este layout: cada pagina declara los suyos para que no se hereden.
 */
export const metadata: Metadata = {
  ...(commercialSite ? { metadataBase: commercialSite } : {}),
  title: { default: LANDING_TITLE, template: "%s | MARJYM" },
  description: LANDING_DESCRIPTION,
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <LandingNavbar />
      <main className="flex-1">
        {children}
      </main>
      <LandingFooter />
    </>
  );
}
