import type { Customer } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCustomerAuthorizationContext } from "@/modules/customer/application/services/CustomerAuthorizationContext";

type ProfileReadRepositories = Pick<RepositoryRegistry, "auth" | "users" | "roles" | "customers">;

/**
 * Lectura del perfil del cliente autenticado. Igual que
 * updateCustomerProfile, no recibe identidad del caller -- la resuelve
 * internamente via el mismo contexto canonico.
 */
export async function getCurrentCustomerProfile(
  repositories: ProfileReadRepositories,
): Promise<Customer> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return context.customer;
}
