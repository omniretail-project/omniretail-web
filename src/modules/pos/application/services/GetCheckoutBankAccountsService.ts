import { isBranchScopedResourceAvailable } from "@/core/scopes/branchScope";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { CheckoutBankAccountDto } from "@/modules/pos/application/dto/CheckoutDto";
import {
  POS_SALES_CREATE_PERMISSION,
  ensurePosBranchAccess,
  ensurePosPermission,
  resolvePosSessionContext,
} from "@/modules/pos/application/services/posServiceContext";

export interface GetCheckoutBankAccountsInput {
  branchId: string;
}

/**
 * Cuentas bancarias disponibles para que el cajero elija al cobrar por transferencia. Tenant,
 * permisos y alcance de sucursal se resuelven desde la sesión actual; `branchId` sólo identifica
 * la sucursal operativa solicitada y se valida contra `User.allowedBranchIds`.
 *
 * El checkout no necesita exponer el número completo: la confirmación usa `bankAccountId` y vuelve
 * a validar internamente tenant/sucursal/moneda. Por eso el read model entrega sólo máscara.
 */
export class GetCheckoutBankAccountsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: GetCheckoutBankAccountsInput): Promise<CheckoutBankAccountDto[]> {
    const { tenant, tenantId, user, permissions } = await resolvePosSessionContext(
      this.repositories,
    );
    ensurePosPermission(permissions, POS_SALES_CREATE_PERMISSION);
    const branch = await ensurePosBranchAccess(this.repositories, user, input.branchId);
    const accounts = await this.repositories.bankAccounts.getActiveByTenant(tenantId);
    return accounts
      .filter(
        (account) =>
          account.currency === tenant.defaultCurrency &&
          isBranchScopedResourceAvailable(account.branchIds, branch.id),
      )
      .map((account) => ({
        id: account.id,
        bankName: account.bankName,
        accountType: account.accountType,
        holderName: account.holderName,
        accountNumberMasked: account.accountNumberMasked,
        currency: account.currency,
      }));
  }
}
