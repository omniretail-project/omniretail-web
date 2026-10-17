"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  CashShiftDto,
  CashShiftFilter,
} from "@/modules/administration/application/dto/CashShiftDto";
import { GetCashShiftsService } from "@/modules/administration/application/services/GetCashShiftsService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { CASH_READ_PERMISSION } from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

interface CashShiftReferenceData {
  shifts: CashShiftDto[];
  branchNames: Map<string, string>;
  actorNames: Map<string, string>;
}

export function useCashShifts() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const actorUserId = user?.id ?? null;
  const canRead = hasPermission(CASH_READ_PERMISSION);
  const service = useMemo(() => new GetCashShiftsService(repositories), [repositories]);
  const [shifts, setShifts] = useState<CashShiftDto[]>([]);
  const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map());
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<CashShiftFilter>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback((): Promise<CashShiftReferenceData> => {
    if (!tenantId || !actorUserId) {
      return Promise.reject(new Error("No se pudo resolver el negocio activo."));
    }

    return Promise.all([
      service.execute(tenantId, actorUserId, permissions),
      repositories.branches.getAll(),
      repositories.users.getAll(),
    ]).then(([nextShifts, branches, users]) => ({
      shifts: nextShifts,
      branchNames: new Map(
        branches
          .filter((branch) => branch.tenantId === tenantId)
          .map((branch) => [branch.id, branch.name]),
      ),
      actorNames: new Map(
        users.filter((actor) => actor.tenantId === tenantId).map((actor) => [actor.id, actor.name]),
      ),
    }));
  }, [actorUserId, permissions, repositories.branches, repositories.users, service, tenantId]);

  const reload = useCallback(async () => {
    if (sessionLoading || !canRead) return;

    setLoading(true);
    setError(null);
    try {
      const data = await loadData();
      setShifts(data.shifts);
      setBranchNames(data.branchNames);
      setActorNames(data.actorNames);
    } catch (caughtError) {
      setError(cleanError(caughtError));
    } finally {
      setLoading(false);
    }
  }, [canRead, loadData, sessionLoading]);

  useDataEvent("cash-shift.changed", reload);

  useEffect(() => {
    let active = true;

    if (sessionLoading) return () => void (active = false);

    if (!canRead) {
      window.queueMicrotask(() => {
        if (active) setLoading(false);
      });
      return () => void (active = false);
    }

    loadData()
      .then((data) => {
        if (!active) return;
        setShifts(data.shifts);
        setBranchNames(data.branchNames);
        setActorNames(data.actorNames);
        setError(null);
      })
      .catch((caughtError: unknown) => {
        if (active) setError(cleanError(caughtError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canRead, loadData, sessionLoading]);

  const filteredShifts = useMemo(() => {
    const query = filter.search?.trim().toLowerCase() ?? "";

    return shifts.filter((shift) => {
      const openedDate = shift.openedAt.slice(0, 10);
      const matchesSearch =
        !query ||
        [
          shift.registerCode,
          branchNames.get(shift.branchId) ?? shift.branchId,
          actorNames.get(shift.userId) ?? shift.userId,
        ].some((value) => value.toLowerCase().includes(query));

      return (
        matchesSearch &&
        (!filter.status || shift.status === filter.status) &&
        (!filter.branchId || shift.branchId === filter.branchId) &&
        (!filter.from || openedDate >= filter.from) &&
        (!filter.to || openedDate <= filter.to)
      );
    });
  }, [actorNames, branchNames, filter, shifts]);

  const resetFilter = useCallback(() => setFilter({}), []);

  return {
    loading: loading || sessionLoading,
    error,
    shifts,
    filteredShifts,
    branchNames,
    actorNames,
    filter,
    setFilter,
    resetFilter,
    canRead,
    reload,
  };
}
