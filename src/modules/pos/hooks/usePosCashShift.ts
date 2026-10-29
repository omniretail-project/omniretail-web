"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SaasCapabilityKey, type CashMovementType } from "@/core/enums";
import type { DataEventPayload } from "@/core/types/events.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import type { CashMovementDto } from "@/modules/pos/application/dto/CashMovementDto";
import type { CashShiftSummaryDto } from "@/modules/pos/application/dto/CashShiftSummaryDto";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";
import { CloseCashShiftService } from "@/modules/pos/application/services/CloseCashShiftService";
import { GetCashShiftMovementsService } from "@/modules/pos/application/services/GetCashShiftMovementsService";
import { GetCashShiftSummaryService } from "@/modules/pos/application/services/GetCashShiftSummaryService";
import { GetOpenCashShiftService } from "@/modules/pos/application/services/GetOpenCashShiftService";
import { OpenCashShiftService } from "@/modules/pos/application/services/OpenCashShiftService";
import { RegisterCashMovementService } from "@/modules/pos/application/services/RegisterCashMovementService";
import {
  PendingSaleConfirmationStore,
  pendingSaleScopeKey,
} from "@/modules/pos/application/services/pendingSaleConfirmation";
import { findRegisteredMovementCandidates } from "@/modules/pos/application/cashMovementVerification";
import {
  cleanPosError,
  isUncertainPosOutcome,
} from "@/modules/pos/application/services/posServiceContext";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

export interface OpenCashShiftFormInput {
  registerCode: string;
  openingAmount: number;
}

export interface CashMovementFormInput {
  type: CashMovementType;
  amount: number;
  reason: string;
}

/**
 * Resultado de un movimiento manual cuya respuesta fue incierta y que NO pudo darse por registrado.
 * Mientras exista, no se envia ningun otro movimiento: los manuales no son idempotentes.
 * - `unverifiable`: no se pudo consultar la caja; el bloqueo persiste hasta lograr la verificacion.
 * - `not_found`: la caja se consulto y el movimiento no aparece; reabrir el formulario lo libera.
 * - `ambiguous`: aparecieron varios movimientos nuevos iguales; reabrir el formulario lo libera.
 */
export interface CashMovementCheck {
  kind: "unverifiable" | "not_found" | "ambiguous";
  message: string;
  knownIds: string[];
  request: CashMovementFormInput;
  cashShiftId: string;
  actorUserId: string;
}

type CashLoadResult =
  | { status: "ok"; movements: CashMovementDto[] }
  | { status: "failed" }
  | { status: "superseded" };

interface CashReloadOptions {
  /** Tras una mutacion fallida: re-sincroniza sin borrar el motivo del fallo. */
  preserveError?: boolean;
  /** Ya hay datos en pantalla: no se muestra la carga global ni se borran si la consulta falla. */
  background?: boolean;
  /** false: el llamador interpreta el fallo (no se publica como error de la pagina). */
  reportFailure?: boolean;
}

const MOVEMENT_REGISTERED = "Movimiento de caja registrado correctamente.";
const MOVEMENT_REFRESH_FAILED =
  "No se pudo actualizar la lista: recarga la página para ver el estado vigente de la caja.";
const MOVEMENT_FOUND_AFTER_UNCERTAIN =
  "El servidor no devolvió una confirmación completa, pero el movimiento aparece registrado en la caja. Revisa la lista de movimientos.";
const MOVEMENT_UNVERIFIABLE =
  "No se pudo confirmar si el movimiento quedó registrado. No lo registres de nuevo hasta verificarlo: usa «Verificar de nuevo» o revisa la lista de movimientos.";
const MOVEMENT_NOT_FOUND =
  "Se consultó la caja y el movimiento no aparece. Si estás seguro de que no se registró, cierra esta ventana y vuelve a crearlo.";
const MOVEMENT_AMBIGUOUS =
  "Aparecieron varios movimientos nuevos con los mismos datos. No se registró otro automáticamente: revisa la lista de movimientos antes de continuar.";

export function usePosCashShift() {
  const repositories = useRepositories();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
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
      close: new CloseCashShiftService(repositories),
      getMovements: new GetCashShiftMovementsService(repositories),
      getOpen: new GetOpenCashShiftService(repositories),
      getSummary: new GetCashShiftSummaryService(repositories),
      open: new OpenCashShiftService(repositories),
      registerMovement: new RegisterCashMovementService(repositories),
    }),
    [repositories],
  );
  const [cashShift, setCashShift] = useState<PosCashShiftDto | null>(null);
  const [summary, setSummary] = useState<CashShiftSummaryDto | null>(null);
  const [movements, setMovements] = useState<CashMovementDto[]>([]);
  const [lastClosedShift, setLastClosedShift] = useState<PosCashShiftDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutationLoading, setMutationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Estado propio del formulario de movimientos: el modal no debe mostrar errores de otras fuentes
  // (carga de la pagina, eventos) con el titulo "No se pudo registrar el movimiento".
  const [movementError, setMovementError] = useState<string | null>(null);
  const [movementCheck, setMovementCheck] = useState<CashMovementCheck | null>(null);
  const [verifyingMovement, setVerifyingMovement] = useState(false);
  const mutationLockRef = useRef(false);
  const verifyingRef = useRef(false);
  const movementCheckRef = useRef<CashMovementCheck | null>(null);
  const reloadSequenceRef = useRef(0);

  const hasBranchAccess = Boolean(
    user &&
    currentBranch &&
    user.tenantId === currentBranch.tenantId &&
    canAccessBranch(currentBranch.id),
  );

  const getContext = useCallback(() => {
    if (!user || !currentBranch || !hasBranchAccess) {
      throw new Error("No hay una sesión y sucursal válidas para operar caja.");
    }
    return {
      tenantId: currentBranch.tenantId,
      actorUserId: user.id,
      branchId: currentBranch.id,
    };
  }, [currentBranch, hasBranchAccess, user]);

  /**
   * `preserveError`: tras una mutación fallida se re-sincroniza con el backend sin borrar el
   * motivo del fallo, que el usuario necesita para decidir si repite la operación.
   * `background`: refresco con datos ya en pantalla; no oculta la caja ni la borra si falla.
   * Devuelve el resultado para que quien refresca decida como interpretarlo.
   */
  const reload = useCallback(async (options: CashReloadOptions = {}): Promise<CashLoadResult> => {
    const requestId = reloadSequenceRef.current + 1;
    reloadSequenceRef.current = requestId;
    if (branchLoading || sessionLoading) return { status: "superseded" };
    const background = options.background === true;
    if (!background) setLoading(true);
    if (!options.preserveError && !background) setError(null);

    try {
      const context = getContext();
      const openShift = await services.getOpen.execute(context);
      if (requestId !== reloadSequenceRef.current) return { status: "superseded" };
      setCashShift(openShift);
      if (!openShift) {
        setSummary(null);
        setMovements([]);
        return { status: "ok", movements: [] };
      }

      const [nextSummary, nextMovements] = await Promise.all([
        services.getSummary.execute({ ...context, cashShiftId: openShift.id }),
        services.getMovements.execute({ ...context, cashShiftId: openShift.id }),
      ]);
      if (requestId !== reloadSequenceRef.current) return { status: "superseded" };
      setSummary(nextSummary);
      setMovements(nextMovements);
      return { status: "ok", movements: nextMovements };
    } catch (loadError) {
      if (requestId !== reloadSequenceRef.current) return { status: "superseded" };
      if (!background) {
        setCashShift(null);
        setSummary(null);
        setMovements([]);
      }
      if (options.reportFailure !== false) {
        setError(cleanPosError(loadError, sessionError ?? "No se pudo cargar el estado de caja."));
      }
      return { status: "failed" };
    } finally {
      if (requestId === reloadSequenceRef.current) setLoading(false);
    }
  }, [branchLoading, getContext, services, sessionError, sessionLoading]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  const handleCashShiftEvent = useCallback(
    (payload: DataEventPayload) => {
      if (payload.tenantId && payload.tenantId !== currentBranch?.tenantId) return;
      if (payload.branchId && payload.branchId !== currentBranch?.id) return;
      if (payload.entityId && cashShift && payload.entityId !== cashShift.id) return;
      // La propia mutación recarga el estado al terminar: una recarga paralela competiría con ella
      // (respuestas cruzadas, carga global intermitente) sin aportar datos nuevos.
      if (mutationLockRef.current) return;
      void reload({ background: Boolean(cashShift) });
    },
    [cashShift, currentBranch, reload],
  );
  useDataEvent("cash-shift.changed", handleCashShiftEvent);

  const runMutation = useCallback(async <T>(
    operation: () => Promise<T>,
    onFailure?: (cause: unknown) => void,
  ) => {
    if (mutationLockRef.current) return null;
    mutationLockRef.current = true;
    setMutationLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      return await operation();
    } catch (mutationError) {
      onFailure?.(mutationError);
      setError(
        cleanPosError(mutationError, "No se pudo completar la operación de caja.", "non_idempotent"),
      );
      return null;
    } finally {
      mutationLockRef.current = false;
      setMutationLoading(false);
    }
  }, []);

  const openCashShift = useCallback(
    async (input: OpenCashShiftFormInput) => {
      const opened = await runMutation(() => services.open.execute({ ...getContext(), ...input }));
      if (!opened) {
        await reload({ preserveError: true });
        return false;
      }
      setLastClosedShift(null);
      setSuccessMessage(`Caja ${opened.registerCode} abierta correctamente.`);
      await reload();
      return true;
    },
    [getContext, reload, runMutation, services.open],
  );

  const blockMovement = useCallback((check: CashMovementCheck) => {
    movementCheckRef.current = check;
    setMovementCheck(check);
    setMovementError(null);
  }, []);

  /**
   * Interpreta la caja consultada tras una respuesta incierta. Un unico movimiento nuevo y coincidente se
   * da por registrado; cualquier otra cosa BLOQUEA nuevos envios (los manuales no son idempotentes) e
   * informa la incertidumbre en lugar de suponer que fallo.
   */
  const settleUncertainMovement = useCallback(
    (
      check: Omit<CashMovementCheck, "kind" | "message">,
      verification: CashLoadResult,
    ) => {
      if (verification.status !== "ok") {
        blockMovement({ ...check, kind: "unverifiable", message: MOVEMENT_UNVERIFIABLE });
        return false;
      }
      const candidates = findRegisteredMovementCandidates({
        movements: verification.movements,
        knownIds: check.knownIds,
        request: check.request,
        cashShiftId: check.cashShiftId,
        actorUserId: check.actorUserId,
      });
      if (candidates.length === 1) {
        movementCheckRef.current = null;
        setMovementCheck(null);
        setMovementError(null);
        setError(null);
        setSuccessMessage(MOVEMENT_FOUND_AFTER_UNCERTAIN);
        return true;
      }
      blockMovement(
        candidates.length > 1
          ? { ...check, kind: "ambiguous", message: MOVEMENT_AMBIGUOUS }
          : { ...check, kind: "not_found", message: MOVEMENT_NOT_FOUND },
      );
      return false;
    },
    [blockMovement],
  );

  const registerMovement = useCallback(
    async (input: CashMovementFormInput) => {
      // Sin turno, con otra operación en curso (doble clic) o con un resultado previo sin resolver NO se
      // envía nada: el POST de un movimiento manual no es idempotente.
      if (!cashShift || !user || mutationLockRef.current || movementCheckRef.current) return false;
      const knownIds = movements.map((movement) => movement.id);
      const failure: { cause: unknown } = { cause: null };
      setMovementError(null);
      const movement = await runMutation(
        () =>
          services.registerMovement.execute({
            ...getContext(),
            cashShiftId: cashShift.id,
            ...input,
          }),
        (cause) => {
          failure.cause = cause;
        },
      );

      if (movement) {
        // El backend confirmó el registro: lo que falle al refrescar después NO lo convierte en fallo.
        const refreshed = await reload({ background: true, reportFailure: false });
        setSuccessMessage(
          refreshed.status === "failed"
            ? `${MOVEMENT_REGISTERED} ${MOVEMENT_REFRESH_FAILED}`
            : MOVEMENT_REGISTERED,
        );
        return true;
      }

      if (!isUncertainPosOutcome(failure.cause)) {
        // Rechazo definitivo (validación, permisos, turno): el formulario conserva lo escrito.
        setMovementError(
          cleanPosError(failure.cause, "No se pudo registrar el movimiento.", "non_idempotent"),
        );
        await reload({ preserveError: true, background: true });
        return false;
      }

      // Respuesta incierta: se consulta el estado autoritativo (solo lectura) antes de decidir nada.
      const verification = await reload({
        preserveError: true,
        background: true,
        reportFailure: false,
      });
      return settleUncertainMovement(
        { knownIds, request: input, cashShiftId: cashShift.id, actorUserId: user.id },
        verification,
      );
    },
    [cashShift, getContext, movements, reload, runMutation, services.registerMovement, settleUncertainMovement, user],
  );

  /** Vuelve a consultar la caja para resolver un movimiento incierto. Nunca envía otro movimiento. */
  const verifyMovement = useCallback(async () => {
    const check = movementCheckRef.current;
    if (!check || verifyingRef.current || mutationLockRef.current) return false;
    verifyingRef.current = true;
    setVerifyingMovement(true);
    try {
      const verification = await reload({
        preserveError: true,
        background: true,
        reportFailure: false,
      });
      return settleUncertainMovement(check, verification);
    } finally {
      verifyingRef.current = false;
      setVerifyingMovement(false);
    }
  }, [reload, settleUncertainMovement]);

  /**
   * Al abrir el formulario de nuevo: libera el bloqueo solo si la caja ya se consultó (movimiento no
   * encontrado o ambiguo). Si no se pudo verificar, el bloqueo persiste hasta lograrlo.
   */
  const resetMovementCheck = useCallback(() => {
    setMovementError(null);
    if (movementCheckRef.current?.kind === "unverifiable") return;
    movementCheckRef.current = null;
    setMovementCheck(null);
  }, []);

  const closeCashShift = useCallback(
    async (countedAmount: number) => {
      if (!cashShift) return false;
      // Igual que una venta pendiente: un movimiento manual sin verificar altera el efectivo esperado.
      if (movementCheckRef.current?.kind === "unverifiable") {
        setError("Hay un movimiento de caja sin verificar. Verifícalo antes de cerrar el turno.");
        return false;
      }
      // Cerrar el turno ocultaria una venta cuya respuesta se perdio: debe resolverse primero.
      if (
        user &&
        currentBranch &&
        new PendingSaleConfirmationStore().load(
          pendingSaleScopeKey(user.id, currentBranch.tenantId, currentBranch.id),
        )
      ) {
        setError(
          "Hay una venta pendiente de verificar en la terminal. Verifícala o descártala antes de cerrar el turno de caja.",
        );
        return false;
      }
      const closed = await runMutation(() =>
        services.close.execute({
          ...getContext(),
          cashShiftId: cashShift.id,
          countedAmount,
        }),
      );
      if (!closed) {
        await reload({ preserveError: true });
        return false;
      }
      setLastClosedShift(closed);
      setSuccessMessage("El turno de caja se cerró correctamente.");
      await reload();
      return true;
    },
    [cashShift, currentBranch, getContext, reload, runMutation, services.close, user],
  );

  const clearFeedback = useCallback(() => {
    setError(null);
    setSuccessMessage(null);
  }, []);

  return {
    cashShift,
    summary,
    movements,
    lastClosedShift,
    currentBranchName: currentBranch?.name ?? null,
    currentUserName: user?.name ?? null,
    loading: loading || branchLoading || sessionLoading,
    mutationLoading,
    error,
    successMessage,
    hasBranchAccess,
    movementError,
    movementCheck,
    verifyingMovement,
    // UI action gating (feature/saas-entitlement-enforcement §7/§11): "Sales History" (canRead)
    // NUNCA se gatea por capability -- historico read-only debe seguir visible aunque el plan
    // pierda POS. El backend (OpenCashShiftService/RegisterCashMovementService/
    // CloseCashShiftService) sigue siendo la autoridad final.
    canOpen: hasPermission("pos.cash.open") && canUsePos,
    canRead: hasPermission("pos.cash.read"),
    canRegisterMovement: hasPermission("pos.cash.movement.create") && canUsePos,
    canClose: hasPermission("pos.cash.close") && canUsePos,
    reload,
    openCashShift,
    registerMovement,
    verifyMovement,
    resetMovementCheck,
    closeCashShift,
    clearFeedback,
  };
}
