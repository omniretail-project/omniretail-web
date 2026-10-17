"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { GetProductEditorDataService } from "@/modules/catalog/application/services/GetProductEditorDataService";
import { cleanError } from "@/modules/catalog/application/services/serviceHelpers";
import type { ProductEditorData } from "@/modules/catalog/application/dto/ProductEditorDto";

export function useProductEditorData(productId?: string, branchId?: string, tenantId?: string) {
  const repositories = useRepositories();
  const service = useMemo(() => new GetProductEditorDataService(repositories), [repositories]);
  const requestIdRef = useRef(0);
  const eventReloadsSuspendedRef = useRef(false);
  const requestKey = `${productId ?? ""}:${branchId ?? ""}:${tenantId ?? ""}`;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProductEditorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const nextData = await service.execute(productId);
      if (requestIdRef.current !== requestId) return;
      setData(nextData);
      setLoadedKey(requestKey);
    } catch (caughtError) {
      if (requestIdRef.current !== requestId) return;
      setData(null);
      setLoadedKey(requestKey);
      setError(cleanError(caughtError));
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [productId, requestKey, service, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let active = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    service
      .execute(productId)
      .then((nextData) => {
        if (!active || requestIdRef.current !== requestId) return;
        setData(nextData);
        setLoadedKey(requestKey);
        setError(null);
      })
      .catch((caughtError) => {
        if (!active || requestIdRef.current !== requestId) return;
        setData(null);
        setLoadedKey(requestKey);
        setError(cleanError(caughtError));
      })
      .finally(() => {
        if (active && requestIdRef.current === requestId) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [branchId, productId, requestKey, service, tenantId]);

  // Recarga por eventos EXTERNOS. Durante la mutacion propia del editor se suspende para no
  // desmontar el formulario con "Preparando formulario..." mientras el submit sigue en curso;
  // la recarga explicita (guardado parcial) usa reload() directamente y no pasa por aqui.
  const reloadFromEvent = useCallback(() => {
    if (eventReloadsSuspendedRef.current) return;
    void reload();
  }, [reload]);
  const setEventReloadsSuspended = useCallback((suspended: boolean) => {
    eventReloadsSuspendedRef.current = suspended;
  }, []);

  // Un borrador nuevo (sin productId) no se recarga por eventos de productos persistidos.
  useDataEvent("product.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reloadFromEvent();
  });
  useDataEvent("unit-conversion.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reloadFromEvent();
  });
  useDataEvent("product-sales-price-tier.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reloadFromEvent();
  });
  useDataEvent("supplier-product.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reloadFromEvent();
  });
  useDataEvent("inventory.changed", (payload) => {
    if (!branchId || !payload.branchId || payload.branchId === branchId) reloadFromEvent();
  });
  useDataEvent("promotion.changed", reloadFromEvent);

  const hasCurrentData = loadedKey === requestKey;

  return {
    loading: loading || !hasCurrentData,
    // Durante una recarga de fondo se conserva el ultimo dato valido (el formulario sigue montado).
    data: hasCurrentData ? data : null,
    error: hasCurrentData ? error : null,
    reload,
    setEventReloadsSuspended,
  };
}
