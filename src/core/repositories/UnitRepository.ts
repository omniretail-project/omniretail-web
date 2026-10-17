import type { Unit, UnitConversion } from "@/core/entities";
export interface UnitRepository {
  getAll(): Promise<Unit[]>;
  getByTenant(tenantId: string): Promise<Unit[]>;
  getById(id: string): Promise<Unit | null>;
  getByIdScoped(tenantId: string, id: string): Promise<Unit | null>;
  getActive(): Promise<Unit[]>;
  getActiveByTenant(tenantId: string): Promise<Unit[]>;
  getAllConversionsByTenant(tenantId: string): Promise<UnitConversion[]>;
  getConversionsByProduct(productId: string): Promise<UnitConversion[]>;
  getConversionsByProductScoped(tenantId: string, productId: string): Promise<UnitConversion[]>;
  getConversion(input: {
    tenantId: string;
    productId?: string;
    fromUnitId: string;
    toUnitId: string;
  }): Promise<UnitConversion | null>;
  create(input: Omit<Unit, "id" | "createdAt" | "updatedAt">): Promise<Unit>;
  update(id: string, input: Partial<Omit<Unit, "id" | "createdAt" | "updatedAt">>): Promise<Unit>;
  updateScoped(
    tenantId: string,
    id: string,
    input: Partial<Omit<Unit, "id" | "tenantId" | "createdAt" | "updatedAt">>,
  ): Promise<Unit>;
  upsertConversion(input: Omit<UnitConversion, "id" | "createdAt">): Promise<UnitConversion>;
  replaceConversionsForProduct(
    productId: string,
    conversions: Omit<UnitConversion, "id" | "productId" | "createdAt">[],
  ): Promise<UnitConversion[]>;
  replaceConversionsForProductScoped(
    tenantId: string,
    productId: string,
    conversions: Omit<UnitConversion, "id" | "productId" | "tenantId" | "createdAt">[],
  ): Promise<UnitConversion[]>;
}
