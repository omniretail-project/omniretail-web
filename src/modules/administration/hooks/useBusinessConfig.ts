"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { businessDefaultsConfig } from "@/config/business-defaults";
import { BusinessPreset } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { BusinessConfigDto } from "@/modules/administration/application/dto/BusinessConfigDto";
import { GetBusinessConfigService } from "@/modules/administration/application/services/GetBusinessConfigService";
import { SaveBusinessConfigService } from "@/modules/administration/application/services/SaveBusinessConfigService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { BUSINESS_CONFIG_MANAGE_PERMISSION } from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useBusinessConfig() {
  const repositories = useRepositories();
  const { user, permissions, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const canManage = hasPermission(BUSINESS_CONFIG_MANAGE_PERMISSION);
  const getService = useMemo(() => new GetBusinessConfigService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveBusinessConfigService(repositories), [repositories]);
  const [config, setConfig] = useState<BusinessConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<BusinessConfigDto | null> => {
    if (sessionLoading) return null;
    if (!tenantId) {
      setConfig(null);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const nextConfig = await getService.execute(tenantId);
      setConfig(nextConfig);
      return nextConfig;
    } catch (caughtError) {
      setConfig(null);
      setError(cleanError(caughtError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [getService, sessionLoading, tenantId]);

  useDataEvent("business-config.changed", reload);

  useEffect(() => {
    let active = true;

    if (!sessionLoading && !tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setConfig(null);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
    } else if (tenantId) {
      getService
        .execute(tenantId)
        .then((nextConfig) => {
          if (!active) return;
          setConfig(nextConfig);
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (!active) return;
          setConfig(null);
          setError(cleanError(caughtError));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [getService, sessionLoading, tenantId]);

  const save = useCallback(
    async (dto: BusinessConfigDto): Promise<BusinessConfigDto> => {
      if (!tenantId) {
        const message = "No se pudo resolver el negocio activo.";
        setError(message);
        throw new Error(message);
      }

      setBusy(true);
      setError(null);
      try {
        const savedConfig = await saveService.execute(tenantId, dto, permissions);
        setConfig(savedConfig);
        return savedConfig;
      } catch (caughtError) {
        const message = cleanError(caughtError);
        setError(message);
        throw new Error(message);
      } finally {
        setBusy(false);
      }
    },
    [permissions, saveService, tenantId],
  );

  /**
   * Devuelve el borrador resultante sin tocar `config`: `config` refleja lo persistido y el
   * borrador vive en la pantalla. Con `custom` se conservan los cambios en curso.
   */
  const applyPreset = useCallback(
    (preset: BusinessPreset, current: BusinessConfigDto | null): BusinessConfigDto | null => {
      if (preset === BusinessPreset.custom) {
        return current ? cloneConfig({ ...current, preset }) : null;
      }

      return cloneConfig({ ...businessDefaultsConfig[preset] });
    },
    [],
  );

  return {
    loading: loading || sessionLoading,
    canManage,
    busy,
    error,
    config,
    save,
    applyPreset,
    reload,
  };
}

function cloneConfig(config: BusinessConfigDto): BusinessConfigDto {
  return {
    ...config,
    defaultProductTracking: { ...config.defaultProductTracking },
  };
}
