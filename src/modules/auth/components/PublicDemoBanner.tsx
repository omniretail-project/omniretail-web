"use client";

import { useState } from "react";
import { getDemoContractUrl, getSalesContactUrl, isPublicDemo } from "@/config/demo-mode";
import { useDemoReset } from "@/infrastructure/providers/useDemoReset";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { DemoBanner } from "@/shared/components/DemoBanner";

/**
 * Conecta el DemoBanner (shared, presentacional) con el reinicio real de la demo. No renderiza
 * nada fuera de la demo publica.
 */
export function PublicDemoBanner() {
  const resetDemo = useDemoReset();
  const [confirming, setConfirming] = useState(false);

  if (!isPublicDemo()) return null;

  return (
    <>
      <DemoBanner
        contactUrl={getSalesContactUrl() || undefined}
        contractUrl={getDemoContractUrl() || undefined}
        onReset={() => setConfirming(true)}
      />
      <ConfirmDialog
        cancelLabel="Cancelar"
        confirmLabel="Reiniciar demo"
        message="Se restauran los datos de ejemplo y se cierra la sesión. Los cambios que hayas hecho se perderán."
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void resetDemo();
        }}
        open={confirming}
        title="Reiniciar demo"
      />
    </>
  );
}
