"use client";

import { useCallback, useRef, useState } from "react";
import type { UnitConversion } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export type ProductUnitConversionsLoadState =
  | { status: "notLoaded" }
  | { status: "loading" }
  | { status: "loaded"; conversions: UnitConversion[] }
  | { status: "error"; error: Error };

const NOT_LOADED_STATE: ProductUnitConversionsLoadState = { status: "notLoaded" };

export function useProductUnitConversions() {
  const repositories = useRepositories();
  const loadedRef = useRef(new Map<string, UnitConversion[]>());
  const pendingRef = useRef(new Map<string, Promise<UnitConversion[]>>());
  const [states, setStates] = useState<Record<string, ProductUnitConversionsLoadState>>({});

  const load = useCallback(
    (tenantId: string, productId?: string): Promise<UnitConversion[]> => {
      const contextKey = `${tenantId}:${productId ?? "new"}`;
      if (loadedRef.current.has(contextKey)) {
        return Promise.resolve(loadedRef.current.get(contextKey) ?? []);
      }
      const pending = pendingRef.current.get(contextKey);
      if (pending) return pending;

      setStates((current) => ({
        ...current,
        [contextKey]: { status: "loading" },
      }));
      const request = (
        productId
          ? repositories.units.getConversionsByProductScoped(tenantId, productId)
          : Promise.resolve([])
      )
        .then((conversions) => {
          loadedRef.current.set(contextKey, conversions);
          pendingRef.current.delete(contextKey);
          setStates((current) => ({
            ...current,
            [contextKey]: { status: "loaded", conversions },
          }));
          return conversions;
        })
        .catch((caughtError: unknown) => {
          const error =
            caughtError instanceof Error
              ? caughtError
              : new Error("No se pudieron cargar las conversiones del producto.");
          pendingRef.current.delete(contextKey);
          setStates((current) => ({
            ...current,
            [contextKey]: { status: "error", error },
          }));
          throw error;
        });
      pendingRef.current.set(contextKey, request);
      return request;
    },
    [repositories],
  );

  const getState = useCallback(
    (tenantId?: string, productId?: string): ProductUnitConversionsLoadState => {
      if (!tenantId) return NOT_LOADED_STATE;
      return states[`${tenantId}:${productId ?? "new"}`] ?? NOT_LOADED_STATE;
    },
    [states],
  );

  return { getState, load };
}
