"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product, StorageLocation } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { GetProductEditorDataService } from "@/modules/catalog/application/services/GetProductEditorDataService";
import { cleanError } from "@/modules/catalog/application/services/serviceHelpers";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

export type DeferredLoadState<Data> =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "loaded"; data: Data; error: null }
  | { status: "error"; data: null; error: string };

const idleState = { status: "idle", data: null, error: null } as const;
const loadingState = { status: "loading", data: null, error: null } as const;

/**
 * Carga perezosa de una seccion del editor. Solo se dispara cuando `enabled` es true (la seccion
 * real esta activa), una vez por `key`, y el resultado vive unicamente durante el mount.
 *
 * "Cargando" se DERIVA (habilitado y sin resultado todavia): el efecto solo arranca la peticion y
 * guarda el resultado en la continuacion asincrona, nunca con un setState sincrono. Los cambios de
 * estado sincronos ocurren unicamente en handlers (reintentar / invalidar).
 */
function useDeferredResource<Data>({
  key,
  enabled,
  fetcher,
}: {
  key: string;
  enabled: boolean;
  fetcher: () => Promise<Data>;
}) {
  const requestIdRef = useRef(0);
  // Clave cuya peticion ya se arranco: evita duplicar una carga en vuelo (p. ej. StrictMode).
  const startedKeyRef = useRef<string | null>(null);
  // `state: null` = sin resultado (o invalidado); un error tambien es un resultado asentado.
  const [entry, setEntry] = useState<{
    key: string;
    state: DeferredLoadState<Data> | null;
  }>({ key, state: null });

  const run = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    startedKeyRef.current = key;
    try {
      const data = await fetcher();
      // Una respuesta tardia (otro contexto o invalidada) no contamina el estado actual.
      if (requestIdRef.current !== requestId) return;
      setEntry({ key, state: { status: "loaded", data, error: null } });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setEntry({ key, state: { status: "error", data: null, error: cleanError(error) } });
    }
  }, [fetcher, key]);

  useEffect(() => {
    if (!enabled) return;
    const settled = entry.key === key && entry.state !== null;
    if (settled || startedKeyRef.current === key) return;
    void run();
  }, [enabled, entry, key, run]);

  const retry = useCallback(() => {
    setEntry({ key, state: null });
    return run();
  }, [key, run]);

  const invalidate = useCallback(() => {
    requestIdRef.current += 1;
    startedKeyRef.current = null;
    setEntry({ key, state: null });
  }, [key]);

  const settledState = entry.key === key ? entry.state : null;
  const state: DeferredLoadState<Data> = settledState ?? (enabled ? loadingState : idleState);
  return { state, retry, invalidate };
}

export function useProductEditorKitEligibleProducts({
  tenantId,
  productId,
  enabled,
}: {
  tenantId?: string;
  productId?: string;
  enabled: boolean;
}) {
  const repositories = useRepositories();
  const service = useMemo(() => new GetProductEditorDataService(repositories), [repositories]);
  const fetcher = useCallback(
    (): Promise<Product[]> => service.getKitEligibleProducts(productId),
    [productId, service],
  );
  const { state, retry, invalidate } = useDeferredResource({
    key: `${tenantId ?? ""}:${productId ?? "new"}`,
    enabled: enabled && Boolean(tenantId),
    fetcher,
  });

  useDataEvent("product.changed", (payload) => {
    if (!tenantId || (payload.tenantId && payload.tenantId !== tenantId)) return;
    service.invalidateKitEligibleProducts(tenantId);
    invalidate();
  });

  return { ...state, retry };
}

type LocationsData = {
  branchLocations: StorageLocation[];
  storageLocations: StorageLocation[];
};

export function useProductEditorLocations({
  tenantId,
  branchId,
  enabled,
}: {
  tenantId?: string;
  branchId: string;
  enabled: boolean;
}) {
  const repositories = useRepositories();
  const service = useMemo(() => new GetProductEditorDataService(repositories), [repositories]);
  const fetcher = useCallback(
    (): Promise<LocationsData> => service.getLocations(branchId),
    [branchId, service],
  );
  const { state, retry } = useDeferredResource({
    key: `${tenantId ?? ""}:${branchId}`,
    enabled: enabled && Boolean(tenantId) && Boolean(branchId),
    fetcher,
  });
  return { ...state, retry };
}
