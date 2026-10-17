"use client";

import Link from "next/link";
import { useState } from "react";
import { UserType } from "@/core/enums";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { SUPPORT_FAQ_CHIPS } from "@/modules/support/config/supportFaqChips";
import { useOrderStatusLookup } from "@/modules/support/hooks/useOrderStatusLookup";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { statusesConfig } from "@/config/statuses";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";

type PanelView = "chips" | { faqId: string } | "order-status" | "contact";

/**
 * Asistente de soporte (V-WEB-09): boton flotante + chips de consulta
 * rapida (preguntas fijas, un chip que consulta el estado real de un
 * pedido, y un chip de escalado humano). NO es un chatbot de lenguaje
 * libre -- no hay backend/IA en este proyecto, todo es Mock*Repository
 * del lado del cliente.
 */
export function SupportAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<PanelView>("chips");
  const [trackingToken, setTrackingToken] = useState("");
  const { loading, result, error, lookup } = useOrderStatusLookup();
  const { config } = usePublicTenant();
  const { user } = useCurrentSession();

  function reset() {
    setView("chips");
    setTrackingToken("");
  }

  function toggle() {
    setOpen((current) => {
      if (current) reset();
      return !current;
    });
  }

  const activeFaq =
    typeof view === "object" ? SUPPORT_FAQ_CHIPS.find((chip) => chip.id === view.faqId) : null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <div className="mb-3 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
            <p className="font-semibold text-[var(--color-title)]">Asistente de soporte</p>
            {view !== "chips" ? (
              <button
                className="text-sm font-semibold text-[var(--color-structure)] hover:underline"
                onClick={reset}
                type="button"
              >
                ← Volver
              </button>
            ) : null}
          </div>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {view === "chips" ? (
              <div className="flex flex-wrap gap-2">
                {SUPPORT_FAQ_CHIPS.map((chip) => (
                  <button
                    className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)]"
                    key={chip.id}
                    onClick={() => setView({ faqId: chip.id })}
                    type="button"
                  >
                    {chip.question}
                  </button>
                ))}
                <button
                  className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)]"
                  onClick={() => setView("order-status")}
                  type="button"
                >
                  ¿Cuál es el estado de mi pedido?
                </button>
                <button
                  className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text)] transition hover:border-[var(--color-structure)] hover:bg-[var(--color-app-background)]"
                  onClick={() => setView("contact")}
                  type="button"
                >
                  Hablar con alguien
                </button>
              </div>
            ) : activeFaq ? (
              <div>
                <p className="font-semibold text-[var(--color-title)]">{activeFaq.question}</p>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">{activeFaq.answer}</p>
              </div>
            ) : view === "order-status" ? (
              <div className="space-y-3">
                <p className="text-sm text-[var(--color-text-muted)]">
                  Ingresa tu código de seguimiento para ver el estado.
                </p>
                <Input
                  onChange={(event) => setTrackingToken(event.target.value)}
                  placeholder="Código de seguimiento"
                  value={trackingToken}
                />
                <Button
                  disabled={loading || !trackingToken.trim()}
                  onClick={() => void lookup(trackingToken)}
                  type="button"
                >
                  {loading ? "Buscando..." : "Consultar"}
                </Button>
                {error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}
                {result ? (
                  <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 text-sm">
                    <p>
                      Pedido <strong>{result.orderNumber}</strong>
                    </p>
                    <p>Estado: {statusesConfig[result.status]?.label ?? result.status}</p>
                    <p>Total: Q{result.total.toFixed(2)}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-[var(--color-text-muted)]">
                  Puede escribirnos directamente:
                </p>
                {config?.contactEmail ? <p>{config.contactEmail}</p> : null}
                {config?.contactPhone ? <p>{config.contactPhone}</p> : null}
                {!config?.contactEmail && !config?.contactPhone ? (
                  <p className="text-[var(--color-text-muted)]">
                    Información de contacto no disponible por el momento.
                  </p>
                ) : null}
                {user?.type === UserType.customer ? (
                  <Link
                    className="font-semibold text-[var(--color-structure)] hover:underline"
                    href="/cuenta/soporte"
                  >
                    Ir a Soporte de mi cuenta →
                  </Link>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <button
        aria-expanded={open}
        aria-label="Abrir asistente de soporte"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-structure)] text-white shadow-lg transition hover:opacity-90"
        onClick={toggle}
        type="button"
      >
        {open ? (
          <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
          </svg>
        ) : (
          <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8-1.17 0-2.29-.2-3.32-.56L3 21l1.67-4.16C3.61 15.42 3 13.77 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          </svg>
        )}
      </button>
    </div>
  );
}
