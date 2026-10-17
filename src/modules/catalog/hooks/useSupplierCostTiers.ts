"use client";

import { useCallback, useRef, useState } from "react";
import type { SupplierCostTierEditorValue } from "@/modules/catalog/application/dto/ProductEditorDto";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export type SupplierCostTierLoadState =
  | { status: "notLoaded" }
  | { status: "loading" }
  | { status: "loaded"; tiers: SupplierCostTierEditorValue[] }
  | { status: "error"; error: Error };

const NOT_LOADED_STATE: SupplierCostTierLoadState = { status: "notLoaded" };

export function useSupplierCostTiers() {
  const repositories = useRepositories();
  const loadedRef = useRef(new Map<string, SupplierCostTierEditorValue[]>());
  const pendingRef = useRef(new Map<string, Promise<SupplierCostTierEditorValue[]>>());
  const [states, setStates] = useState<Record<string, SupplierCostTierLoadState>>({});

  const load = useCallback(
    (supplierProductId: string): Promise<SupplierCostTierEditorValue[]> => {
      const loaded = loadedRef.current.get(supplierProductId);
      if (loaded) return Promise.resolve(loaded);

      const pending = pendingRef.current.get(supplierProductId);
      if (pending) return pending;

      setStates((current) => ({
        ...current,
        [supplierProductId]: { status: "loading" },
      }));
      const request = repositories.supplierProducts
        .getCostTiers(supplierProductId)
        .then((tiers) =>
          tiers.map((tier) => ({
            id: tier.id,
            minQuantity: tier.minQuantity,
            unitCost: tier.unitCost,
          })),
        )
        .then((tiers) => {
          loadedRef.current.set(supplierProductId, tiers);
          pendingRef.current.delete(supplierProductId);
          setStates((current) => ({
            ...current,
            [supplierProductId]: { status: "loaded", tiers },
          }));
          return tiers;
        })
        .catch((caughtError: unknown) => {
          const error =
            caughtError instanceof Error
              ? caughtError
              : new Error("No se pudieron cargar los costos por volumen.");
          pendingRef.current.delete(supplierProductId);
          setStates((current) => ({
            ...current,
            [supplierProductId]: { status: "error", error },
          }));
          throw error;
        });
      pendingRef.current.set(supplierProductId, request);
      return request;
    },
    [repositories],
  );

  const getState = useCallback(
    (supplierProductId: string): SupplierCostTierLoadState =>
      states[supplierProductId] ?? NOT_LOADED_STATE,
    [states],
  );

  return { getState, load };
}
