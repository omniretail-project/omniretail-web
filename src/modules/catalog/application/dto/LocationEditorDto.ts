import type { StorageLocation } from "@/core/entities";

export interface LocationListItem {
  id: string;
  tenantId: string;
  branchId: string;
  parentId?: string;
  parentName?: string;
  code: string;
  name: string;
  type: StorageLocation["type"];
  depth: number;
  description?: string;
  status: StorageLocation["status"];
  productCount: number | null;
}

export interface LocationEditorDto {
  name: string;
  code: string;
  description: string;
  branchId: string;
  parentId: string;
  type: StorageLocation["type"];
  status: StorageLocation["status"];
}
