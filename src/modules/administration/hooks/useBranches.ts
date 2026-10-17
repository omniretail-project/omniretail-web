"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { BranchDto, BranchInputDto } from "@/modules/administration/application/dto/BranchDto";
import { ArchiveBranchService } from "@/modules/administration/application/services/ArchiveBranchService";
import { CreateBranchService } from "@/modules/administration/application/services/CreateBranchService";
import { GetBranchesService } from "@/modules/administration/application/services/GetBranchesService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { UpdateBranchService } from "@/modules/administration/application/services/UpdateBranchService";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useBranches() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const actorUserId = user?.id ?? null;
  const canManage = hasPermission("admin.branches.manage");
  const canRead = hasPermission("admin.branches.read") || canManage;
  const getService = useMemo(() => new GetBranchesService(repositories), [repositories]);
  const createService = useMemo(() => new CreateBranchService(repositories), [repositories]);
  const updateService = useMemo(() => new UpdateBranchService(repositories), [repositories]);
  const archiveService = useMemo(() => new ArchiveBranchService(repositories), [repositories]);
  const [branches, setBranches] = useState<BranchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<BranchDto[]> => {
    if (sessionLoading) return [];
    if (!tenantId) {
      setBranches([]);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const nextBranches = await getService.execute(tenantId, permissions);
      setBranches(nextBranches);
      return nextBranches;
    } catch (caughtError) {
      setBranches([]);
      setError(cleanError(caughtError));
      return [];
    } finally {
      setLoading(false);
    }
  }, [getService, permissions, sessionLoading, tenantId]);

  useDataEvent("branch.changed", reload);

  useEffect(() => {
    let active = true;

    if (!sessionLoading && !tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setBranches([]);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
    } else if (tenantId) {
      getService
        .execute(tenantId, permissions)
        .then((nextBranches) => {
          if (!active) return;
          setBranches(nextBranches);
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (!active) return;
          setBranches([]);
          setError(cleanError(caughtError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [getService, permissions, sessionLoading, tenantId]);

  const runMutation = useCallback(
    async (action: (tenantId: string, actorUserId: string) => Promise<BranchDto>) => {
      if (!tenantId || !actorUserId) {
        const message = "No se pudo resolver la sesión actual.";
        setError(message);
        throw new Error(message);
      }

      setBusy(true);
      setError(null);
      try {
        return await action(tenantId, actorUserId);
      } catch (caughtError) {
        const message = cleanError(caughtError);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [actorUserId, tenantId],
  );

  const create = useCallback(
    (dto: BranchInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        createService.execute(currentTenantId, dto, permissions, currentActorUserId),
      ),
    [createService, permissions, runMutation],
  );

  const update = useCallback(
    (branchId: string, dto: BranchInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        updateService.execute(currentTenantId, branchId, dto, permissions, currentActorUserId),
      ),
    [permissions, runMutation, updateService],
  );

  const archive = useCallback(
    (branchId: string) =>
      runMutation((currentTenantId, currentActorUserId) =>
        archiveService.execute(currentTenantId, branchId, permissions, currentActorUserId),
      ),
    [archiveService, permissions, runMutation],
  );

  return {
    loading: loading || sessionLoading,
    busy,
    error,
    branches,
    canRead,
    canManage,
    create,
    update,
    archive,
    reload,
  };
}
