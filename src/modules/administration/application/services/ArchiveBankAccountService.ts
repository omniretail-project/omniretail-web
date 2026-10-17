import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { BankAccountDto } from "@/modules/administration/application/dto/BankAccountDto";
import { toBankAccountDto } from "@/modules/administration/application/mappers/BankAccountMapper";
import {
  ensureBankAccountActor,
  ensureBankAccountBelongsToTenant,
  ensureBankAccountTenant,
  ensureCanManageBankAccounts,
} from "@/modules/administration/application/services/serviceHelpers";

export class ArchiveBankAccountService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(
    tenantId: string,
    accountId: string,
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

    const account = ensureBankAccountBelongsToTenant(
      await this.repositories.bankAccounts.update(current.id, { status: "archived" }),
      tenantId,
    );
    await this.repositories.auditLogs.append({
      tenantId,
      actorUserId,
      action: "bank_account.archived",
      entityType: "BankAccount",
      entityId: account.id,
      metadata: {
        alias: account.alias,
        previousStatus: current.status,
        status: account.status,
      },
    });

    return toBankAccountDto(account);
  }
}
