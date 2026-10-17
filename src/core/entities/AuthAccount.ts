import type { AccountStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface AuthAccount {
  id: string;
  userId: string;
  email: string;
  passwordHashMock: string;
  status: AccountStatus;
  failedLoginAttempts: number;
  lockedUntil?: ISODateString;
  passwordChangedAt?: ISODateString;
  lastLoginAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
