import { permanentRedirect, redirect } from "next/navigation";
import {
  getDemoInformationRequestUrl,
  INFORMATION_REQUEST_PATH,
  isPublicDemo,
} from "@/config/demo-mode";
import { DemoUnavailableNotice } from "@/shared/components/DemoUnavailableNotice";

/**
 * Ruta heredada: la contratacion automatica ya no existe. Los enlaces antiguos llevan al formulario
 * comercial. La demo publica nunca lo aloja ni envia nada: apunta a la landing real.
 */
export default function LegacyContractRoute() {
  if (isPublicDemo()) {
    const informationUrl = getDemoInformationRequestUrl();
    if (informationUrl) redirect(informationUrl);
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <DemoUnavailableNotice
          className="w-full"
          description="La solicitud de información no está disponible en la demo."
        />
      </main>
    );
  }

  permanentRedirect(INFORMATION_REQUEST_PATH);
}
