import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  BankAccountDto,
  BankAccountInputDto,
} from "@/modules/administration/application/dto/BankAccountDto";
import { toBankAccountDto } from "@/modules/administration/application/mappers/BankAccountMapper";
import {
  ensureBankAccountActor,
  ensureBankAccountBelongsToTenant,
  ensureBankAccountBranchIds,
  ensureBankAccountTenant,
  ensureCanManageBankAccounts,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  maskAccountNumber,
  normalizeBankAccountInput,
  validateBankAccountInput,
} from "@/modules/administration/validation/bankAccount.validation";

export class UpdateBankAccountService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    accountId: string,
    dto: BankAccountInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<BankAccountDto> {
    ensureCanManageBankAccounts(permissions);
    ensureBankAccountTenant(tenantId);
    ensureBankAccountActor(actorUserId);
    const current = ensureBankAccountBelongsToTenant(
      await this.repositories.bankAccounts.getById(accountId),
      tenantId,
    );
    validateBankAccountInput(dto, "update");

    const input = normalizeBankAccountInput(dto);
    // Un accountNumber vacío en edición significa "conservar el actual": se conserva el número Y
    // su máscara sin volver a derivarla a partir de un valor que el usuario no tocó.
    const accountNumber = input.accountNumber ?? current.accountNumber;
    const accountNumberMasked =
      input.accountNumber === undefined
        ? current.accountNumberMasked
        : maskAccountNumber(accountNumber);
    const tenantBranches = (await this.repositories.branches.getAll()).filter(
      (branch) => branch.tenantId === tenantId,
    );
    ensureBankAccountBranchIds(input.branchIds, tenantBranches, current.branchIds);

    const account = ensureBankAccountBelongsToTenant(
      await this.repositories.bankAccounts.update(current.id, {
        bankName: input.bankName,
        holderName: input.holderName,
        accountNumber,
        accountNumberMasked,
        accountType: input.accountType,
        currency: input.currency,
        alias: input.alias,
        branchIds: input.branchIds,
        transferInstructions: input.transferInstructions,
        status: input.status,
      }),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "bank_account.updated",
      entityType: "BankAccount",
      entityId: account.id,
      metadata: {
        alias: account.alias,
        accountNumberMasked: account.accountNumberMasked,
        previousStatus: current.status,
        status: account.status,
      },
    });

    return toBankAccountDto(account);
  }
}
