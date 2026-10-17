"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Promotion } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { FinalizeProductPromotionService } from "@/modules/catalog/application/services/FinalizeProductPromotionService";
import { GetProductPromotionsService } from "@/modules/catalog/application/services/GetProductPromotionsService";
import {
  SaveProductPromotionService,
  type SaveProductPromotionInput,
} from "@/modules/catalog/application/services/SaveProductPromotionService";
import type { ProductPromotionsViewModel } from "@/modules/catalog/application/services/GetProductPromotionsService";

export interface UseProductPromotionsOptions {
  enabled?: boolean;
  tenantId?: string;
}

type ProductPromotionsLoadState =
  | { status: "loading" }
  | { status: "loaded"; data: ProductPromotionsViewModel | null }
  | { status: "error"; error: string };

export function useProductPromotions(
  productId: string | null,
  { enabled = true, tenantId }: UseProductPromotionsOptions = {},
) {
  const repositories = useRepositories();
  const getService = useMemo(() => new GetProductPromotionsService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveProductPromotionService(repositories), [repositories]);
  const finalizeService = useMemo(
    () => new FinalizeProductPromotionService(repositories),
    [repositories],
  );
  const requestKey = `${tenantId ?? "unknown"}:${productId ?? "none"}`;
  const resolvedRef = useRef(new Map<string, ProductPromotionsViewModel | null>());
  const pendingRef = useRef(
    new Map<string, Promise<ProductPromotionsViewModel | null>>(),
  );
  const [states, setStates] = useState<Record<string, ProductPromotionsLoadState>>({});

  const requestData = useCallback((force = false) => {
    if (!productId) return Promise.resolve<ProductPromotionsViewModel | null>(null);
    const pending = pendingRef.current.get(requestKey);
    if (pending) return pending;
    if (!force && resolvedRef.current.has(requestKey)) {
      return Promise.resolve(resolvedRef.current.get(requestKey) ?? null);
    }

    const request = getService
      .execute(productId)
      .then((data) => {
        resolvedRef.current.set(requestKey, data);
        return data;
      })
      .finally(() => {
        pendingRef.current.delete(requestKey);
      });
    pendingRef.current.set(requestKey, request);
    return request;
  }, [getService, productId, requestKey]);

  const reload = useCallback(async () => {
    if (!productId) return;
    setStates((current) => ({
      ...current,
      [requestKey]: { status: "loading" },
    }));
    try {
      const data = await requestData(true);
      setStates((current) => ({
        ...current,
        [requestKey]: { status: "loaded", data },
      }));
    } catch {
      setStates((current) => ({
        ...current,
        [requestKey]: { status: "error", error: "No se pudieron cargar las promociones." },
      }));
    }
  }, [productId, requestData, requestKey]);

  useEffect(() => {
    let active = true;
    if (!enabled || !productId || states[requestKey]) return;

    requestData()
      .then((nextData) => {
        if (!active) return;
        setStates((current) => ({
          ...current,
          [requestKey]: { status: "loaded", data: nextData },
        }));
      })
      .catch(() => {
        if (!active) return;
        setStates((current) => ({
          ...current,
          [requestKey]: { status: "error", error: "No se pudieron cargar las promociones." },
        }));
      });

    return () => {
      active = false;
    };
  }, [enabled, productId, requestData, requestKey, states]);

  useDataEvent("promotion.changed", (payload) => {
    if (!productId || (payload.productId && payload.productId !== productId)) return;
    resolvedRef.current.delete(requestKey);
    setStates((current) => {
      const next = { ...current };
      delete next[requestKey];
      return next;
    });
    if (enabled) void reload();
  });

  const save = useCallback(
    async (input: SaveProductPromotionInput): Promise<Promotion> => {
      const promotion = await saveService.execute(input);
      await reload();
      return promotion;
    },
    [reload, saveService],
  );

  const finalize = useCallback(
    async (promotionId: string): Promise<Promotion> => {
      const promotion = await finalizeService.execute(promotionId);
      await reload();
      return promotion;
    },
    [finalizeService, reload],
  );

  const state = states[requestKey];
  const status = !productId || (!enabled && !state) ? "notLoaded" : (state?.status ?? "loading");
  const data = state?.status === "loaded" ? state.data : null;
  const currentData = data?.product.id === productId ? data : null;
  const error = state?.status === "error" ? state.error : null;
  const loading = status === "loading";

  return { data: currentData, error, loading, status, reload, save, finalize };
}
