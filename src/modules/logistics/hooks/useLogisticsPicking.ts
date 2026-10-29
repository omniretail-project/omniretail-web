"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { DataEventPayload } from "@/core/types/events.types";
import { useDataEventBus, useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type {
  PickingDetailDto,
  PickingDetailLineDto,
  PickingQueueItemDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";
import {
  getPickingLineUpdateAvailability,
  isPickingAutoFefoEligible,
  type PickingPhysicalSelectionResult,
} from "@/modules/logistics/application/pickingPhysicalSelection";
import {
  PickingApplicationService,
  type RegisterPickingIncidentCommand,
} from "@/modules/logistics/application/services/PickingApplicationService";
import type { PickingIncidentFormValues } from "@/modules/logistics/validation/picking.validation";
import { validatePickingIncident } from "@/modules/logistics/validation/picking.validation";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import {
  canonicalizePickingTrackingSelections,
  createPickingUpdateFingerprint,
  getOrCreatePickingOperationId,
  isCurrentPickingRequest,
} from "@/modules/logistics/hooks/pickingRequestIdentity";

export function useLogisticsPicking() {
  const repositories = useRepositories();
  const eventBus = useDataEventBus();
  const instanceId = useId();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    user,
    canAccessBranch,
    hasPermission,
    loading: sessionLoading,
    error: sessionError,
  } = useCurrentSession();
  const service = useMemo(() => new PickingApplicationService(repositories), [repositories]);
  const [queue, setQueue] = useState<PickingQueueItemDto[]>([]);
  const [detail, setDetail] = useState<PickingDetailDto | null>(null);
  const [selectedPickingOrderId, setSelectedPickingOrderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  const detailSequenceRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const mutationLockRef = useRef(false);
  const workspaceBranchIdRef = useRef<string | null>(null);
  const selectedPickingOrderIdRef = useRef<string | null>(null);
  const activeBranchIdRef = useRef<string | null>(currentBranch?.id ?? null);
  const pendingOperationIdsRef = useRef(new Map<string, string>());
  // Sucursal cuya cola ya se mostro: las lecturas siguientes son en segundo plano (no ocultan la mesa).
  const queueBranchIdRef = useRef<string | null>(null);

  const hasBranchAccess = Boolean(
    user &&
    currentBranch &&
    user.tenantId === currentBranch.tenantId &&
    canAccessBranch(currentBranch.id),
  );
  const canRead = hasPermission("logistics.picking.read");
  const commandsReadOnly = repositories.pickingCommandsEnabled === false;
  const autoFefoEnabled = repositories.pickingReadDataSource === "api";
  const canStart = !commandsReadOnly && hasPermission("logistics.picking.start");
  const canComplete = !commandsReadOnly && hasPermission("logistics.picking.complete");

  const reload = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    if (branchLoading || sessionLoading) return;
    const background = Boolean(
      currentBranch && hasBranchAccess && canRead && queueBranchIdRef.current === currentBranch.id,
    );
    if (!background) {
      setLoading(true);
      setQueueError(null);
    }
    if (!currentBranch || !hasBranchAccess || !canRead) {
      queueBranchIdRef.current = null;
      setQueue([]);
      setLoading(false);
      return;
    }
    try {
      const items = await service.getQueue(currentBranch.id);
      if (isCurrentPickingRequest({
        sequence,
        currentSequence: loadSequenceRef.current,
        requestedBranchId: currentBranch.id,
        activeBranchId: activeBranchIdRef.current,
      })) {
        queueBranchIdRef.current = currentBranch.id;
        setQueue(items);
        setQueueError(null);
      }
    } catch (cause) {
      if (sequence === loadSequenceRef.current) {
        setQueueError(toMessage(cause, sessionError ?? "No se pudo cargar la cola de picking."));
      }
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [branchLoading, canRead, currentBranch, hasBranchAccess, service, sessionError, sessionLoading]);

  /**
   * `quiet` (refresco por evento): no muestra indicador ni toca el error visible, y un fallo conserva el
   * detalle anterior. Una lectura obsoleta nunca pisa a una mas nueva (secuencia + pedido + sucursal).
   */
  const loadDetail = useCallback(async (
    branchId: string,
    pickingOrderId: string,
    options?: { quiet?: boolean },
  ) => {
    const quiet = options?.quiet === true;
    const sequence = ++detailSequenceRef.current;
    if (!quiet) {
      setDetailLoading(true);
      setWorkspaceError(null);
    }
    try {
      const nextDetail = await service.getDetail(branchId, pickingOrderId);
      if (isCurrentPickingRequest({
        sequence,
        currentSequence: detailSequenceRef.current,
        requestedBranchId: branchId,
        activeBranchId: activeBranchIdRef.current,
        requestedPickingOrderId: pickingOrderId,
        selectedPickingOrderId: selectedPickingOrderIdRef.current,
      })) {
        setDetail(nextDetail);
      }
      return nextDetail;
    } catch (cause) {
      if (!quiet && sequence === detailSequenceRef.current && activeBranchIdRef.current === branchId) {
        setWorkspaceError(toMessage(cause, "No se pudo cargar el detalle de picking."));
      }
      return null;
    } finally {
      if (sequence === detailSequenceRef.current && activeBranchIdRef.current === branchId) {
        setDetailLoading(false);
      }
    }
  }, [service]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => { if (active) void reload(); });
    return () => { active = false; };
  }, [reload]);

  useEffect(() => {
    let active = true;
    const branchId = currentBranch?.id ?? null;
    activeBranchIdRef.current = branchId;
    if (workspaceBranchIdRef.current && workspaceBranchIdRef.current !== branchId) {
      detailSequenceRef.current += 1;
      mutationSequenceRef.current += 1;
      mutationLockRef.current = false;
    }
    window.queueMicrotask(() => {
      if (!active || !workspaceBranchIdRef.current || workspaceBranchIdRef.current === branchId) return;
      workspaceBranchIdRef.current = null;
      selectedPickingOrderIdRef.current = null;
      pendingOperationIdsRef.current.clear();
      setSelectedPickingOrderId(null);
      setDetail(null);
      setWorkspaceError(null);
      setDetailLoading(false);
      setSubmitting(false);
    });
    return () => { active = false; };
  }, [currentBranch?.id]);

  const openPicking = useCallback(async (item: PickingQueueItemDto) => {
    if (!currentBranch || !hasBranchAccess || !canRead) return;
    workspaceBranchIdRef.current = currentBranch.id;
    selectedPickingOrderIdRef.current = item.pickingOrderId;
    setSelectedPickingOrderId(item.pickingOrderId);
    setDetail(null);
    setWorkspaceError(null);
    await loadDetail(currentBranch.id, item.pickingOrderId);
  }, [canRead, currentBranch, hasBranchAccess, loadDetail]);

  const closePicking = useCallback(() => {
    if (mutationLockRef.current || submitting) return false;
    detailSequenceRef.current += 1;
    workspaceBranchIdRef.current = null;
    selectedPickingOrderIdRef.current = null;
    pendingOperationIdsRef.current.clear();
    setSelectedPickingOrderId(null);
    setDetail(null);
    setWorkspaceError(null);
    setDetailLoading(false);
    return true;
  }, [submitting]);

  const beginMutation = useCallback(() => {
    if (mutationLockRef.current) return null;
    mutationLockRef.current = true;
    const sequence = ++mutationSequenceRef.current;
    // Una lectura de detalle iniciada antes de la mutacion quedaria obsoleta: se invalida para que
    // jamas sobrescriba el detalle autoritativo que devuelve el backend.
    detailSequenceRef.current += 1;
    setDetailLoading(false);
    setSubmitting(true);
    setWorkspaceError(null);
    return sequence;
  }, []);

  const finishMutation = useCallback((sequence: number) => {
    if (sequence !== mutationSequenceRef.current) return;
    mutationLockRef.current = false;
    setSubmitting(false);
  }, []);

  const canApplyMutationResult = useCallback((branchId: string, pickingOrderId: string) =>
    activeBranchIdRef.current === branchId &&
    selectedPickingOrderIdRef.current === pickingOrderId,
  []);

  /**
   * Los repositorios API no publican eventos de Logistica: tras una operacion confirmada por el backend
   * se avisa a las demas pantallas (Packing, Despacho, Historial) por el bus interno. `origin` evita que
   * este mismo hook reaccione a su propio aviso.
   */
  const announceChange = useCallback((
    branchId: string,
    pickingOrderId: string,
    options?: { orderId?: string; orderChanged?: boolean },
  ) => {
    const tenantId = user?.tenantId;
    if (!tenantId) return;
    const metadata = { origin: instanceId };
    try {
      eventBus.emit("picking.changed", {
        tenantId,
        branchId,
        pickingOrderId,
        ...(options?.orderId ? { orderId: options.orderId } : {}),
        action: "updated",
        metadata,
      });
      if (options?.orderChanged) {
        eventBus.emit("order.changed", {
          tenantId,
          branchId,
          ...(options.orderId ? { orderId: options.orderId } : {}),
          action: "status_changed",
          metadata,
        });
      }
    } catch {
      // La operacion ya quedo confirmada por el backend: un oyente ajeno que falle no la invalida.
    }
  }, [eventBus, instanceId, user?.tenantId]);

  const assign = useCallback(async () => {
    if (!currentBranch || !selectedPickingOrderId || !canStart) return false;
    const sequence = beginMutation();
    if (sequence === null) return false;
    const branchId = currentBranch.id;
    const pickingOrderId = selectedPickingOrderId;
    try {
      await service.assign(branchId, pickingOrderId);
      announceChange(branchId, pickingOrderId);
      if (!canApplyMutationResult(branchId, pickingOrderId)) return false;
      await Promise.all([loadDetail(branchId, pickingOrderId), reload()]);
      return true;
    } catch (cause) {
      if (canApplyMutationResult(branchId, pickingOrderId)) {
        setWorkspaceError(toMessage(cause, "No se pudo tomar el picking."));
      }
      return false;
    } finally {
      finishMutation(sequence);
    }
  }, [announceChange, beginMutation, canApplyMutationResult, canStart, currentBranch, finishMutation, loadDetail, reload, selectedPickingOrderId, service]);

  const updateLine = useCallback(async (
    line: PickingDetailLineDto,
    targetQuantity: number,
    physicalSelection: PickingPhysicalSelectionResult,
  ) => {
    if (!currentBranch || !detail || !canStart) return false;
    const autoAllocateLots = physicalSelection.autoAllocateLots === true;
    if (autoAllocateLots && (!autoFefoEnabled || !isPickingAutoFefoEligible(line))) {
      setWorkspaceError("Esta linea no admite asignacion automatica FEFO.");
      return false;
    }
    const availability = getPickingLineUpdateAvailability(line);
    if (!availability.available) {
      setWorkspaceError(availability.reason);
      return false;
    }
    const branchId = currentBranch.id;
    const pickingOrderId = detail.pickingOrderId;
    const normalizedSelections = canonicalizePickingTrackingSelections(
      physicalSelection.trackingSelections,
    );
    const fingerprint = createPickingUpdateFingerprint({
      pickingOrderId,
      pickingLineId: line.pickingLineId,
      targetQuantity,
      locationId: physicalSelection.locationId,
      autoAllocateLots,
      trackingSelections: normalizedSelections,
    });
    const sequence = beginMutation();
    if (sequence === null) return false;
    const operationId = getOrCreatePickingOperationId(
      pendingOperationIdsRef.current,
      fingerprint,
    );
    try {
      const updatedDetail = await service.updateLine(branchId, {
        pickingOrderId,
        pickingLineId: line.pickingLineId,
        pickedQuantity: targetQuantity,
        operationId,
        locationId: physicalSelection.locationId ?? undefined,
        ...(autoAllocateLots
          ? { autoAllocateLots: true }
          : {
              lotId: normalizedSelections[0]?.lotId ?? undefined,
              serialNumbers: line.tracking.serial
                ? normalizedSelections.flatMap((selection) => selection.serialNumbers)
                : undefined,
            }),
        trackingSelections: normalizedSelections,
      });
      pendingOperationIdsRef.current.delete(fingerprint);
      announceChange(branchId, pickingOrderId, { orderId: updatedDetail.orderId });
      if (!canApplyMutationResult(branchId, pickingOrderId)) return false;
      // El detalle autoritativo ya llego en la respuesta: se aplica al instante. La cola (lista lateral)
      // se refresca en segundo plano sin retener el bloqueo ni ocultar la mesa.
      setDetail(updatedDetail);
      void reload();
      return true;
    } catch (cause) {
      if (canApplyMutationResult(branchId, pickingOrderId)) {
        setWorkspaceError(toMessage(cause, "No se pudo registrar el progreso."));
      }
      return false;
    } finally {
      finishMutation(sequence);
    }
  }, [announceChange, autoFefoEnabled, beginMutation, canApplyMutationResult, canStart, currentBranch, detail, finishMutation, reload, service]);

  const registerIncident = useCallback(async (values: PickingIncidentFormValues) => {
    if (!currentBranch || !detail || !canStart) return false;
    const validation = validatePickingIncident(values);
    if (!validation.valid) return false;
    const sequence = beginMutation();
    if (sequence === null) return false;
    const branchId = currentBranch.id;
    const pickingOrderId = detail.pickingOrderId;
    try {
      const command: RegisterPickingIncidentCommand = { pickingOrderId, ...validation.command };
      await service.registerIncident(branchId, command);
      announceChange(branchId, pickingOrderId);
      if (!canApplyMutationResult(branchId, pickingOrderId)) return false;
      await Promise.all([loadDetail(branchId, pickingOrderId), reload()]);
      return true;
    } catch (cause) {
      if (canApplyMutationResult(branchId, pickingOrderId)) {
        setWorkspaceError(toMessage(cause, "No se pudo registrar la incidencia."));
      }
      return false;
    } finally {
      finishMutation(sequence);
    }
  }, [announceChange, beginMutation, canApplyMutationResult, canStart, currentBranch, detail, finishMutation, loadDetail, reload, service]);

  const resolveIncident = useCallback(async (incidentId: string) => {
    if (!currentBranch || !detail || !canStart) return false;
    const sequence = beginMutation();
    if (sequence === null) return false;
    const branchId = currentBranch.id;
    const pickingOrderId = detail.pickingOrderId;
    try {
      await service.resolveIncident(branchId, pickingOrderId, incidentId);
      announceChange(branchId, pickingOrderId);
      if (!canApplyMutationResult(branchId, pickingOrderId)) return false;
      await Promise.all([loadDetail(branchId, pickingOrderId), reload()]);
      return true;
    } catch (cause) {
      if (canApplyMutationResult(branchId, pickingOrderId)) {
        setWorkspaceError(toMessage(cause, "No se pudo resolver la incidencia."));
      }
      return false;
    } finally {
      finishMutation(sequence);
    }
  }, [announceChange, beginMutation, canApplyMutationResult, canStart, currentBranch, detail, finishMutation, loadDetail, reload, service]);

  const release = useCallback(async (reason: string) => {
    if (!currentBranch || !detail || !canStart) return false;
    const sequence = beginMutation();
    if (sequence === null) return false;
    const branchId = currentBranch.id;
    const pickingOrderId = detail.pickingOrderId;
    try {
      await service.release(branchId, pickingOrderId, reason);
      announceChange(branchId, pickingOrderId);
      if (!canApplyMutationResult(branchId, pickingOrderId)) return false;
      await Promise.all([loadDetail(branchId, pickingOrderId), reload()]);
      return true;
    } catch (cause) {
      if (canApplyMutationResult(branchId, pickingOrderId)) {
        setWorkspaceError(toMessage(cause, "No se pudo liberar el picking."));
      }
      return false;
    } finally {
      finishMutation(sequence);
    }
  }, [announceChange, beginMutation, canApplyMutationResult, canStart, currentBranch, detail, finishMutation, loadDetail, reload, service]);

  const complete = useCallback(async () => {
    if (!currentBranch || !detail || !canComplete) return false;
    const sequence = beginMutation();
    if (sequence === null) return false;
    const branchId = currentBranch.id;
    const pickingOrderId = detail.pickingOrderId;
    try {
      await service.complete(branchId, pickingOrderId);
      announceChange(branchId, pickingOrderId, { orderId: detail.orderId, orderChanged: true });
      if (!canApplyMutationResult(branchId, pickingOrderId)) return false;
      detailSequenceRef.current += 1;
      workspaceBranchIdRef.current = null;
      selectedPickingOrderIdRef.current = null;
      pendingOperationIdsRef.current.clear();
      setSelectedPickingOrderId(null);
      setDetail(null);
      setWorkspaceError(null);
      await reload();
      return true;
    } catch (cause) {
      if (canApplyMutationResult(branchId, pickingOrderId)) {
        setWorkspaceError(toMessage(cause, "No se pudo completar el picking."));
      }
      return false;
    } finally {
      finishMutation(sequence);
    }
  }, [announceChange, beginMutation, canApplyMutationResult, canComplete, currentBranch, detail, finishMutation, reload, service]);

  const handleEvent = useCallback((payload: DataEventPayload) => {
    if (!currentBranch || payload.tenantId !== currentBranch.tenantId || payload.branchId !== currentBranch.id) return;
    // Aviso publicado por este mismo hook: ya aplico el detalle autoritativo de su respuesta.
    if (payload.metadata?.origin === instanceId) return;
    void reload();
    const pickingOrderId = selectedPickingOrderIdRef.current;
    if (pickingOrderId && !mutationLockRef.current) {
      void loadDetail(currentBranch.id, pickingOrderId, { quiet: true });
    }
  }, [currentBranch, instanceId, loadDetail, reload]);
  useDataEvent("picking.changed", handleEvent);
  useDataEvent("order.changed", handleEvent);

  const filteredQueue = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return queue;
    return queue.filter((item) =>
      [item.orderReference, item.customerName, item.deliveryMethod, item.status]
        .some((value) => value.toLocaleLowerCase().includes(term)),
    );
  }, [queue, search]);

  return {
    currentBranchName: currentBranch?.name ?? "Sin sucursal",
    currentUserId: user?.id ?? null,
    hasBranchAccess,
    canRead,
    canStart,
    canComplete,
    commandsReadOnly,
    autoFefoEnabled,
    queue: filteredQueue,
    search,
    setSearch,
    loading,
    detailLoading,
    submitting,
    detail,
    selectedPickingOrderId,
    workspaceOpen: selectedPickingOrderId !== null,
    queueError,
    workspaceError,
    reload,
    openPicking,
    closePicking,
    assign,
    updateLine,
    registerIncident,
    resolveIncident,
    release,
    complete,
  };
}

function toMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function normalizePickingSerialNumbers(serialNumbers: readonly string[]): string[] {
  return [...serialNumbers].sort();
}
