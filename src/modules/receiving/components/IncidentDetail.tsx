"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ReceiptIncidentEvidence } from "@/core/entities";
import type { IncidentListItemViewModel } from "@/modules/receiving/application/dto/IncidentListItemViewModel";

interface IncidentDetailContentProps {
  incident: IncidentListItemViewModel;
  onPreview: (evidence: ReceiptIncidentEvidence) => void;
}

export function IncidentDetailDrawer({
  incident,
  onClose,
  onPreview,
}: IncidentDetailContentProps & { onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (dialogs.item(dialogs.length - 1) !== drawerRef.current) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [incident.id]);

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button
        aria-label="Cerrar detalle de incidencia"
        className="absolute inset-0 bg-[var(--color-topbar)]/25"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={`Detalle de incidencia: ${incident.typeName}`}
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-0.5rem)] flex-col overflow-hidden border-l border-[var(--color-border)] bg-white shadow-xl sm:w-[min(88vw,460px)] lg:w-[min(46vw,480px)] xl:w-[min(38vw,500px)]"
        ref={drawerRef}
        role="dialog"
      >
        <header className="border-b border-[var(--color-border)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700">
                <AlertIcon /> Detalle de incidencia
              </p>
              <h2 className="mt-1 break-words text-lg font-bold text-[var(--color-title)]">
                {incident.typeName}
              </h2>
              <p className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">
                {incident.productName}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-[var(--color-text-muted)]">
                SKU {incident.sku}
              </p>
            </div>
            <button
              aria-label="Cerrar"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              ×
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-5">
          <IncidentDetailContent incident={incident} onPreview={onPreview} />
        </div>
      </aside>
    </div>
  );
}

export function IncidentDetailContent({ incident, onPreview }: IncidentDetailContentProps) {
  return (
    <div className="space-y-4">
      <DetailSection title="General">
        <dl className="grid gap-3 sm:grid-cols-2">
          <DetailItem label="Producto" value={incident.productName} />
          <DetailItem label="SKU" value={incident.sku} />
          <DetailItem label="Tipo" value={incident.typeName} />
          <DetailItem
            label="Cantidad afectada"
            value={
              typeof incident.quantityAffected === "number"
                ? formatNumber(incident.quantityAffected)
                : "No disponible"
            }
          />
          <DetailItem label="Fecha" value={formatDate(incident.date)} />
          <DetailItem
            label="Estado del registro"
            value={incident.confirmed ? "Historica / confirmada" : "En edicion"}
          />
        </dl>
      </DetailSection>

      <DetailSection title="Documento">
        <dl className="grid gap-3 sm:grid-cols-2">
          <DetailItem label="Recepcion" value={incident.receiptNumber} />
          <DetailItem
            label="Orden de compra"
            value={incident.purchaseOrderNumber ?? "No disponible"}
          />
          <DetailItem label="Proveedor" value={incident.supplierName ?? "No disponible"} />
          <DetailItem label="Sucursal" value={incident.branchName ?? "No disponible"} />
          <DetailItem label="Responsable" value={incident.responsibleName ?? "No disponible"} />
        </dl>
      </DetailSection>

      <DetailSection title="Observacion">
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text)]">
          {incident.observation || "Sin observacion."}
        </p>
      </DetailSection>

      {incident.evidence.length > 0 ? (
      <DetailSection title={`Evidencias (${incident.evidence.length})`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {incident.evidence.map((evidence) =>
              evidence.previewUrl ? (
                <button
                  aria-label={`Ver evidencia ${evidence.name}`}
                  className="group aspect-[4/3] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
                  key={evidence.id}
                  onClick={() => onPreview(evidence)}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={evidence.name}
                    className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                    src={evidence.previewUrl}
                  />
                </button>
              ) : (
                <div
                  className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed border-[var(--color-border)] p-2 text-center text-xs font-semibold text-[var(--color-text-muted)]"
                  key={evidence.id}
                  title={evidence.name}
                >
                  {evidence.name}
                </div>
              ),
            )}
          </div>
      </DetailSection>
      ) : null}
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-white p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M12 8v5m0 3h.01M10.3 4.9 3.6 17a2 2 0 0 0 1.75 3h13.3a2 2 0 0 0 1.75-3L13.7 4.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(value);
}
