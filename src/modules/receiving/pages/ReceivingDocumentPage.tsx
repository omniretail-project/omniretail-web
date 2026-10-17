"use client";

import dynamic from "next/dynamic";
import { Fragment, useCallback, useEffect, useMemo, useState, type SVGProps } from "react";
import { SaasCapabilityKey } from "@/core/enums";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import {
  parseUnitQuantityInput,
  toFiniteNumber,
  type NumericInputValue,
} from "@/shared/utils/numberInput";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import { type ReceiptIncidentEvidence, type ReceiptIncidentTypeCode } from "@/core/entities";
import {
  EXPIRATION_BEFORE_ENTRY_MESSAGE,
  getLocalCalendarDate,
  isExpirationBeforeOperationDate,
} from "@/core/inventory/expirationDate";
import type {
  ReceivingDocumentDetailType,
  ReceivingDocumentIncident,
  ReceivingDocumentLine,
  ReceivingTrackingDetail,
  ReceivingPreviousReceipt,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import {
  getAcceptedNow,
  getRejectedNow,
  parseSerialNumbers,
  toBaseQuantity,
  validateIncidentQuantities,
  validateApiDraftLines,
  validateLines,
} from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import { useReceivingDocumentDetail } from "@/modules/receiving/hooks/useReceivingDocumentDetail";
import {
  findRepeatedSerials,
  useSerialPrecheck,
} from "@/modules/receiving/hooks/useSerialPrecheck";
import type { ReceiptDraftTrackingDetailInput } from "@/core/repositories";

interface SerialPrecheckResult {
  duplicates: string[];
  unavailable: boolean;
}

interface ReceivingDocumentPageProps {
  documentType: ReceivingDocumentDetailType;
  documentId: string;
}

const ReceivingIncidentEditor = dynamic(
  () =>
    import("@/modules/receiving/components/ReceivingIncidentForms").then(
      (module) => module.ReceivingIncidentEditor,
    ),
  { loading: () => <DeferredPanel label="Cargando editor de incidencia..." /> },
);

const ReceivingHistoryDialogs = dynamic(
  () =>
    import("@/modules/receiving/components/ReceivingHistoryDialogs").then(
      (module) => module.ReceivingHistoryDialogs,
    ),
  { loading: () => <DeferredPanel label="Cargando detalle historico..." /> },
);

export function ReceivingDocumentPage({ documentType, documentId }: ReceivingDocumentPageProps) {
  const { showToast } = useToast();
  const {
    detail,
    lines,
    incidents,
    loading,
    saving,
    incidentSaving,
    dirty,
    error,
    apiMode,
    transferReception,
    pendingTransferMessage,
    pendingTransferRetryReady,
    hasPendingTransferConfirmation,
    confirmAvailable,
    incidentsAvailable,
    updateLine,
    updateLineQuantity,
    saveProgress,
    confirm,
    saveIncident,
    removeIncident,
    createApiIncident,
    resolveApiIncident,
    downloadFinalReport,
  } = useReceivingDocumentDetail(documentType, documentId);
  const { hasCapability } = useEntitlement();
  const canUseReceiving = hasCapability(SaasCapabilityKey.receiving);
  const [incidentEditorOpen, setIncidentEditorOpen] = useState(false);
  // Panel lateral bajo demanda (cerrado por defecto): resumen o formulario de incidencia, nunca ambos.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [deleteIncidentId, setDeleteIncidentId] = useState<string | null>(null);
  const [selectedPreviousReceiptId, setSelectedPreviousReceiptId] = useState<string | null>(null);
  const [selectedHistoricalIncidentId, setSelectedHistoricalIncidentId] = useState<string | null>(
    null,
  );
  const [previewEvidence, setPreviewEvidence] = useState<ReceiptIncidentEvidence | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [serialPrecheck, setSerialPrecheck] = useState<Record<string, SerialPrecheckResult>>({});
  const [replacementIncidentId, setReplacementIncidentId] = useState<string | null>(null);
  const handleSerialPrecheck = useCallback((lineId: string, result: SerialPrecheckResult) => {
    setSerialPrecheck((current) => {
      const previous = current[lineId];
      if (
        previous?.unavailable === result.unavailable &&
        previous.duplicates.join("\u0000") === result.duplicates.join("\u0000")
      ) {
        return current;
      }
      return { ...current, [lineId]: result };
    });
  }, []);
  const selectedIncident = incidents.find((incident) => incident.id === selectedIncidentId);
  const selectedPreviousReceipt = detail?.previousReceipts.find(
    (receipt) => receipt.id === selectedPreviousReceiptId,
  );
  const selectedHistoricalIncident = incidents.find(
    (incident) => incident.id === selectedHistoricalIncidentId,
  );
  const apiSummary = detail?.dataSource === "api";
  const summary = useMemo(
    () => getSummary(lines, incidents, apiSummary),
    [apiSummary, incidents, lines],
  );
  const saveProgressErrors = detail
    ? detail.dataSource === "api"
      ? validateLines(lines, incidents, detail)
      : validateIncidentQuantities(lines, incidents, detail)
    : [];
  // Seriales ya registrados (precheck): solo lineas editables que se enviarian en el payload.
  const remoteSerialErrors = lines.flatMap((line) => {
    const duplicates = serialPrecheck[line.id]?.duplicates ?? [];
    return duplicates.length > 0 && !line.incidentProtected
      ? [`${line.productName}: seriales ya registrados: ${duplicates.join(", ")}.`]
      : [];
  });
  const allSaveErrors = [...saveProgressErrors, ...remoteSerialErrors];
  const saveProgressInvalid = !detail || allSaveErrors.length > 0;
  const incidentLineBlocks: Record<string, string> =
    detail?.dataSource === "api"
      ? Object.fromEntries(
          lines.flatMap((line) => {
            if (toFiniteNumber(line.receivedNow) <= 0) return [];
            const remote = serialPrecheck[line.id]?.duplicates ?? [];
            const reason =
              remote.length > 0
                ? `Seriales ya registrados: ${remote.join(", ")}`
                : validateApiDraftLines([line], detail)[0];
            return reason ? [[line.id, reason]] : [];
          }),
        )
      : {};
  const hasOpenApiIncidents = incidents.some((incident) => incident.status === "open");
  const confirmationInvalid =
    detail?.document.type === "transfer"
      ? hasPendingTransferConfirmation
        ? !pendingTransferRetryReady
        : !transferReception?.canConfirmTransfer ||
          !lines.some((line) => toFiniteNumber(line.receivedNow) > 0) ||
          validateLines(lines, incidents, detail).length > 0 ||
          lines.some((line) => toFiniteNumber(line.receivedNow) > 0 && !line.locationId)
      : detail
        ? validateLines(lines, incidents, detail).length > 0 ||
          hasOpenApiIncidents ||
          remoteSerialErrors.length > 0 ||
          Boolean(detail.incidentListIncomplete)
        : true;

  async function handleSaveProgress() {
    try {
      await saveProgress();
      showToast({ title: "Avance guardado", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo guardar avance",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function handleDownloadReport() {
    try {
      await downloadFinalReport();
      showToast({ title: "PDF generado", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo generar el PDF",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function handleConfirm() {
    try {
      await confirm();
      showToast({ title: "Recepcion confirmada", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo confirmar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function handleCreateApiIncident(input: {
    incidentType: ReceiptIncidentTypeCode;
    sourceLineId: string;
    quantityAffected: number;
    notes: string;
  }) {
    try {
      await createApiIncident(input);
      showToast({ title: "Incidencia registrada", tone: "success" });
      setIncidentEditorOpen(false);
    } catch (caughtError) {
      showToast({
        title: "No se pudo registrar la incidencia",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  const replacementIncident = incidents.find((incident) => incident.id === replacementIncidentId);
  const replacementLine = replacementIncident
    ? lines.find((line) => line.goodsReceiptItemId === replacementIncident.goodsReceiptItemId)
    : undefined;

  function startResolveIncident(incident: ReceivingDocumentIncident) {
    setSelectedHistoricalIncidentId(null);
    // Con trazabilidad abre ReplacementModal; sin ella, un ConfirmDialog simple.
    setReplacementIncidentId(incident.id);
  }

  async function handleResolveApiIncident(
    incidentId: string,
    trackingDetails?: ReceiptDraftTrackingDetailInput[],
  ) {
    try {
      await resolveApiIncident(incidentId, trackingDetails);
      showToast({ title: "Incidencia resuelta con reemplazo", tone: "success" });
      setSelectedHistoricalIncidentId(null);
      setReplacementIncidentId(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo resolver la incidencia",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border border-[var(--color-border)] bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-[var(--color-text-muted)]">Cargando recepcion...</p>
      </section>
    );
  }

  if (error || !detail) {
    return (
      <section className="space-y-4 rounded-lg border border-[var(--color-border)] bg-white p-5 shadow-sm">
        <p className="text-sm font-semibold text-[var(--color-danger)]">
          {error ?? "No se encontro el documento."}
        </p>
        <Button href="/compras/recepciones" variant="secondary">
          <ArrowLeftIcon />
          Volver a recepciones
        </Button>
      </section>
    );
  }

  const readOnly = detail.readOnly;
  const showMutationActions = !readOnly || pendingTransferRetryReady;
  const showIncidentPanel = incidentEditorOpen && !readOnly;
  const sidePanelOpen = showIncidentPanel || summaryOpen;
  const editingDisabled =
    readOnly || Boolean(detail.draftEditingLocked) || hasPendingTransferConfirmation;

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Recepciones &gt; Recepcion de mercaderia
        </p>
        <PageHeader
          title="Recepcion de mercaderia"
          description={`${detail.document.typeLabel} ${detail.document.number}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button href="/compras/recepciones" type="button" variant="ghost">
                <ArrowLeftIcon />
                Volver
              </Button>
              {apiMode &&
              detail.document.type === "purchase_order" &&
              detail.document.statusLabel === "Recibida" &&
              !detail.receiptHistoryIncomplete &&
              detail.previousReceipts.length > 0 ? (
                <Button
                  onClick={() => void handleDownloadReport()}
                  type="button"
                  variant="secondary"
                >
                  Descargar PDF
                </Button>
              ) : null}
              {showMutationActions ? (
                <>
                  {!readOnly &&
                  detail.document.type === "purchase_order" &&
                  !detail.draftEditingLocked ? (
                    <Button
                      disabled={saving || incidentSaving || !canUseReceiving || saveProgressInvalid}
                      onClick={handleSaveProgress}
                      type="button"
                      variant="secondary"
                    >
                      <SaveIcon />
                      Guardar avance
                    </Button>
                  ) : null}
                  {confirmAvailable ? (
                    <Button
                      disabled={saving || incidentSaving || !canUseReceiving || confirmationInvalid}
                      onClick={handleConfirm}
                      type="button"
                    >
                      <CheckIcon />
                      Confirmar recepcion
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          }
        />
      </div>

      {detail.draftEditingLocked ? (
        <InlineAlert
          title={
            detail.incidentListIncomplete
              ? "Los productos quedan bloqueados porque la lista de incidencias está incompleta y no puede descartarse una referencia a sus líneas."
              : "Este borrador tiene una incidencia asociada a una línea. Para preservar su referencia canónica, los productos quedan bloqueados incluso si la incidencia ya fue resuelta."
          }
          tone="warning"
        />
      ) : null}
      {hasOpenApiIncidents && !readOnly ? (
        <InlineAlert title="Resuelve las incidencias abiertas antes de confirmar." tone="warning" />
      ) : null}
      {detail.incidentListIncomplete ? (
        <InlineAlert
          title="La recepción tiene más incidencias que las mostradas. Resuelve las incidencias abiertas antes de confirmar; el backend vuelve a validar esta regla."
          tone="warning"
        />
      ) : null}
      {apiMode && dirty && allSaveErrors[0] ? (
        <InlineAlert title={allSaveErrors[0]} tone="warning" />
      ) : null}
      {detail.receiptHistoryIncomplete ? (
        <InlineAlert
          title="El historial confirmado tiene más páginas. Los totales históricos y pendientes no están disponibles; esta recepción es solo de consulta."
          tone="warning"
        />
      ) : null}
      {detail.document.type === "transfer" && transferReception?.blockingReason ? (
        <InlineAlert title={transferReception.blockingReason} tone="warning" />
      ) : null}
      {detail.document.type === "transfer" && pendingTransferMessage ? (
        <InlineAlert
          title={pendingTransferMessage}
          tone={pendingTransferRetryReady ? "info" : "warning"}
        />
      ) : null}
      {detail.document.type === "transfer" && transferReception?.destinationLocationName ? (
        <InlineAlert
          title={`Ubicación automática: ${transferReception.destinationLocationName}`}
          description="La confirmación se registrará en esta ubicación operativa. No requiere selección manual."
          tone="info"
        />
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <DetailItem label="Documento vinculado" value={detail.document.number} />
          <DetailItem label="Tipo" value={detail.document.typeLabel} />
          <DetailItem label={detail.document.originLabel} value={detail.document.originName} />
          <DetailItem label="Sucursal destino" value={detail.document.branchName} />
          <DetailItem label="Estado" value={detail.document.statusLabel} />
        </div>
      </section>

      {detail.previousReceipts.length > 0 ? (
        <PreviousReceiptsSection
          documentNumber={detail.document.number}
          expanded={historyExpanded}
          receipts={detail.previousReceipts}
          onSelect={(receipt) => setSelectedPreviousReceiptId(receipt.id)}
          onToggle={() => setHistoryExpanded((current) => !current)}
        />
      ) : null}

      <div
        className={cn(
          "grid gap-5",
          sidePanelOpen && "xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start",
        )}
      >
        <main className="min-w-0 space-y-5">
          <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-[var(--color-title)]">
                  Recepcion actual de {detail.document.number}
                </h2>
                <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                  Pendiente inicial:{" "}
                  {detail.receiptHistoryIncomplete
                    ? "No disponible"
                    : formatNumber(summary.ordered - summary.acceptedPreviously)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  aria-label="Ver resumen"
                  aria-pressed={summaryOpen && !showIncidentPanel}
                  onClick={() => {
                    setIncidentEditorOpen(false);
                    setSummaryOpen((current) => (showIncidentPanel ? true : !current));
                  }}
                  title="Ver resumen"
                  type="button"
                  variant={summaryOpen && !showIncidentPanel ? "primary" : "secondary"}
                >
                  <EyeIcon />
                  <span className="hidden sm:inline">Resumen</span>
                </Button>
                {!readOnly && incidentsAvailable && detail.document.type === "purchase_order" ? (
                  <Button
                    aria-label="Registrar incidencia"
                    aria-pressed={showIncidentPanel}
                    disabled={incidentSaving || saving || (!apiMode && dirty)}
                    onClick={() => {
                      setSelectedIncidentId(null);
                      setIncidentEditorOpen(true);
                    }}
                    title="Registrar incidencia"
                    type="button"
                    variant={showIncidentPanel ? "primary" : "secondary"}
                  >
                    <AlertIcon />
                    <span className="hidden sm:inline">Registrar incidencia</span>
                  </Button>
                ) : null}
              </div>
            </div>
            <ReceivingLinesTable
              detail={detail}
              incidents={incidents}
              lines={lines}
              readOnly={editingDisabled}
              transferReception={transferReception}
              serialPrecheck={serialPrecheck}
              onSerialPrecheck={handleSerialPrecheck}
              onQuantityChange={updateLineQuantity}
              onUpdateLine={updateLine}
            />
          </section>

          <IncidentsSection
            incidents={apiMode ? incidents : incidents.filter((incident) => incident.editable)}
            selectedIncidentId={selectedIncidentId}
            onSelect={(incident) => {
              if (incident.editable && !readOnly) {
                setSelectedIncidentId(incident.id);
                setIncidentEditorOpen(true);
              } else {
                setSelectedHistoricalIncidentId(incident.id);
              }
            }}
          />
        </main>

        {sidePanelOpen ? (
          <>
            <button
              aria-label="Cerrar panel"
              className="fixed inset-0 z-30 bg-black/30 xl:hidden"
              onClick={() => {
                setIncidentEditorOpen(false);
                setSummaryOpen(false);
              }}
              type="button"
            />
            <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-sm overflow-y-auto bg-white p-3 shadow-xl xl:static xl:top-20 xl:z-auto xl:max-h-[calc(100dvh-6rem)] xl:w-auto xl:max-w-none xl:self-start xl:bg-transparent xl:p-0 xl:shadow-none xl:sticky">
              {!showIncidentPanel ? (
                <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-bold text-[var(--color-title)]">Resumen</h2>
                    <button
                      aria-label="Cerrar resumen"
                      className="rounded-md p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-app-background)]"
                      onClick={() => setSummaryOpen(false)}
                      type="button"
                    >
                      <XIcon />
                    </button>
                  </div>
                  <div className="mt-4 space-y-3">
                    <SummaryItem label="Pedido total" value={formatNumber(summary.ordered)} />
                    <SummaryItem
                      label="Aceptado previamente"
                      value={
                        detail.receiptHistoryIncomplete
                          ? "No disponible"
                          : formatNumber(summary.acceptedPreviously)
                      }
                    />
                    <SummaryItem label="Aceptado ahora" value={formatNumber(summary.acceptedNow)} />
                    <SummaryItem
                      label="Con incidencia ahora"
                      value={formatNumber(summary.incidentNow)}
                    />
                    <SummaryItem
                      label="Aceptado acumulado"
                      value={
                        detail.receiptHistoryIncomplete
                          ? "No disponible"
                          : formatNumber(summary.acceptedAccumulated)
                      }
                    />
                    <SummaryItem
                      label="Pendiente despues"
                      value={
                        detail.receiptHistoryIncomplete
                          ? "No disponible"
                          : formatNumber(summary.pendingAfter)
                      }
                    />
                  </div>
                  <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3">
                    <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                      Entrada inventario
                    </p>
                    <p className="mt-1 text-xl font-bold text-[var(--color-title)]">
                      {formatNumber(summary.inventoryEntry)}
                    </p>
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                      unidades base
                    </p>
                  </div>
                </section>
              ) : apiMode ? (
                <ReceivingIncidentEditor
                  formProps={{
                    detail,
                    lines,
                    incidents,
                    lineBlocks: incidentLineBlocks,
                    saving: incidentSaving,
                    onCancel: () => setIncidentEditorOpen(false),
                    onSave: handleCreateApiIncident,
                  }}
                  mode="api"
                />
              ) : (
                <ReceivingIncidentEditor
                  formProps={{
                    detail,
                    incident: selectedIncident,
                    incidents,
                    lines,
                    onCancel: () => {
                      setIncidentEditorOpen(false);
                      setSelectedIncidentId(null);
                    },
                    onDelete: selectedIncident
                      ? () => setDeleteIncidentId(selectedIncident.id)
                      : undefined,
                    onPreview: setPreviewEvidence,
                    onSave: (input) => {
                      saveIncident({ ...input, id: selectedIncident?.id });
                      showToast({
                        title: selectedIncident
                          ? "Incidencia actualizada"
                          : "Incidencia registrada",
                        tone: "success",
                      });
                      setIncidentEditorOpen(false);
                      setSelectedIncidentId(null);
                    },
                  }}
                  key={selectedIncident?.id ?? "new-incident"}
                  mode="local"
                />
              )}
            </aside>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        cancelLabel="Conservar"
        confirmLabel="Quitar incidencia"
        message="La cantidad rechazada se recalculara inmediatamente. El cambio se persistira al guardar avance o confirmar la recepcion."
        open={Boolean(deleteIncidentId)}
        title="¿Quitar esta incidencia?"
        onCancel={() => setDeleteIncidentId(null)}
        onConfirm={() => {
          if (deleteIncidentId) removeIncident(deleteIncidentId);
          setDeleteIncidentId(null);
          setIncidentEditorOpen(false);
          setSelectedIncidentId(null);
          showToast({ title: "Incidencia quitada", tone: "success" });
        }}
      />

      {selectedPreviousReceipt || selectedHistoricalIncident || previewEvidence ? (
        <ReceivingHistoryDialogs
          documentNumber={detail.document.number}
          evidence={previewEvidence}
          incident={selectedHistoricalIncident}
          originName={detail.document.originName}
          receipt={selectedPreviousReceipt}
          resolving={incidentSaving}
          onCloseEvidence={() => setPreviewEvidence(null)}
          onCloseIncident={() => setSelectedHistoricalIncidentId(null)}
          onCloseReceipt={() => setSelectedPreviousReceiptId(null)}
          onPreview={setPreviewEvidence}
          onResolve={
            apiMode && detail.canManageIncidents && selectedHistoricalIncident?.status === "open"
              ? () => startResolveIncident(selectedHistoricalIncident)
              : undefined
          }
          onSelectIncident={(incident) => setSelectedHistoricalIncidentId(incident.id)}
        />
      ) : null}
      {replacementIncident && replacementLine && requiresTracking(replacementLine) ? (
        <ReplacementModal
          key={replacementIncident.id}
          incident={replacementIncident}
          line={replacementLine}
          saving={incidentSaving}
          onClose={() => setReplacementIncidentId(null)}
          onConfirm={(trackingDetails) =>
            handleResolveApiIncident(replacementIncident.id, trackingDetails)
          }
        />
      ) : null}
      <ConfirmDialog
        cancelLabel="Cancelar"
        confirmLabel="Resolver incidencia"
        message={`Se aceptarán ${formatNumber(replacementIncident?.quantityAffected ?? 0)} unidades de reemplazo y la incidencia quedará resuelta.`}
        open={Boolean(
          replacementIncident && (!replacementLine || !requiresTracking(replacementLine)),
        )}
        title="¿Resolver incidencia con reemplazo?"
        onCancel={() => setReplacementIncidentId(null)}
        onConfirm={() => {
          if (replacementIncident) void handleResolveApiIncident(replacementIncident.id);
        }}
      />
    </div>
  );
}

function ReceivingLinesTable({
  detail,
  incidents,
  lines,
  readOnly,
  transferReception,
  serialPrecheck,
  onSerialPrecheck,
  onQuantityChange,
  onUpdateLine,
}: {
  serialPrecheck: Record<string, SerialPrecheckResult>;
  onSerialPrecheck: (lineId: string, result: SerialPrecheckResult) => void;
  detail: NonNullable<ReturnType<typeof useReceivingDocumentDetail>["detail"]>;
  incidents: ReceivingDocumentIncident[];
  lines: ReceivingDocumentLine[];
  readOnly: boolean;
  transferReception: ReturnType<typeof useReceivingDocumentDetail>["transferReception"];
  onQuantityChange: (lineId: string, value: NumericInputValue) => void;
  onUpdateLine: (lineId: string, patch: Partial<ReceivingDocumentLine>) => void;
}) {
  // API: lo afectado por incidencias OPEN no esta pendiente de recibir (esta justificado).
  const pendingFor = (line: ReceivingDocumentLine) =>
    detail.dataSource === "api"
      ? Math.max(0, line.pendingQuantity - getRejectedNow(line, incidents))
      : line.pendingQuantity;
  const lineLocked = (line: ReceivingDocumentLine) =>
    readOnly ||
    Boolean(line.incidentProtected) ||
    Boolean(
      detail.dataSource === "api" &&
      detail.document.type === "transfer" &&
      (transferReception?.traceabilityBlockedLineIds.includes(line.id) ||
        transferReception?.unavailableProductLineIds.includes(line.id) ||
        !line.locationId),
    );
  return (
    <>
      {detail.dataSource === "api"
        ? lines.map((line) => (
            <SerialPrecheckProbe
              key={line.id}
              enabled={!lineLocked(line)}
              line={line}
              onResult={onSerialPrecheck}
            />
          ))
        : null}
      <div className="space-y-3 xl:hidden">
        {lines.map((line) => {
          const acceptedNow = Math.max(0, toFiniteNumber(line.receivedNow));
          const rejectedNow = getRejectedNow(line, incidents);
          const pendingBefore = Math.max(0, line.orderedQuantity - line.acceptedPreviously);
          return (
            <article
              className="space-y-3 rounded-lg border border-[var(--color-border)] bg-white p-3"
              key={line.id}
            >
              <div>
                <p className="font-bold text-[var(--color-title)]">{line.productName}</p>
                <ProtectedLineBadge protectedLine={Boolean(line.incidentProtected)} />
                <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                  SKU {line.sku}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <SmallDescription
                  label="Pedido"
                  value={`${formatNumber(line.orderedQuantity)} ${line.unitName}`}
                />
                <SmallDescription
                  label="Equivalencia"
                  value={`1 ${line.unitName} = ${formatNumber(line.purchaseToBaseFactor)} ${line.baseUnitName}`}
                />
                <SmallDescription
                  label="Total esperado"
                  value={`${formatNumber(line.orderedQuantity * line.purchaseToBaseFactor)} ${line.baseUnitName}`}
                />
                <SmallDescription
                  label="Recibido anteriormente"
                  value={
                    detail.receiptHistoryIncomplete
                      ? "No disponible"
                      : `${formatNumber(line.acceptedPreviously)} ${line.unitName} / ${formatNumber(line.acceptedPreviously * line.purchaseToBaseFactor)} ${line.baseUnitName}`
                  }
                />
                <SmallDescription
                  label="Pendiente"
                  value={
                    detail.receiptHistoryIncomplete
                      ? "No disponible"
                      : `${formatNumber(pendingBefore)} ${line.unitName} / ${formatNumber(pendingBefore * line.purchaseToBaseFactor)} ${line.baseUnitName}`
                  }
                />
                <SmallDescription
                  label="Con incidencia"
                  value={`${formatNumber(rejectedNow)} ${line.unitName}`}
                />
              </dl>
              <Field label={`Aceptado ahora (${line.unitName})`}>
                <QuantityInput
                  disabled={
                    lineLocked(line) ||
                    (detail.document.type === "transfer" && line.tracking.serial)
                  }
                  line={line}
                  enforceMaximum={detail.dataSource === "api"}
                  maximum={Math.max(0, pendingBefore - rejectedNow)}
                  value={line.receivedNow}
                  onChange={(value) => onQuantityChange(line.id, value)}
                />
              </Field>
              <p className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm font-bold text-[var(--color-title)]">
                Entrada al inventario: {formatNumber(acceptedNow * line.purchaseToBaseFactor)}{" "}
                {line.baseUnitName}
              </p>
              {detail.document.type === "transfer" ||
              (detail.capabilities.supportsMultipleLocations && line.tracking.stock) ? (
                <Field label="Ubicacion operativa">
                  <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-title)]">
                    {getReceivingLocationLabel(detail, line)}
                  </p>
                </Field>
              ) : null}
              {detail.document.type === "transfer" ? (
                <TransferTraceabilityFields
                  detail={detail}
                  line={line}
                  readOnly={lineLocked(line)}
                  onUpdateLine={onUpdateLine}
                />
              ) : detail.dataSource === "api" ? (
                <ApiTrackingDetailsEditor
                  line={line}
                  precheck={serialPrecheck[line.id]}
                  readOnly={lineLocked(line)}
                  onUpdateLine={onUpdateLine}
                />
              ) : (
                <TrackingFields
                  capabilities={detail.capabilities}
                  line={line}
                  readOnly={lineLocked(line)}
                  onUpdateLine={onUpdateLine}
                />
              )}
            </article>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[890px] table-fixed border-collapse text-left text-sm">
          <colgroup>
            <col />
            <col className="w-[78px]" />
            <col className="w-[68px]" />
            <col className="w-[96px]" />
            <col className="w-[88px]" />
            <col className="w-[72px]" />
            <col className="w-[155px]" />
            <col className="w-[150px]" />
          </colgroup>
          <thead className="bg-[var(--color-structure)] text-[11px] uppercase text-white">
            <tr>
              <th className="px-2 py-2.5 font-semibold">Producto</th>
              <th className="px-2 py-2.5 font-semibold">Unidad</th>
              <th className="px-2 py-2.5 text-right font-semibold">Pedido</th>
              <th className="px-2 py-2.5 text-right font-semibold">Aceptado ahora</th>
              <th className="px-2 py-2.5 text-right font-semibold">Con incidencia</th>
              <th className="px-2 py-2.5 text-right font-semibold">Pendiente</th>
              <th className="px-2 py-2.5 font-semibold">Ubicacion</th>
              <th className="px-2 py-2.5 font-semibold">Trazabilidad</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const wideTracking =
                detail.dataSource === "api" &&
                detail.document.type === "purchase_order" &&
                (line.tracking.lot || line.tracking.serial);
              return (
                <Fragment key={line.id}>
                  <tr className="border-t border-[var(--color-border)] align-top">
                    <td className="px-2 py-2.5">
                      <p
                        className="line-clamp-2 break-words font-bold leading-5 text-[var(--color-title)]"
                        title={line.productName}
                      >
                        {line.productName}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">
                        {line.sku}
                      </p>
                      <ProtectedLineBadge protectedLine={Boolean(line.incidentProtected)} />
                    </td>
                    <td className="px-2 py-2.5 font-semibold text-[var(--color-text)]">
                      {line.unitName}
                      <span className="mt-1 block text-[10px] font-medium text-[var(--color-text-muted)]">
                        1 = {formatNumber(line.purchaseToBaseFactor)} {line.baseUnitName}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-bold text-[var(--color-title)]">
                      {formatNumber(line.orderedQuantity)}
                      <span className="block text-[10px] font-medium text-[var(--color-text-muted)]">
                        Total {formatNumber(line.orderedQuantity * line.purchaseToBaseFactor)}{" "}
                        {line.baseUnitName}
                      </span>
                      <span className="block text-[10px] font-medium text-[var(--color-text-muted)]">
                        {detail.receiptHistoryIncomplete ? (
                          "Previo no disponible"
                        ) : (
                          <>
                            Previo {formatNumber(line.acceptedPreviously)} /{" "}
                            {formatNumber(line.acceptedPreviously * line.purchaseToBaseFactor)} base
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <QuantityInput
                        disabled={
                          lineLocked(line) ||
                          (detail.document.type === "transfer" && line.tracking.serial)
                        }
                        line={line}
                        enforceMaximum={detail.dataSource === "api"}
                        maximum={Math.max(
                          0,
                          line.orderedQuantity -
                            line.acceptedPreviously -
                            getRejectedNow(line, incidents),
                        )}
                        value={line.receivedNow}
                        onChange={(value) => onQuantityChange(line.id, value)}
                      />
                      <span className="mt-1 block text-right text-[10px] font-semibold text-[var(--color-text-muted)]">
                        Inventario:{" "}
                        {formatNumber(
                          Math.max(0, toFiniteNumber(line.receivedNow)) * line.purchaseToBaseFactor,
                        )}{" "}
                        {line.baseUnitName}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span className="inline-flex min-h-9 min-w-12 items-center justify-end rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-2 font-bold text-[var(--color-title)]">
                        {formatNumber(getRejectedNow(line, incidents))}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-bold text-[var(--color-title)]">
                      {detail.receiptHistoryIncomplete ? (
                        "No disponible"
                      ) : (
                        <>
                          {formatNumber(pendingFor(line))}
                          <span className="block text-[10px] font-medium text-[var(--color-text-muted)]">
                            {formatNumber(pendingFor(line) * line.purchaseToBaseFactor)}{" "}
                            {line.baseUnitName}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {detail.document.type === "transfer" ||
                      (detail.capabilities.supportsMultipleLocations && line.tracking.stock) ? (
                        <MutedText>{getReceivingLocationLabel(detail, line)}</MutedText>
                      ) : (
                        <MutedText>No requerido</MutedText>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {detail.document.type === "transfer" ? (
                        <TransferTraceabilityFields
                          detail={detail}
                          line={line}
                          readOnly={lineLocked(line)}
                          onUpdateLine={onUpdateLine}
                        />
                      ) : detail.dataSource === "api" ? (
                        wideTracking ? (
                          <TrackingSummary line={line} />
                        ) : (
                          <MutedText>No requerido</MutedText>
                        )
                      ) : (
                        <TrackingFields
                          capabilities={detail.capabilities}
                          line={line}
                          readOnly={lineLocked(line)}
                          onUpdateLine={onUpdateLine}
                        />
                      )}
                    </td>
                  </tr>
                  {wideTracking ? (
                    <tr className="bg-[var(--color-app-background)]/60">
                      <td className="px-3 pb-3 pt-1" colSpan={8}>
                        <p className="mb-1 text-xs font-bold uppercase text-[var(--color-text-muted)]">
                          Trazabilidad · {line.productName}
                        </p>
                        <ApiTrackingDetailsEditor
                          line={line}
                          precheck={serialPrecheck[line.id]}
                          readOnly={lineLocked(line)}
                          onUpdateLine={onUpdateLine}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TrackingSummary({ line }: { line: ReceivingDocumentLine }) {
  const assigned = line.trackingDetails.reduce(
    (sum, detail) => sum + toFiniteNumber(detail.baseQuantity),
    0,
  );
  const expected = Math.max(0, toFiniteNumber(line.receivedNow) * line.purchaseToBaseFactor);
  const serialCount = getLineSerials(line).length;
  return (
    <div className="space-y-0.5 text-xs font-semibold text-[var(--color-text)]">
      <p>
        {[
          line.tracking.lot ? "Lote" : null,
          line.tracking.expiration ? "Vencimiento" : null,
          line.tracking.serial ? "Series" : null,
        ]
          .filter(Boolean)
          .join(" / ")}
      </p>
      <p className="text-[var(--color-text-muted)]">
        {formatNumber(assigned)} / {formatNumber(expected)} asignadas
        {line.tracking.serial ? ` · ${serialCount} series` : ""}
      </p>
    </div>
  );
}

function ProtectedLineBadge({ protectedLine }: { protectedLine: boolean }) {
  if (!protectedLine) return null;
  return (
    <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
      Protegida por incidencia
    </span>
  );
}

function QuantityInput({
  disabled,
  enforceMaximum = false,
  line,
  maximum,
  value,
  onChange,
}: {
  disabled: boolean;
  /** API: nunca se guarda un valor superior al maximo (expresado en la unidad de compra). */
  enforceMaximum?: boolean;
  line: ReceivingDocumentLine;
  maximum: number;
  value: NumericInputValue;
  onChange: (value: NumericInputValue) => void;
}) {
  const reachedMaximum = enforceMaximum && toFiniteNumber(value) >= maximum;
  return (
    <>
      <Input
        aria-label={`Cantidad, maximo ${maximum}`}
        className="min-w-0 px-2 text-right font-semibold"
        disabled={disabled}
        inputMode={line.unitAllowsDecimals ? "decimal" : "numeric"}
        maxLength={12}
        onChange={(event) => {
          const parsed = parseUnitQuantityInput(event.target.value, line.unitAllowsDecimals);
          // Un valor por encima del maximo se recorta en vez de guardarse como invalido.
          onChange(
            enforceMaximum && typeof parsed === "number" && parsed > maximum ? maximum : parsed,
          );
        }}
        type="text"
        value={value}
      />
      {reachedMaximum ? (
        <span className="mt-1 block text-right text-[10px] font-semibold text-[var(--color-text-muted)]">
          Máximo: {formatNumber(maximum)}
        </span>
      ) : null}
    </>
  );
}

function TransferTraceabilityFields({
  detail,
  line,
  readOnly,
  onUpdateLine,
}: {
  detail: NonNullable<ReturnType<typeof useReceivingDocumentDetail>["detail"]>;
  line: ReceivingDocumentLine;
  readOnly: boolean;
  onUpdateLine: (lineId: string, patch: Partial<ReceivingDocumentLine>) => void;
}) {
  if (detail.dataSource === "api" && (line.tracking.lot || line.tracking.serial)) {
    return (
      <MutedText>
        Bloqueado: el Backend todavía no expone las selecciones físicas despachadas.
      </MutedText>
    );
  }
  const available =
    detail.lines
      .find((entry) => entry.id === line.id)
      ?.serialNumbersText.split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const selected =
    toFiniteNumber(line.receivedNow) > 0
      ? line.serialNumbersText
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  function toggle(serial: string) {
    const next = selected.includes(serial)
      ? selected.filter((value) => value !== serial)
      : [...selected, serial];
    onUpdateLine(line.id, { serialNumbersText: next.join("\n"), receivedNow: next.length });
  }
  return (
    <div className="space-y-1 text-xs text-[var(--color-text)]">
      {line.lotNumber ? <p>Lote: {line.lotNumber}</p> : null}
      {line.expirationDate ? <p>Vence: {line.expirationDate}</p> : null}
      {line.tracking.serial ? (
        <div className="space-y-1">
          <p className="font-semibold">
            {readOnly ? "Series despachadas:" : "Series pendientes del despacho:"}
          </p>
          {available.length ? (
            available.map((serial) =>
              readOnly ? (
                <p key={serial}>{serial}</p>
              ) : (
                <label className="flex items-center gap-2" key={serial}>
                  <input
                    checked={selected.includes(serial)}
                    onChange={() => toggle(serial)}
                    type="checkbox"
                  />
                  <span>{serial}</span>
                </label>
              ),
            )
          ) : (
            <MutedText>Sin series pendientes</MutedText>
          )}
        </div>
      ) : !line.lotNumber ? (
        <MutedText>Sin trazabilidad requerida</MutedText>
      ) : null}
    </div>
  );
}

function getLineSerials(line: ReceivingDocumentLine) {
  return line.trackingDetails.flatMap((detail) => parseSerialNumbers(detail.serialNumbersText));
}

/** Una sola request batch por linea serializada (no por celda ni por tecla). */
function SerialPrecheckProbe({
  line,
  enabled,
  onResult,
}: {
  line: ReceivingDocumentLine;
  enabled: boolean;
  onResult: (lineId: string, result: SerialPrecheckResult) => void;
}) {
  const { remoteDuplicates, unavailable } = useSerialPrecheck({
    productId: line.productId,
    serials: getLineSerials(line),
    enabled: enabled && line.tracking.serial,
  });
  const duplicatesKey = remoteDuplicates.join("\u0000");
  useEffect(() => {
    onResult(line.id, {
      duplicates: duplicatesKey ? duplicatesKey.split("\u0000") : [],
      unavailable,
    });
  }, [duplicatesKey, line.id, onResult, unavailable]);
  return null;
}

function ApiTrackingDetailsEditor({
  line,
  precheck,
  readOnly,
  onUpdateLine,
}: {
  precheck?: SerialPrecheckResult;
  line: ReceivingDocumentLine;
  readOnly: boolean;
  onUpdateLine: (lineId: string, patch: Partial<ReceivingDocumentLine>) => void;
}) {
  if (!line.tracking.lot && !line.tracking.serial) {
    return <MutedText>No requerido</MutedText>;
  }
  const updateDetail = (detailId: string, patch: Partial<ReceivingTrackingDetail>) => {
    onUpdateLine(line.id, {
      trackingDetails: line.trackingDetails.map((detail) =>
        detail.id === detailId ? { ...detail, ...patch } : detail,
      ),
    });
  };
  const expectedBaseQuantity = Math.max(
    0,
    toFiniteNumber(line.receivedNow) * line.purchaseToBaseFactor,
  );
  const registeredBaseQuantity = line.trackingDetails.reduce(
    (sum, detail) => sum + toFiniteNumber(detail.baseQuantity),
    0,
  );
  const addDetail = () => {
    const remainingBase = Number((expectedBaseQuantity - registeredBaseQuantity).toFixed(6));
    onUpdateLine(line.id, {
      trackingDetails: [
        ...line.trackingDetails,
        {
          id: crypto.randomUUID(),
          baseQuantity: remainingBase > 0 ? remainingBase : "",
          lotNumber: "",
          expirationDate: "",
          serialNumbersText: "",
        },
      ],
    });
  };

  const repeatedSerials = findRepeatedSerials(getLineSerials(line));
  return (
    <div className="space-y-2">
      {precheck?.unavailable ? (
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">
          No se pudo validar los seriales en este momento; se validarán al guardar.
        </p>
      ) : null}
      <p className="text-xs font-semibold text-[var(--color-text)]">
        Base asignada: {formatNumber(registeredBaseQuantity)} / {formatNumber(expectedBaseQuantity)}{" "}
        {line.baseUnitName}
      </p>
      {line.trackingDetails.map((detail, index) => {
        const serialCount = detail.serialNumbersText
          .split(/\r?\n|,/)
          .map((serial) => serial.trim())
          .filter(Boolean).length;
        const operationDate = getLocalCalendarDate();
        const detailSerials = parseSerialNumbers(detail.serialNumbersText);
        const detailRepeated = detailSerials.filter((serial) => repeatedSerials.includes(serial));
        const detailRemote = detailSerials.filter((serial) =>
          (precheck?.duplicates ?? []).includes(serial),
        );
        return (
          <div
            className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-2"
            key={detail.id}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-[var(--color-title)]">Detalle {index + 1}</p>
              {!readOnly ? (
                <button
                  aria-label={`Quitar detalle ${index + 1}`}
                  className="rounded p-1 text-[var(--color-danger)] hover:bg-red-50"
                  onClick={() =>
                    onUpdateLine(line.id, {
                      trackingDetails: line.trackingDetails.filter(
                        (candidate) => candidate.id !== detail.id,
                      ),
                    })
                  }
                  type="button"
                >
                  <TrashIcon />
                </button>
              ) : null}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <Input
                aria-label={`Cantidad base del detalle ${index + 1}`}
                className="h-9 px-2 text-xs"
                disabled={readOnly}
                inputMode={
                  line.baseUnitAllowsDecimals && !line.tracking.serial ? "decimal" : "numeric"
                }
                maxLength={12}
                onChange={(event) =>
                  updateDetail(detail.id, {
                    baseQuantity: parseUnitQuantityInput(
                      event.target.value,
                      line.baseUnitAllowsDecimals && !line.tracking.serial,
                    ),
                  })
                }
                placeholder={`Cantidad en ${line.baseUnitName}`}
                type="text"
                value={detail.baseQuantity}
              />
              {line.tracking.lot ? (
                <Input
                  aria-label={`Lote del detalle ${index + 1}`}
                  className="h-9 px-2 text-xs"
                  disabled={readOnly}
                  maxLength={TEXT_LIMITS.lotNumber}
                  onChange={(event) => updateDetail(detail.id, { lotNumber: event.target.value })}
                  placeholder="Número de lote"
                  value={detail.lotNumber}
                />
              ) : null}
              {line.tracking.expiration ? (
                <Input
                  aria-label={`Vencimiento del detalle ${index + 1}`}
                  className="h-9 px-2 text-xs"
                  disabled={readOnly}
                  min={operationDate}
                  onChange={(event) =>
                    updateDetail(detail.id, { expirationDate: event.target.value })
                  }
                  type="date"
                  value={detail.expirationDate}
                />
              ) : null}
            </div>
            {line.tracking.serial ? (
              <div className="space-y-1">
                <textarea
                  aria-label={`Series del detalle ${index + 1}`}
                  className="min-h-20 w-full resize-y rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs text-[var(--color-text)] outline-none transition focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={readOnly}
                  maxLength={TEXT_LIMITS.serialNumbers}
                  onChange={(event) =>
                    updateDetail(detail.id, { serialNumbersText: event.target.value })
                  }
                  placeholder="Una serie por línea"
                  value={detail.serialNumbersText}
                />
                <MutedText>{serialCount} series registradas</MutedText>
                {detailRepeated.length > 0 ? (
                  <p className="text-xs font-semibold text-[var(--color-danger)]">
                    Seriales repetidos: {detailRepeated.join(", ")}
                  </p>
                ) : null}
                {detailRemote.length > 0 ? (
                  <p className="text-xs font-semibold text-[var(--color-danger)]">
                    Seriales ya registrados: {detailRemote.join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {!readOnly ? (
        <Button
          className="w-full justify-center px-2"
          onClick={addDetail}
          type="button"
          variant="ghost"
        >
          Agregar detalle
        </Button>
      ) : null}
    </div>
  );
}

function TrackingFields({
  capabilities,
  line,
  readOnly,
  onUpdateLine,
}: {
  capabilities: NonNullable<
    ReturnType<typeof useReceivingDocumentDetail>["detail"]
  >["capabilities"];
  line: ReceivingDocumentLine;
  readOnly: boolean;
  onUpdateLine: (lineId: string, patch: Partial<ReceivingDocumentLine>) => void;
}) {
  const fields = [];
  if (line.tracking.lot && capabilities.supportsLots) {
    fields.push(
      <Input
        disabled={readOnly}
        key="lot"
        className="h-9 px-2 text-xs"
        maxLength={TEXT_LIMITS.lotNumber}
        onChange={(event) => onUpdateLine(line.id, { lotNumber: event.target.value })}
        placeholder="Lote"
        value={line.lotNumber}
      />,
    );
  }
  if (line.tracking.expiration && capabilities.supportsExpiration) {
    const operationDate = getLocalCalendarDate();
    const expirationIsBeforeEntry =
      line.expirationDate && isExpirationBeforeOperationDate(line.expirationDate, operationDate);
    fields.push(
      <div key="expiration" className="space-y-1">
        <Input
          disabled={readOnly}
          className="h-9 px-2 text-xs"
          min={operationDate}
          onChange={(event) => onUpdateLine(line.id, { expirationDate: event.target.value })}
          type="date"
          value={line.expirationDate}
        />
        {expirationIsBeforeEntry ? (
          <p className="text-xs font-semibold text-[var(--color-danger)]">
            {EXPIRATION_BEFORE_ENTRY_MESSAGE}
          </p>
        ) : null}
      </div>,
    );
  }
  if (line.tracking.serial && capabilities.supportsSerials) {
    const serialCount = line.serialNumbersText
      .split(/\r?\n/)
      .map((serial) => serial.trim())
      .filter(Boolean).length;
    const requiredSerials =
      Math.max(0, toFiniteNumber(line.receivedNow)) * line.purchaseToBaseFactor;
    fields.push(
      <div key="serial" className="space-y-1">
        <p className="text-xs font-bold text-[var(--color-title)]">
          Entrada al inventario: {formatNumber(requiredSerials)} {line.baseUnitName}
        </p>
        <p className="text-xs font-semibold text-[var(--color-text)]">
          Se requieren {formatNumber(requiredSerials)} numeros de serie
        </p>
        <textarea
          className="min-h-16 w-full resize-y rounded-md border border-[var(--color-border)] bg-white px-2 py-1.5 text-xs text-[var(--color-text)] outline-none transition focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={readOnly}
          maxLength={TEXT_LIMITS.serialNumbers}
          onChange={(event) => onUpdateLine(line.id, { serialNumbersText: event.target.value })}
          placeholder="Serie por linea"
          value={line.serialNumbersText}
        />
        <MutedText>
          {serialCount} / {requiredSerials} registrados
        </MutedText>
      </div>,
    );
  }
  if (fields.length === 0) return <MutedText>No requerido</MutedText>;
  return <div className="space-y-2">{fields}</div>;
}

function IncidentsSection({
  incidents,
  selectedIncidentId,
  onSelect,
}: {
  incidents: ReceivingDocumentIncident[];
  selectedIncidentId: string | null;
  onSelect: (incident: ReceivingDocumentIncident) => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <h2 className="text-base font-bold text-[var(--color-title)]">
        Incidencias de la recepcion actual
      </h2>
      {incidents.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-4 py-6 text-center text-sm font-medium text-[var(--color-text-muted)]">
          Todavia no hay incidencias registradas.
        </p>
      ) : (
        <div
          className={cn(
            "mt-3 grid gap-3",
            incidents.length >= 2 && "md:grid-cols-2",
            incidents.length >= 3 && "xl:grid-cols-3",
          )}
        >
          {incidents.map((incident) => (
            <button
              aria-pressed={incident.id === selectedIncidentId}
              className={cn(
                "h-full w-full rounded-md border p-3 text-left transition",
                incident.id === selectedIncidentId
                  ? "border-[var(--color-primary)] bg-blue-50 ring-2 ring-[var(--color-primary)]/20"
                  : "border-[var(--color-border)] bg-white",
                incident.editable
                  ? "cursor-pointer hover:border-[var(--color-primary)]"
                  : "cursor-pointer hover:border-[var(--color-primary)]",
              )}
              key={incident.id}
              onClick={() => onSelect(incident)}
              type="button"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-[var(--color-title)]">{incident.productName}</p>
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    {incident.incidentTypeName}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)]">
                  {incident.editable ? <PencilIcon /> : null}
                  {incident.status ? (
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-bold",
                        incident.status === "open"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-800",
                      )}
                    >
                      {incident.status === "open" ? "Abierta" : "Resuelta"}
                    </span>
                  ) : null}
                  {formatDate(incident.createdAt)}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--color-text)]">{incident.description}</p>
              <p className="mt-2 text-xs font-bold uppercase text-[var(--color-text-muted)]">
                {incident.quantityAffected === undefined
                  ? "Incidencia general"
                  : `${formatNumber(incident.quantityAffected)} afectadas`}
                {incident.evidence.length > 0
                  ? ` - ${incident.evidence.length} ${incident.evidence.length === 1 ? "evidencia" : "evidencias"}`
                  : null}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PreviousReceiptsSection({
  documentNumber,
  expanded,
  receipts,
  onSelect,
  onToggle,
}: {
  documentNumber: string;
  expanded: boolean;
  receipts: ReceivingPreviousReceipt[];
  onSelect: (receipt: ReceivingPreviousReceipt) => void;
  onToggle: () => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-structure)]"
        onClick={onToggle}
        type="button"
      >
        <span>
          <span className="block text-base font-bold text-[var(--color-title)]">
            Historial de recepcion de {documentNumber}
          </span>
          <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
            Confirmaciones anteriores asociadas a esta orden de compra.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-sm font-bold text-[var(--color-title)]">
          {receipts.length} {receipts.length === 1 ? "recepcion" : "recepciones"}
          <ChevronIcon className={cn("transition-transform", expanded && "rotate-180")} />
        </span>
      </button>
      {expanded ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {receipts.map((receipt) => (
            <article
              className="rounded-md border border-[var(--color-border)] p-3"
              key={receipt.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                    {getReceiptSequenceLabel(receipt.sequenceNumber)}
                  </p>
                  <p className="font-bold text-[var(--color-title)]">{receipt.orderNumber}</p>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                    {receipt.number} · {formatDateTime(receipt.receivedAt)}
                  </p>
                </div>
                <Button
                  className="min-h-8 px-2 py-1"
                  onClick={() => onSelect(receipt)}
                  type="button"
                  variant="ghost"
                >
                  <EyeIcon />
                  Ver detalle
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--color-text)]">
                <span>{receipt.responsibleName}</span>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-[var(--color-title)]">
                  {receipt.statusLabel}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <DetailItem label="Aceptadas" value={formatNumber(receipt.acceptedQuantity)} />
                <DetailItem label="Incidencias" value={formatNumber(receipt.incidentQuantity)} />
                <DetailItem label="Pendiente despues" value={formatNumber(receipt.pendingAfter)} />
              </dl>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function requiresTracking(line: ReceivingDocumentLine) {
  return line.tracking.lot || line.tracking.expiration || line.tracking.serial;
}

function ReplacementModal({
  incident,
  line,
  saving,
  onClose,
  onConfirm,
}: {
  incident: ReceivingDocumentIncident;
  line: ReceivingDocumentLine;
  saving: boolean;
  onClose: () => void;
  onConfirm: (trackingDetails: ReceiptDraftTrackingDetailInput[]) => Promise<void>;
}) {
  const quantity = incident.quantityAffected ?? 0;
  // Cantidad fija = mercancia afectada; la conversion a base usa el factor existente una sola vez.
  const baseQuantity = Number(toBaseQuantity(line, quantity).toFixed(6));
  const [lotNumber, setLotNumber] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [serialsText, setSerialsText] = useState("");
  const serials = parseSerialNumbers(serialsText);
  const repeated = findRepeatedSerials(serials);
  const existing = new Set(getLineSerials(line));
  const alreadyInReceipt = serials.filter((serial) => existing.has(serial));
  const precheck = useSerialPrecheck({
    productId: line.productId,
    serials,
    enabled: line.tracking.serial,
  });
  const operationDate = getLocalCalendarDate();
  const errors: string[] = [];
  if (line.tracking.lot && !lotNumber.trim()) errors.push("Ingresa el número de lote.");
  if (line.tracking.expiration) {
    if (!expirationDate) errors.push("Ingresa la fecha de vencimiento.");
    else if (isExpirationBeforeOperationDate(expirationDate, operationDate)) {
      errors.push(EXPIRATION_BEFORE_ENTRY_MESSAGE);
    }
  }
  if (line.tracking.serial) {
    if (!Number.isInteger(baseQuantity) || serials.length !== baseQuantity) {
      errors.push(
        `Ingresa exactamente ${formatNumber(baseQuantity)} números de serie (tienes ${serials.length}).`,
      );
    }
    if (repeated.length > 0) errors.push(`Seriales repetidos: ${repeated.join(", ")}.`);
    if (alreadyInReceipt.length > 0) {
      errors.push(`Seriales ya incluidos en esta recepción: ${alreadyInReceipt.join(", ")}.`);
    }
    if (precheck.remoteDuplicates.length > 0) {
      errors.push(`Seriales ya registrados: ${precheck.remoteDuplicates.join(", ")}.`);
    }
  }
  const invalid = errors.length > 0 || precheck.checking;

  async function handleConfirm() {
    if (invalid) return;
    await onConfirm([
      {
        baseQuantity,
        ...(line.tracking.lot ? { lotNumber: lotNumber.trim() } : {}),
        ...(line.tracking.expiration ? { expirationDate } : {}),
        serialNumbers: line.tracking.serial ? serials : [],
      },
    ]);
  }

  return (
    <Modal
      open
      title="Registrar reemplazo"
      subtitle={incident.productName}
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-3">
        <dl className="grid gap-3 sm:grid-cols-2">
          <DetailItem label="Producto" value={`${incident.productName} (${incident.sku})`} />
          <DetailItem
            label="Cantidad a reemplazar"
            value={`${formatNumber(quantity)} ${line.unitName}`}
          />
        </dl>
        {line.tracking.lot ? (
          <Field label="Lote">
            <Input
              disabled={saving}
              maxLength={TEXT_LIMITS.lotNumber}
              onChange={(event) => setLotNumber(event.target.value)}
              value={lotNumber}
            />
          </Field>
        ) : null}
        {line.tracking.expiration ? (
          <Field label="Vencimiento">
            <Input
              disabled={saving}
              min={operationDate}
              onChange={(event) => setExpirationDate(event.target.value)}
              type="date"
              value={expirationDate}
            />
          </Field>
        ) : null}
        {line.tracking.serial ? (
          <Field label={`Números de serie (${serials.length} / ${formatNumber(baseQuantity)})`}>
            <textarea
              className="min-h-24 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              maxLength={TEXT_LIMITS.serialNumbers}
              onChange={(event) => setSerialsText(event.target.value)}
              placeholder="Una serie por línea"
              value={serialsText}
            />
            {precheck.unavailable ? (
              <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                No se pudo validar los seriales en este momento; se validarán al resolver.
              </p>
            ) : null}
          </Field>
        ) : null}
        {errors.length > 0 ? (
          <ul className="space-y-1 text-xs font-semibold text-[var(--color-danger)]">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-3">
          <Button disabled={saving} onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={saving || invalid} onClick={() => void handleConfirm()} type="button">
            <CheckIcon />
            Resolver con reemplazo
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase text-[var(--color-text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function DeferredPanel({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-white p-4 text-sm font-semibold text-[var(--color-text-muted)]">
      {label}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-[var(--color-title)]">{value}</p>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-2">
      <p className="text-sm font-semibold text-[var(--color-text)]">{label}</p>
      <p className="font-bold text-[var(--color-title)]">{value}</p>
    </div>
  );
}

function MutedText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-semibold text-[var(--color-text-muted)]">{children}</p>;
}

function getReceivingLocationLabel(
  detail: { locations: Array<{ id: string; code: string; name: string }> },
  line: Pick<ReceivingDocumentLine, "locationId" | "staleSavedLocationId">,
) {
  const location = detail.locations.find((candidate) => candidate.id === line.locationId);
  const label = location ? `${location.code} - ${location.name}` : "Sin ubicacion operativa activa";
  // El borrador guardaba otra ubicacion: se avisa y se corrige al guardar, sin perder la captura.
  return line.staleSavedLocationId
    ? `${label} (el borrador tenia otra ubicacion; se corregira al guardar)`
    : label;
}

function SmallDescription({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function getSummary(
  lines: ReceivingDocumentLine[],
  incidents: ReceivingDocumentIncident[],
  subtractIncidentsFromPending: boolean,
) {
  return lines.reduce(
    (summary, line) => {
      const acceptedNow = getAcceptedNow(line);
      const incidentNow = getRejectedNow(line, incidents);
      summary.ordered += line.orderedQuantity;
      summary.acceptedPreviously += line.acceptedPreviously;
      summary.acceptedNow += acceptedNow;
      summary.incidentNow += incidentNow;
      summary.acceptedAccumulated += line.acceptedPreviously + acceptedNow;
      summary.pendingAfter += subtractIncidentsFromPending
        ? Math.max(0, line.pendingQuantity - incidentNow)
        : line.pendingQuantity;
      if (line.tracking.stock) summary.inventoryEntry += toBaseQuantity(line, acceptedNow);
      return summary;
    },
    {
      ordered: 0,
      acceptedPreviously: 0,
      acceptedNow: 0,
      incidentNow: 0,
      acceptedAccumulated: 0,
      pendingAfter: 0,
      inventoryEntry: 0,
    },
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getReceiptSequenceLabel(sequenceNumber: number) {
  if (sequenceNumber === 1) return "Primera recepcion";
  if (sequenceNumber === 2) return "Segunda recepcion";
  return `Recepcion ${sequenceNumber}`;
}

function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-4 w-4 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

function AlertIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

function ArrowLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </Icon>
  );
}

function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m20 6-11 11-5-5" />
    </Icon>
  );
}

function SaveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </Icon>
  );
}

function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  );
}

function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </Icon>
  );
}

function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

function ChevronIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
