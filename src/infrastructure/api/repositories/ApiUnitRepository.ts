import { UnitStatus } from "@/core/enums";
import type { Unit, UnitConversion } from "@/core/entities";
import type { UnitRepository } from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  fetchAllApiPages,
  type ApiUnit,
  type ApiUnitConversion,
} from "@/infrastructure/api/repositories/catalogMasterDataApi";
import { assertApiUuid, assertOptionalApiUuid } from "@/infrastructure/api/uuid";
import {
  apiUnitConversionSchema,
  parseApi,
} from "@/infrastructure/api/repositories/productRelationsApi.schema";
import { z } from "zod";

type UnitWrite = Omit<Unit, "id" | "createdAt" | "updatedAt">;
type ConversionWrite = Omit<UnitConversion, "id" | "createdAt">;
type ProductConversionWrite = Pick<UnitConversion, "fromUnitId" | "toUnitId" | "factor">;
const apiProductUnitConversionsSchema = z.array(apiUnitConversionSchema);

export class ApiUnitRepository implements UnitRepository {
  constructor(
    _productScopedDelegate: UnitRepository,
    private readonly eventBus: DataEventBus,
  ) {
    void _productScopedDelegate;
  }

  async getAll() {
    return this.listUnits();
  }

  async getByTenant(_tenantId: string) {
    void _tenantId;
    return this.listUnits();
  }

  async getById(id: string) {
    assertApiUuid(id, "unitId");
    try {
      return toUnit(await backendFetch<ApiUnit>(`/catalog/units/${id}`));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async getByIdScoped(_tenantId: string, id: string) {
    return this.getById(id);
  }

  async getActive() {
    return this.listUnits(UnitStatus.active);
  }

  async getActiveByTenant(_tenantId: string) {
    void _tenantId;
    return this.listUnits(UnitStatus.active);
  }

  async getAllConversionsByTenant(_tenantId: string) {
    void _tenantId;
    return this.listConversions();
  }

  async getConversionsByProduct(productId: string) {
    assertApiUuid(productId, "productId");
    return this.listProductConversions(productId);
  }

  async getConversionsByProductScoped(_tenantId: string, productId: string) {
    void _tenantId;
    return this.getConversionsByProduct(productId);
  }

  async getConversion(input: Parameters<UnitRepository["getConversion"]>[0]) {
    assertOptionalApiUuid(input.productId, "productId");
    assertApiUuid(input.fromUnitId, "fromUnitId");
    assertApiUuid(input.toUnitId, "toUnitId");
    const productId = input.productId || undefined;
    const conversions = await this.listConversions({
      productId,
      fromUnitId: input.fromUnitId,
      toUnitId: input.toUnitId,
    });
    return (
      conversions.find(
        (conversion) =>
          conversion.fromUnitId === input.fromUnitId &&
          conversion.toUnitId === input.toUnitId &&
          conversion.productId === productId,
      ) ?? null
    );
  }

  async create(input: UnitWrite) {
    const unit = toUnit(
      await backendFetch<ApiUnit>("/catalog/units", {
        method: "POST",
        body: toCreateRequest(input),
      }),
    );
    this.emitUnit(unit, "created");
    return unit;
  }

  async update(id: string, input: Partial<UnitWrite>) {
    assertApiUuid(id, "unitId");
    const current = await this.getById(id);
    if (!current) throw new BackendRequestError("Unidad no encontrada.", 404, "UNIT_NOT_FOUND");

    if (input.status === UnitStatus.archived && Object.keys(input).length === 1) {
      await backendFetch<void>(`/catalog/units/${id}`, { method: "DELETE" });
      const archived = { ...current, status: UnitStatus.archived };
      this.emitUnit(archived, "archived");
      return archived;
    }

    const unit = toUnit(
      await backendFetch<ApiUnit>(`/catalog/units/${id}`, {
        method: "PUT",
        body: toUpdateRequest({ ...current, ...input }),
      }),
    );
    this.emitUnit(unit, "updated");
    return unit;
  }

  async updateScoped(_tenantId: string, id: string, input: Partial<Omit<UnitWrite, "tenantId">>) {
    return this.update(id, input);
  }

  async upsertConversion(input: ConversionWrite) {
    assertOptionalApiUuid(input.productId, "productId");
    assertApiUuid(input.fromUnitId, "fromUnitId");
    assertApiUuid(input.toUnitId, "toUnitId");
    const current = await this.getConversion(input);
    const conversion = current
      ? toConversion(
          await backendFetch<ApiUnitConversion>(`/catalog/unit-conversions/${current.id}`, {
            method: "PUT",
            body: { factor: input.factor },
          }),
        )
      : toConversion(
          await backendFetch<ApiUnitConversion>("/catalog/unit-conversions", {
            method: "POST",
            body: toConversionRequest(input),
          }),
        );
    this.emitConversion(conversion, current ? "updated" : "created");
    return conversion;
  }

  async replaceConversionsForProduct(
    productId: string,
    conversions: Parameters<UnitRepository["replaceConversionsForProduct"]>[1],
  ) {
    return this.replaceProductConversions(productId, conversions);
  }

  async replaceConversionsForProductScoped(
    tenantId: string,
    productId: string,
    conversions: Parameters<UnitRepository["replaceConversionsForProductScoped"]>[2],
  ) {
    void tenantId;
    return this.replaceProductConversions(productId, conversions);
  }

  private async replaceProductConversions(
    productId: string,
    conversions: ProductConversionWrite[],
  ) {
    assertApiUuid(productId, "productId");
    const items = parseApi(
      apiProductUnitConversionsSchema,
      await backendFetch<unknown>(`/catalog/products/${productId}/unit-conversions`, {
        method: "PUT",
        body: {
          conversions: conversions.map((conversion) => ({
            fromUnitId: conversion.fromUnitId,
            toUnitId: conversion.toUnitId,
            factor: conversion.factor,
          })),
        },
      }),
      "El backend devolvió conversiones de producto inválidas.",
    ).map(toConversion);
    this.eventBus.emit("unit-conversion.changed", { productId, action: "updated" });
    return items;
  }

  private async listProductConversions(productId: string) {
    return parseApi(
      apiProductUnitConversionsSchema,
      await backendFetch<unknown>(`/catalog/products/${productId}/unit-conversions`),
      "El backend devolvió conversiones de producto inválidas.",
    ).map(toConversion);
  }

  private async listUnits(status?: UnitStatus) {
    return (await fetchAllApiPages<ApiUnit>("/catalog/units", { status })).map(toUnit);
  }

  private async listConversions(
    query: {
      productId?: string;
      fromUnitId?: string;
      toUnitId?: string;
    } = {},
  ) {
    return (await fetchAllApiPages<ApiUnitConversion>("/catalog/unit-conversions", query)).map(
      toConversion,
    );
  }

  private emitUnit(unit: Unit, action: "created" | "updated" | "archived") {
    this.eventBus.emit("business-config.changed", {
      entityId: unit.id,
      tenantId: unit.tenantId,
      action,
    });
  }

  private emitConversion(conversion: UnitConversion, action: "created" | "updated") {
    this.eventBus.emit("unit-conversion.changed", {
      entityId: conversion.id,
      tenantId: conversion.tenantId,
      productId: conversion.productId,
      action,
    });
  }
}

function toUnit(unit: ApiUnit): Unit {
  return unit;
}

function toConversion(conversion: ApiUnitConversion): UnitConversion {
  return {
    ...conversion,
    productId: conversion.productId ?? undefined,
    factor: Number(conversion.factor),
  };
}

function toCreateRequest(unit: UnitWrite) {
  return {
    code: unit.code,
    name: unit.name,
    symbol: unit.symbol,
    category: unit.category,
    allowsDecimals: unit.allowsDecimals,
    status: unit.status,
  };
}

function toUpdateRequest(unit: UnitWrite) {
  return {
    name: unit.name,
    symbol: unit.symbol,
    category: unit.category,
    allowsDecimals: unit.allowsDecimals,
    status: unit.status,
  };
}

function toConversionRequest(conversion: ConversionWrite) {
  return {
    productId: conversion.productId || null,
    fromUnitId: conversion.fromUnitId,
    toUnitId: conversion.toUnitId,
    factor: conversion.factor,
  };
}
