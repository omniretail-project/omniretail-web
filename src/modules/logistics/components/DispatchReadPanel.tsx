"use client";

import { useState, type FormEvent } from "react";
import { TransportMode } from "@/core/enums";
import { useLogisticsDispatchRead } from "@/modules/logistics/hooks/useLogisticsDispatchRead";
import { validateDispatchShipment } from "@/modules/logistics/validation/dispatch.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";

export function DispatchReadPanel() {
  const dispatch = useLogisticsDispatchRead();

  if (!dispatch.canRead && !dispatch.loading) {
    return <InlineAlert description="Tu rol no posee logistics.dispatch.read." title="Acceso no autorizado" tone="warning" />;
  }
  if (!dispatch.hasBranchAccess && !dispatch.loading) {
    return <InlineAlert description="Selecciona una sucursal autorizada para consultar despachos." title="Sucursal no disponible" tone="warning" />;
  }

  return (
    <section className="space-y-4 rounded-xl border border-[var(--color-border)] bg-white p-3.5 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-title)]">Salidas listas</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Pedidos y traslados preparados en {dispatch.currentBranchName}.
          </p>
        </div>
        <Button disabled={dispatch.loading} onClick={() => void dispatch.reload()} variant="secondary">
          Actualizar
        </Button>
      </div>

      {dispatch.error ? <InlineAlert description={dispatch.error} title="No se pudo consultar Dispatch" /> : null}
      {dispatch.success ? <InlineAlert description={dispatch.success} title="Salida confirmada" tone="success" /> : null}
      {dispatch.loading ? <p className="text-sm text-[var(--color-text-muted)]">Consultando salidas...</p> : null}
      {!dispatch.loading && dispatch.queue.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-[var(--color-text-muted)]">
          No hay pedidos ni traslados listos para salida.
        </p>
      ) : null}

      {dispatch.orders.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-semibold text-[var(--color-title)]">Pedidos preparados</h3>
          {dispatch.orders.map((item) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5" key={item.sourceId}>
              <div>
                <p className="font-semibold text-[var(--color-title)]">{item.sourceReference}</p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {transportLabel(item.transportMode)} · Packing finalizado {formatDateTime(item.packingFinalizedAt)}
                </p>
              </div>
              <Button
                disabled={dispatch.detailLoading || dispatch.mutationInFlight}
                onClick={() => item.orderId && void dispatch.selectOrder(item.orderId)}
                variant="secondary"
              >
                Ver detalle
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {dispatch.transfers.length > 0 ? (
        <div className="space-y-2">
          <h3 className="font-semibold text-[var(--color-title)]">Traslados preparados</h3>
          {dispatch.transfers.map((item) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5" key={item.sourceId}>
              <div>
                <p className="font-semibold text-[var(--color-title)]">{item.sourceReference}</p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Flota propia · Packing finalizado {formatDateTime(item.packingFinalizedAt)}
                </p>
              </div>
              <Button
                disabled={!dispatch.canConfirm || dispatch.mutationInFlight}
                onClick={() => void dispatch.confirmTransfer(item.sourceId, item.sourceReference)}
                type="button"
              >
                {dispatch.submittingSourceId === item.sourceId ? "Confirmando..." : "Confirmar salida"}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {dispatch.selectedOrderId ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="font-semibold text-[var(--color-title)]">Detalle del pedido preparado</h3>
            <Button disabled={dispatch.mutationInFlight} onClick={dispatch.clearSelection} variant="ghost">Cerrar</Button>
          </div>
          {dispatch.detailLoading ? <p className="mt-2 text-sm">Consultando detalle...</p> : null}
          {dispatch.detail ? (
            <PreparedDetail
              canConfirm={dispatch.canConfirm}
              detail={dispatch.detail}
              onConfirm={dispatch.confirmOrder}
              submitting={dispatch.submittingSourceId === dispatch.detail.orderId}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PreparedDetail({
  canConfirm,
  detail,
  onConfirm,
  submitting,
}: {
  canConfirm: boolean;
  detail: NonNullable<ReturnType<typeof useLogisticsDispatchRead>["detail"]>;
  onConfirm: ReturnType<typeof useLogisticsDispatchRead>["confirmOrder"];
  submitting: boolean;
}) {
  const address = detail.address;
  const [carrierName, setCarrierName] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateDispatchShipment(detail.transportMode, { carrierName, trackingNumber });
    setErrors(validation.errors);
    if (!validation.valid) return;
    await onConfirm({
      carrierName: validation.carrierName,
      trackingNumber: validation.trackingNumber,
    });
  };

  return (
    <form className="mt-3 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Detail label="Pedido" value={detail.orderReference} />
        <Detail label="Destinatario" value={detail.recipientName || "No disponible"} />
        <Detail label="Teléfono" value={detail.recipientPhone ?? "No disponible"} />
        <Detail label="Transporte" value={transportLabel(detail.transportMode)} />
        <Detail label="Bultos" value={String(detail.packageCount)} />
        <Detail label="Peso total" value={`${detail.totalWeight} kg`} />
        <Detail label="Etiqueta" value={detail.labelCode} />
        <Detail label="Packing finalizado" value={formatDateTime(detail.packingFinalizedAt)} />
        <div className="sm:col-span-2">
          <Detail
            label="Dirección"
            value={address ? [address.line1, address.line2, address.city, address.stateOrDepartment, address.country]
              .filter(Boolean).join(", ") || "No disponible" : "No disponible"}
          />
        </div>
      </div>
      {detail.transportMode === TransportMode.third_party ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField error={errors.carrierName} id={`dispatch-carrier-${detail.orderId}`} label="Transportista">
            <Input
              aria-describedby={errors.carrierName ? `dispatch-carrier-${detail.orderId}-error` : undefined}
              disabled={!canConfirm || submitting}
              id={`dispatch-carrier-${detail.orderId}`}
              maxLength={200}
              onChange={(event) => setCarrierName(event.target.value)}
              value={carrierName}
            />
          </FormField>
          <FormField error={errors.trackingNumber} id={`dispatch-tracking-${detail.orderId}`} label="Número de guía">
            <Input
              aria-describedby={errors.trackingNumber ? `dispatch-tracking-${detail.orderId}-error` : undefined}
              disabled={!canConfirm || submitting}
              id={`dispatch-tracking-${detail.orderId}`}
              maxLength={200}
              onChange={(event) => setTrackingNumber(event.target.value)}
              value={trackingNumber}
            />
          </FormField>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          La salida utilizará la flota propia configurada para el pedido.
        </p>
      )}
      <div className="flex justify-end">
        <Button disabled={!canConfirm || submitting} type="submit">
          {submitting ? "Confirmando salida..." : "Confirmar despacho"}
        </Button>
      </div>
      {!canConfirm ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          Tu rol puede consultar el despacho, pero no posee logistics.dispatch.confirm.
        </p>
      ) : null}
    </form>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <p><span className="font-semibold text-[var(--color-title)]">{label}:</span> {value}</p>;
}

function transportLabel(mode: TransportMode) {
  return mode === TransportMode.third_party ? "Transportista externo" : "Flota propia";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
