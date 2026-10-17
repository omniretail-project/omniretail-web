import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoContractUrl, isPublicDemo } from "@/config/demo-mode";
import { PublicContractPage } from "@/modules/contracting/pages/PublicContractPage";
import { DemoUnavailableNotice } from "@/shared/components/DemoUnavailableNotice";

export const metadata: Metadata = {
  title: "Contrata MARJYM Base",
  description: "Crea tu negocio con MARJYM Base.",
};

export default function ContractRoutePage() {
  if (isPublicDemo()) {
    // La contratacion real vive en la landing, no en la instancia demo.
    const contractUrl = getDemoContractUrl();
    if (contractUrl) redirect(contractUrl);
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6 py-10">
        <DemoUnavailableNotice
          className="w-full"
          description="La contratación no está disponible en la demo."
        />
      </main>
    );
  }

  return <PublicContractPage />;
}
