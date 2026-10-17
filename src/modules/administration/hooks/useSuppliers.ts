"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  SupplierDto,
  SupplierInputDto,
} from "@/modules/administration/application/dto/SupplierDto";
import { ArchiveSupplierService } from "@/modules/administration/application/services/ArchiveSupplierService";
import { CreateSupplierService } from "@/modules/administration/application/services/CreateSupplierService";
import { GetSuppliersService } from "@/modules/administration/application/services/GetSuppliersService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { UpdateSupplierService } from "@/modules/administration/application/services/UpdateSupplierService";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useSuppliers() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const actorUserId = user?.id ?? null;
  const canManage = hasPermission("admin.suppliers.manage");
  const getService = useMemo(() => new GetSuppliersService(repositories), [repositories]);
  const createService = useMemo(() => new CreateSupplierService(repositories), [repositories]);
  const updateService = useMemo(() => new UpdateSupplierService(repositories), [repositories]);
  const archiveService = useMemo(() => new ArchiveSupplierService(repositories), [repositories]);
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<SupplierDto[]> => {
    if (sessionLoading) return [];
    if (!tenantId) {
      setSuppliers([]);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const nextSuppliers = await getService.execute(tenantId, permissions);
      setSuppliers(nextSuppliers);
      return nextSuppliers;
    } catch (caughtError) {
      setSuppliers([]);
      setError(cleanError(caughtError));
      return [];
    } finally {
      setLoading(false);
    }
  }, [getService, permissions, sessionLoading, tenantId]);

  useDataEvent("supplier.changed", reload);

  useEffect(() => {
    let active = true;

    if (!sessionLoading && !tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setSuppliers([]);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
    } else if (tenantId) {
      getService
        .execute(tenantId, permissions)
        .then((nextSuppliers) => {
          if (!active) return;
          setSuppliers(nextSuppliers);
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (!active) return;
          setSuppliers([]);
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
    async (action: (tenantId: string, actorUserId: string) => Promise<SupplierDto>) => {
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
    (dto: SupplierInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        createService.execute(currentTenantId, dto, permissions, currentActorUserId),
      ),
    [createService, permissions, runMutation],
  );

  const update = useCallback(
    (supplierId: string, dto: SupplierInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        updateService.execute(currentTenantId, supplierId, dto, permissions, currentActorUserId),
      ),
    [permissions, runMutation, updateService],
  );

  const archive = useCallback(
    (supplierId: string) =>
      runMutation((currentTenantId, currentActorUserId) =>
        archiveService.execute(currentTenantId, supplierId, permissions, currentActorUserId),
      ),
    [archiveService, permissions, runMutation],
  );

  return {
    loading: loading || sessionLoading,
    busy,
    error,
    suppliers,
    canManage,
    create,
    update,
    archive,
    reload,
  };
}
