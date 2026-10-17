import type { BankAccount, BankAccountStatus, BankAccountType } from "@/core/entities";
import type { CurrencyCode } from "@/core/types/common.types";
import { assertApiUuid } from "@/infrastructure/api/uuid";

/** BankAccountResponse del backend (`/administration/bank-accounts`). */
export interface ApiBankAccount {
  id: string;
  tenantId: string;
  bankName: string;
  holderName: string;
  accountNumber: string;
  accountNumberMasked: string;
  accountType: string;
  currency: string;
  alias: string;
  branchIds: string[] | null;
  transferInstructions: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * CreateBankAccountRequest / UpdateBankAccountRequest: la tienda sale del JWT, nunca del body, y
 * `accountNumberMasked` lo deriva el backend del numero completo.
 */
export interface ApiBankAccountRequest {
  bankName: string;
  holderName: string;
  accountNumber: string;
  accountType: BankAccountType;
  currency: CurrencyCode;
  alias: string;
  branchIds: string[];
  transferInstructions?: string;
  status: BankAccountStatus;
}

type BankAccountInput = Omit<
  BankAccount,
  "id" | "tenantId" | "accountNumberMasked" | "createdAt" | "updatedAt"
>;

export function toBankAccount(account: ApiBankAccount): BankAccount {
  return {
    id: account.id,
    tenantId: account.tenantId,
    bankName: account.bankName,
    holderName: account.holderName,
    accountNumber: account.accountNumber,
    accountNumberMasked: account.accountNumberMasked,
    accountType: account.accountType as BankAccountType,
    currency: account.currency as CurrencyCode,
    alias: account.alias,
    branchIds: account.branchIds ?? [],
    transferInstructions: account.transferInstructions ?? undefined,
    status: account.status as BankAccountStatus,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/**
 * El PUT del backend reemplaza branchIds/transferInstructions y exige el resto de campos, por eso
 * se envia siempre la cuenta completa. Las sucursales deben ser UUID del backend.
 */
export function toBankAccountRequest(input: BankAccountInput): ApiBankAccountRequest {
  input.branchIds.forEach((branchId) => assertApiUuid(branchId, "branchIds"));
  return {
    bankName: input.bankName,
    holderName: input.holderName,
    accountNumber: input.accountNumber,
    accountType: input.accountType,
    currency: input.currency,
    alias: input.alias,
    branchIds: input.branchIds,
    transferInstructions: input.transferInstructions,
    status: input.status,
  };
}
