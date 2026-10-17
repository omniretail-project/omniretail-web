import type { Customer } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { ProfileFormDto } from "@/modules/customer/application/dto/ProfileFormDto";
import { resolveCustomerAuthorizationContext } from "@/modules/customer/application/services/CustomerAuthorizationContext";

const PROFILE_UPDATE_PERMISSION = "customer.account.update";

export class ProfileUpdateNotAllowedError extends Error {}

type ProfileRepositories = Pick<RepositoryRegistry, "auth" | "users" | "roles" | "customers">;

/**
 * Boundary autorizado para actualizar el perfil del cliente autenticado.
 * NO recibe user/customerId/tenantId/hasPermission del caller -- resuelve
 * el CustomerAuthorizationContext internamente en cada llamada, asi que
 * no existe forma de pasarle la identidad de otro cliente ni de simular
 * un permiso concedido desde el hook. El permiso se comprueba contra
 * `context.hasPermission`, derivado del Role real, nunca contra un
 * boolean que llegue de afuera.
 *
 * Usa updateProfileForCustomer() (no el generico update(id, Partial
 * <Customer>)): ese generico sigue existiendo para flujos
 * administrativos legitimos, pero permitiria -- solo por TypeScript --
 * tocar tenantId/userId/email/status. updateProfileForCustomer exige
 * tenantId+customerId scoped y limita el input a name/phone.
 */
export async function updateCustomerProfile(
  repositories: ProfileRepositories,
  dto: ProfileFormDto,
): Promise<Customer> {
  const context = await resolveCustomerAuthorizationContext(repositories);

  if (!context.hasPermission(PROFILE_UPDATE_PERMISSION)) {
    throw new ProfileUpdateNotAllowedError("No dispone de permisos para actualizar el perfil.");
  }

  return repositories.customers.updateProfileForCustomer(context.tenantId, context.customerId, {
    name: dto.name.trim(),
    phone: dto.phone.trim() || undefined,
  });
}
