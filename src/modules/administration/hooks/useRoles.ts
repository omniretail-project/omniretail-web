"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { RoleDto, RoleInputDto } from "@/modules/administration/application/dto/RoleDto";
import { ArchiveRoleService } from "@/modules/administration/application/services/ArchiveRoleService";
import { CreateRoleService } from "@/modules/administration/application/services/CreateRoleService";
import { GetRolesService } from "@/modules/administration/application/services/GetRolesService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { UpdateRoleService } from "@/modules/administration/application/services/UpdateRoleService";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useRoles() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const actorUserId = user?.id ?? null;
  const canRead = hasPermission("admin.roles.read") || hasPermission("admin.roles.manage");
  const canManage = hasPermission("admin.roles.manage");
  const getService = useMemo(() => new GetRolesService(repositories), [repositories]);
  const createService = useMemo(() => new CreateRoleService(repositories), [repositories]);
  const updateService = useMemo(() => new UpdateRoleService(repositories), [repositories]);
  const archiveService = useMemo(() => new ArchiveRoleService(repositories), [repositories]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<RoleDto[]> => {
    if (sessionLoading) return [];
    if (!tenantId) {
      setRoles([]);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const nextRoles = await getService.execute(tenantId, permissions);
      setRoles(nextRoles);
      return nextRoles;
    } catch (caughtError) {
      setRoles([]);
      setError(cleanError(caughtError));
      return [];
    } finally {
      setLoading(false);
    }
  }, [getService, permissions, sessionLoading, tenantId]);

  useDataEvent("role.changed", reload);

  useEffect(() => {
    let active = true;

    if (!sessionLoading && !tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setRoles([]);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
    } else if (tenantId) {
      getService
        .execute(tenantId, permissions)
        .then((nextRoles) => {
          if (!active) return;
          setRoles(nextRoles);
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (!active) return;
          setRoles([]);
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
    async (action: (tenantId: string, actorUserId: string) => Promise<RoleDto>) => {
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
    (dto: RoleInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        createService.execute(currentTenantId, dto, permissions, currentActorUserId),
      ),
    [createService, permissions, runMutation],
  );

  const update = useCallback(
    (roleId: string, dto: RoleInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        updateService.execute(currentTenantId, roleId, dto, permissions, currentActorUserId),
      ),
    [permissions, runMutation, updateService],
  );

  const archive = useCallback(
    (roleId: string) =>
      runMutation((currentTenantId, currentActorUserId) =>
        archiveService.execute(currentTenantId, roleId, permissions, currentActorUserId),
      ),
    [archiveService, permissions, runMutation],
  );

  return {
    loading: loading || sessionLoading,
    busy,
    error,
    roles,
    canRead,
    canManage,
    // Permisos efectivos del actor -- RoleForm los necesita para deshabilitar (no ocultar, ticket
    // "FIXES FOCALIZADOS" §2) los checkboxes de permisos que el actor no puede delegar. El service
    // (`ensureDelegatablePermissions`) sigue siendo la autoridad real; esto es solo UX.
    actorPermissions: permissions,
    create,
    update,
    archive,
    reload,
  };
}
