"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/shared/components/Button";

const subscribeToOrigin = () => () => {};

interface StorefrontLinkCardProps {
  slug: string;
  /** Si la tienda está desactivada, el enlace existe pero los clientes no podrán comprar. */
  enabled: boolean;
}

/** Enlace público de la tienda en línea del negocio, con acciones de abrir y copiar. */
export function StorefrontLinkCard({ slug, enabled }: StorefrontLinkCardProps) {
  const origin = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => "",
  );
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const path = `/tienda/${encodeURIComponent(slug)}`;
  const url = `${origin}${path}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-[var(--color-title)]">Enlace de tu tienda</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Comparte este enlace con tus clientes para que compren en línea.
          </p>
        </div>
        <span
          className={
            enabled
              ? "inline-flex w-fit rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800"
              : "inline-flex w-fit rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800"
          }
        >
          {enabled ? "Tienda activa" : "Tienda desactivada"}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <a
          className="min-w-0 flex-1 break-all rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2.5 text-sm font-medium text-[var(--color-title)] underline-offset-2 hover:underline"
          href={path}
          rel="noopener noreferrer"
          target="_blank"
        >
          {url || path}
        </a>
        <div className="flex gap-2">
          <Button onClick={() => void handleCopy()} type="button" variant="secondary">
            {copyState === "copied" ? "¡Copiado!" : "Copiar enlace"}
          </Button>
          <Button href={path} rel="noopener noreferrer" target="_blank" variant="primary">
            Abrir tienda
          </Button>
        </div>
      </div>

      <p aria-live="polite" className="mt-2 min-h-4 text-xs text-[var(--color-text-muted)]">
        {copyState === "failed"
          ? "No se pudo copiar automáticamente. Selecciona el enlace y cópialo manualmente."
          : !enabled
            ? "Activa la tienda y guarda los cambios para que los clientes puedan comprar."
            : ""}
      </p>
    </section>
  );
}
