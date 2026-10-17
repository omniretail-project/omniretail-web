import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  BankAccountDto,
  BankAccountInputDto,
} from "@/modules/administration/application/dto/BankAccountDto";
import { toBankAccountDto } from "@/modules/administration/application/mappers/BankAccountMapper";
import {
  ensureBankAccountActor,
  ensureBankAccountBranchIds,
  ensureBankAccountTenant,
  ensureCanManageBankAccounts,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  maskAccountNumber,
  normalizeBankAccountInput,
  validateBankAccountInput,
} from "@/modules/administration/validation/bankAccount.validation";

export class CreateBankAccountService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    dto: BankAccountInputDto,
    permissions: readonly string[],
    actorUserId: string,
  ): Promise<BankAccountDto> {
    ensureCanManageBankAccounts(permissions);
    ensureBankAccountTenant(tenantId);
    ensureBankAccountActor(actorUserId);
    validateBankAccountInput(dto, "create");

    const input = normalizeBankAccountInput(dto);
    // La validación en modo "create" garantiza accountNumber presente; accountNumberMasked se
    // deriva acá, nunca se acepta desde el DTO.
    const accountNumber = input.accountNumber as string;
    const accountNumberMasked = maskAccountNumber(accountNumber);
    const tenantBranches = (await this.repositories.branches.getAll()).filter(
      (branch) => branch.tenantId === tenantId,
    );
    ensureBankAccountBranchIds(input.branchIds, tenantBranches);

    const account = await this.repositories.bankAccounts.create({
      tenantId,
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
    });
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "bank_account.created",
      entityType: "BankAccount",
      entityId: account.id,
      metadata: {
        alias: account.alias,
        bankName: account.bankName,
        accountType: account.accountType,
        accountNumberMasked: account.accountNumberMasked,
        currency: account.currency,
        status: account.status,
      },
    });

    return toBankAccountDto(account);
  }
}
