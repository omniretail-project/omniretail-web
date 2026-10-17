import type { ISODateString } from "@/core/types/common.types";

export interface Session {
  id: string;
  userId: string;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  rememberMe: boolean;
  /** Branch selected for this authenticated session; never supplied as mutation authority by UI. */
  activeBranchId?: string;
  deviceLabel?: string;
  revokedAt?: ISODateString;
}
