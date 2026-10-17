import type { RoleStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export type BranchScope = "assigned" | "selected" | "all";

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions: string[];
  branchScope: BranchScope;
  /**
   * Un rol `isSystem` (los sembrados por la plataforma) nunca debe archivarse ni actualizarse por
   * los futuros application services. El payload de update tampoco puede modificar `isSystem`,
   * para que el repositorio no corrompa accidentalmente el flag aunque esa política se omita.
   */
  status: RoleStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
