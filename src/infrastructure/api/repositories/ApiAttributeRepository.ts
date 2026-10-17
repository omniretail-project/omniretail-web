import type { AttributeDefinition, ProductAttributeValue } from "@/core/entities";
import type { AttributeRepository } from "@/core/repositories";
import type { PaginatedResult } from "@/core/types/pagination.types";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import {
  apiAttributeDefinitionPageSchema,
  apiAttributeDefinitionSchema,
  apiProductAttributeValueSchema,
  parseApi,
  type ApiAttributeDefinition,
  type ApiProductAttributeValue,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";
import { z } from "zod";

const PAGE_SIZE = 100;
const apiProductAttributeValuesSchema = z.array(apiProductAttributeValueSchema);

export class ApiAttributeRepository implements AttributeRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getDefinitions(): Promise<AttributeDefinition[]> {
    const first = await this.getDefinitionsPage(1);
    const items = [...first.items];
    for (let page = 2; page <= first.totalPages; page += 1) {
      items.push(...(await this.getDefinitionsPage(page)).items);
    }
    return items.map(toDefinition);
  }

  async getValuesByProduct(productId: string): Promise<ProductAttributeValue[]> {
    assertApiUuid(productId, "productId");
    const items = parseApi(
      apiProductAttributeValuesSchema,
      await backendFetch<unknown>(`/catalog/products/${productId}/attributes`),
      "El backend devolvió atributos de producto inválidos.",
    );
    return items.map((item) => toValue(item, productId));
  }

  async createDefinition(
    input: Parameters<AttributeRepository["createDefinition"]>[0],
  ): Promise<AttributeDefinition> {
    if (input.dataType === "date" || input.dataType === "option") {
      throw new BackendRequestError(
        "Products API solo admite atributos de texto, número o booleanos.",
        400,
        "UNSUPPORTED_ATTRIBUTE_TYPE",
      );
    }
    const item = parseApi(
      apiAttributeDefinitionSchema,
      await backendFetch<unknown>("/catalog/attributes", {
        method: "POST",
        body: {
          code: input.code,
          name: input.name,
          dataType: toApiDataType(input.dataType),
        },
      }),
      "El backend devolvió una definición de atributo inválida.",
    );
    const definition = { ...toDefinition(item), tenantId: input.tenantId };
    this.eventBus.emit("product.changed", { tenantId: input.tenantId, action: "updated" });
    return definition;
  }

  async updateDefinition(
    id: string,
    input: Parameters<AttributeRepository["updateDefinition"]>[1],
  ): Promise<AttributeDefinition> {
    assertApiUuid(id, "attributeId");
    const current = (await this.getDefinitions()).find((item) => item.id === id);
    if (!current) throw new BackendRequestError("Atributo no encontrado.", 404);
    if (input.active === false) {
      await backendFetch<void>(`/catalog/attributes/${id}`, { method: "DELETE" });
      return { ...current, active: false };
    }
    const item = parseApi(
      apiAttributeDefinitionSchema,
      await backendFetch<unknown>(`/catalog/attributes/${id}`, {
        method: "PUT",
        body: { name: input.name ?? current.name },
      }),
      "El backend devolvió una definición de atributo inválida.",
    );
    return { ...toDefinition(item), tenantId: current.tenantId };
  }

  async setProductValue(
    input: Parameters<AttributeRepository["setProductValue"]>[0],
  ): Promise<ProductAttributeValue> {
    const current = await this.getValuesByProduct(input.productId);
    const next = [
      ...current.filter(
        (item) => item.attributeDefinitionId !== input.attributeDefinitionId,
      ),
      input,
    ];
    const replaced = await this.replaceValuesForProduct(input.productId, next);
    const saved = replaced.find(
      (item) => item.attributeDefinitionId === input.attributeDefinitionId,
    );
    if (!saved) throw new BackendRequestError("No se pudo guardar el atributo.", 502);
    return saved;
  }

  async replaceValuesForProduct(
    productId: string,
    values: Parameters<AttributeRepository["replaceValuesForProduct"]>[1],
  ): Promise<ProductAttributeValue[]> {
    assertApiUuid(productId, "productId");
    const items = parseApi(
      apiProductAttributeValuesSchema,
      await backendFetch<unknown>(`/catalog/products/${productId}/attributes`, {
        method: "PUT",
        body: {
          attributes: values.map((value) => ({
            attributeId: value.attributeDefinitionId,
            value: String(value.value),
          })),
        },
      }),
      "El backend devolvió atributos de producto inválidos.",
    );
    this.eventBus.emit("product.changed", { productId, action: "updated" });
    return items.map((item) => toValue(item, productId));
  }

  private async getDefinitionsPage(page: number) {
    return parseApi(
      apiAttributeDefinitionPageSchema,
      await backendFetch<unknown>("/catalog/attributes", {
        query: { page, size: PAGE_SIZE },
      }),
      "El backend devolvió definiciones de atributo inválidas.",
    ) as PaginatedResult<ApiAttributeDefinition>;
  }
}

function toDefinition(item: ApiAttributeDefinition): AttributeDefinition {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    dataType: item.dataType.toLowerCase() as AttributeDefinition["dataType"],
    active: item.status === "active",
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toValue(item: ApiProductAttributeValue, productId: string): ProductAttributeValue {
  return {
    productId,
    attributeDefinitionId: item.attributeId,
    value: item.value,
    code: item.code,
    name: item.name,
    dataType: item.dataType.toLowerCase() as "text" | "number" | "boolean",
    active: item.status === "active",
  };
}

function toApiDataType(dataType: AttributeDefinition["dataType"]) {
  return dataType.toUpperCase();
}
