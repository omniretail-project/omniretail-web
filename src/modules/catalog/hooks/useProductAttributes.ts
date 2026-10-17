"use client";

import { useCallback, useRef, useState } from "react";
import type { AttributeDefinition, ProductAttributeValue } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { ProductAttributeEditorValue } from "@/modules/catalog/application/dto/ProductEditorDto";

export interface LoadedProductAttributes {
  definitions: AttributeDefinition[];
  attributes: ProductAttributeEditorValue[];
}

export type ProductAttributesLoadState =
  | { status: "notLoaded" }
  | { status: "loading" }
  | ({ status: "loaded" } & LoadedProductAttributes)
  | { status: "error"; error: Error };

const NOT_LOADED_STATE: ProductAttributesLoadState = { status: "notLoaded" };

export function useProductAttributes() {
  const repositories = useRepositories();
  const definitionsRef = useRef(new Map<string, AttributeDefinition[]>());
  const definitionRequestsRef = useRef(new Map<string, Promise<AttributeDefinition[]>>());
  const valuesRef = useRef(new Map<string, ProductAttributeValue[]>());
  const valueRequestsRef = useRef(new Map<string, Promise<ProductAttributeValue[]>>());
  const loadRequestsRef = useRef(new Map<string, Promise<LoadedProductAttributes>>());
  const [states, setStates] = useState<Record<string, ProductAttributesLoadState>>({});

  const loadDefinitions = useCallback(
    (tenantId: string) => {
      if (definitionsRef.current.has(tenantId)) {
        return Promise.resolve(definitionsRef.current.get(tenantId) ?? []);
      }
      const pending = definitionRequestsRef.current.get(tenantId);
      if (pending) return pending;

      const request = repositories.attributes
        .getDefinitions()
        .then((definitions) =>
          definitions.filter(
            (definition) =>
              definition.tenantId === undefined || definition.tenantId === tenantId,
          ),
        )
        .then((definitions) => {
          definitionsRef.current.set(tenantId, definitions);
          definitionRequestsRef.current.delete(tenantId);
          return definitions;
        })
        .catch((error: unknown) => {
          definitionRequestsRef.current.delete(tenantId);
          throw error;
        });
      definitionRequestsRef.current.set(tenantId, request);
      return request;
    },
    [repositories],
  );

  const loadValues = useCallback(
    (tenantId: string, productId?: string) => {
      if (!productId) return Promise.resolve<ProductAttributeValue[]>([]);
      const valuesKey = `${tenantId}:${productId}`;
      if (valuesRef.current.has(valuesKey)) {
        return Promise.resolve(valuesRef.current.get(valuesKey) ?? []);
      }
      const pending = valueRequestsRef.current.get(valuesKey);
      if (pending) return pending;

      const request = repositories.attributes
        .getValuesByProduct(productId)
        .then((values) => {
          valuesRef.current.set(valuesKey, values);
          valueRequestsRef.current.delete(valuesKey);
          return values;
        })
        .catch((error: unknown) => {
          valueRequestsRef.current.delete(valuesKey);
          throw error;
        });
      valueRequestsRef.current.set(valuesKey, request);
      return request;
    },
    [repositories],
  );

  const load = useCallback(
    (tenantId: string, productId?: string): Promise<LoadedProductAttributes> => {
      const contextKey = `${tenantId}:${productId ?? "new"}`;
      const pending = loadRequestsRef.current.get(contextKey);
      if (pending) return pending;

      setStates((current) => ({
        ...current,
        [contextKey]: { status: "loading" },
      }));
      const request = Promise.all([
        loadDefinitions(tenantId),
        loadValues(tenantId, productId),
      ])
        .then(([definitions, values]) => {
          const attributes = values.map((value) => {
            const definition = definitions.find(
              (item) => item.id === value.attributeDefinitionId,
            );
            return {
              attributeDefinitionId: value.attributeDefinitionId,
              name: definition?.name ?? value.name ?? "Atributo",
              value: String(value.value),
            };
          });
          const result = { definitions, attributes };
          loadRequestsRef.current.delete(contextKey);
          setStates((current) => ({
            ...current,
            [contextKey]: { status: "loaded", ...result },
          }));
          return result;
        })
        .catch((caughtError: unknown) => {
          const error =
            caughtError instanceof Error
              ? caughtError
              : new Error("No se pudieron cargar los atributos del producto.");
          loadRequestsRef.current.delete(contextKey);
          setStates((current) => ({
            ...current,
            [contextKey]: { status: "error", error },
          }));
          throw error;
        });
      loadRequestsRef.current.set(contextKey, request);
      return request;
    },
    [loadDefinitions, loadValues],
  );

  const getState = useCallback(
    (tenantId?: string, productId?: string): ProductAttributesLoadState => {
      if (!tenantId) return NOT_LOADED_STATE;
      return states[`${tenantId}:${productId ?? "new"}`] ?? NOT_LOADED_STATE;
    },
    [states],
  );

  return { getState, load };
}
