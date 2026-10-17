"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

type TransferQueue = Awaited<ReturnType<DispatchApplicationService["getTransferQueue"]>>;

export function useTransferDispatch() {
  const repositories = useRepositories();
  const service = useMemo(() => new DispatchApplicationService(repositories), [repositories]);
  const { currentBranch } = useActiveBranch();
  const { hasPermission } = useCurrentSession();
  const branchId = currentBranch?.id ?? "";
  const canRead = hasPermission("logistics.dispatch.read");
  const canConfirm = hasPermission("logistics.dispatch.confirm");
  const [items, setItems] = useState<TransferQueue>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const pendingOperationIds = useRef(new Map<string, string>());
  const lock = useRef(false);

  const reload = useCallback(async () => {
    const currentGeneration = ++generation.current;
    if (!branchId || !canRead) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const queue = await service.getTransferQueue(branchId);
      if (currentGeneration === generation.current) {
        setItems(queue);
        setError(null);
      }
    } catch (cause) {
      if (currentGeneration === generation.current) {
        setItems([]);
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar traslados.");
      }
    } finally {
      if (currentGeneration === generation.current) setLoading(false);
    }
  }, [branchId, canRead, service]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void reload(); });
    return () => { active = false; generation.current += 1; };
  }, [reload]);
  useDataEvent("packing.changed", reload);
  useDataEvent("inventory-transfer.changed", reload);

  const confirm = useCallback(async (transferId: string) => {
    if (!branchId || !canConfirm || lock.current) return false;
    lock.current = true;
    const startedBranch = branchId;
    const startedGeneration = generation.current;
    const operationId = pendingOperationIds.current.get(transferId) ?? crypto.randomUUID();
    pendingOperationIds.current.set(transferId, operationId);
    setBusyId(transferId);
    setError(null);
    try {
      await service.confirmTransfer(branchId, transferId, operationId);
      pendingOperationIds.current.delete(transferId);
      if (startedBranch === branchId && startedGeneration === generation.current) await reload();
      return true;
    } catch (cause) {
      if (startedGeneration === generation.current) {
        setError(cause instanceof Error ? cause.message : "No se pudo despachar el traslado.");
      }
      return false;
    } finally {
      lock.current = false;
      setBusyId(null);
    }
  }, [branchId, canConfirm, reload, service]);

  return { items, loading, busyId, error, canRead, canConfirm, confirm, reload };
}
