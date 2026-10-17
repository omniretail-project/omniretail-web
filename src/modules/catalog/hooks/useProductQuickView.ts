"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { GetProductQuickViewService } from "@/modules/catalog/application/services/GetProductQuickViewService";
import type { ProductQuickViewModel } from "@/modules/catalog/types/catalog.types";
import { createReloadCoalescer } from "@/shared/utils/reloadCoalescer";

export function useProductQuickView(
  productId: string | null,
  branchId?: string,
  branchTenantId?: string,
  branchName?: string,
) {
  const repositories = useRepositories();
  const service = useMemo(() => new GetProductQuickViewService(repositories), [repositories]);
  const requestKey = `${productId ?? ""}:${branchTenantId ?? ""}:${branchId ?? ""}`;
  const [result, setResult] = useState<{
    key: string;
    data: ProductQuickViewModel | null;
  } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!productId) {
      return;
    }
    const requestId = ++requestIdRef.current;
    setFailure(null);
    try {
      const data = await service.execute(
        productId,
        createBranchContext(branchId, branchTenantId, branchName),
      );
      if (requestId === requestIdRef.current) setResult({ key: requestKey, data });
    } catch {
      if (requestId === requestIdRef.current) {
        setFailure({ key: requestKey, message: "No se pudo cargar la consulta rápida." });
      }
    }
  }, [branchId, branchName, branchTenantId, productId, requestKey, service]);

  const reloadCoalescer = useMemo(() => createReloadCoalescer(null, requestKey), [requestKey]);
  useEffect(() => {
    reloadCoalescer.setLoader(load);
    return () => reloadCoalescer.setLoader(null);
  }, [load, reloadCoalescer]);
  const reload = useCallback(() => reloadCoalescer.invalidate(), [reloadCoalescer]);

  useEffect(() => {
    if (!productId) return;
    void reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [productId, reload]);

  useDataEvent("product.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reload();
  });
  useDataEvent("stock.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reload();
  });
  useDataEvent("inventory.changed", (payload) => {
    if (!productId || (payload.productId && payload.productId !== productId)) return;
    if (branchId && payload.branchId && payload.branchId !== branchId) return;
    if (branchTenantId && payload.tenantId && payload.tenantId !== branchTenantId) return;
    void reload();
  });
  useDataEvent("supplier.changed", reload);
  useDataEvent("supplier-product.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reload();
  });
  useDataEvent("promotion.changed", reload);

  const data = result?.key === requestKey ? result.data : null;
  const error = failure?.key === requestKey ? failure.message : null;
  const currentData = data?.product.id === productId ? data : null;
  const loading = Boolean(productId && !currentData && !error);

  return { loading, data: currentData, error, reload };
}

function createBranchContext(branchId?: string, tenantId?: string, name?: string) {
  return branchId && tenantId && name ? { id: branchId, tenantId, name } : undefined;
}
