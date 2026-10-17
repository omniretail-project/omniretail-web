"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaasCapabilityKey } from "@/core/enums";
import type { DataEventPayload } from "@/core/types/events.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import type { ReturnSaleLookupDto } from "@/modules/pos/application/dto/ReturnSaleLookupDto";
import type { SaleReversalResultDto } from "@/modules/pos/application/dto/SaleReversalResultDto";
import { GetReturnSaleLookupService } from "@/modules/pos/application/services/GetReturnSaleLookupService";
import { ProcessSaleReturnService } from "@/modules/pos/application/services/ProcessSaleReturnService";
import { VoidSaleService } from "@/modules/pos/application/services/VoidSaleService";
import {
  validateReturnSelection,
  validateVoidReason,
} from "@/modules/pos/validation/returns.validation";
import { cleanPosError } from "@/modules/pos/application/services/posServiceContext";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

export type SaleReversalMode = "return" | "void";

export function usePosReturns() {
  const repositories = useRepositories();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    sessionId,
    user,
    canAccessBranch,
    hasPermission,
    loading: sessionLoading,
    error: sessionError,
  } = useCurrentSession();
  const { hasCapability } = useEntitlement();
  const canUsePos = hasCapability(SaasCapabilityKey.pos);
  const services = useMemo(
    () => ({
      lookup: new GetReturnSaleLookupService(repositories),
      processReturn: new ProcessSaleReturnService(repositories),
      voidSale: new VoidSaleService(repositories),
    }),
    [repositories],
  );

  const [documentNumber, setDocumentNumber] = useState("");
  const [lookup, setLookup] = useState<ReturnSaleLookupDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [mode, setMode] = useState<SaleReversalMode | null>(null);
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SaleReversalResultDto | null>(null);
  const lookupSequenceRef = useRef(0);
  const mutationLockRef = useRef(false);
  const operationKeyRef = useRef<string | null>(null);
  const attemptedPayloadRef = useRef<string | null>(null);
  const currentContextKey = `${sessionId ?? ""}:${user?.id ?? ""}:${currentBranch?.tenantId ?? ""}:${currentBranch?.id ?? ""}`;
  const currentContextRef = useRef(currentContextKey);

  const hasBranchAccess = Boolean(
    user &&
    currentBranch &&
    user.tenantId === currentBranch.tenantId &&
    canAccessBranch(currentBranch.id),
  );
  const canRead = hasPermission("pos.returns.read");
  // UI action gating (feature/saas-entitlement-enforcement §7/§11): devolucion/anulacion son
  // operaciones activas -- se gatean por capability. `canRead` (busqueda de la venta) queda
  // intacto: no es historico de solo lectura como Sales History, es la puerta de entrada al flujo.
  const canProcessReturn = hasPermission("pos.returns.create") && canUsePos;
  const canVoid = hasPermission("pos.sales.void") && canUsePos;
  const contextLoading = branchLoading || sessionLoading;
  const accessBlocked =
    !contextLoading && (!user || !currentBranch || !hasBranchAccess || !canRead);

  const getContext = useCallback(() => {
    if (!user || !currentBranch || !hasBranchAccess) {
      throw new Error("No hay una sesión y sucursal válidas para consultar devoluciones.");
    }
    return {
      tenantId: currentBranch.tenantId,
      branchId: currentBranch.id,
      actorUserId: user.id,
    };
  }, [currentBranch, hasBranchAccess, user]);

  const resetOperation = useCallback(() => {
    setMode(null);
    setReason("");
    setQuantities({});
    setOperationError(null);
    operationKeyRef.current = null;
    attemptedPayloadRef.current = null;
  }, []);

  const loadLookup = useCallback(
    async (requestedDocument: string, resetWorkflow: boolean) => {
      const requestId = lookupSequenceRef.current + 1;
      lookupSequenceRef.current = requestId;
      const requestedContext = currentContextKey;
      if (resetWorkflow) {
        setLookup(null);
        resetOperation();
        setOperationNotice(null);
        setResult(null);
      }
      setIsSearching(true);
      setLookupError(null);
      setNotFound(false);

      try {
        const nextLookup = await services.lookup.execute({
          ...getContext(),
          documentNumber: requestedDocument,
        });
        if (
          requestId !== lookupSequenceRef.current ||
          requestedContext !== currentContextRef.current
        ) {
          return null;
        }
        setLookup(nextLookup);
        setNotFound(!nextLookup);
        return nextLookup;
      } catch (error) {
        if (
          requestId !== lookupSequenceRef.current ||
          requestedContext !== currentContextRef.current
        ) {
          return null;
        }
        if (resetWorkflow) setLookup(null);
        setLookupError(cleanPosError(error, sessionError ?? "No se pudo consultar la venta."));
        return null;
      } finally {
        if (
          requestId === lookupSequenceRef.current &&
          requestedContext === currentContextRef.current
        ) {
          setIsSearching(false);
        }
      }
    },
    [currentContextKey, getContext, resetOperation, services.lookup, sessionError],
  );

  const search = useCallback(async () => {
    const normalizedDocument = documentNumber.trim();
    if (!normalizedDocument) {
      setLookup(null);
      setNotFound(false);
      setLookupError("Ingrese el número de documento que desea consultar.");
      return false;
    }
    if (accessBlocked) {
      setLookup(null);
      setNotFound(false);
      setLookupError("No dispone de acceso para consultar devoluciones en la sucursal activa.");
      return false;
    }
    return Boolean(await loadLookup(normalizedDocument, true));
  }, [accessBlocked, documentNumber, loadLookup]);

  useEffect(() => {
    currentContextRef.current = currentContextKey;
    window.queueMicrotask(() => {
      lookupSequenceRef.current += 1;
      setLookup(null);
      setNotFound(false);
      setLookupError(null);
      setOperationNotice(null);
      setResult(null);
      resetOperation();
    });
  }, [currentContextKey, resetOperation]);

  const handleSaleChanged = useCallback(
    (payload: DataEventPayload) => {
      if (!lookup || mutationLockRef.current || !currentBranch) return;
      if (payload.tenantId !== currentBranch.tenantId) return;
      if (payload.branchId !== currentBranch.id) return;
      if (payload.entityId !== lookup.sale.saleId) return;
      void loadLookup(lookup.sale.documentNumber, false);
    },
    [currentBranch, loadLookup, lookup],
  );
  useDataEvent("sale.returned", handleSaleChanged);
  useDataEvent("sale.voided", handleSaleChanged);

  const beginOperation = useCallback(
    (nextMode: SaleReversalMode) => {
      if (!lookup) return;
      if (nextMode === "return" && (!canProcessReturn || !lookup.allowedOperations.partialReturn)) {
        return;
      }
      if (nextMode === "void" && (!canVoid || !lookup.allowedOperations.voidTotal)) return;
      setMode(nextMode);
      setReason("");
      setQuantities({});
      setOperationError(null);
      setOperationNotice(null);
      setResult(null);
      operationKeyRef.current = crypto.randomUUID();
      attemptedPayloadRef.current = null;
    },
    [canProcessReturn, canVoid, lookup],
  );

  const closeOperation = useCallback(() => {
    if (mutationLockRef.current) return;
    resetOperation();
  }, [resetOperation]);

  const returnValidation = useMemo(
    () => validateReturnSelection(reason, quantities, lookup?.items ?? []),
    [lookup?.items, quantities, reason],
  );
  const voidValidation = useMemo(() => validateVoidReason(reason), [reason]);
  const activeOperationBlockedReason = getOperationBlockedReason({
    mode,
    lookup,
    canProcessReturn,
    canVoid,
  });
  const activeOperationAllowed = Boolean(mode && !activeOperationBlockedReason);
  const formIsValid = Boolean(
    activeOperationAllowed &&
    !processing &&
    (mode === "return" ? returnValidation.isValid : voidValidation.isValid),
  );

  useEffect(() => {
    if (!mode || !activeOperationBlockedReason || processing) return;
    window.queueMicrotask(() => {
      setOperationNotice(activeOperationBlockedReason);
      resetOperation();
    });
  }, [activeOperationBlockedReason, mode, processing, resetOperation]);

  const setLineQuantity = useCallback((saleItemId: string, value: string) => {
    setQuantities((current) => ({ ...current, [saleItemId]: value }));
  }, []);

  const submitOperation = useCallback(async () => {
    if (!lookup || !mode || mutationLockRef.current) return false;
    const blockedReason = getOperationBlockedReason({
      mode,
      lookup,
      canProcessReturn,
      canVoid,
    });
    if (blockedReason) {
      setOperationError(blockedReason);
      return false;
    }
    if (!formIsValid) return false;
    const lines = mode === "return" ? returnValidation.lines : [];
    const payloadFingerprint = JSON.stringify({
      mode,
      saleId: lookup.sale.saleId,
      reason: reason.trim(),
      lines,
    });
    if (
      !operationKeyRef.current ||
      (attemptedPayloadRef.current !== null && attemptedPayloadRef.current !== payloadFingerprint)
    ) {
      operationKeyRef.current = crypto.randomUUID();
    }
    attemptedPayloadRef.current = payloadFingerprint;
    const idempotencyKey = operationKeyRef.current;
    const operationContext = currentContextKey;

    mutationLockRef.current = true;
    setProcessing(true);
    setOperationError(null);
    try {
      const context = getContext();
      const nextResult =
        mode === "return"
          ? await services.processReturn.execute({
              ...context,
              saleId: lookup.sale.saleId,
              idempotencyKey,
              reason: reason.trim(),
              lines,
            })
          : await services.voidSale.execute({
              ...context,
              saleId: lookup.sale.saleId,
              idempotencyKey,
              reason: reason.trim(),
            });
      if (operationContext !== currentContextRef.current) return false;
      setResult(nextResult);
      setMode(null);
      setReason("");
      setQuantities({});
      operationKeyRef.current = null;
      attemptedPayloadRef.current = null;
      await loadLookup(lookup.sale.documentNumber, false);
      return true;
    } catch (error) {
      if (operationContext !== currentContextRef.current) return false;
      setOperationError(cleanPosError(error, "No se pudo completar la operación.", "idempotent"));
      await loadLookup(lookup.sale.documentNumber, false);
      return false;
    } finally {
      mutationLockRef.current = false;
      setProcessing(false);
    }
  }, [
    canProcessReturn,
    canVoid,
    currentContextKey,
    formIsValid,
    getContext,
    loadLookup,
    lookup,
    mode,
    reason,
    returnValidation.lines,
    services.processReturn,
    services.voidSale,
  ]);

  return {
    documentNumber,
    lookup,
    notFound,
    isSearching,
    lookupError,
    mode,
    reason,
    quantities,
    processing,
    operationError,
    operationNotice,
    result,
    currentBranchName: currentBranch?.name ?? null,
    contextLoading,
    accessBlocked,
    hasBranchAccess,
    canRead,
    canProcessReturn,
    canVoid,
    formIsValid,
    reasonError: mode === "return" ? returnValidation.reasonError : voidValidation.reasonError,
    lineErrors: returnValidation.lineErrors,
    setDocumentNumber,
    search,
    beginOperation,
    closeOperation,
    setReason,
    setLineQuantity,
    submitOperation,
  };
}

function getOperationBlockedReason({
  mode,
  lookup,
  canProcessReturn,
  canVoid,
}: {
  mode: SaleReversalMode | null;
  lookup: ReturnSaleLookupDto | null;
  canProcessReturn: boolean;
  canVoid: boolean;
}) {
  if (!mode) return null;
  if (!lookup) return "La venta ya no está disponible para completar esta operación.";
  if (mode === "return") {
    if (!canProcessReturn) return "Ya no dispone de permisos para procesar devoluciones.";
    if (!lookup.allowedOperations.partialReturn) {
      return (
        lookup.allowedOperations.returnBlockedReason ??
        "La devolución dejó de estar permitida para esta venta."
      );
    }
    return null;
  }
  if (!canVoid) return "Ya no dispone de permisos para anular ventas.";
  if (!lookup.allowedOperations.voidTotal) {
    return (
      lookup.allowedOperations.voidBlockedReason ??
      "La anulación dejó de estar permitida para esta venta."
    );
  }
  return null;
}
