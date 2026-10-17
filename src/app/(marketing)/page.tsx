import { redirect } from "next/navigation";
import { isPublicDemo } from "@/config/demo-mode";
import LandingHero from "@/modules/marketing/components/LandingHero";
import LandingFeatures from "@/modules/marketing/components/LandingFeatures";
import LandingPricing from "@/modules/marketing/components/LandingPricing";
import LandingFaq from "@/modules/marketing/components/LandingFaq";

export default function MarketingPage() {
  // La demo publica entra directo al login: la landing vive en su propio sitio.
  if (isPublicDemo()) redirect("/iniciar-sesion");

  return (
    <div className="min-h-screen bg-[var(--mkt-bg)]">
      <LandingHero />
      <LandingFeatures />
      <LandingPricing />
      <LandingFaq />
    </div>
  );
}
