"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BusinessPreset } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  HeroBannerConfigDto,
  HeroBannerConfigInputDto,
} from "@/modules/administration/application/dto/HeroBannerConfigDto";
import { GetBusinessConfigService } from "@/modules/administration/application/services/GetBusinessConfigService";
import { GetHeroBannerConfigService } from "@/modules/administration/application/services/GetHeroBannerConfigService";
import { SaveHeroBannerConfigService } from "@/modules/administration/application/services/SaveHeroBannerConfigService";
import { PartialSaveError, cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useHeroBannerConfig() {
  const repositories = useRepositories();
  const { user, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const getService = useMemo(() => new GetHeroBannerConfigService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveHeroBannerConfigService(repositories), [repositories]);
  const getBusinessConfigService = useMemo(
    () => new GetBusinessConfigService(repositories),
    [repositories],
  );
  const [config, setConfig] = useState<HeroBannerConfigDto | null>(null);
  const [preset, setPreset] = useState<BusinessPreset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<HeroBannerConfigDto | null> => {
    if (sessionLoading) return null;
    if (!tenantId) {
      setConfig(null);
      setPreset(null);
      setError("No se pudo resolver el negocio activo.");
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextConfig, businessConfig] = await Promise.all([
        getService.execute(),
        getBusinessConfigService.execute(tenantId),
      ]);
      setConfig(nextConfig);
      setPreset(businessConfig.preset);
      return nextConfig;
    } catch (caughtError) {
      setConfig(null);
      setPreset(null);
      setError(cleanError(caughtError));
      return null;
    } finally {
      setLoading(false);
    }
  }, [getBusinessConfigService, getService, sessionLoading, tenantId]);

  useDataEvent("business-config.changed", reload);

  useEffect(() => {
    let active = true;

    if (sessionLoading) {
      return () => {
        active = false;
      };
    }

    if (!tenantId) {
      window.queueMicrotask(() => {
        if (!active) return;
        setConfig(null);
        setPreset(null);
        setError("No se pudo resolver el negocio activo.");
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    Promise.all([getService.execute(), getBusinessConfigService.execute(tenantId)])
      .then(([nextConfig, businessConfig]) => {
        if (!active) return;
        setConfig(nextConfig);
        setPreset(businessConfig.preset);
        setError(null);
      })
      .catch((caughtError: unknown) => {
        if (!active) return;
        setConfig(null);
        setPreset(null);
        setError(cleanError(caughtError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [getBusinessConfigService, getService, sessionLoading, tenantId]);

  const save = useCallback(
    async (dto: HeroBannerConfigInputDto): Promise<HeroBannerConfigDto> => {
      // Ver useEcommerceConfig.save: el error de guardado lo muestra el formulario, no `error`.
      setSaving(true);
      try {
        const savedConfig = await saveService.execute(dto);
        setConfig(savedConfig);
        return savedConfig;
      } catch (caughtError) {
        // Guardado parcial: se muestra lo que el backend si confirmo y se conserva el error para
        // que la pantalla sincronice el formulario con ese estado.
        if (caughtError instanceof PartialSaveError) {
          setConfig(caughtError.persisted as HeroBannerConfigDto);
          throw caughtError;
        }
        throw new Error(cleanError(caughtError));
      } finally {
        setSaving(false);
      }
    },
    [saveService],
  );

  return {
    loading: loading || sessionLoading,
    saving,
    error,
    config,
    preset,
    tenantId,
    save,
    reload,
  };
}
