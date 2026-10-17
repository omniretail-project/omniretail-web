import type { ISODateString } from "@/core/types/common.types";

export interface RecoveryCode {
  id: string;
  userId: string;
  code: string;
  used: boolean;
  createdAt: ISODateString;
}
