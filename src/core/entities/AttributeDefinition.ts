import type { ISODateString } from "@/core/types/common.types";

export type AttributeDataType = "text" | "number" | "boolean" | "date" | "option";

export interface AttributeDefinition {
  id: string;
  tenantId?: string;
  name: string;
  code: string;
  dataType: AttributeDataType;
  options?: string[];
  required?: boolean;
  active: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
