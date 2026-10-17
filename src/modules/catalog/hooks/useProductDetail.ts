"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { GetProductDetailService } from "@/modules/catalog/application/services/GetProductDetailService";
import type { ProductDetailViewModel } from "@/modules/catalog/types/catalog.types";

export function useProductDetail(productId: string) {
  const repositories = useRepositories();
  const service = useMemo(() => new GetProductDetailService(repositories), [repositories]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ProductDetailViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await service.execute(productId));
    } catch {
      setError("No se pudo cargar el producto.");
    } finally {
      setLoading(false);
    }
  }, [productId, service]);

  useDataEvent("product.changed", (payload) => {
    if (!payload.productId || payload.productId === productId) reload();
  });

  useEffect(() => {
    let active = true;
    service
      .execute(productId)
      .then((nextDetail) => {
        if (!active) return;
        setDetail(nextDetail);
        setError(null);
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el producto.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productId, service]);

  return { loading, detail, error, reload };
}
