import type { ISODateString } from "@/core/types/common.types";
import type { SupplierCostTier } from "@/core/entities/SupplierCostTier";

export interface SupplierProduct {
  id: string;
  tenantId: string;
  supplierId: string;
  productId: string;
  supplierSku?: string;
  purchaseUnitId: string;
  purchaseToBaseFactor: number;
  lastCost: number;
  leadTimeDays: number;
  minimumOrderQuantity: number;
  preferred: boolean;
  active: boolean;
  /** Incluido por lecturas operacionales API; repositorios legacy pueden resolverlo aparte. */
  costTiers?: SupplierCostTier[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
