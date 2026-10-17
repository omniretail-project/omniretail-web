"use client";

import { useEffect, useMemo, useState } from "react";
import { isApiMode } from "@/config/api-mode";
import { fetchPublicStoreIdentity } from "@/infrastructure/api/fetchPublicStoreIdentity";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import {
  GetInicioBusinessIdentityService,
  type InicioBusinessIdentity,
} from "@/modules/auth/application/services/GetInicioBusinessIdentityService";

interface InicioBusinessIdentityState {
  tenantId: string | null;
  identity: InicioBusinessIdentity | null;
  loading: boolean;
  error: boolean;
}

export function useInicioBusinessIdentity(tenantId: string | null | undefined) {
  const repositories = useRepositories();
  const service = useMemo(
    () =>
      new GetInicioBusinessIdentityService(
        repositories,
        isApiMode() ? fetchPublicStoreIdentity : undefined,
      ),
    [repositories],
  );
  const [state, setState] = useState<InicioBusinessIdentityState>({
    tenantId: null,
    identity: null,
    loading: false,
    error: false,
  });

  useEffect(() => {
    let active = true;

    window.queueMicrotask(async () => {
      if (!active) return;
      if (!tenantId) {
        setState({ tenantId: null, identity: null, loading: false, error: false });
        return;
      }

      setState({ tenantId, identity: null, loading: true, error: false });
      try {
        const identity = await service.execute(tenantId);
        if (active) setState({ tenantId, identity, loading: false, error: false });
      } catch {
        if (active) setState({ tenantId, identity: null, loading: false, error: true });
      }
    });

    return () => {
      active = false;
    };
  }, [service, tenantId]);

  const hasCurrentTenant = state.tenantId === (tenantId ?? null);

  return {
    identity: hasCurrentTenant ? state.identity : null,
    loading: Boolean(tenantId) && (!hasCurrentTenant || state.loading),
    error: hasCurrentTenant && state.error,
  };
}
