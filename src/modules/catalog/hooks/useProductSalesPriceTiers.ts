"use client";

import { useCallback, useRef, useState } from "react";
import type { ProductSalesPriceTierEditorValue } from "@/modules/catalog/application/dto/ProductEditorDto";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export type ProductSalesPriceTiersLoadState =
  | { status: "notLoaded" }
  | { status: "loading" }
  | { status: "loaded"; tiers: ProductSalesPriceTierEditorValue[] }
  | { status: "error"; error: Error };

const NOT_LOADED_STATE: ProductSalesPriceTiersLoadState = { status: "notLoaded" };

export function useProductSalesPriceTiers() {
  const repositories = useRepositories();
  const loadedRef = useRef(new Map<string, ProductSalesPriceTierEditorValue[]>());
  const pendingRef = useRef(
    new Map<string, Promise<ProductSalesPriceTierEditorValue[]>>(),
  );
  const [states, setStates] = useState<Record<string, ProductSalesPriceTiersLoadState>>({});

  const load = useCallback(
    (tenantId: string, productId?: string): Promise<ProductSalesPriceTierEditorValue[]> => {
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
          ? repositories.productSalesPriceTiers.getByProduct(productId)
          : Promise.resolve([])
      )
        .then((tiers) =>
          tiers.map((tier) => ({
            id: tier.id,
            minQuantity: tier.minQuantity,
            unitPrice: tier.unitPrice,
            active: tier.active,
          })),
        )
        .then((tiers) => {
          loadedRef.current.set(contextKey, tiers);
          pendingRef.current.delete(contextKey);
          setStates((current) => ({
            ...current,
            [contextKey]: { status: "loaded", tiers },
          }));
          return tiers;
        })
        .catch((caughtError: unknown) => {
          const error =
            caughtError instanceof Error
              ? caughtError
              : new Error("No se pudieron cargar los precios por cantidad.");
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
    (tenantId?: string, productId?: string): ProductSalesPriceTiersLoadState => {
      if (!tenantId) return NOT_LOADED_STATE;
      return states[`${tenantId}:${productId ?? "new"}`] ?? NOT_LOADED_STATE;
    },
    [states],
  );

  return { getState, load };
}
