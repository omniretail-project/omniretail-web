"use client";

import { useState, type ReactNode, type SVGProps } from "react";
import { isReceiptIncidentTypeCode, type ReceiptIncidentEvidence, type ReceiptIncidentTypeCode } from "@/core/entities";
import { RECEIPT_INCIDENT_NOTES_MAX_LENGTH } from "@/core/repositories/ReceiptRepository";
import type { ReceivingDocumentDetail, ReceivingDocumentIncident, ReceivingDocumentLine } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { getIncidentCapacity } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import { isQuantityCompatibleWithUnit, parseUnitQuantityInput, toFiniteNumber, type NumericInputValue } from "@/shared/utils/numberInput";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";

type ApiIncidentFormProps = Parameters<typeof ApiIncidentForm>[0];
type IncidentFormProps = Parameters<typeof IncidentForm>[0];

export function ReceivingIncidentEditor(
  props:
    | { mode: "api"; formProps: ApiIncidentFormProps }
    | { mode: "local"; formProps: IncidentFormProps },
) {
  return props.mode === "api" ? (
    <ApiIncidentForm {...props.formProps} />
  ) : (
    <IncidentForm {...props.formProps} />
  );
}

export function ApiIncidentForm({
  detail,
  lines,
  incidents,
  lineBlocks,
  saving,
  onCancel,
  onSave,
}: {
  detail: ReceivingDocumentDetail;
  lines: ReceivingDocumentLine[];
  incidents: ReceivingDocumentIncident[];
  /** Motivo por linea (seriales invalidos/duplicados) que impide registrar incidencias en ella. */
  lineBlocks: Record<string, string>;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: {
    incidentType: ReceiptIncidentTypeCode;
    sourceLineId: string;
    quantityAffected: number;
    notes: string;
  }) => Promise<void>;
}) {
  // Solo las lineas con cantidad aceptada pueden materializarse como GoodsReceiptItem
  // (receivedQuantity > 0 en el contrato del borrador). No depende de un receipt ya persistido.
  const lineOptions = lines.filter((line) => toFiniteNumber(line.receivedNow) > 0);
  const [sourceLineId, setSourceLineId] = useState(
    (lineOptions.find((line) => !lineBlocks[line.id]) ?? lineOptions[0])?.sourceLineId ?? "",
  );
  const [incidentType, setIncidentType] = useState(detail.incidentTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState<NumericInputValue>(1);
  const [notes, setNotes] = useState("");
  const selectedLine = lineOptions.find((line) => line.sourceLineId === sourceLineId);
  const numericQuantity = toFiniteNumber(quantity);
  // La cantidad afectada es mercancia NO aceptada: se limita por lo pendiente de la orden.
  const capacity = selectedLine ? getIncidentCapacity(selectedLine, incidents) : 0;
  const blockReason = selectedLine ? lineBlocks[selectedLine.id] : undefined;
  const quantityError =
    selectedLine && numericQuantity > capacity
      ? `La cantidad supera lo pendiente de la orden (${formatNumber(capacity)}).`
      : undefined;
  const lineInvalid =
    !selectedLine ||
    Boolean(blockReason) ||
    numericQuantity <= 0 ||
    numericQuantity > capacity ||
    !isQuantityCompatibleWithUnit(quantity, selectedLine.unitAllowsDecimals);
  const invalid =
    !isReceiptIncidentTypeCode(incidentType) ||
    !notes.trim() ||
    notes.length > RECEIPT_INCIDENT_NOTES_MAX_LENGTH ||
    lineInvalid;

  async function handleSave() {
    if (invalid || !isReceiptIncidentTypeCode(incidentType)) return;
    await onSave({ incidentType, sourceLineId, quantityAffected: numericQuantity, notes });
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 bg-[var(--color-structure)] px-4 py-3 text-white">
        <div>
          <h2 className="text-sm font-bold">Registrar incidencia</h2>
          <p className="text-xs font-semibold opacity-80">{detail.document.number}</p>
        </div>
        <button
          aria-label="Volver al resumen"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-bold hover:bg-white/10"
          onClick={onCancel}
          type="button"
        >
          <ArrowLeftIcon />
          Resumen
        </button>
      </div>
      <div className="space-y-3 p-4">
        {lineOptions.length === 0 ? (
          <InlineAlert
            title="Ingresa una cantidad aceptada en al menos un producto para registrar una incidencia."
            tone="warning"
          />
        ) : null}
        <Field label="Producto afectado">
          <Select
            disabled={saving || lineOptions.length === 0}
            onChange={(event) => setSourceLineId(event.target.value)}
            value={sourceLineId}
          >
            {lineOptions.map((line) => (
              <option
                disabled={Boolean(lineBlocks[line.id])}
                key={line.sourceLineId}
                value={line.sourceLineId}
              >
                {line.productName} ({line.sku}) - {line.unitName}
                {lineBlocks[line.id] ? " - revisa la trazabilidad" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cantidad afectada">
          <Input
            disabled={saving}
            inputMode={selectedLine?.unitAllowsDecimals ? "decimal" : "numeric"}
            maxLength={12}
            onChange={(event) =>
              setQuantity(
                parseUnitQuantityInput(
                  event.target.value,
                  selectedLine?.unitAllowsDecimals ?? false,
                ),
              )
            }
            type="text"
            value={quantity}
          />
          <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
            Máximo disponible para incidencia: {formatNumber(capacity)}
          </p>
          {quantityError ? (
            <p className="mt-1 text-xs font-semibold text-[var(--color-danger)]">{quantityError}</p>
          ) : null}
          {blockReason ? (
            <p className="mt-1 text-xs font-semibold text-[var(--color-danger)]">{blockReason}</p>
          ) : null}
        </Field>
        <Field label="Tipo de incidencia">
          <Select
            disabled={saving}
            onChange={(event) => setIncidentType(event.target.value)}
            value={incidentType}
          >
            {detail.incidentTypes.map((type) => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Observación">
          <textarea
            className="min-h-28 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
            maxLength={RECEIPT_INCIDENT_NOTES_MAX_LENGTH}
            onChange={(event) => setNotes(event.target.value)}
            value={notes}
          />
          <p className="text-right text-xs text-[var(--color-text-muted)]">
            {notes.length} / {RECEIPT_INCIDENT_NOTES_MAX_LENGTH}
          </p>
        </Field>
        <div className="grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-3">
          <Button disabled={saving} onClick={onCancel} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={saving || invalid} onClick={() => void handleSave()} type="button">
            <SaveIcon />
            Guardar incidencia
          </Button>
        </div>
      </div>
    </section>
  );
}

export function IncidentForm({
  detail,
  incident,
  incidents,
  lines,
  onCancel,
  onDelete,
  onPreview,
  onSave,
}: {
  detail: ReceivingDocumentDetail;
  incident?: ReceivingDocumentIncident;
  incidents: ReceivingDocumentIncident[];
  lines: ReceivingDocumentLine[];
  onCancel: () => void;
  onDelete?: () => void;
  onPreview: (evidence: ReceiptIncidentEvidence) => void;
  onSave: (input: {
    productId: string;
    incidentTypeId: string;
    quantityAffected: number;
    description: string;
    evidence: ReceiptIncidentEvidence[];
  }) => void;
}) {
  const { showToast } = useToast();
  const [productId, setProductId] = useState(incident?.productId ?? lines[0]?.productId ?? "");
  const [incidentTypeId, setIncidentTypeId] = useState(
    incident?.incidentTypeId ?? detail.incidentTypes[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState<NumericInputValue>(incident?.quantityAffected ?? 1);
  const [description, setDescription] = useState(incident?.description ?? "");
  const [evidence, setEvidence] = useState<ReceiptIncidentEvidence[]>(incident?.evidence ?? []);
  const selectedLine = lines.find((line) => line.productId === productId);
  const affectedByOtherIncidents = incidents
    .filter((item) => item.editable && item.productId === productId && item.id !== incident?.id)
    .reduce((sum, item) => sum + (item.quantityAffected ?? 0), 0);
  const maximumQuantity = Math.max(
    0,
    (selectedLine?.orderedQuantity ?? 0) -
      (selectedLine?.acceptedPreviously ?? 0) -
      toFiniteNumber(selectedLine?.receivedNow ?? 0) -
      affectedByOtherIncidents,
  );
  const incidentInvalid =
    !productId ||
    !incidentTypeId ||
    !description.trim() ||
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > maximumQuantity ||
    !isQuantityCompatibleWithUnit(quantity, selectedLine?.unitAllowsDecimals ?? false);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const accepted = [...files].filter((file) => /^image\/(png|jpe?g|webp)$/i.test(file.type));
    if (accepted.length !== files.length) {
      showToast({ title: "Algunas imagenes no son compatibles", tone: "info" });
    }
    const mapped = await Promise.all(accepted.map(fileToEvidence));
    setEvidence((current) => [...current, ...mapped]);
  }

  function handleSave() {
    if (!productId || !incidentTypeId || !description.trim() || toFiniteNumber(quantity) <= 0) {
      showToast({ title: "Completa la incidencia", tone: "danger" });
      return;
    }
    if (toFiniteNumber(quantity) > maximumQuantity) {
      showToast({
        title: "Cantidad mayor a la disponible",
        description: `Solo quedan ${formatNumber(maximumQuantity)} unidades disponibles para registrar entre aceptadas e incidencias.`,
        tone: "danger",
      });
      return;
    }
    try {
      onSave({
        productId,
        incidentTypeId,
        quantityAffected: toFiniteNumber(quantity),
        description,
        evidence,
      });
    } catch (caughtError) {
      showToast({
        title: "No se pudo registrar la incidencia",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 bg-[var(--color-structure)] px-4 py-3 text-white">
        <div>
          <h2 className="text-sm font-bold">
            {incident ? "Editar incidencia" : "Registrar incidencia"}
          </h2>
          <p className="text-xs font-semibold opacity-80">{detail.document.number}</p>
        </div>
        <button
          aria-label="Volver al resumen"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-bold hover:bg-white/10"
          onClick={onCancel}
          type="button"
        >
          <ArrowLeftIcon />
          Resumen
        </button>
      </div>
      <div className="space-y-3 p-4">
        <Field label="Producto">
          <Select value={productId} onChange={(event) => setProductId(event.target.value)}>
            {lines.map((line) => (
              <option key={line.productId} value={line.productId}>
                {line.productName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de incidencia">
          <Select
            value={incidentTypeId}
            onChange={(event) => setIncidentTypeId(event.target.value)}
          >
            {detail.incidentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Cantidad">
          <Input
            inputMode={selectedLine?.unitAllowsDecimals ? "decimal" : "numeric"}
            maxLength={12}
            onChange={(event) =>
              setQuantity(
                parseUnitQuantityInput(
                  event.target.value,
                  selectedLine?.unitAllowsDecimals ?? false,
                ),
              )
            }
            type="text"
            value={quantity}
          />
          <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
            Disponible para incidencia: {formatNumber(maximumQuantity)}
          </p>
        </Field>
        <Field label="Observacion">
          <textarea
            className="min-h-24 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
            maxLength={TEXT_LIMITS.notes}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
          <p className="text-right text-xs text-[var(--color-text-muted)]">
            {description.length} / {TEXT_LIMITS.notes}
          </p>
        </Field>
        <Field label="Evidencia fotografica">
          <label className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[var(--color-primary)] bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-title)] hover:bg-blue-50">
            <ImageIcon />
            Agregar imagenes
            <input
              accept="image/png,image/jpeg,image/jpg,image/webp"
              className="sr-only"
              multiple
              onChange={(event) => void handleFiles(event.target.files)}
              type="file"
            />
          </label>
          <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
            {evidence.length} {evidence.length === 1 ? "evidencia" : "evidencias"}
          </p>
          {evidence.length > 0 ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {evidence.map((item) => (
                <div
                  className="relative min-w-0 overflow-hidden rounded-md border border-[var(--color-border)] bg-white"
                  key={item.id}
                >
                  {item.previewUrl ? (
                    <button className="block w-full" onClick={() => onPreview(item)} type="button">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt={item.name}
                        className="aspect-[4/3] w-full object-cover"
                        src={item.previewUrl}
                      />
                    </button>
                  ) : null}
                  <div className="min-w-0 p-2 pr-9">
                    <p className="truncate text-xs font-semibold text-[var(--color-title)]">
                      {item.name}
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {formatFileSize(item.size)}
                    </p>
                  </div>
                  <button
                    aria-label={`Quitar ${item.name}`}
                    className="absolute bottom-1 right-1 rounded-md bg-white p-1.5 text-[var(--color-danger)] shadow-sm hover:bg-red-50"
                    onClick={() =>
                      setEvidence((current) => current.filter((file) => file.id !== item.id))
                    }
                    type="button"
                  >
                    <XIcon />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Field>
        <div className="grid w-full min-w-0 gap-2 border-t border-[var(--color-border)] pt-3">
          {onDelete ? (
            <div className="flex min-w-0 justify-start">
              <Button
                className="w-full justify-center px-3 sm:w-auto"
                onClick={onDelete}
                type="button"
                variant="danger"
              >
                <TrashIcon />
                Quitar
              </Button>
            </div>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              className="w-full min-w-0 justify-center px-2"
              onClick={onCancel}
              type="button"
              variant="ghost"
            >
              <XIcon />
              Cancelar
            </Button>
            <Button
              className="w-full min-w-0 justify-center px-2 text-center leading-tight whitespace-normal"
              disabled={incidentInvalid}
              onClick={handleSave}
              type="button"
            >
              <SaveIcon />
              {incident ? "Guardar cambios" : "Guardar incidencia"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}


function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</span>{children}</label>;
}
function fileToEvidence(file: File): Promise<ReceiptIncidentEvidence> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ id: `${file.name}-${file.size}-${Date.now()}`, name: file.name, type: file.type, size: file.size, previewUrl: typeof reader.result === "string" ? reader.result : undefined });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function formatNumber(value: number) { return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(value); }
function formatFileSize(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB`; }
function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) { return <svg aria-hidden="true" className={cn("h-4 w-4 shrink-0", className)} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" {...props}>{children}</svg>; }
function ArrowLeftIcon(props: SVGProps<SVGSVGElement>) { return <Icon {...props}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></Icon>; }
function SaveIcon(props: SVGProps<SVGSVGElement>) { return <Icon {...props}><path d="M5 4h12l2 2v14H5z" /><path d="M8 4v6h8V4" /><path d="M8 20v-6h8v6" /></Icon>; }
function ImageIcon(props: SVGProps<SVGSVGElement>) { return <Icon {...props}><rect height="16" rx="2" width="18" x="3" y="4" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></Icon>; }
function XIcon(props: SVGProps<SVGSVGElement>) { return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>; }
function TrashIcon(props: SVGProps<SVGSVGElement>) { return <Icon {...props}><path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13" /></Icon>; }
