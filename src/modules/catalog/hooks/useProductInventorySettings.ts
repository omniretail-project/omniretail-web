"use client";

import { useCallback, useRef, useState } from "react";
import type { ProductInventorySettings } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export type ProductInventorySettingsLoadState =
  | { status: "notLoaded" }
  | { status: "loading" }
  | { status: "loaded"; settings: ProductInventorySettings | null }
  | { status: "error"; error: Error };

const NOT_LOADED_STATE: ProductInventorySettingsLoadState = { status: "notLoaded" };

export function useProductInventorySettings() {
  const repositories = useRepositories();
  const loadedRef = useRef(new Map<string, ProductInventorySettings | null>());
  const pendingRef = useRef(
    new Map<string, Promise<ProductInventorySettings | null>>(),
  );
  const [states, setStates] = useState<Record<string, ProductInventorySettingsLoadState>>({});

  const load = useCallback(
    (
      tenantId: string,
      productId: string | undefined,
      branchId: string,
    ): Promise<ProductInventorySettings | null> => {
      const contextKey = `${tenantId}:${productId ?? "new"}:${branchId}`;
      if (loadedRef.current.has(contextKey)) {
        return Promise.resolve(loadedRef.current.get(contextKey) ?? null);
      }
      const pending = pendingRef.current.get(contextKey);
      if (pending) return pending;

      setStates((current) => ({
        ...current,
        [contextKey]: { status: "loading" },
      }));
      const request = (
        productId
          ? repositories.inventory.getProductInventorySettings(productId, branchId)
          : Promise.resolve(null)
      )
        .then((settings) => {
          loadedRef.current.set(contextKey, settings);
          pendingRef.current.delete(contextKey);
          setStates((current) => ({
            ...current,
            [contextKey]: { status: "loaded", settings },
          }));
          return settings;
        })
        .catch((caughtError: unknown) => {
          const error =
            caughtError instanceof Error
              ? caughtError
              : new Error("No se pudo cargar la configuracion de inventario.");
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
    (
      tenantId?: string,
      productId?: string,
      branchId?: string,
    ): ProductInventorySettingsLoadState => {
      if (!tenantId || !branchId) return NOT_LOADED_STATE;
      return states[`${tenantId}:${productId ?? "new"}:${branchId}`] ?? NOT_LOADED_STATE;
    },
    [states],
  );

  return { getState, load };
}
