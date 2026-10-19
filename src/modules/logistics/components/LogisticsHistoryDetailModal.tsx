"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DeliveryMethod } from "@/core/enums";
import type { StorePickupHandoverResult } from "@/core/repositories";
import type { LogisticsHistoryDetailDto } from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import { LogisticsTracePanel } from "@/modules/logistics/components/LogisticsTracePanel";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Modal } from "@/shared/components/Modal";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface LogisticsHistoryDetailModalProps {
  open: boolean;
  detail: LogisticsHistoryDetailDto | null;
  loading: boolean;
  error: string | null;
  handoverEligible: boolean;
  handoverSubmitting: boolean;
  handoverMutationInFlight: boolean;
  handoverError: string | null;
  handoverErrorUncertain: boolean;
  onClose: () => void;
  onConfirmStorePickupHandover: (
    orderId: string,
  ) => Promise<StorePickupHandoverResult | null>;
}

type HandoverNotice =
  | { tone: "success"; title: string; description: string }
  | { tone: "warning"; title: string; description: string };

export function LogisticsHistoryDetailModal({
  open,
  detail,
  loading,
  error,
  handoverEligible,
  handoverSubmitting,
  handoverMutationInFlight,
  handoverError,
  handoverErrorUncertain,
  onClose,
  onConfirmStorePickupHandover,
}: LogisticsHistoryDetailModalProps) {
  const summary = detail?.summary;
  const homeDelivery = summary?.deliveryMethod === DeliveryMethod.home_delivery;
  const [handoverConfirmationOpen, setHandoverConfirmationOpen] = useState(false);
  const [handoverNotice, setHandoverNotice] = useState<HandoverNotice | null>(null);
  const handoverInvocationRef = useRef(false);
  const activeOrderIdRef = useRef<string | null>(open ? summary?.orderId ?? null : null);

  useLayoutEffect(() => {
    const orderId = open ? summary?.orderId ?? null : null;
    activeOrderIdRef.current = orderId;
    return () => {
      if (activeOrderIdRef.current === orderId) activeOrderIdRef.current = null;
    };
  }, [open, summary?.orderId]);

  const handoverBusy = handoverSubmitting || handoverMutationInFlight;

  async function confirmHandover() {
    const orderId = summary?.orderId;
    if (!orderId || !handoverEligible || handoverBusy || handoverInvocationRef.current) return;
    handoverInvocationRef.current = true;
    setHandoverNotice(null);
    try {
      const result = await onConfirmStorePickupHandover(orderId);
      if (activeOrderIdRef.current !== orderId || !result) return;
      setHandoverConfirmationOpen(false);
      setHandoverNotice(
        result.idempotent
          ? {
              tone: "warning",
              title: "Entrega ya confirmada",
              description:
                "El Backend informó que la entrega ya estaba registrada. El detalle se vuelve a consultar para mostrar su estado autoritativo.",
            }
          : {
              tone: "success",
              title: "Entrega confirmada",
              description:
                "El Backend confirmó la entrega física al cliente. El detalle se vuelve a consultar para mostrar su estado autoritativo.",
            },
      );
    } finally {
      handoverInvocationRef.current = false;
    }
  }

  return (
    <Modal
      onClose={onClose}
      open={open}
      size="xl"
      subtitle={summary?.orderReference ?? "Detalle de operación logística"}
      title="Detalle del pedido"
    >
      {loading ? (
        <p className="rounded-lg border border-[var(--color-border)] p-5 text-sm text-[var(--color-text-muted)]">
          Consultando detalle y trazabilidad...
        </p>
      ) : null}
      {error ? <InlineAlert description={error} title="No se pudo cargar el detalle" /> : null}

      {summary && detail ? (
        <div className="space-y-4">
          <section className="rounded-lg border border-t-4 border-[var(--color-border)] border-t-[var(--color-structure)] bg-white p-3.5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Referencia
                </p>
                <h3 className="mt-0.5 text-lg font-bold text-[var(--color-title)] sm:text-xl">
                  {summary.orderReference}
                </h3>
              </div>
              <StatusBadge status={summary.operationalStatus} />
            </div>
            <dl className="mt-3 grid gap-2.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <DetailField label={homeDelivery ? "Destinatario" : "Persona que retira"}>
                {summary.contactName}
              </DetailField>
              <DetailField label="Teléfono">{summary.contactPhone ?? "No disponible"}</DetailField>
              <DetailField label="Modalidad">
                {homeDelivery ? "Envío a domicilio" : "Retiro en tienda/bodega"}
              </DetailField>
              <DetailField label="Responsable">
                {summary.responsibleUserName ?? "No disponible"}
              </DetailField>
            </dl>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--color-title)]">Fechas operativas</h3>
            <dl className="mt-2 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <DateField label="Recolección finalizada" value={summary.pickingCompletedAt} />
              <DateField label="Empaque finalizado" value={summary.packingFinalizedAt} />
              {homeDelivery ? (
                <DateField label="Despacho" value={summary.dispatchedAt} />
              ) : (
                <DateField label="Entrega" value={summary.deliveredAt} />
              )}
            </dl>
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <article className="rounded-lg border border-[var(--color-border)] p-3.5">
              <h3 className="text-sm font-bold text-[var(--color-title)]">Empaque</h3>
              <dl className="mt-2 grid gap-2.5 text-sm sm:grid-cols-2">
                <DetailField label="Preparación">
                  {summary.packingId
                    ? summary.packingFinalizedAt
                      ? "Finalizada"
                      : "En preparación"
                    : "No disponible"}
                </DetailField>
                <DetailField label="Peso">
                  {homeDelivery && summary.totalWeight !== null
                    ? `${summary.totalWeight} kg`
                    : "No aplica"}
                </DetailField>
                <DetailField label="Bultos">
                  {homeDelivery && summary.packageCount !== null
                    ? String(summary.packageCount)
                    : "No aplica"}
                </DetailField>
              </dl>
            </article>

            <article className="rounded-lg border border-[var(--color-border)] p-3.5">
              <h3 className="text-sm font-bold text-[var(--color-title)]">
                {homeDelivery ? "Despachado" : "Entrega en tienda"}
              </h3>
              <dl className="mt-2 grid gap-2.5 text-sm sm:grid-cols-2">
                {homeDelivery ? (
                  <>
                    <DetailField label="Transporte">
                      {summary.carrierName ?? "No disponible"}
                    </DetailField>
                    <DetailField label="Guía">
                      {summary.trackingNumber ?? "No disponible"}
                    </DetailField>
                  </>
                ) : (
                  <DetailField label="Resultado">
                    {summary.deliveredAt ? "Entregado" : "Pendiente de entrega"}
                  </DetailField>
                )}
              </dl>
            </article>
          </section>

          {handoverNotice ? (
            <InlineAlert
              description={handoverNotice.description}
              title={handoverNotice.title}
              tone={handoverNotice.tone}
            />
          ) : null}
          {handoverError ? (
            <InlineAlert
              description={
                handoverErrorUncertain
                  ? `${handoverError} Verifica el estado actualizado del pedido antes de intentar nuevamente.`
                  : handoverError
              }
              title={
                handoverErrorUncertain
                  ? "No se pudo verificar la entrega"
                  : "No se pudo confirmar la entrega"
              }
            />
          ) : null}
          {handoverEligible ? (
            <div className="flex justify-end border-t border-[var(--color-border)] pt-4">
              <Button
                aria-busy={handoverSubmitting}
                disabled={handoverBusy}
                onClick={() => {
                  setHandoverNotice(null);
                  setHandoverConfirmationOpen(true);
                }}
                type="button"
              >
                {handoverSubmitting
                  ? "Confirmando entrega..."
                  : "Confirmar entrega al cliente"}
              </Button>
            </div>
          ) : null}

          <LogisticsTracePanel
            error={null}
            items={detail.items}
            state={detail.items.length > 0 ? "data" : "empty"}
          />
        </div>
      ) : null}

      <ConfirmDialog
        cancelLabel="Volver"
        confirmDisabled={!handoverEligible || handoverBusy}
        confirmLabel={handoverSubmitting ? "Confirmando..." : "Confirmar entrega"}
        message={handoverEligible
          ? "¿Confirma que el pedido fue entregado al cliente?"
          : "El pedido dejó de ser elegible para entrega. Cierra este diálogo y actualiza el detalle antes de intentar otra acción."}
        onCancel={() => {
          if (!handoverBusy) setHandoverConfirmationOpen(false);
        }}
        onConfirm={() => void confirmHandover()}
        open={handoverConfirmationOpen}
        title="Confirmar entrega al cliente"
      />
    </Modal>
  );
}

function DetailField({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words font-medium text-[var(--color-title)]">{children}</dd>
    </div>
  );
}

function DateField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white p-2.5">
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-[var(--color-title)]">
        {formatDateTime(value)}
      </dd>
    </div>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
