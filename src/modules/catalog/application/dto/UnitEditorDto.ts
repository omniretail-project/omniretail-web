import type { Unit } from "@/core/entities";

export interface UnitListItem {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  symbol: string;
  category: Unit["category"];
  categoryLabel: string;
  allowsDecimals: boolean;
  status: Unit["status"];
  productReferenceCount: number;
  conversionReferenceCount: number;
}

export interface UnitEditorDto {
  name: string;
  symbol: string;
  category: Unit["category"];
  allowsDecimals: boolean;
  status: Unit["status"];
}
