import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoInformationRequestUrl, isPublicDemo } from "@/config/demo-mode";
import { InformationRequestPage } from "@/modules/information-request/pages/InformationRequestPage";
import { DemoUnavailableNotice } from "@/shared/components/DemoUnavailableNotice";

export const metadata: Metadata = {
  title: "Solicitar información | MARJYM",
  description:
    "Cuéntanos sobre tu negocio y nuestro equipo te contactará con una propuesta personalizada de MARJYM.",
};

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
