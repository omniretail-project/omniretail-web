import type { BankAccount } from "@/core/entities";
import type { BankAccountDto } from "@/modules/administration/application/dto/BankAccountDto";

export function toBankAccountDto(account: BankAccount): BankAccountDto {
  return {
    id: account.id,
    bankName: account.bankName,
    holderName: account.holderName,
    accountNumber: account.accountNumber,
    accountNumberMasked: account.accountNumberMasked,
    accountType: account.accountType,
    currency: account.currency,
    alias: account.alias,
    branchIds: [...account.branchIds],
    transferInstructions: account.transferInstructions,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
