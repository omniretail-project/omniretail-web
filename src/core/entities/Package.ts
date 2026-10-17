import type { ISODateString } from "@/core/types/common.types";

export interface Package {
  id: string;
  dispatchId: string;
  number: string;
  weight?: number;
  description?: string;
  createdAt: ISODateString;
}
