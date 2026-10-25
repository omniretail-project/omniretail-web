import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoInformationRequestUrl, isPublicDemo } from "@/config/demo-mode";
import { InformationRequestPage } from "@/modules/information-request/pages/InformationRequestPage";
import {
  INFORMATION_REQUEST_DESCRIPTION,
  INFORMATION_REQUEST_TITLE,
  buildMarketingMetadata,
} from "@/modules/marketing/seo/marketingMetadata";
import { DemoUnavailableNotice } from "@/shared/components/DemoUnavailableNotice";

// La plantilla del layout de marketing agrega " | MARJYM": el titulo no repite la marca.
export const metadata: Metadata = buildMarketingMetadata({
  title: INFORMATION_REQUEST_TITLE,
  socialTitle: `${INFORMATION_REQUEST_TITLE} | MARJYM`,
  description: INFORMATION_REQUEST_DESCRIPTION,
  path: "/solicitar-informacion",
});

export default function InformationRequestRoute() {
  if (isPublicDemo()) {
    // La demo es Mock y aislada: no envia solicitudes. El formulario real vive en la landing.
    const landingUrl = getDemoInformationRequestUrl();
    if (landingUrl) redirect(landingUrl);
    return (
      <div className="mx-auto flex w-full max-w-md items-center px-6 py-10">
        <DemoUnavailableNotice
          className="w-full"
          description="La solicitud de información no está disponible en la demo."
        />
      </div>
    );
  }

  return <InformationRequestPage />;
}
