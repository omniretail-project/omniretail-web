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
import { cleanPosError } from "@/modules/pos/application/services/posServiceContext";
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
  const mutationLockRef = useRef(false);
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
   */
  const reload = useCallback(async (options: { preserveError?: boolean } = {}) => {
    const requestId = reloadSequenceRef.current + 1;
    reloadSequenceRef.current = requestId;
    if (branchLoading || sessionLoading) return;
    setLoading(true);
    if (!options.preserveError) setError(null);

    try {
      const context = getContext();
      const openShift = await services.getOpen.execute(context);
      if (requestId !== reloadSequenceRef.current) return;
      setCashShift(openShift);
      if (!openShift) {
        setSummary(null);
        setMovements([]);
        return;
      }

      const [nextSummary, nextMovements] = await Promise.all([
        services.getSummary.execute({ ...context, cashShiftId: openShift.id }),
        services.getMovements.execute({ ...context, cashShiftId: openShift.id }),
      ]);
      if (requestId !== reloadSequenceRef.current) return;
      setSummary(nextSummary);
      setMovements(nextMovements);
    } catch (loadError) {
      if (requestId !== reloadSequenceRef.current) return;
      setCashShift(null);
      setSummary(null);
      setMovements([]);
      setError(cleanPosError(loadError, sessionError ?? "No se pudo cargar el estado de caja."));
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
      void reload();
    },
    [cashShift, currentBranch, reload],
  );
  useDataEvent("cash-shift.changed", handleCashShiftEvent);

  const runMutation = useCallback(async <T>(operation: () => Promise<T>) => {
    if (mutationLockRef.current) return null;
    mutationLockRef.current = true;
    setMutationLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      return await operation();
    } catch (mutationError) {
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

  const registerMovement = useCallback(
    async (input: CashMovementFormInput) => {
      if (!cashShift) return false;
      const movement = await runMutation(() =>
        services.registerMovement.execute({
          ...getContext(),
          cashShiftId: cashShift.id,
          ...input,
        }),
      );
      if (!movement) {
        await reload({ preserveError: true });
        return false;
      }
      setSuccessMessage("Movimiento de caja registrado correctamente.");
      await reload();
      return true;
    },
    [cashShift, getContext, reload, runMutation, services.registerMovement],
  );

  const closeCashShift = useCallback(
    async (countedAmount: number) => {
      if (!cashShift) return false;
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
    closeCashShift,
    clearFeedback,
  };
}
