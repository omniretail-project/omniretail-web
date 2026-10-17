"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Branch } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  EcommerceConfigDto,
  EcommerceConfigInputDto,
} from "@/modules/administration/application/dto/EcommerceConfigDto";
import { GetEcommerceConfigService } from "@/modules/administration/application/services/GetEcommerceConfigService";
import { SaveEcommerceConfigService } from "@/modules/administration/application/services/SaveEcommerceConfigService";
import { PartialSaveError, cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useEntitlementContext } from "@/shared/providers/EntitlementProvider";
import { SaasCapabilityKey } from "@/core/enums";

export interface EcommerceBranchOption {
  id: string;
  name: string;
}

function toBranchOptions(branches: Branch[], tenantId: string): EcommerceBranchOption[] {
  return branches
    .filter((branch) => branch.tenantId === tenantId)
    .map((branch) => ({ id: branch.id, name: branch.name }));
}

export function useEcommerceConfig() {
  const repositories = useRepositories();
  const { user, hasPermission, loading: sessionLoading } = useCurrentSession();
  const { hasCapability } = useEntitlementContext();
  const tenantId = user?.tenantId ?? null;
  const canManage = hasPermission("admin.ecommerce_config.manage") && hasCapability(SaasCapabilityKey.ecommerce);
  const getService = useMemo(() => new GetEcommerceConfigService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveEcommerceConfigService(repositories), [repositories]);
  const [config, setConfig] = useState<EcommerceConfigDto | null>(null);
  const [branchOptions, setBranchOptions] = useState<EcommerceBranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<EcommerceConfigDto | null> => {
    if (sessionLoading) return null;
    if (!tenantId) {
      setConfig(null);
      setBranchOptions([]);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextConfig, branches] = await Promise.all([
        getService.execute(),
        repositories.branches.getActive(),
      ]);
      setConfig(nextConfig);
      setBranchOptions(toBranchOptions(branches, tenantId));
      return nextConfig;
    } catch (caughtError) {
      setConfig(null);
      setBranchOptions([]);
      setError(cleanError(caughtError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [getService, repositories, sessionLoading, tenantId]);

  useDataEvent("business-config.changed", reload);
  useDataEvent("tenant-subscription.changed", reload);

  useEffect(() => {
    let active = true;

    if (!sessionLoading && !tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setConfig(null);
        setBranchOptions([]);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
    } else if (tenantId) {
      Promise.all([
        getService.execute(),
        repositories.branches.getActive(),
      ])
        .then(([nextConfig, branches]) => {
          if (!active) return;
          setConfig(nextConfig);
          setBranchOptions(toBranchOptions(branches, tenantId));
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (!active) return;
          setConfig(null);
          setBranchOptions([]);
          setError(cleanError(caughtError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [getService, repositories, sessionLoading, tenantId]);

  const save = useCallback(
    async (dto: EcommerceConfigInputDto): Promise<EcommerceConfigDto> => {
      // `error` es solo para fallos de carga (su boton "Reintentar" recarga). Un fallo de guardado
      // se relanza y lo muestra el formulario, para no repetir el mismo mensaje en varios banners.
      if (!tenantId) {
        throw new Error("No se pudo resolver la sesión actual.");
      }

      setSaving(true);
      try {
        const savedConfig = await saveService.execute(dto);
        setConfig(savedConfig);
        return savedConfig;
      } catch (caughtError) {
        // Guardado parcial: se muestra lo que el backend si confirmo y se conserva el error para
        // que la pantalla sincronice el formulario con ese estado.
        if (caughtError instanceof PartialSaveError) {
          setConfig(caughtError.persisted as EcommerceConfigDto);
          throw caughtError;
        }
        throw new Error(cleanError(caughtError));
      } finally {
        setSaving(false);
      }
    },
    [saveService, tenantId],
  );

  return {
    loading: loading || sessionLoading,
    saving,
    error,
    config,
    branchOptions,
    canManage,
    tenantId,
    save,
    reload,
  };
}
