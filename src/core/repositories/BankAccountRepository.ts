import type { BankAccount } from "@/core/entities";
export interface BankAccountRepository {
  getAll(): Promise<BankAccount[]>;
  getActive(): Promise<BankAccount[]>;
  /** Tenant-scoped read: only active accounts belonging to `tenantId`. Use for any flow driven by UI/session context (e.g. POS checkout) instead of `getActive()` + filtering in memory. */
  getActiveByTenant(tenantId: string): Promise<BankAccount[]>;
  getById(id: string): Promise<BankAccount | null>;
  create(input: Omit<BankAccount, "id" | "createdAt" | "updatedAt">): Promise<BankAccount>;
  update(
    id: string,
    input: Partial<Omit<BankAccount, "id" | "createdAt" | "updatedAt">>,
  ): Promise<BankAccount>;
}
