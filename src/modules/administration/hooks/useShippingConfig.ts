"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  ShippingConfigDto,
  ShippingConfigFormValue,
} from "@/modules/administration/application/dto/ShippingConfigDto";
import { GetShippingConfigService } from "@/modules/administration/application/services/GetShippingConfigService";
import { SaveShippingConfigService } from "@/modules/administration/application/services/SaveShippingConfigService";
import { cleanError } from "@/modules/administration/application/services/serviceHelpers";
import { SHIPPING_CONFIG_MANAGE_PERMISSION } from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export function useShippingConfig() {
  const repositories = useRepositories();
  const { user, hasPermission, loading: sessionLoading } = useCurrentSession();
  const tenantId = user?.tenantId ?? null;
  const canManage = hasPermission(SHIPPING_CONFIG_MANAGE_PERMISSION);
  const enabled = !sessionLoading && Boolean(tenantId) && canManage;

  const getService = useMemo(() => new GetShippingConfigService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveShippingConfigService(repositories), [repositories]);

  const [config, setConfig] = useState<ShippingConfigDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Carga la config; `isActive` descarta respuestas que llegan tras desmontar o cambiar de sesión. */
  const load = useCallback(
    (isActive: () => boolean = () => true): Promise<void> =>
      getService
        .execute()
        .then((next) => {
          if (!isActive()) return;
          setConfig(next);
          setError(null);
        })
        .catch((caughtError: unknown) => {
          if (isActive()) setError(cleanError(caughtError));
        })
        .finally(() => {
          if (isActive()) setLoaded(true);
        }),
    [getService],
  );

  const reload = useCallback(async () => {
    if (enabled) await load();
  }, [enabled, load]);

  useDataEvent("shipping-config.changed", reload);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [enabled, load]);

  const save = useCallback(
    async (value: ShippingConfigFormValue): Promise<ShippingConfigDto> => {
      setSaving(true);
      setError(null);
      try {
        const next = await saveService.execute(value);
        setConfig(next);
        return next;
      } catch (caughtError) {
        const message = cleanError(caughtError);
        setError(message);
        throw new Error(message);
      } finally {
        setSaving(false);
      }
    },
    [saveService],
  );

  return {
    // Sin permiso o sin sesión no hay nada que cargar: la sección no se muestra.
    loading: sessionLoading || (enabled && !loaded),
    saving,
    error,
    config,
    canManage,
    save,
  };
}
