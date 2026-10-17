import type { ISODateString } from "@/core/types/common.types";

export interface EmailVerification {
  id: string;
  userId: string;
  token: string;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  verifiedAt?: ISODateString;
}
