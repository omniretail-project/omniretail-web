"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Branch, Role } from "@/core/entities";
import { RoleStatus } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  EmployeeDto,
  EmployeeInputDto,
} from "@/modules/administration/application/dto/EmployeeDto";
import { CreateEmployeeService } from "@/modules/administration/application/services/CreateEmployeeService";
import { GetEmployeesService } from "@/modules/administration/application/services/GetEmployeesService";
import { ResendInvitationService } from "@/modules/administration/application/services/ResendInvitationService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { UpdateEmployeeService } from "@/modules/administration/application/services/UpdateEmployeeService";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export interface RoleOption {
  id: string;
  name: string;
  permissions: string[];
  isDelegable: boolean;
}

export interface BranchOption {
  id: string;
  name: string;
}

export function useEmployees() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const actorUserId = user?.id ?? null;
  const canRead = hasPermission("admin.users.read") || hasPermission("admin.users.manage");
  const canManage = hasPermission("admin.users.manage");
  const getService = useMemo(() => new GetEmployeesService(repositories), [repositories]);
  const createService = useMemo(() => new CreateEmployeeService(repositories), [repositories]);
  const updateService = useMemo(() => new UpdateEmployeeService(repositories), [repositories]);
  const resendInvitationService = useMemo(
    () => new ResendInvitationService(repositories),
    [repositories],
  );
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [roleNames, setRoleNames] = useState<Map<string, string>>(new Map());
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLookups = useCallback(
    async (currentTenantId: string) => {
      const [roles, branches] = await Promise.all([
        repositories.roles.listByTenant(currentTenantId),
        repositories.branches.getActiveByTenant(currentTenantId),
      ]);
      setRoleNames(new Map(roles.map((role: Role) => [role.id, role.name])));
      const permissionSet = new Set(permissions);
      setRoleOptions(
        roles
          .filter((role: Role) => role.status === RoleStatus.active)
          .map((role: Role) => ({
            id: role.id,
            name: role.name,
            permissions: role.permissions,
            isDelegable: role.permissions.every((key) => permissionSet.has(key)),
          })),
      );
      setBranchNames(new Map(branches.map((branch: Branch) => [branch.id, branch.name])));
      setBranchOptions(branches.map((branch: Branch) => ({ id: branch.id, name: branch.name })));
    },
    [permissions, repositories],
  );

  const reload = useCallback(async (): Promise<EmployeeDto[]> => {
    if (sessionLoading) return [];
    if (!tenantId) {
      setEmployees([]);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const [nextEmployees] = await Promise.all([
        getService.execute(tenantId, permissions),
        loadLookups(tenantId),
      ]);
      setEmployees(nextEmployees);
      return nextEmployees;
    } catch (caughtError) {
      setEmployees([]);
      setError(cleanError(caughtError));
      return [];
    } finally {
      setLoading(false);
    }
  }, [getService, loadLookups, permissions, sessionLoading, tenantId]);

  useDataEvent("user.changed", reload);
  useDataEvent("role.changed", reload);
  useDataEvent("branch.changed", reload);
  // inviteEmployee (alta o reintento de invitación) emite esto -- sin esta suscripción, "Estado
  // cuenta" en la tabla quedaría desactualizado hasta la próxima acción no relacionada.
  useDataEvent("auth.changed", reload);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      void reload();
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, sessionLoading]);

  const runMutation = useCallback(
    async <T>(action: (tenantId: string, actorUserId: string) => Promise<T>): Promise<T> => {
      // Los errores de mutacion se relanzan para que los muestre el formulario/accion que los
      // dispara. `error` queda solo para fallos de carga: su boton "Reintentar" recarga la lista y
      // no repite la mutacion, asi que mostrar ahi un fallo de guardado confunde.
      if (!tenantId || !actorUserId) {
        throw new Error("No se pudo resolver la sesión actual.");
      }

      setBusy(true);
      try {
        return await action(tenantId, actorUserId);
      } catch (caughtError) {
        throw new Error(cleanError(caughtError));
      } finally {
        setBusy(false);
      }
    },
    [actorUserId, tenantId],
  );

  const create = useCallback(
    (dto: EmployeeInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        createService.execute(currentTenantId, dto, permissions, currentActorUserId),
      ),
    [createService, permissions, runMutation],
  );

  const update = useCallback(
    (employeeId: string, dto: EmployeeInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        updateService.execute(currentTenantId, employeeId, dto, permissions, currentActorUserId),
      ),
    [permissions, runMutation, updateService],
  );

  const resendInvitation = useCallback(
    (employeeId: string) =>
      runMutation((currentTenantId, currentActorUserId) =>
        resendInvitationService.execute(
          currentTenantId,
          employeeId,
          permissions,
          currentActorUserId,
        ),
      ),
    [permissions, resendInvitationService, runMutation],
  );

  return {
    loading: loading || sessionLoading,
    busy,
    error,
    employees,
    roleOptions,
    roleNames,
    branchOptions,
    branchNames,
    canRead,
    canManage,
    create,
    update,
    resendInvitation,
    reload,
  };
}
