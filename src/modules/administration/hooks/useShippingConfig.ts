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

  const getService = useMemo(() => new GetShippingConfigService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveShippingConfigService(repositories), [repositories]);

  const [config, setConfig] = useState<ShippingConfigDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (sessionLoading || !tenantId || !canManage) return;
    try {
      setConfig(await getService.execute());
      setError(null);
    } catch (caughtError) {
      setError(cleanError(caughtError));
    }
  }, [canManage, getService, sessionLoading, tenantId]);

  useDataEvent("shipping-config.changed", reload);

  useEffect(() => {
    let active = true;
    if (sessionLoading) return;
    if (!tenantId || !canManage) {
      window.queueMicrotask(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    getService
      .execute()
      .then((next) => {
        if (!active) return;
        setConfig(next);
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
  }, [canManage, getService, sessionLoading, tenantId]);

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
    loading: loading || sessionLoading,
    saving,
    error,
    config,
    canManage,
    save,
  };
}
