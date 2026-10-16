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
type ResetStatus = "idle" | "resetting" | "waiting-other-tabs" | "failed";

export function PublicDemoBanner() {
  const resetDemo = useDemoReset();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<ResetStatus>("idle");

  if (!isPublicDemo()) return null;

  const startReset = () => {
    setConfirming(false);
    setStatus("resetting");
    // Exito = redireccion al login; el estado solo vuelve a cambiar si hay error.
    resetDemo({ onWaitingForOtherTabs: () => setStatus("waiting-other-tabs") }).catch(() =>
      setStatus("failed"),
    );
  };

  return (
    <>
      <DemoBanner
        contactUrl={getSalesContactUrl() || undefined}
        contractUrl={getDemoContractUrl() || undefined}
        onReset={() => setConfirming(true)}
        resetting={status === "resetting" || status === "waiting-other-tabs"}
      />
      {status === "waiting-other-tabs" ? (
        <p className="bg-[var(--color-warning)]/10 px-4 py-2 text-center text-sm text-[var(--color-title)]" role="status">
          Esperando a que cierres las otras pestañas de la demo para terminar el reinicio…
        </p>
      ) : null}
      {status === "failed" ? (
        <p className="bg-[var(--color-danger)]/10 px-4 py-2 text-center text-sm text-[var(--color-danger)]" role="alert">
          No se pudo reiniciar la demo. Recarga la página y vuelve a intentarlo.
        </p>
      ) : null}
      <ConfirmDialog
        cancelLabel="Cancelar"
        confirmLabel="Reiniciar demo"
        message="Se restauran los datos de ejemplo y se cierra la sesión. Los cambios que hayas hecho se perderán."
        onCancel={() => setConfirming(false)}
        onConfirm={startReset}
        open={confirming}
        title="Reiniciar demo"
      />
    </>
  );
}
