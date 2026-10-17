"use client";

import { useRef, useState } from "react";
import type { InventoryTransfer } from "@/core/entities";
import { InventoryTransferStatus } from "@/core/enums";
import type { TransferHistoryRow } from "@/modules/inventory/application/services/GetInventoryTransferHistoryService";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { Input } from "@/shared/components/Input";
import { useToast } from "@/shared/components/Toast";

const STATUS_LABELS: Record<InventoryTransferStatus, string> = {
  [InventoryTransferStatus.preparing]: "En preparación",
  [InventoryTransferStatus.inTransit]: "En tránsito",
  [InventoryTransferStatus.received]: "Recibido / completado",
  [InventoryTransferStatus.cancelled]: "Cancelado",
};

interface Props {
  rows: TransferHistoryRow[];
  loading: boolean;
  error: string | null;
  canManageTransfers: boolean;
  busy: boolean;
  onCancel: (id: string, reason: string, operationId: string) => Promise<InventoryTransfer>;
  onConfirmationChange?: (open: boolean) => void;
}

export function TransferHistoryPanel({ rows, loading, error, canManageTransfers, busy,
  onCancel, onConfirmationChange }: Props) {
  const { showToast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const operationId = useRef<string | null>(null);
  const submitting = useRef(false);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  function updateConfirmOpen(open: boolean) {
    setConfirmOpen(open);
    onConfirmationChange?.(open);
  }

  function select(row: TransferHistoryRow) {
    if (busy || submitting.current) return;
    setSelectedId(row.id);
    setReason("");
    setSubmitError("");
    updateConfirmOpen(false);
    operationId.current = null;
  }

  async function confirmCancel() {
    if (!selected || !selected.canCancel || !canManageTransfers || busy || submitting.current) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setSubmitError("Ingresa el motivo de cancelación.");
      updateConfirmOpen(false);
      return;
    }
    submitting.current = true;
    setSubmitError("");
    try {
      const transfer = await onCancel(selected.id, normalizedReason,
        operationId.current ??= crypto.randomUUID());
      updateConfirmOpen(false);
      setReason("");
      operationId.current = null;
      showToast({ title: `Traslado ${transfer.number} cancelado`, tone: "success" });
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : "No se pudo cancelar el traslado.");
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-bold text-[var(--color-title)]">Traslados materializados</h3>
      </div>
      {error ? <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p> : null}
      {loading ? <p className="text-sm text-[var(--color-text-muted)]">Cargando traslados...</p> : null}
      {!loading && rows.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No hay traslados para esta sucursal.</p> : null}
      {!loading && rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <article className="rounded-xl border border-[var(--color-border)] bg-white p-3.5 text-sm shadow-sm" key={row.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[var(--color-title)]">{row.number}</p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${getTransferStatusClass(row.status)}`}>
                      {STATUS_LABELS[row.status]}
                    </span>
                  </div>
                  <p className="mt-1 break-words font-medium text-[var(--color-text)]">
                    {row.sourceBranchName} <span aria-hidden="true">→</span> {row.destinationBranchName}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {row.requestedQuantity} unidades · Actualizado {formatDate(row.updatedAt)}
                  </p>
                </div>
                <Button onClick={() => select(row)} type="button" variant="secondary">Ver detalle</Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {selected ? (
        <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
          <section aria-labelledby="transfer-summary-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-[var(--color-title)]" id="transfer-summary-heading">
                Resumen del traslado
              </h3>
              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${getTransferStatusClass(selected.status)}`}>
                {STATUS_LABELS[selected.status]}
              </span>
            </div>
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <TransferMeta label="Número" value={selected.number} />
              <TransferMeta label="ID del traslado" value={selected.id} />
              <TransferMeta label="Cantidad" value={String(selected.requestedQuantity)} />
              <TransferMeta label="Origen" value={selected.sourceBranchName} />
              <TransferMeta label="Destino" value={selected.destinationBranchName} />
              <TransferMeta label="Actualización" value={formatDate(selected.updatedAt)} />
            </dl>
          </section>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <section className="rounded-xl bg-[var(--color-app-background)] p-3.5">
              <h4 className="text-sm font-bold text-[var(--color-title)]">Ciclo de vida</h4>
              <ol className="mt-3 space-y-0 text-sm">
                {selected.lifecycle.map((step, index) => (
                  <li className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0" key={`${step.label}-${index}`}>
                    <span aria-hidden="true" className="relative flex justify-center">
                      <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--color-primary)] ring-4 ring-blue-100" />
                      {index < selected.lifecycle.length - 1 ? (
                        <span className="absolute bottom-0 top-4 w-px bg-blue-200" />
                      ) : null}
                    </span>
                    <span className="min-w-0">
                      <strong className="block break-words text-[var(--color-title)]">{step.label}</strong>
                      <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                        {formatDate(step.at)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-xl bg-[var(--color-app-background)] p-3.5">
              <h4 className="text-sm font-bold text-[var(--color-title)]">Movimientos físicos</h4>
              {selected.movements.length === 0 ? (
                <p className="mt-3 rounded-lg bg-white p-3 text-sm text-[var(--color-text-muted)]">
                  No hay entradas o salidas registradas.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {selected.movements.map((movement) => (
                    <li className="rounded-lg bg-white p-3 shadow-sm" key={movement.id}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <strong className="text-[var(--color-title)]">
                          {formatMovementLabel(movement.label)}
                        </strong>
                        <span className="font-bold tabular-nums text-[var(--color-title)]">
                          {movement.quantity}
                        </span>
                      </div>
                      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                        <TransferMeta label="Sucursal" value={movement.branchName} />
                        <TransferMeta label="Fecha" value={formatDate(movement.at)} />
                      </dl>
                      <p className="mt-2 break-words text-xs text-[var(--color-text-muted)]">
                        <span className="font-semibold text-[var(--color-text)]">Motivo / referencia:</span>{" "}
                        {movement.reason}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {selected.canCancel && canManageTransfers ? (
            <div className="max-w-lg space-y-2 border-t border-[var(--color-border)] pt-3">
              <label className="block text-sm font-semibold" htmlFor="transfer-cancel-reason">Motivo de cancelación *</label>
              <Input id="transfer-cancel-reason" maxLength={300} onChange={(event) => {
                setReason(event.target.value);
                setSubmitError("");
                operationId.current = null;
              }} value={reason} />
              {submitError ? <p className="text-sm text-[var(--color-danger)]" role="alert">{submitError}</p> : null}
              <Button disabled={busy || !reason.trim()} onClick={() => {
                operationId.current = crypto.randomUUID();
                updateConfirmOpen(true);
              }} type="button" variant="danger">Cancelar traslado</Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel={busy ? "Cancelando..." : "Confirmar cancelación"}
        message={`¿Cancelar ${selected?.number ?? "este traslado"}? Se liberará su reserva en origen. Esta acción solo está disponible antes del despacho.`}
        onCancel={() => { if (!busy && !submitting.current) updateConfirmOpen(false); }}
        onConfirm={() => { void confirmCancel(); }}
        open={confirmOpen && Boolean(selected?.canCancel) && canManageTransfers}
        title="Cancelar traslado"
      />
    </section>
  );
}

function TransferMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function formatMovementLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (normalized === "transfer in" || normalized.includes("entrada")) return "Entrada";
  if (normalized === "transfer out" || normalized.includes("salida")) return "Salida";
  return label;
}

function getTransferStatusClass(status: InventoryTransferStatus) {
  if (status === InventoryTransferStatus.received) return "bg-emerald-100 text-emerald-800";
  if (status === InventoryTransferStatus.cancelled) return "bg-red-100 text-red-800";
  if (status === InventoryTransferStatus.inTransit) return "bg-blue-100 text-blue-800";
  return "bg-amber-100 text-amber-800";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "short", timeStyle: "short" })
    .format(new Date(value));
}
