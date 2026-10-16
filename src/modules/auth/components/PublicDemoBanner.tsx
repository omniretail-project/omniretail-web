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
  const [resetError, setResetError] = useState(false);

  if (!isPublicDemo()) return null;

  return (
    <>
      <DemoBanner
        contactUrl={getSalesContactUrl() || undefined}
        contractUrl={getDemoContractUrl() || undefined}
        onReset={() => setConfirming(true)}
      />
      {resetError ? (
        <p className="bg-[var(--color-danger)]/10 px-4 py-2 text-center text-sm text-[var(--color-danger)]" role="alert">
          No se pudo reiniciar la demo: cierra las otras pestañas de la demo y vuelve a intentarlo.
        </p>
      ) : null}
      <ConfirmDialog
        cancelLabel="Cancelar"
        confirmLabel="Reiniciar demo"
        message="Se restauran los datos de ejemplo y se cierra la sesión. Los cambios que hayas hecho se perderán."
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          setResetError(false);
          resetDemo().catch(() => setResetError(true));
        }}
        open={confirming}
        title="Reiniciar demo"
      />
    </>
  );
}
