"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Branch } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  BankAccountDto,
  BankAccountInputDto,
} from "@/modules/administration/application/dto/BankAccountDto";
import { ArchiveBankAccountService } from "@/modules/administration/application/services/ArchiveBankAccountService";
import { CreateBankAccountService } from "@/modules/administration/application/services/CreateBankAccountService";
import { GetBankAccountsService } from "@/modules/administration/application/services/GetBankAccountsService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { UpdateBankAccountService } from "@/modules/administration/application/services/UpdateBankAccountService";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export interface BranchOption {
  id: string;
  name: string;
}

function toBranchOptions(branches: Branch[], tenantId: string): BranchOption[] {
  return branches
    .filter((branch) => branch.tenantId === tenantId)
    .map((branch) => ({ id: branch.id, name: branch.name }));
}

export function useBankAccounts() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const actorUserId = user?.id ?? null;
  const canManage = hasPermission("admin.bank_accounts.manage");
  const getService = useMemo(() => new GetBankAccountsService(repositories), [repositories]);
  const createService = useMemo(() => new CreateBankAccountService(repositories), [repositories]);
  const updateService = useMemo(() => new UpdateBankAccountService(repositories), [repositories]);
  const archiveService = useMemo(() => new ArchiveBankAccountService(repositories), [repositories]);
  const [accounts, setAccounts] = useState<BankAccountDto[]>([]);
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [branchNames, setBranchNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<BankAccountDto[]> => {
    if (sessionLoading) return [];
    if (!tenantId) {
      setAccounts([]);
      setBranchOptions([]);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const [nextAccounts, branches] = await Promise.all([
        getService.execute(tenantId, permissions),
        repositories.branches.getActive(),
      ]);
      setAccounts(nextAccounts);
      setBranchOptions(toBranchOptions(branches, tenantId));
      setBranchNames(new Map(branches.map((b) => [b.id, b.name])));
      return nextAccounts;
    } catch (caughtError) {
      setAccounts([]);
      setError(cleanError(caughtError));
      return [];
    } finally {
      setLoading(false);
    }
  }, [getService, permissions, repositories, sessionLoading, tenantId]);

  useDataEvent("payment.changed", reload);
  useDataEvent("branch.changed", reload);

  useEffect(() => {
    let active = true;

    if (!sessionLoading && !tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setAccounts([]);
        setBranchOptions([]);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
    } else if (tenantId) {
      Promise.all([getService.execute(tenantId, permissions), repositories.branches.getActive()])
        .then(([nextAccounts, branches]) => {
          if (!active) return;
          setAccounts(nextAccounts);
          setBranchOptions(toBranchOptions(branches, tenantId));
          setBranchNames(new Map(branches.map((b) => [b.id, b.name])));
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (!active) return;
          setAccounts([]);
          setError(cleanError(caughtError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [getService, permissions, repositories, sessionLoading, tenantId]);

  const runMutation = useCallback(
    async (action: (tenantId: string, actorUserId: string) => Promise<BankAccountDto>) => {
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
    (dto: BankAccountInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        createService.execute(currentTenantId, dto, permissions, currentActorUserId),
      ),
    [createService, permissions, runMutation],
  );

  const update = useCallback(
    (accountId: string, dto: BankAccountInputDto) =>
      runMutation((currentTenantId, currentActorUserId) =>
        updateService.execute(currentTenantId, accountId, dto, permissions, currentActorUserId),
      ),
    [permissions, runMutation, updateService],
  );

  const archive = useCallback(
    (accountId: string) =>
      runMutation((currentTenantId, currentActorUserId) =>
        archiveService.execute(currentTenantId, accountId, permissions, currentActorUserId),
      ),
    [archiveService, permissions, runMutation],
  );

  return {
    loading: loading || sessionLoading,
    busy,
    error,
    accounts,
    branchNames,
    branchOptions,
    canManage,
    create,
    update,
    archive,
    reload,
  };
}
