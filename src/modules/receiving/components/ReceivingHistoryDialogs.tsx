"use client";

import type { ReactNode, SVGProps } from "react";
import type { ReceiptIncidentEvidence } from "@/core/entities";
import type {
  ReceivingDocumentIncident,
  ReceivingPreviousReceipt,
  ReceivingPreviousReceiptLine,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { cn } from "@/shared/utils/cn";

export function ReceivingHistoryDialogs({ documentNumber, originName, receipt, incident, evidence, resolving, onCloseReceipt, onCloseIncident, onCloseEvidence, onSelectIncident, onPreview, onResolve }: {
  documentNumber: string;
  originName: string;
  receipt?: ReceivingPreviousReceipt;
  incident?: ReceivingDocumentIncident;
  evidence: ReceiptIncidentEvidence | null;
  resolving: boolean;
  onCloseReceipt: () => void;
  onCloseIncident: () => void;
  onCloseEvidence: () => void;
  onSelectIncident: (incident: ReceivingDocumentIncident) => void;
  onPreview: (evidence: ReceiptIncidentEvidence) => void;
  onResolve?: () => void;
}) {
  return <>
    <PreviousReceiptModal documentNumber={documentNumber} receipt={receipt} onClose={onCloseReceipt} onSelectIncident={onSelectIncident} onPreview={onPreview} />
    <HistoricalIncidentModal incident={incident} documentNumber={documentNumber} originName={originName} resolving={resolving} onResolve={onResolve} onClose={onCloseIncident} onPreview={onPreview} />
    <EvidencePreview evidence={evidence} onClose={onCloseEvidence} />
  </>;
}

function PreviousReceiptModal({
  documentNumber,
  receipt,
  onClose,
  onSelectIncident,
  onPreview,
}: {
  documentNumber: string;
  receipt?: ReceivingPreviousReceipt;
  onClose: () => void;
  onSelectIncident: (incident: ReceivingDocumentIncident) => void;
  onPreview: (evidence: ReceiptIncidentEvidence) => void;
}) {
  return (
    <Modal
      density="compact"
      maxWidth="min(1080px, 94vw)"
      open={Boolean(receipt)}
      title={
        receipt
          ? `Detalle de ${getReceiptSequenceLabel(receipt.sequenceNumber).toLowerCase()}`
          : "Detalle de recepcion"
      }
      subtitle={receipt ? `${documentNumber} · ${receipt.number} · solo lectura` : undefined}
      onClose={onClose}
      size="xl"
    >
      {receipt ? (
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <DetailItem label="Documento origen" value={documentNumber} />
            <DetailItem label="Fecha" value={formatDateTime(receipt.receivedAt)} />
            <DetailItem label="Responsable" value={receipt.responsibleName} />
            <DetailItem label="Aceptadas" value={formatNumber(receipt.acceptedQuantity)} />
            <DetailItem label="Pendiente despues" value={formatNumber(receipt.pendingAfter)} />
          </dl>
          <HistoricalReceiptLinesTable lines={receipt.lines} />
          {receipt.incidents.length > 0 ? (
            <section>
              <h3 className="font-bold text-[var(--color-title)]">Incidencias de esta recepcion</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {receipt.incidents.map((incident) => (
                  <button
                    className="w-full rounded-md border border-[var(--color-border)] p-3 text-left hover:border-[var(--color-primary)]"
                    key={incident.id}
                    onClick={() => onSelectIncident(incident)}
                    type="button"
                  >
                    <p className="font-bold text-[var(--color-title)]">{incident.productName}</p>
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                      {incident.sku}
                    </p>
                    <p className="text-sm">
                      {incident.incidentTypeName} - {formatNumber(incident.quantityAffected ?? 0)}{" "}
                      afectadas
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-text)]">{incident.description}</p>
                    <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
                      {formatDateTime(incident.createdAt)} · {incident.createdByName}
                    </p>
                    <EvidenceGallery evidence={incident.evidence} onPreview={onPreview} />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function HistoricalReceiptLinesTable({ lines }: { lines: ReceivingPreviousReceiptLine[] }) {
  return (
    <section>
      <h3 className="font-bold text-[var(--color-title)]">Productos de esta recepcion</h3>
      <div className="mt-2 overflow-x-auto rounded-md border border-[var(--color-border)]">
        <table className="w-full min-w-[940px] table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col className="w-[170px]" />
            <col className="w-[70px]" />
            <col className="w-[85px]" />
            <col className="w-[95px]" />
            <col className="w-[95px]" />
            <col className="w-[85px]" />
            <col className="w-[130px]" />
            <col className="w-[210px]" />
          </colgroup>
          <thead className="bg-[var(--color-structure)] text-[11px] uppercase text-white">
            <tr>
              <th className="px-2 py-2.5">Producto</th>
              <th className="px-2 py-2.5">Unidad</th>
              <th className="px-2 py-2.5 text-right">Pedido original</th>
              <th className="px-2 py-2.5 text-right">Aceptado</th>
              <th className="px-2 py-2.5 text-right">Incidencia</th>
              <th className="px-2 py-2.5 text-right">Pendiente</th>
              <th className="px-2 py-2.5">Ubicacion</th>
              <th className="px-2 py-2.5">Trazabilidad</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr className="border-t border-[var(--color-border)] align-top" key={line.id}>
                <td className="px-2 py-2.5">
                  <p
                    className="line-clamp-2 font-bold leading-5 text-[var(--color-title)]"
                    title={line.productName}
                  >
                    {line.productName}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">{line.sku}</p>
                </td>
                <td className="px-2 py-2.5">{line.unitName}</td>
                <td className="px-2 py-2.5 text-right font-semibold">
                  {formatNumber(line.orderedQuantity)}
                </td>
                <td className="px-2 py-2.5 text-right font-bold text-emerald-700">
                  {formatNumber(line.acceptedQuantity)}
                </td>
                <td className="px-2 py-2.5 text-right font-bold text-amber-700">
                  {formatNumber(line.incidentQuantity)}
                </td>
                <td className="px-2 py-2.5 text-right font-bold text-[var(--color-title)]">
                  {formatNumber(line.pendingAfter)}
                </td>
                <td className="px-2 py-2.5">
                  <p className="truncate" title={line.locationName}>
                    {line.locationName}
                  </p>
                </td>
                <td className="px-2 py-2.5 text-xs leading-5 text-[var(--color-text)]">
                  {line.lotNumber ? <p>Lote: {line.lotNumber}</p> : null}
                  {line.expirationDate ? <p>Vence: {formatDate(line.expirationDate)}</p> : null}
                  {line.serialNumbers.length > 0 ? (
                    <p className="break-words">Seriales: {line.serialNumbers.join(", ")}</p>
                  ) : null}
                  {!line.lotNumber && !line.expirationDate && line.serialNumbers.length === 0
                    ? "Sin trazabilidad"
                    : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoricalIncidentModal({
  incident,
  documentNumber,
  originName,
  resolving,
  onResolve,
  onClose,
  onPreview,
}: {
  incident?: ReceivingDocumentIncident;
  documentNumber: string;
  originName: string;
  resolving: boolean;
  onResolve?: () => void;
  onClose: () => void;
  onPreview: (evidence: ReceiptIncidentEvidence) => void;
}) {
  return (
    <Modal
      open={Boolean(incident)}
      title="Detalle de incidencia"
      subtitle={incident?.status ? `Estado: ${incident.status === "open" ? "Abierta" : "Resuelta"}` : "Registro historico - solo lectura"}
      onClose={onClose}
      size="lg"
    >
      {incident ? (
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <DetailItem label="Producto" value={incident.productName} />
            <DetailItem label="SKU" value={incident.sku} />
            <DetailItem label="Tipo" value={incident.incidentTypeName} />
            <DetailItem
              label="Cantidad afectada"
              value={
                incident.quantityAffected === undefined
                  ? "Incidencia general"
                  : formatNumber(incident.quantityAffected)
              }
            />
            {incident.status ? (
              <DetailItem
                label="Estado"
                value={incident.status === "open" ? "Abierta" : "Resuelta"}
              />
            ) : null}
            <DetailItem label="Fecha" value={formatDateTime(incident.createdAt)} />
            <DetailItem label="Responsable" value={incident.createdByName} />
            <DetailItem label="Recepcion relacionada" value={incident.receiptNumber} />
            <DetailItem label="Documento origen" value={documentNumber} />
            <DetailItem label="Proveedor" value={originName} />
          </dl>
          <div>
            <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
              Observacion
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-text)]">
              {incident.description}
            </p>
          </div>
          <EvidenceGallery evidence={incident.evidence} onPreview={onPreview} />
          {onResolve ? (
            <div className="flex justify-end border-t border-[var(--color-border)] pt-3">
              <Button disabled={resolving} onClick={onResolve} type="button">
                <CheckIcon />
                Resolver incidencia
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function EvidenceGallery({
  evidence,
  onPreview,
}: {
  evidence: ReceiptIncidentEvidence[];
  onPreview: (evidence: ReceiptIncidentEvidence) => void;
}) {
  if (evidence.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {evidence.map((item) =>
        item.previewUrl ? (
          <button
            key={item.id}
            onClick={(event) => {
              event.stopPropagation();
              onPreview(item);
            }}
            type="button"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={item.name}
              className="h-20 w-24 rounded-md border border-[var(--color-border)] object-cover"
              src={item.previewUrl}
            />
          </button>
        ) : null,
      )}
    </div>
  );
}

function EvidencePreview({
  evidence,
  onClose,
}: {
  evidence: ReceiptIncidentEvidence | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(evidence)}
      title={evidence?.name ?? "Evidencia"}
      onClose={onClose}
      size="xl"
    >
      {evidence?.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={evidence.name}
          className="mx-auto max-h-[72dvh] max-w-full object-contain"
          src={evidence.previewUrl}
        />
      ) : null}
    </Modal>
  );
}


function DetailItem({ label, value }: { label: string; value: ReactNode }) { return <div className="min-w-0"><dt className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[var(--color-title)]">{value}</dd></div>; }
function formatNumber(value: number) { return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("es-GT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function getReceiptSequenceLabel(sequenceNumber: number) { if (sequenceNumber === 1) return "Primera recepcion"; if (sequenceNumber === 2) return "Segunda recepcion"; return `Recepcion ${sequenceNumber}`; }
function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) { return <svg aria-hidden="true" className={cn("h-4 w-4 shrink-0", className)} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" {...props}>{children}</svg>; }
function CheckIcon(props: SVGProps<SVGSVGElement>) { return <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon>; }
