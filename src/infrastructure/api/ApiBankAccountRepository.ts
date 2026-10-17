import type { BankAccount } from "@/core/entities";
import type { BankAccountRepository } from "@/core/repositories";
import type { PaginatedResult } from "@/core/types";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  type ApiBankAccount,
  toBankAccount,
  toBankAccountRequest,
} from "@/infrastructure/api/apiBankAccountMapper";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const BASE_PATH = "/administration/bank-accounts";
/** Tamaño de pagina al recorrer el listado completo. */
const PAGE_SIZE = 100;

/**
 * BankAccountRepository de modo api contra `/api/backend/administration/bank-accounts`. El backend
 * resuelve la tienda desde el JWT, asi que `getActiveByTenant` solo filtra el resultado por
 * `tenantId` para respetar el contrato.
 *
 * Emite `payment.changed` (no un evento propio), igual que MockBankAccountRepository: es el evento
 * que escuchan useBankAccounts, usePosTerminal y los reportes.
 */
export class ApiBankAccountRepository implements BankAccountRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getAll(): Promise<BankAccount[]> {
    const accounts: BankAccount[] = [];
    for (let page = 1; ; page++) {
      const result = await backendFetch<PaginatedResult<ApiBankAccount>>(BASE_PATH, {
        query: { page, size: PAGE_SIZE },
      });
      accounts.push(...result.items.map(toBankAccount));
      if (page >= result.totalPages) return accounts;
    }
  }

  async getActive(): Promise<BankAccount[]> {
    const accounts = await backendFetch<ApiBankAccount[]>(`${BASE_PATH}/active`);
    return accounts.map(toBankAccount);
  }

  async getActiveByTenant(tenantId: string): Promise<BankAccount[]> {
    return (await this.getActive()).filter((account) => account.tenantId === tenantId);
  }

  async getById(id: string): Promise<BankAccount | null> {
    if (!isApiUuid(id)) return null;
    try {
      return toBankAccount(await backendFetch<ApiBankAccount>(`${BASE_PATH}/${id}`));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async create(input: Omit<BankAccount, "id" | "createdAt" | "updatedAt">): Promise<BankAccount> {
    const created = toBankAccount(
      await backendFetch<ApiBankAccount>(BASE_PATH, {
        method: "POST",
        body: toBankAccountRequest(input),
      }),
    );
    this.emitChanged(created, "created");
    return created;
  }

  /** Archivar es un `update` con `status: "archived"` (el contrato no tiene `archive`). */
  async update(
    id: string,
    input: Partial<Omit<BankAccount, "id" | "createdAt" | "updatedAt">>,
  ): Promise<BankAccount> {
    const current = await this.getById(id);
    if (!current) throw new Error("Cuenta bancaria no encontrada.");
    const updated = toBankAccount(
      await backendFetch<ApiBankAccount>(`${BASE_PATH}/${id}`, {
        method: "PUT",
        body: toBankAccountRequest({ ...current, ...input }),
      }),
    );
    this.emitChanged(updated, updated.status === "archived" ? "archived" : "updated");
    return updated;
  }

  private emitChanged(account: BankAccount, action: "created" | "updated" | "archived"): void {
    this.eventBus.emit("payment.changed", {
      entityId: account.id,
      tenantId: account.tenantId,
      action,
    });
  }
}
