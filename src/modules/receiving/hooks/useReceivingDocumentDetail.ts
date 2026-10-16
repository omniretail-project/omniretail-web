"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReceiptIncidentEvidence } from "@/core/entities";
import type { ReceiptDraftTrackingDetailInput } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  CreateReceivingIncidentInput,
  ReceivingDocumentDetail,
  ReceivingDocumentIncident,
  ReceivingDocumentDetailType,
  ReceivingDocumentLine,
  ReceivingTrackingDetail,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { PurchaseOrderPdfService } from "@/modules/purchasing/application/services/PurchaseOrderPdfService";
import {
  hasStaleLocationToPersist,
  resolveApiTransferSelection,
  ReceivingDocumentDetailService,
} from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import {
  canDiscardReceivingConfirmation,
} from "@/modules/receiving/hooks/receivingRequestIdentity";
import type {
  PendingTransferReceptionLookup,
  TransferReceptionOperationPayload,
  TransferReceptionOperationScope,
} from "@/modules/receiving/application/services/pendingTransferReception";
import { useReceivingMutationCoordinator } from "@/modules/receiving/providers/ReceivingMutationCoordinatorProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import { toFiniteNumber, type NumericInputValue } from "@/shared/utils/numberInput";

export function useReceivingDocumentDetail(
  documentType: ReceivingDocumentDetailType,
  documentId: string,
) {
  const repositories = useRepositories();
  const apiMode = repositories.receivingDataSource === "api";
  const { sessionId, user } = useCurrentSession();
  const mutationCoordinator = useReceivingMutationCoordinator();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const activeBranchId = currentBranch?.id;
  const contextKey = `${sessionId ?? ""}:${user?.id ?? ""}:${user?.tenantId ?? ""}:${activeBranchId ?? ""}:${documentType}:${documentId}`;
  const transferOperationScope = useMemo<TransferReceptionOperationScope | null>(
    () => apiMode && documentType === "transfer" && sessionId && user && activeBranchId
      ? {
          sessionId,
          userId: user.id,
          tenantId: user.tenantId,
          branchId: activeBranchId,
          documentType: "transfer",
          documentId,
        }
      : null,
    [activeBranchId, apiMode, documentId, documentType, sessionId, user],
  );
  const service = useMemo(() => new ReceivingDocumentDetailService(repositories), [repositories]);
  const [detail, setDetail] = useState<ReceivingDocumentDetail | null>(null);
  const [lines, setLines] = useState<ReceivingDocumentLine[]>([]);
  const [incidents, setIncidents] = useState<ReceivingDocumentIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationId, setConfirmationId] = useState(() => crypto.randomUUID());
  const [pendingTransferLookup, setPendingTransferLookup] =
    useState<PendingTransferReceptionLookup>({ status: "empty" });
  const [renderedContextKey, setRenderedContextKey] = useState(contextKey);
  const requestIdRef = useRef(0);
  const activeBranchIdRef = useRef(activeBranchId);
  const contextKeyRef = useRef(contextKey);
  const dirtyRef = useRef(false);
  const mutationPendingRef = useRef(false);
  const incidentMutationPendingRef = useRef(false);

  const updateDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  if (renderedContextKey !== contextKey) {
    setRenderedContextKey(contextKey);
    setDetail(null);
    setLines([]);
    setIncidents([]);
    setError(null);
    setLoading(true);
    setDirty(false);
    setPendingTransferLookup({ status: "empty" });
  }

  useLayoutEffect(() => {
    contextKeyRef.current = contextKey;
    activeBranchIdRef.current = activeBranchId;
    requestIdRef.current += 1;
    dirtyRef.current = false;
  }, [activeBranchId, contextKey]);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const requestedContextKey = contextKey;
    if (!activeBranchId) {
      setDetail(null);
      setLines([]);
      setIncidents([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextDetail = await service.getDocument(documentType, documentId, activeBranchId);
      if (requestId !== requestIdRef.current || requestedContextKey !== contextKeyRef.current) return;
      setDetail(nextDetail);
      const pendingLookup = transferOperationScope
        ? mutationCoordinator.lookupTransferConfirmation(transferOperationScope)
        : { status: "empty" as const };
      setPendingTransferLookup(pendingLookup);
      setLines(
        pendingLookup.status === "owned"
          ? restorePendingTransferSelection(nextDetail.lines, pendingLookup.record.payload)
          : nextDetail.lines,
      );
      setIncidents(nextDetail.incidents);
      // Un borrador API con ubicacion obsoleta ya no coincide con lo mostrado: queda pendiente de
      // guardar (el servicio lo persiste antes de confirmar). Si esta bloqueado por incidencias
      // no puede guardarse, asi que no se marca y la confirmacion informa el motivo.
      updateDirty(
        repositories.receivingDataSource === "api" &&
          !nextDetail.draftEditingLocked &&
          hasStaleLocationToPersist(nextDetail, nextDetail.lines),
      );
    } catch (caughtError) {
      if (requestId !== requestIdRef.current || requestedContextKey !== contextKeyRef.current) return;
      setError(caughtError instanceof Error ? caughtError.message : "No se pudo cargar.");
    } finally {
      if (requestId === requestIdRef.current && requestedContextKey === contextKeyRef.current) {
        setLoading(false);
      }
    }
  }, [
    activeBranchId,
    contextKey,
    documentId,
    documentType,
    mutationCoordinator,
    repositories,
    service,
    transferOperationScope,
    updateDirty,
  ]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  const reloadFromEvent = useCallback(async () => {
    if (dirtyRef.current || mutationPendingRef.current || incidentMutationPendingRef.current)
      return;
    await reload();
  }, [reload]);

  useDataEvent("receipt.changed", reloadFromEvent);
  useDataEvent("purchase-order.changed", reloadFromEvent);
  useDataEvent("inventory.changed", reloadFromEvent);
  useDataEvent("stock.changed", reloadFromEvent);
  useDataEvent("incident-type.changed", reloadFromEvent);
  useDataEvent("unit-conversion.changed", reloadFromEvent);
  useDataEvent("supplier-product.changed", reloadFromEvent);
  useDataEvent("business-config.changed", reloadFromEvent);

  const updateLine = useCallback(
    (lineId: string, patch: Partial<ReceivingDocumentLine>) => {
      updateDirty(true);
      setLines((current) =>
        current.map((line) =>
          // Una linea con incidencia (abierta o resuelta) queda inmutable: el backend la conserva.
          line.id === lineId && !line.incidentProtected
            ? recalculateLine({ ...line, ...patch })
            : line,
        ),
      );
    },
    [updateDirty],
  );

  const transferReception = useMemo(() => {
    const base = detail?.transferReception;
    if (!base || detail.dataSource !== "api" || detail.document.type !== "transfer") return base;
    return resolveApiTransferSelection({
      lines,
      canReceiveTransfer: base.canReceiveTransfer,
      activeLocationById: new Map(
        detail.locations.map((location) => [location.id, location]),
      ),
      unavailableProductLineIds: base.unavailableProductLineIds,
      traceabilityBlockedLineIds: base.traceabilityBlockedLineIds,
      unavailableReason: base.blockingReason,
    });
  }, [detail, lines]);
  const selectedTransferItems = useMemo(
    () => lines
      .filter((line) => toFiniteNumber(line.receivedNow) > 0)
      .map((line) => ({
        itemId: line.sourceLineId,
        productId: line.productId,
        receivedQuantity: toFiniteNumber(line.receivedNow),
      })),
    [lines],
  );
  const ownedPendingTransfer = pendingTransferLookup.status === "owned"
    ? pendingTransferLookup.record
    : null;
  const pendingTransferSelectionMatches = Boolean(
    ownedPendingTransfer &&
    sameReceivingItems(ownedPendingTransfer.payload.items, selectedTransferItems),
  );
  const pendingTransferRetryReady = Boolean(
    transferOperationScope && ownedPendingTransfer && pendingTransferSelectionMatches,
  );
  const pendingTransferMessage = getPendingTransferMessage(
    pendingTransferLookup,
    pendingTransferSelectionMatches,
  );

  const updateLineQuantity = useCallback(
    (lineId: string, value: NumericInputValue) => {
      updateDirty(true);
      setLines((current) =>
        current.map((line) => {
          if (line.id !== lineId || line.incidentProtected) return line;
          const next = { ...line, receivedNow: value };
          return recalculateLine(
            apiMode ? { ...next, trackingDetails: syncTrackingDetails(line, next) } : next,
          );
        }),
      );
    },
    [apiMode, updateDirty],
  );

  const saveProgress = useCallback(async () => {
    if (mutationPendingRef.current || incidentMutationPendingRef.current) return;
    const mutationBranchId = activeBranchIdRef.current;
    mutationPendingRef.current = true;
    setSaving(true);
    try {
      await service.saveProgress({
        documentType,
        documentId,
        lines,
        incidents,
      });
      if (activeBranchIdRef.current !== mutationBranchId) return;
      await reload();
    } catch (caughtError) {
      throw toFriendlyReceivingError(caughtError);
    } finally {
      mutationPendingRef.current = false;
      setSaving(false);
    }
  }, [documentId, documentType, incidents, lines, reload, service]);

  const confirm = useCallback(async () => {
    if (mutationPendingRef.current || incidentMutationPendingRef.current) return;
    const mutationBranchId = activeBranchIdRef.current;
    const mutationContextKey = contextKeyRef.current;
    const apiTransfer = apiMode && documentType === "transfer";
    if (apiTransfer && !transferOperationScope) {
      throw new Error("No se pudo resolver el contexto seguro de la confirmación.");
    }
    const mutationToken = mutationCoordinator.beginRequest();
    if (mutationToken === null) return;
    mutationPendingRef.current = true;
    setSaving(true);
    try {
      const performConfirmation = async () => {
        let preparedTransfer = null as ReturnType<
          typeof mutationCoordinator.prepareTransferConfirmation
        > | null;
        try {
          if (apiTransfer && transferOperationScope) {
            // El lock se adquiere antes de esta relectura. Otra pestana nunca puede basarse
            // solamente en el estado React que observo antes de que comenzara la operacion.
            const freshLookup = mutationCoordinator.lookupTransferConfirmation(
              transferOperationScope,
            );
            const freshOwned = freshLookup.status === "owned" ? freshLookup.record : null;
            const freshSelectionMatches = Boolean(
              freshOwned && sameReceivingItems(freshOwned.payload.items, selectedTransferItems),
            );
            if (contextKeyRef.current === mutationContextKey) {
              setPendingTransferLookup(freshLookup);
            }
            if (freshLookup.status === "invalid" ||
              freshLookup.status === "unavailable" ||
              freshLookup.status === "foreign") {
              throw new Error(
                getPendingTransferMessage(freshLookup, freshSelectionMatches) ??
                  "No se puede verificar una confirmación anterior.",
              );
            }

            let transferPayload: TransferReceptionOperationPayload;
            if (freshOwned) {
              if (!freshSelectionMatches) {
                throw new Error(
                  "Existe una confirmación incierta. Reintenta únicamente las cantidades originales.",
                );
              }
              transferPayload = freshOwned.payload;
            } else {
              if (!transferReception?.canConfirmTransfer ||
                !transferReception.destinationLocationId) {
                throw new Error(
                  transferReception?.blockingReason ??
                    "La selección del traslado no puede confirmarse.",
                );
              }
              transferPayload = {
                destinationLocationId: transferReception.destinationLocationId,
                items: selectedTransferItems,
              };
            }
            preparedTransfer = mutationCoordinator.prepareTransferConfirmation(
              transferOperationScope,
              transferPayload,
            );
            if (contextKeyRef.current === mutationContextKey) {
              setPendingTransferLookup({ status: "owned", record: preparedTransfer });
            }
          }

          const confirmationLines = preparedTransfer
            ? applyTransferOperationToLines(lines, preparedTransfer.payload)
            : lines;
          await service.confirm({
            documentType,
            documentId,
            lines: confirmationLines,
            incidents,
            confirmationId: preparedTransfer?.confirmationId ?? confirmationId,
            hasUnsavedChanges: dirtyRef.current,
            ...(preparedTransfer
              ? {
                  transferOperation: {
                    destinationLocationId: preparedTransfer.payload.destinationLocationId,
                    idempotentReplay: preparedTransfer.attempts > 1,
                  },
                }
              : {}),
          });
          if (preparedTransfer && transferOperationScope) {
            mutationCoordinator.clearTransferConfirmation(transferOperationScope);
            if (contextKeyRef.current === mutationContextKey) {
              setPendingTransferLookup({ status: "empty" });
            }
          }
        } catch (caughtError) {
          if (preparedTransfer && transferOperationScope) {
            if (canDiscardReceivingConfirmation(caughtError, preparedTransfer.attempts)) {
              mutationCoordinator.clearTransferConfirmation(transferOperationScope);
              if (contextKeyRef.current === mutationContextKey) {
                setPendingTransferLookup({ status: "empty" });
              }
            } else if (contextKeyRef.current === mutationContextKey) {
              setPendingTransferLookup({ status: "owned", record: preparedTransfer });
            }
          }
          throw caughtError;
        }
      };

      if (apiTransfer && transferOperationScope) {
        await mutationCoordinator.runWithTransferLock(
          transferOperationScope,
          performConfirmation,
        );
      } else {
        await performConfirmation();
      }
      if (
        activeBranchIdRef.current !== mutationBranchId ||
        contextKeyRef.current !== mutationContextKey
      ) return;
      await reload();
      if (!apiTransfer) setConfirmationId(crypto.randomUUID());
    } catch (caughtError) {
      // Confirmar puede guardar el borrador antes del POST final. Ante un 409 se conserva el
      // formulario local: una recarga aqui descartaria ediciones que el usuario debe corregir.
      throw toFriendlyReceivingError(caughtError);
    } finally {
      mutationPendingRef.current = false;
      if (mutationCoordinator.finishRequest(mutationToken)) setSaving(false);
    }
  }, [
    apiMode,
    confirmationId,
    documentId,
    documentType,
    incidents,
    lines,
    mutationCoordinator,
    reload,
    selectedTransferItems,
    service,
    transferOperationScope,
    transferReception,
  ]);

  const saveIncident = useCallback(
    (input: {
      id?: string;
      productId: string;
      incidentTypeId: string;
      quantityAffected: number;
      description: string;
      evidence: ReceiptIncidentEvidence[];
    }) => {
      if (!detail) return;
      const line = lines.find((item) => item.productId === input.productId);
      const incidentType = detail.incidentTypes.find((item) => item.id === input.incidentTypeId);
      if (!line || !incidentType) throw new Error("La incidencia no tiene referencias validas.");
      const existing = input.id ? incidents.find((item) => item.id === input.id) : undefined;
      const otherIncidentQuantity = incidents
        .filter(
          (item) => item.editable && item.productId === input.productId && item.id !== existing?.id,
        )
        .reduce((sum, item) => sum + (item.quantityAffected ?? 0), 0);
      const remainingBefore = Math.max(0, line.orderedQuantity - line.acceptedPreviously);
      const acceptedNow = typeof line.receivedNow === "number" ? line.receivedNow : 0;
      if (acceptedNow + otherIncidentQuantity + input.quantityAffected > remainingBefore) {
        throw new Error(
          `Solo quedan ${Math.max(0, remainingBefore - acceptedNow - otherIncidentQuantity)} unidades disponibles para registrar entre aceptadas e incidencias.`,
        );
      }
      const nextIncident: ReceivingDocumentIncident = {
        id: existing?.id ?? `draft-${crypto.randomUUID()}`,
        receiptId: existing?.receiptId ?? detail.document.receiptId ?? "",
        ...(existing?.receiptLineId ? { receiptLineId: existing.receiptLineId } : {}),
        productId: input.productId,
        productName: line.productName,
        sku: line.sku,
        incidentTypeId: input.incidentTypeId,
        incidentTypeName: incidentType.name,
        quantityAffected: input.quantityAffected,
        description: input.description.trim(),
        evidence: input.evidence,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        createdByUserId: existing?.createdByUserId ?? "user-warehouse",
        createdByName: existing?.createdByName ?? "Usuario de bodega",
        receiptNumber:
          existing?.receiptNumber ?? detail.document.receiptNumber ?? "Borrador actual",
        editable: true,
      };
      const nextIncidents = existing
        ? incidents.map((item) => (item.id === existing.id ? nextIncident : item))
        : [...incidents, nextIncident];
      setIncidents(nextIncidents);
      setLines((current) => current.map((item) => recalculateLine(item)));
      updateDirty(true);
    },
    [detail, incidents, lines, updateDirty],
  );

  const removeIncident = useCallback(
    (incidentId: string) => {
      const nextIncidents = incidents.filter(
        (incident) => incident.id !== incidentId || !incident.editable,
      );
      setIncidents(nextIncidents);
      setLines((current) => current.map((item) => recalculateLine(item)));
      updateDirty(true);
    },
    [incidents, updateDirty],
  );

  const createApiIncident = useCallback(
    async (
      input: Omit<
        CreateReceivingIncidentInput,
        "documentId" | "receiptId" | "goodsReceiptItemId"
      > & {
        /** PurchaseOrderItem estable; el GoodsReceiptItem real se resuelve tras persistir. */
        sourceLineId: string;
      },
    ) => {
      if (!detail) throw new Error("No se encontró la recepción.");
      if (incidentMutationPendingRef.current || mutationPendingRef.current) return;
      const mutationBranchId = activeBranchIdRef.current;
      incidentMutationPendingRef.current = true;
      setIncidentSaving(true);
      try {
        let receiptId = detail.document.receiptId;
        const { sourceLineId, ...incidentInput } = input;
        let goodsReceiptItemId = lines.find(
          (line) => line.sourceLineId === sourceLineId,
        )?.goodsReceiptItemId;
        let didSave = false;
        if (dirtyRef.current || !receiptId) {
          // Se usa el receipt devuelto por el guardado, nunca el estado de React (puede estar viejo).
          const savedReceipt = await service.saveProgress({
            documentType,
            documentId,
            lines,
            incidents,
          });
          receiptId = savedReceipt.id;
          didSave = true;
        }
        if (didSave || !goodsReceiptItemId) {
          // El guardado reemplaza los items del borrador: se re-resuelve el GoodsReceiptItem real
          // desde el receipt canonico por sourceLineId (nunca ids previos al PUT).
          if (!mutationBranchId) throw new Error("Selecciona una sucursal activa.");
          const fresh = await service.getDocument(documentType, documentId, mutationBranchId);
          if (fresh.document.receiptId && fresh.document.receiptId !== receiptId) {
            throw new Error("El borrador cambió; vuelve a intentar.");
          }
          goodsReceiptItemId = fresh.lines.find(
            (line) => line.sourceLineId === sourceLineId,
          )?.goodsReceiptItemId;
        }
        if (!goodsReceiptItemId) {
          throw new Error(
            "Este producto aún no tiene cantidad recibida; ingresa una cantidad aceptada para registrar la incidencia.",
          );
        }
        await service.createIncident({
          documentId,
          receiptId,
          ...incidentInput,
          goodsReceiptItemId,
        });
        if (activeBranchIdRef.current !== mutationBranchId) return;
        await reload();
      } catch (caughtError) {
        throw toFriendlyIncidentError(caughtError);
      } finally {
        incidentMutationPendingRef.current = false;
        setIncidentSaving(false);
      }
    },
    [detail, documentId, documentType, incidents, lines, reload, service],
  );

  const draftReceiptId = detail?.document.receiptId;
  const branchName = detail?.document.branchName;
  const pdfService = useMemo(() => new PurchaseOrderPdfService(repositories), [repositories]);
  // Reporte final desde datos canonicos de la orden/recepciones confirmadas (sin API en el componente).
  const downloadFinalReport = useCallback(
    () => pdfService.downloadReceivingReport(documentId, { branchName }),
    [branchName, documentId, pdfService],
  );
  const resolveApiIncident = useCallback(
    async (incidentId: string, trackingDetails?: ReceiptDraftTrackingDetailInput[]) => {
      if (!draftReceiptId) {
        throw new Error("No se encontró el borrador asociado a la incidencia.");
      }
      if (incidentMutationPendingRef.current || mutationPendingRef.current) return;
      const mutationBranchId = activeBranchIdRef.current;
      incidentMutationPendingRef.current = true;
      setIncidentSaving(true);
      try {
        if (dirtyRef.current) {
          // Resolver relee el receipt: se persisten antes los cambios locales para no perderlos.
          await service.saveProgress({ documentType, documentId, lines, incidents });
        }
        await service.resolveIncident(documentId, draftReceiptId, incidentId, trackingDetails);
        // Cantidades, incidencias y estado se releen del backend (fuente de verdad).
        if (activeBranchIdRef.current !== mutationBranchId) return;
        await reload();
      } catch (caughtError) {
        throw toFriendlyIncidentError(caughtError);
      } finally {
        incidentMutationPendingRef.current = false;
        setIncidentSaving(false);
      }
    },
    [draftReceiptId, documentId, documentType, incidents, lines, reload, service],
  );

  const apiPurchaseOrder = apiMode && documentType === "purchase_order";

  return {
    detail,
    lines,
    incidents,
    currentBranch,
    loading: branchLoading || loading,
    saving: saving || mutationCoordinator.isRequestInFlight(),
    incidentSaving,
    dirty,
    error,
    apiMode,
    transferReception,
    pendingTransferMessage,
    pendingTransferRetryReady,
    hasPendingTransferConfirmation: pendingTransferLookup.status !== "empty",
    confirmAvailable:
      !apiMode ||
      Boolean(apiPurchaseOrder && detail?.canConfirm) ||
      Boolean(
        apiMode &&
        documentType === "transfer" &&
        (transferReception?.canReceiveTransfer || pendingTransferRetryReady),
      ),
    // En API el draft puede no existir aun: la pagina lo persiste (Guardar avance) antes de abrir
    // el formulario, nunca se crea una segunda recepcion porque saveApiDraft reutiliza el draft.
    incidentsAvailable: !apiMode || Boolean(apiPurchaseOrder && detail?.canManageIncidents),
    reload,
    updateLine,
    updateLineQuantity,
    saveProgress,
    confirm,
    saveIncident,
    removeIncident,
    createApiIncident,
    resolveApiIncident,
    downloadFinalReport,
  };
}

function restorePendingTransferSelection(
  lines: ReceivingDocumentLine[],
  payload: TransferReceptionOperationPayload,
): ReceivingDocumentLine[] {
  const quantityByItemId = new Map(
    payload.items.map((item) => [item.itemId, item.receivedQuantity]),
  );
  return lines.map((line) => recalculateLine({
    ...line,
    receivedNow: quantityByItemId.get(line.sourceLineId) ?? 0,
  }));
}

function applyTransferOperationToLines(
  lines: ReceivingDocumentLine[],
  payload: TransferReceptionOperationPayload,
): ReceivingDocumentLine[] {
  const quantityByItemId = new Map(
    payload.items.map((item) => [item.itemId, item.receivedQuantity]),
  );
  return lines.map((line) => ({
    ...line,
    receivedNow: quantityByItemId.get(line.sourceLineId) ?? 0,
  }));
}

function sameReceivingItems(
  left: TransferReceptionOperationPayload["items"],
  right: TransferReceptionOperationPayload["items"],
): boolean {
  const canonical = (items: TransferReceptionOperationPayload["items"]) => [...items]
    .map((item) => ({
      itemId: item.itemId,
      productId: item.productId,
      receivedQuantity: item.receivedQuantity,
    }))
    .sort((first, second) =>
      first.itemId.localeCompare(second.itemId) ||
      first.productId.localeCompare(second.productId),
    );
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function getPendingTransferMessage(
  lookup: PendingTransferReceptionLookup,
  selectionMatches: boolean,
): string | null {
  if (lookup.status === "invalid") {
    return "No se puede verificar la confirmación pendiente porque el registro local está dañado. No se enviará otra operación.";
  }
  if (lookup.status === "unavailable") {
    return "El almacenamiento seguro de la pestaña no está disponible. No se enviará otra confirmación potencialmente duplicada.";
  }
  if (lookup.status === "foreign") {
    return "Existe una confirmación incierta de este traslado iniciada en otra sesión o por otro usuario. Debe verificarse antes de continuar.";
  }
  if (lookup.status === "owned" && !selectionMatches) {
    return "La confirmación incierta no coincide con las líneas actuales. No se enviará un payload diferente ni una identidad nueva.";
  }
  if (lookup.status === "owned") {
    return "Existe una confirmación incierta. El reintento conservará exactamente la identidad, las cantidades y la ubicación originales.";
  }
  return null;
}

/** Traduce errores de backend conocidos a mensajes entendibles; conserva el resto. */
export function toFriendlyIncidentError(error: unknown): Error {
  return toFriendlyReceivingError(error);
}

/**
 * Codigos 409 REALES del backend (InventoryOperationalLocationService). GOODS_RECEIPT_LOCATION_INVALID
 * no esta aqui a proposito: su mensaje identifica SKU y linea y debe llegar completo al usuario.
 */
const RECEIVING_LOCATION_ERROR_MESSAGES: Record<string, string> = {
  INVENTORY_ASSIGNED_LOCATION_INACTIVE:
    "La ubicación operativa asignada al producto está inactiva. Asigna una ubicación activa e inténtalo de nuevo.",
  INVENTORY_ASSIGNED_LOCATION_INVALID:
    "La ubicación operativa asignada al producto no existe o no pertenece a la sucursal.",
  INVENTORY_LOCATION_NOT_ASSIGNED:
    "El producto no tiene una ubicación operativa asignada en esta sucursal.",
  INVENTORY_LOCATION_MISMATCH:
    "La ubicación indicada no es la ubicación operativa asignada al producto.",
  INVENTORY_LOCATION_CONFLICT:
    "El producto conserva existencias en otra ubicación de la sucursal. Regulariza el inventario antes de recibir.",
  INVENTORY_LOCATION_CHANGE_BLOCKED:
    "La ubicación asignada no puede cambiar mientras el producto tenga existencias o reservas en otra ubicación.",
  INVENTORY_LOCATION_REQUIRED:
    "La entrada debe indicar la ubicación donde se registra el producto.",
};

export function toFriendlyReceivingError(error: unknown): Error {
  if (error instanceof BackendRequestError) {
    if (error.code === "DUPLICATE_SERIAL") {
      return new Error("Uno o más números de serie ya están registrados. Revisa los seriales.");
    }
    if (error.code === "RECEIPT_HAS_OPEN_INCIDENTS") {
      return new Error(
        "La recepción tiene incidencias abiertas que deben resolverse antes de confirmar.",
      );
    }
    if (error.code === "INSUFFICIENT_STOCK") {
      return new Error("El stock relacionado cambió y la recepción no pudo confirmarse.");
    }
    // GOODS_RECEIPT_LOCATION_INVALID trae el SKU y la linea de cada rechazo: se conserva tal cual.
    const locationMessage = error.code ? RECEIVING_LOCATION_ERROR_MESSAGES[error.code] : undefined;
    if (error.status === 409 && locationMessage) return new Error(locationMessage);
    return new Error(error.message);
  }
  return error instanceof Error ? error : new Error("No se pudo completar la operación.");
}

function toAcceptedBaseQuantity(line: ReceivingDocumentLine) {
  const accepted = toFiniteNumber(line.receivedNow);
  return Math.max(0, Number((accepted * line.purchaseToBaseFactor).toFixed(6)));
}

/**
 * Mantiene el primer trackingDetail alineado con "Aceptado ahora" mientras el usuario no lo haya
 * tocado (sin lote/vencimiento/series y con la cantidad base autogenerada). Una vez que existen
 * varios detalles o el unico fue editado, la distribucion es del usuario y no se redistribuye.
 */
export function syncTrackingDetails(
  previous: ReceivingDocumentLine,
  next: ReceivingDocumentLine,
): ReceivingTrackingDetail[] {
  const details = next.trackingDetails;
  if (!next.tracking.lot && !next.tracking.serial) return details;
  if (typeof next.receivedNow !== "number" && next.receivedNow !== "") return details;
  const nextBase = toAcceptedBaseQuantity(next);
  if (details.length === 0) {
    if (nextBase <= 0) return details;
    return [
      {
        id: crypto.randomUUID(),
        baseQuantity: nextBase,
        lotNumber: "",
        expirationDate: "",
        serialNumbersText: "",
      },
    ];
  }
  const [only] = details;
  if (details.length !== 1 || !only) return details;
  const pristine =
    !only.lotNumber &&
    !only.expirationDate &&
    !only.serialNumbersText &&
    toFiniteNumber(only.baseQuantity) === toAcceptedBaseQuantity(previous);
  if (!pristine) return details;
  if (nextBase <= 0) return [];
  return [{ ...only, baseQuantity: nextBase }];
}

function recalculateLine(line: ReceivingDocumentLine) {
  const receivedNow = typeof line.receivedNow === "number" ? line.receivedNow : 0;
  return {
    ...line,
    pendingQuantity: Math.max(0, line.orderedQuantity - line.acceptedPreviously - receivedNow),
  };
}
