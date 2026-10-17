"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationResult,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type {
  RegularizationAttemptSummary,
  RegularizationDestination,
  RegularizationErrorInfo,
  RegularizationFailure,
  RegularizationProductOption,
} from "@/modules/inventory/application/dto/InventoryRegularizationDto";
import {
  classifyRegularizationFailure,
  freezeRegularizationRequest,
} from "@/modules/inventory/application/services/inventoryRegularizationAttempt";
import {
  clearPendingRegularization,
  isPendingRegularizationValidFor,
  readPendingRegularization,
  savePendingRegularization,
  type PendingRegularization,
} from "@/modules/inventory/application/services/inventoryRegularizationPending";
import {
  InventoryRegularizationService,
  REGULARIZATION_API_ONLY_MESSAGE,
} from "@/modules/inventory/application/services/InventoryRegularizationService";
import {
  INVENTORY_ADJUSTMENT_CREATE_PERMISSION,
  INVENTORY_STOCK_READ_PERMISSION,
} from "@/modules/inventory/application/services/serviceHelpers";
import {
  evaluateRegularizationGate,
  REGULARIZATION_ASSIGN_PERMISSION,
} from "@/modules/inventory/validation/inventoryRegularization.validation";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface KeyedLoad<T> {
  key: string;
  status: LoadStatus;
  data: T | null;
  error: RegularizationErrorInfo | null;
}

interface PreviewLoad extends KeyedLoad<LegacyBalanceRegularizationPreview> {
  /** Un 409 definitivo exige una vista previa nueva antes de otro intento. */
  stale: boolean;
  /** Destino y modo para los que se pidio: la vista previa solo vale para ellos. */
  locationId: string;
  assign: boolean;
}

interface SearchLoad {
  branchId: string;
  term: string;
  status: LoadStatus;
  items: RegularizationProductOption[];
  error: RegularizationErrorInfo | null;
}

export type RegularizationExecutionState =
  | { phase: "idle" }
  | {
      phase: "executing";
      request: Readonly<RegularizeLocationBalanceInput>;
      summary: RegularizationAttemptSummary;
    }
  | {
      phase: "uncertain";
      request: Readonly<RegularizeLocationBalanceInput>;
      failure: RegularizationFailure;
      summary: RegularizationAttemptSummary;
      /** true: el intento se recupero de una visita anterior a esta pantalla. */
      recovered: boolean;
      /**
       * Un reintento no pudo enviarse (permiso, acceso o validacion local) o fue rechazado antes de
       * comprobar la solicitud original: el intento previo se conserva, no se descarta.
       */
      retryFailure?: RegularizationFailure;
    }
  | { phase: "failed"; failure: RegularizationFailure }
  | {
      phase: "succeeded";
      result: LocationRegularizationResult;
      summary: RegularizationAttemptSummary;
    };

type KeyedExecution = { key: string } & RegularizationExecutionState;

const UNKNOWN_OUTCOME_MESSAGE =
  "Se envió una regularización y se salió de la pantalla antes de conocer su resultado.";

function toErrorInfo(error: unknown): RegularizationErrorInfo {
  const failure = classifyRegularizationFailure(error);
  return {
    ...(failure.code ? { code: failure.code } : {}),
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    message: failure.message,
    ...(failure.fields ? { fields: failure.fields } : {}),
    ...(failure.local ? { local: true } : {}),
  };
}

function toRecoveredExecution(pending: PendingRegularization): RegularizationExecutionState {
  return {
    phase: "uncertain",
    request: pending.request,
    failure: {
      kind: "uncertain",
      message: pending.failure?.message ?? UNKNOWN_OUTCOME_MESSAGE,
      ...(pending.failure?.code ? { code: pending.failure.code } : {}),
      ...(pending.failure?.status !== undefined ? { status: pending.failure.status } : {}),
    },
    summary: pending.summary,
    recovered: true,
  };
}

/**
 * Regularizacion de inventario heredado (con asignacion inicial opcional del destino). Garantias:
 *  - la vista previa, el destino, la ubicacion elegida y el resultado pertenecen a UN contexto
 *    (sucursal + producto); se guardan con su clave y solo se muestran si coincide con el actual.
 *    La vista previa ademas solo vale para la ubicacion y el modo (asignar o no) con que se pidio:
 *    cambiar sucursal, producto, ubicacion o modo la invalida de inmediato. Cada cambio de contexto
 *    invalida las solicitudes en vuelo con contadores (refs que solo se mutan en manejadores);
 *  - un producto con ubicacion asignada usa SIEMPRE esa ubicacion (modo normal, assign=false): la
 *    regularizacion no sustituye a un traslado; uno sin ubicacion permite elegir entre las activas
 *    que entrega el backend (modo asignacion, assign=true / assignDestination=true);
 *  - la solicitud se congela (clave UUID, modo, motivo, cantidades, fingerprint) al primer intento y
 *    un reintento reenvia exactamente la misma;
 *  - el intento se guarda en la pestana ANTES de enviarse y se limpia solo con exito confirmado,
 *    rechazo definitivo o descarte explicito; al volver a la pantalla se recupera como "incierto"
 *    (nunca se reenvia solo);
 *  - ante un resultado incierto el contexto queda bloqueado y NUNCA se envia un segundo POST de
 *    forma automatica.
 *
 * Los manejadores no usan useCallback: ningun efecto depende de su identidad y React Compiler los
 * memoiza.
 */
export function useInventoryRegularization() {
  const repositories = useRepositories();
  const { branches, currentBranch } = useActiveBranch();
  const { hasPermission, user } = useCurrentSession();
  const service = useMemo(() => new InventoryRegularizationService(repositories), [repositories]);
  const apiMode = repositories.inventoryStockDataSource === "api";
  const canPreview = hasPermission(INVENTORY_STOCK_READ_PERMISSION);
  const canExecute = hasPermission(INVENTORY_ADJUSTMENT_CREATE_PERMISSION);
  // La asignacion inicial exige ajustar inventario Y actualizar productos.
  const canAssign = canExecute && hasPermission(REGULARIZATION_ASSIGN_PERMISSION);

  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [productState, setProductState] = useState<{
    branchId: string;
    option: RegularizationProductOption;
  } | null>(null);
  const [searchState, setSearchState] = useState<SearchLoad | null>(null);
  const [destinationState, setDestinationState] = useState<KeyedLoad<RegularizationDestination> | null>(
    null,
  );
  const [locationState, setLocationState] = useState<{ key: string; locationId: string } | null>(
    null,
  );
  const [previewState, setPreviewState] = useState<PreviewLoad | null>(null);
  const [reasonState, setReasonState] = useState<{ key: string; value: string } | null>(null);
  const [executionState, setExecutionState] = useState<KeyedExecution | null>(null);
  // Intento pendiente de una visita anterior (misma pestana). Se valida contra la sesion al render.
  const [storedAttempt, setStoredAttempt] = useState<PendingRegularization | null>(() =>
    readPendingRegularization(),
  );

  const searchRequestRef = useRef(0);
  const destinationRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const executingRef = useRef(false);

  const recoveredAttempt =
    storedAttempt && user
      ? isPendingRegularizationValidFor(storedAttempt, {
          tenantId: user.tenantId,
          userId: user.id,
          branchIds: branches
            .filter((branch) => branch.tenantId === user.tenantId)
            .map((branch) => branch.id),
        })
        ? storedAttempt
        : null
      : null;

  // Un registro de otro usuario/negocio, o de una sucursal ya no autorizada, no se restaura.
  const droppableKey =
    storedAttempt !== null && user !== null && branches.length > 0 && recoveredAttempt === null
      ? storedAttempt.request.idempotencyKey
      : null;
  useEffect(() => {
    if (droppableKey) clearPendingRegularization(droppableKey);
  }, [droppableKey]);

  // Mientras hay un intento en curso o incierto (propio o recuperado), el contexto queda fijado.
  const pinnedAttempt: RegularizationExecutionState | null =
    executionState && (executionState.phase === "executing" || executionState.phase === "uncertain")
      ? executionState
      : executionState === null && recoveredAttempt
        ? toRecoveredExecution(recoveredAttempt)
        : null;
  const attemptBranchId =
    pinnedAttempt &&
    (pinnedAttempt.phase === "executing" || pinnedAttempt.phase === "uncertain")
      ? pinnedAttempt.request.branchId
      : null;
  const locked = attemptBranchId !== null;

  const allowedBranchIds = new Set(branches.map((branch) => branch.id));
  const branchId = attemptBranchId
    ? attemptBranchId
    : selectedBranchId && allowedBranchIds.has(selectedBranchId)
      ? selectedBranchId
      : currentBranch && allowedBranchIds.has(currentBranch.id)
        ? currentBranch.id
        : "";

  const product = productState && productState.branchId === branchId ? productState.option : null;
  const contextKey = product ? `${branchId}|${product.id}` : null;

  const destination =
    contextKey && destinationState?.key === contextKey ? destinationState : null;
  const destinationData = destination?.data ?? null;
  // Sin ubicacion asignada: modo asignacion inicial (el usuario elige entre las asignables).
  const assignMode = destinationData?.kind === "unassigned";
  const chosenLocationId =
    contextKey && locationState?.key === contextKey ? locationState.locationId : null;
  const selectedLocationId =
    destinationData?.kind === "unassigned" &&
    chosenLocationId &&
    destinationData.assignableLocations.some((option) => option.id === chosenLocationId)
      ? chosenLocationId
      : null;
  const targetLocationId =
    destinationData?.kind === "assigned" ? destinationData.locationId : selectedLocationId;
  const preview =
    contextKey &&
    previewState?.key === contextKey &&
    previewState.assign === assignMode &&
    previewState.locationId === targetLocationId
      ? previewState
      : null;
  const reason = contextKey && reasonState?.key === contextKey ? reasonState.value : "";
  const search = searchState && searchState.branchId === branchId ? searchState : null;
  const execution: RegularizationExecutionState =
    pinnedAttempt ??
    // Sin producto seleccionado solo puede quedar el resultado de un reintento recuperado.
    (executionState && (contextKey === null || executionState.key === contextKey)
      ? executionState
      : { phase: "idle" });

  // Un intento incierto no se pierde al cerrar o recargar la pestana sin avisar.
  useEffect(() => {
    if (!locked) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [locked]);

  async function loadPreview(
    key: string,
    targetBranchId: string,
    productId: string,
    locationId: string,
    assign: boolean,
  ) {
    const requestId = ++previewRequestRef.current;
    setPreviewState({
      key,
      status: "loading",
      data: null,
      error: null,
      stale: false,
      locationId,
      assign,
    });
    try {
      const data = await service.preview(targetBranchId, productId, locationId, assign);
      if (requestId !== previewRequestRef.current) return;
      setPreviewState({
        key,
        status: "ready",
        data,
        error: null,
        stale: false,
        locationId,
        assign,
      });
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setPreviewState({
        key,
        status: "error",
        data: null,
        error: toErrorInfo(error),
        stale: false,
        locationId,
        assign,
      });
    }
  }

  async function loadDestination(
    key: string,
    targetBranchId: string,
    productId: string,
    keepLocationId: string | null = null,
  ) {
    const requestId = ++destinationRequestRef.current;
    previewRequestRef.current += 1;
    setPreviewState(null);
    setDestinationState({ key, status: "loading", data: null, error: null });
    try {
      const data = await service.resolveDestination(targetBranchId, productId);
      if (requestId !== destinationRequestRef.current) return;
      setDestinationState({ key, status: "ready", data, error: null });
      if (data.kind === "assigned") {
        // Ubicacion ya asignada: flujo original (assign=false), sin elegir otra.
        await loadPreview(key, targetBranchId, productId, data.locationId, false);
      } else if (data.kind === "unassigned" && keepLocationId) {
        // Se conserva la eleccion previa solo si el backend aun la considera asignable.
        if (data.assignableLocations.some((option) => option.id === keepLocationId)) {
          await loadPreview(key, targetBranchId, productId, keepLocationId, true);
        } else {
          setLocationState(null);
        }
      }
    } catch (error) {
      if (requestId !== destinationRequestRef.current) return;
      setDestinationState({ key, status: "error", data: null, error: toErrorInfo(error) });
    }
  }

  async function searchProducts(term: string) {
    if (!branchId || !canPreview) return;
    const requestId = ++searchRequestRef.current;
    const requestedBranchId = branchId;
    setSearchState({ branchId: requestedBranchId, term, status: "loading", items: [], error: null });
    try {
      const items = await service.searchProducts(requestedBranchId, term);
      if (requestId !== searchRequestRef.current) return;
      setSearchState({ branchId: requestedBranchId, term, status: "ready", items, error: null });
    } catch (error) {
      if (requestId !== searchRequestRef.current) return;
      setSearchState({
        branchId: requestedBranchId,
        term,
        status: "error",
        items: [],
        error: toErrorInfo(error),
      });
    }
  }

  /** Invalida de inmediato cualquier lectura en vuelo del contexto anterior. */
  function invalidateContextRequests() {
    searchRequestRef.current += 1;
    destinationRequestRef.current += 1;
    previewRequestRef.current += 1;
  }

  function selectBranch(nextBranchId: string) {
    if (locked || nextBranchId === branchId) return;
    invalidateContextRequests();
    setSelectedBranchId(nextBranchId);
    setSearchState(null);
    setExecutionState(null);
  }

  function selectProduct(option: RegularizationProductOption) {
    if (locked || !branchId || !canPreview) return;
    const key = `${branchId}|${option.id}`;
    invalidateContextRequests();
    setProductState({ branchId, option });
    setExecutionState(null);
    setLocationState(null);
    void loadDestination(key, branchId, option.id);
  }

  function clearProduct() {
    if (locked) return;
    invalidateContextRequests();
    setProductState(null);
    setExecutionState(null);
    setLocationState(null);
  }

  /**
   * Elige la ubicacion que se asignara (solo cuando el producto no tiene ninguna). Cambiarla
   * invalida la vista previa y pide otra con assign=true. Una ubicacion ya asignada no se cambia.
   */
  function selectLocation(locationId: string) {
    if (locked || !contextKey || !product || destinationData?.kind !== "unassigned") return;
    previewRequestRef.current += 1;
    setPreviewState(null);
    setExecutionState((current) =>
      current && (current.phase === "failed" || current.phase === "succeeded") ? null : current,
    );
    if (!destinationData.assignableLocations.some((option) => option.id === locationId)) {
      setLocationState(null);
      return;
    }
    setLocationState({ key: contextKey, locationId });
    void loadPreview(contextKey, branchId, product.id, locationId, true);
  }

  async function refreshPreview() {
    if (locked || !contextKey || !product) return;
    // El resultado o el error anterior ya se mostraron; una vista previa nueva inicia otro ciclo.
    setExecutionState((current) =>
      current && (current.phase === "failed" || current.phase === "succeeded") ? null : current,
    );
    // Siempre se relee el destino: tras una asignacion o un cambio ajeno el modo puede haber cambiado.
    await loadDestination(contextKey, branchId, product.id, selectedLocationId);
  }

  function setReason(value: string) {
    if (!contextKey || locked) return;
    setReasonState({ key: contextKey, value });
  }

  const gate = evaluateRegularizationGate({
    preview: preview?.data ?? null,
    previewStale: preview?.stale ?? false,
    destination: destinationData,
    selectedLocationId,
    reason,
    canAdjust: canExecute,
    canAssign,
  });
  const canSubmit = gate.allowed && !locked && execution.phase !== "succeeded";

  async function runRequest(
    key: string,
    request: Readonly<RegularizeLocationBalanceInput>,
    summary: RegularizationAttemptSummary,
    identity: { tenantId: string; userId: string },
    previous: { failure: RegularizationFailure; recovered: boolean } | null = null,
  ) {
    executingRef.current = true;
    setExecutionState({ key, phase: "executing", request, summary });
    try {
      const result = await service.regularize(request);
      // Exito confirmado: ya no hay nada que recuperar.
      clearPendingRegularization(request.idempotencyKey);
      setStoredAttempt(null);
      // La vista previa anterior deja de ser valida: el saldo ya se movio.
      previewRequestRef.current += 1;
      setPreviewState({
        key,
        status: "idle",
        data: null,
        error: null,
        stale: true,
        locationId: request.locationId,
        assign: request.assignDestination === true,
      });
      setExecutionState({ key, phase: "succeeded", result, summary });
    } catch (error) {
      const failure = classifyRegularizationFailure(error);
      if (failure.kind === "uncertain") {
        // Se conserva la solicitud congelada (tambien al salir de la pantalla): solo se puede
        // reintentar la MISMA, con su clave.
        savePendingRegularization({
          tenantId: identity.tenantId,
          userId: identity.userId,
          request,
          summary,
          failure: {
            message: failure.message,
            ...(failure.code ? { code: failure.code } : {}),
            ...(failure.status !== undefined ? { status: failure.status } : {}),
          },
        });
        setExecutionState({
          key,
          phase: "uncertain",
          request,
          failure,
          summary,
          recovered: false,
        });
      } else if (previous && (failure.local || failure.status !== 409)) {
        // Reintento que no llego a comprobar la solicitud original (permiso, acceso, validacion
        // local o rechazo previo al registro idempotente): el intento enviado antes NO se borra.
        setExecutionState({
          key,
          phase: "uncertain",
          request,
          failure: previous.failure,
          summary,
          recovered: previous.recovered,
          retryFailure: failure,
        });
      } else {
        clearPendingRegularization(request.idempotencyKey);
        setStoredAttempt(null);
        setExecutionState({ key, phase: "failed", failure });
        if (failure.status === 409) {
          setPreviewState((current) =>
            current && current.key === key ? { ...current, stale: true } : current,
          );
        }
      }
    } finally {
      executingRef.current = false;
    }
  }

  /** Primer intento: congela clave + modo + cuerpo a partir de la vista previa y el motivo vigentes. */
  async function submit() {
    if (executingRef.current || locked) return;
    if (!canSubmit || !contextKey || !preview?.data || !user) return;
    const request = freezeRegularizationRequest({
      preview: preview.data,
      reason,
      idempotencyKey: globalThis.crypto.randomUUID(),
      assignDestination: assignMode,
    });
    const summary: RegularizationAttemptSummary = {
      productName: preview.data.productName,
      sku: preview.data.sku,
      locationName: preview.data.locationName,
    };
    const identity = { tenantId: user.tenantId, userId: user.id };
    // Se guarda ANTES de enviar: si la pantalla se desmonta con el POST en vuelo, el intento se
    // recupera como incierto y no se genera una clave nueva.
    savePendingRegularization({ ...identity, request, summary, failure: null });
    await runRequest(contextKey, request, summary, identity);
  }

  /** Reintento manual de un resultado incierto: misma clave, mismo cuerpo, ningun recalculo. */
  async function retryUncertain() {
    if (executingRef.current || !canExecute || !user) return;
    if (execution.phase !== "uncertain") return;
    const { request, summary, failure, recovered } = execution;
    await runRequest(
      `${request.branchId}|${request.productId}`,
      request,
      summary,
      { tenantId: user.tenantId, userId: user.id },
      { failure, recovered },
    );
  }

  /** Descarte explicito (el usuario ya confirmo que desconoce el resultado); exige nueva vista previa. */
  function discardUncertain() {
    if (executingRef.current || execution.phase !== "uncertain") return;
    const { request } = execution;
    clearPendingRegularization(request.idempotencyKey);
    setStoredAttempt(null);
    previewRequestRef.current += 1;
    setPreviewState({
      key: `${request.branchId}|${request.productId}`,
      status: "idle",
      data: null,
      error: null,
      stale: true,
      locationId: request.locationId,
      assign: request.assignDestination === true,
    });
    setExecutionState(null);
  }

  function dismissResult() {
    setExecutionState((current) => (current?.phase === "succeeded" ? null : current));
  }

  return {
    apiMode,
    apiOnlyMessage: REGULARIZATION_API_ONLY_MESSAGE,
    canPreview,
    canExecute,
    canAssign,
    branches,
    branchId,
    locked,
    search,
    product,
    destination,
    assignMode,
    selectedLocationId,
    preview,
    reason,
    execution,
    gate,
    canSubmit,
    selectBranch,
    searchProducts,
    selectProduct,
    clearProduct,
    selectLocation,
    refreshPreview,
    setReason,
    submit,
    retryUncertain,
    discardUncertain,
    dismissResult,
  };
}
