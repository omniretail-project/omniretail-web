import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BankAccountDto } from "@/modules/administration/application/dto/BankAccountDto";
import { toBankAccountDto } from "@/modules/administration/application/mappers/BankAccountMapper";
import {
  ensureBankAccountTenant,
  ensureCanManageBankAccounts,
} from "@/modules/administration/application/services/serviceHelpers";

export class GetBankAccountsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, permissions: readonly string[]): Promise<BankAccountDto[]> {
    ensureCanManageBankAccounts(permissions);
    ensureBankAccountTenant(tenantId);
    const accounts = await this.repositories.bankAccounts.getAll();

    return accounts.filter((account) => account.tenantId === tenantId).map(toBankAccountDto);
  }
}
