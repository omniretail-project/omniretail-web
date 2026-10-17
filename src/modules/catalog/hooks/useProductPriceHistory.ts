"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import {
  GetProductPriceHistoryService,
  type ProductPriceHistoryViewModel,
} from "@/modules/catalog/application/services/GetProductPriceHistoryService";

export function useProductPriceHistory(productId: string | null) {
  const repositories = useRepositories();
  const service = useMemo(() => new GetProductPriceHistoryService(repositories), [repositories]);
  const [data, setData] = useState<ProductPriceHistoryViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!productId) return;
    setError(null);
    try {
      setData(await service.execute(productId));
    } catch {
      setError("No se pudo cargar el historial de precios.");
    }
  }, [productId, service]);

  useEffect(() => {
    let active = true;
    if (!productId) return;

    service
      .execute(productId)
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setError(null);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el historial de precios.");
      });

    return () => {
      active = false;
    };
  }, [productId, service]);

  useDataEvent("product-price.changed", (payload) => {
    if (productId && (!payload.productId || payload.productId === productId)) reload();
  });

  const currentData = data?.product.id === productId ? data : null;
  const loading = Boolean(productId && !currentData && !error);

  return { data: currentData, error, loading };
}
