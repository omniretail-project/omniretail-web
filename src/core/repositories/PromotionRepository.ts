import type { Promotion } from "@/core/entities";
import type { SalesChannel } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface PromotionApplicabilityCriteria {
  tenantId: string;
  productId: string;
  at: ISODateString;
  channel: SalesChannel;
  branchId?: string;
}

export interface PromotionRepository {
  getAll(): Promise<Promotion[]>;
  getActive(): Promise<Promotion[]>;
  getActiveByTenant(tenantId: string): Promise<Promotion[]>;
  getByProduct(productId: string): Promise<Promotion[]>;
  getByProductScoped(tenantId: string, productId: string): Promise<Promotion[]>;
  getByIdScoped(tenantId: string, id: string): Promise<Promotion | null>;
  getApplicable(criteria: PromotionApplicabilityCriteria): Promise<Promotion | null>;
  create(input: Omit<Promotion, "id" | "createdAt" | "updatedAt">): Promise<Promotion>;
  update(
    id: string,
    input: Partial<Omit<Promotion, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Promotion>;
  updateScoped(
    tenantId: string,
    id: string,
    input: Partial<Omit<Promotion, "id" | "tenantId" | "createdAt" | "updatedAt">>,
  ): Promise<Promotion>;
  endScoped(tenantId: string, id: string): Promise<Promotion>;
  cancelScoped(tenantId: string, id: string): Promise<Promotion>;
}
