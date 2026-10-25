import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isPublicDemo } from "@/config/demo-mode";
import { getCommercialSiteUrl } from "@/config/site";
import LandingHero from "@/modules/marketing/components/LandingHero";
import LandingFeatures from "@/modules/marketing/components/LandingFeatures";
import LandingPricing from "@/modules/marketing/components/LandingPricing";
import LandingFaq from "@/modules/marketing/components/LandingFaq";
import { JsonLd } from "@/modules/marketing/seo/JsonLd";
import {
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  buildMarketingMetadata,
} from "@/modules/marketing/seo/marketingMetadata";
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from "@/modules/marketing/seo/structuredData";

// El titulo ya contiene la marca: `absolute` evita que la plantilla del layout la duplique.
export const metadata: Metadata = buildMarketingMetadata({
  title: { absolute: LANDING_TITLE },
  socialTitle: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
  path: "/",
});

export default function MarketingPage() {
  // La demo publica entra directo al login: la landing vive en su propio sitio.
  if (isPublicDemo()) redirect("/iniciar-sesion");

  // Datos estructurados solo en el sitio comercial oficial (marjym.com).
  const commercialSite = getCommercialSiteUrl();

  return (
    <div className="min-h-screen bg-[var(--mkt-bg)]">
      {commercialSite ? (
        <>
          <JsonLd data={buildOrganizationJsonLd(commercialSite)} />
          <JsonLd data={buildWebSiteJsonLd(commercialSite)} />
        </>
      ) : null}
      <LandingHero />
      <LandingFeatures />
      <LandingPricing />
      <LandingFaq />
    </div>
  );
}
