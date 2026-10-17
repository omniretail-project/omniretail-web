"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type {
  ApiDispatchResultDto,
  DispatchQueueItemDto,
  PreparedDispatchDetailDto,
} from "@/modules/logistics/application/dto/DispatchReadModelDto";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import {
  advanceDispatchReadContext,
  captureDispatchReadContext,
  createDispatchReadContext,
  isCurrentDispatchRead,
  readCurrentDispatchContextValue,
  removeConfirmedDispatchSource,
  type DispatchContextualValue,
  type DispatchReadContextToken,
} from "@/modules/logistics/hooks/dispatchReadIdentity";
import {
  createDispatchOperationFingerprint,
  shouldRetainDispatchOperationIdentity,
} from "@/modules/logistics/hooks/dispatchRequestIdentity";
import { useDispatchMutationCoordinator } from "@/modules/logistics/providers/DispatchMutationCoordinatorProvider";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

export interface ConfirmOrderShipmentInput {
  carrierName?: string;
  trackingNumber?: string;
}

export function useLogisticsDispatchRead() {
  const repositories = useRepositories();
  const mutationCoordinator = useDispatchMutationCoordinator();
  const service = useMemo(() => new DispatchApplicationService(repositories), [repositories]);
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    sessionId,
    user,
    canAccessBranch,
    hasPermission,
    loading: sessionLoading,
    error: sessionError,
  } = useCurrentSession();
  const branchId = currentBranch?.id ?? null;
  const hasBranchAccess = Boolean(
    user && currentBranch && user.tenantId === currentBranch.tenantId && canAccessBranch(currentBranch.id),
  );
  const canRead = hasPermission("logistics.dispatch.read");
  const canConfirm = hasPermission("logistics.dispatch.confirm");
  const contextKey = sessionId && user && currentBranch
    ? `${sessionId}:${user.id}:${user.tenantId}:${currentBranch.id}`
    : null;
  const [currentContext, setCurrentContext] = useState(() => createDispatchReadContext(contextKey));
  if (currentContext.activeContextKey !== contextKey) {
    setCurrentContext(advanceDispatchReadContext(currentContext, contextKey));
  }
  const contextStateRef = useRef(currentContext);
  const queueSequenceRef = useRef(0);
  const detailSequenceRef = useRef(0);
  const mutationSequenceRef = useRef(0);
  const selectedOrderIdRef = useRef<string | null>(null);
  const [queueState, setQueueState] = useState<DispatchContextualValue<DispatchQueueItemDto[]> | null>(null);
  const [detailState, setDetailState] = useState<DispatchContextualValue<PreparedDispatchDetailDto> | null>(null);
  const [selectionState, setSelectionState] = useState<DispatchContextualValue<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoadingState, setDetailLoadingState] = useState<DispatchContextualValue<boolean> | null>(null);
  const [submittingState, setSubmittingState] = useState<DispatchContextualValue<string> | null>(null);
  const [errorState, setErrorState] = useState<DispatchContextualValue<string> | null>(null);
  const [successState, setSuccessState] = useState<DispatchContextualValue<string> | null>(null);

  useLayoutEffect(() => {
    contextStateRef.current = currentContext;
    queueSequenceRef.current += 1;
    detailSequenceRef.current += 1;
    mutationSequenceRef.current += 1;
    selectedOrderIdRef.current = null;
  }, [currentContext]);

  const reload = useCallback(async () => {
    const sequence = ++queueSequenceRef.current;
    if (branchLoading || sessionLoading) return;
    if (!contextKey || !branchId || !hasBranchAccess || !canRead) {
      setLoading(false);
      return;
    }
    const requestContext = captureDispatchReadContext(contextStateRef.current, contextKey);
    if (!requestContext) return;
    setLoading(true);
    setErrorState(null);
    try {
      const queue = await service.getApiQueue(branchId);
      if (isCurrentRequest(sequence, queueSequenceRef.current, requestContext, contextStateRef.current)) {
        setQueueState({ ...requestContext, value: queue });
      }
    } catch (cause) {
      if (isCurrentRequest(sequence, queueSequenceRef.current, requestContext, contextStateRef.current)) {
        setErrorState({
          ...requestContext,
          value: toMessage(cause, sessionError ?? "No se pudo cargar la cola de despachos."),
        });
      }
    } finally {
      if (isCurrentRequest(sequence, queueSequenceRef.current, requestContext, contextStateRef.current)) {
        setLoading(false);
      }
    }
  }, [branchId, branchLoading, canRead, contextKey, hasBranchAccess, service, sessionError, sessionLoading]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => { if (active) void reload(); });
    return () => { active = false; };
  }, [reload]);

  const selectOrder = useCallback(async (orderId: string) => {
    if (
      !contextKey || !branchId || !hasBranchAccess || !canRead ||
      mutationCoordinator.isRequestInFlight()
    ) return;
    const requestContext = captureDispatchReadContext(contextStateRef.current, contextKey);
    if (!requestContext) return;
    const sequence = ++detailSequenceRef.current;
    selectedOrderIdRef.current = orderId;
    setSelectionState({ ...requestContext, value: orderId });
    setDetailState(null);
    setDetailLoadingState({ ...requestContext, value: true });
    setErrorState(null);
    setSuccessState(null);
    try {
      const detail = await service.getApiPreparedDetail(branchId, orderId);
      if (isCurrentOrderRequest(
        sequence,
        detailSequenceRef.current,
        requestContext,
        contextStateRef.current,
        orderId,
        selectedOrderIdRef.current,
      )) {
        setDetailState({ ...requestContext, value: detail });
      }
    } catch (cause) {
      if (isCurrentOrderRequest(
        sequence,
        detailSequenceRef.current,
        requestContext,
        contextStateRef.current,
        orderId,
        selectedOrderIdRef.current,
      )) {
        setErrorState({
          ...requestContext,
          value: toMessage(cause, "No se pudo cargar el pedido preparado."),
        });
      }
    } finally {
      if (isCurrentOrderRequest(
        sequence,
        detailSequenceRef.current,
        requestContext,
        contextStateRef.current,
        orderId,
        selectedOrderIdRef.current,
      )) setDetailLoadingState(null);
    }
  }, [branchId, canRead, contextKey, hasBranchAccess, mutationCoordinator, service]);

  const clearSelection = useCallback(() => {
    detailSequenceRef.current += 1;
    selectedOrderIdRef.current = null;
    setSelectionState(null);
    setDetailState(null);
    setDetailLoadingState(null);
  }, []);

  const confirmOrder = useCallback(async (
    input: ConfirmOrderShipmentInput,
  ): Promise<ApiDispatchResultDto | null> => {
    const detail = readCurrentDispatchContextValue(detailState, currentContext, contextKey);
    if (
      !canConfirm || !sessionId || !user || !branchId || !contextKey || !detail ||
      selectedOrderIdRef.current !== detail.orderId
    ) return null;
    const requestContext = captureDispatchReadContext(contextStateRef.current, contextKey);
    if (!requestContext) return null;
    const payload = {
      ...(input.carrierName ? { carrierName: input.carrierName } : {}),
      ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
    };
    const fingerprint = createDispatchOperationFingerprint({
      action: "confirm-order",
      sessionId,
      userId: user.id,
      tenantId: user.tenantId,
      branchId,
      sourceType: "order",
      sourceId: detail.orderId,
      payload,
    });
    const mutationToken = mutationCoordinator.beginRequest();
    if (mutationToken === null) return null;
    const sequence = ++mutationSequenceRef.current;
    const operationId = mutationCoordinator.getOrCreateOperationId(fingerprint);
    setSubmittingState({ ...requestContext, value: detail.orderId });
    setErrorState(null);
    setSuccessState(null);
    try {
      const result = await service.confirmApiOrder(branchId, detail.orderId, {
        operationId,
        ...payload,
      });
      mutationCoordinator.markOperationDefinitive(fingerprint);
      if (!isCurrentOrderRequest(
        sequence,
        mutationSequenceRef.current,
        requestContext,
        contextStateRef.current,
        detail.orderId,
        selectedOrderIdRef.current,
      )) return result;
      detailSequenceRef.current += 1;
      selectedOrderIdRef.current = null;
      setSelectionState(null);
      setDetailState(null);
      setDetailLoadingState(null);
      setQueueState((state) => state &&
        state.requestedContextKey === requestContext.requestedContextKey &&
        state.requestedContextGeneration === requestContext.requestedContextGeneration
        ? { ...state, value: removeConfirmedDispatchSource(state.value, "order", detail.orderId) }
        : state);
      setSuccessState({
        ...requestContext,
        value: `${detail.orderReference} fue despachado correctamente.`,
      });
      await reload();
      return result;
    } catch (cause) {
      if (!shouldRetainDispatchOperationIdentity(cause)) {
        mutationCoordinator.markOperationDefinitive(fingerprint);
      }
      if (isCurrentOrderRequest(
        sequence,
        mutationSequenceRef.current,
        requestContext,
        contextStateRef.current,
        detail.orderId,
        selectedOrderIdRef.current,
      )) {
        setErrorState({
          ...requestContext,
          value: toMessage(cause, "No se pudo confirmar el despacho del pedido."),
        });
      }
      return null;
    } finally {
      if (mutationCoordinator.finishRequest(mutationToken)) setSubmittingState(null);
    }
  }, [branchId, canConfirm, contextKey, currentContext, detailState, mutationCoordinator, reload, service, sessionId, user]);

  const confirmTransfer = useCallback(async (
    transferId: string,
    reference: string,
  ): Promise<ApiDispatchResultDto | null> => {
    if (!canConfirm || !sessionId || !user || !branchId || !contextKey) return null;
    const requestContext = captureDispatchReadContext(contextStateRef.current, contextKey);
    if (!requestContext) return null;
    const fingerprint = createDispatchOperationFingerprint({
      action: "confirm-transfer",
      sessionId,
      userId: user.id,
      tenantId: user.tenantId,
      branchId,
      sourceType: "transfer",
      sourceId: transferId,
    });
    const mutationToken = mutationCoordinator.beginRequest();
    if (mutationToken === null) return null;
    const sequence = ++mutationSequenceRef.current;
    const operationId = mutationCoordinator.getOrCreateOperationId(fingerprint);
    setSubmittingState({ ...requestContext, value: transferId });
    setErrorState(null);
    setSuccessState(null);
    try {
      const result = await service.confirmApiTransfer(branchId, transferId, { operationId });
      mutationCoordinator.markOperationDefinitive(fingerprint);
      if (!isCurrentRequest(sequence, mutationSequenceRef.current, requestContext, contextStateRef.current)) {
        return result;
      }
      setQueueState((state) => state &&
        state.requestedContextKey === requestContext.requestedContextKey &&
        state.requestedContextGeneration === requestContext.requestedContextGeneration
        ? { ...state, value: removeConfirmedDispatchSource(state.value, "transfer", transferId) }
        : state);
      setSuccessState({ ...requestContext, value: `${reference} fue despachada correctamente.` });
      await reload();
      return result;
    } catch (cause) {
      if (!shouldRetainDispatchOperationIdentity(cause)) {
        mutationCoordinator.markOperationDefinitive(fingerprint);
      }
      if (isCurrentRequest(sequence, mutationSequenceRef.current, requestContext, contextStateRef.current)) {
        setErrorState({
          ...requestContext,
          value: toMessage(cause, "No se pudo confirmar el despacho de la transferencia."),
        });
      }
      return null;
    } finally {
      if (mutationCoordinator.finishRequest(mutationToken)) setSubmittingState(null);
    }
  }, [branchId, canConfirm, contextKey, mutationCoordinator, reload, service, sessionId, user]);

  const queue = readCurrentDispatchContextValue(queueState, currentContext, contextKey) ?? [];
  return {
    currentBranchName: currentBranch?.name ?? "Sin sucursal",
    hasBranchAccess,
    canRead,
    canConfirm,
    loading: loading || branchLoading || sessionLoading || Boolean(
      contextKey && hasBranchAccess && canRead &&
      readCurrentDispatchContextValue(queueState, currentContext, contextKey) === null &&
      readCurrentDispatchContextValue(errorState, currentContext, contextKey) === null,
    ),
    detailLoading: readCurrentDispatchContextValue(
      detailLoadingState,
      currentContext,
      contextKey,
    ) === true,
    mutationInFlight: mutationCoordinator.isRequestInFlight(),
    submittingSourceId: readCurrentDispatchContextValue(
      submittingState,
      currentContext,
      contextKey,
    ),
    queue,
    orders: queue.filter((item) => item.sourceType === "order"),
    transfers: queue.filter((item) => item.sourceType === "transfer"),
    selectedOrderId: readCurrentDispatchContextValue(selectionState, currentContext, contextKey),
    detail: readCurrentDispatchContextValue(detailState, currentContext, contextKey),
    error: readCurrentDispatchContextValue(errorState, currentContext, contextKey),
    success: readCurrentDispatchContextValue(successState, currentContext, contextKey),
    reload,
    selectOrder,
    clearSelection,
    confirmOrder,
    confirmTransfer,
  };
}

function isCurrentRequest(
  sequence: number,
  currentSequence: number,
  requestContext: DispatchReadContextToken,
  activeContext: { activeContextKey: string | null; generation: number },
) {
  return isCurrentDispatchRead({
    sequence,
    currentSequence,
    ...requestContext,
    activeContextKey: activeContext.activeContextKey,
    activeContextGeneration: activeContext.generation,
  });
}

function isCurrentOrderRequest(
  sequence: number,
  currentSequence: number,
  requestContext: DispatchReadContextToken,
  activeContext: { activeContextKey: string | null; generation: number },
  orderId: string,
  selectedOrderId: string | null,
) {
  return isCurrentDispatchRead({
    sequence,
    currentSequence,
    ...requestContext,
    activeContextKey: activeContext.activeContextKey,
    activeContextGeneration: activeContext.generation,
    requestedOrderId: orderId,
    selectedOrderId,
  });
}

function toMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
