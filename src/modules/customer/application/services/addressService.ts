import type { Address } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { AddressFormDto } from "@/modules/customer/application/dto/AddressFormDto";
import { resolveCustomerAuthorizationContext } from "@/modules/customer/application/services/CustomerAuthorizationContext";

type AddressRepositories = Pick<
  RepositoryRegistry,
  "auth" | "users" | "roles" | "customers" | "addresses"
>;

// La plataforma opera unicamente en Guatemala -- pedirle el pais al
// cliente es informacion redundante, asi que se fija aqui en vez de
// exponerlo como campo del formulario.
const PLATFORM_COUNTRY = "Guatemala";

function toFields(dto: AddressFormDto) {
  return {
    label: dto.label.trim(),
    recipientName: dto.recipientName.trim(),
    line1: dto.line1.trim(),
    line2: dto.line2.trim() || undefined,
    city: dto.city.trim(),
    stateOrDepartment: dto.stateOrDepartment.trim() || undefined,
    postalCode: dto.postalCode.trim() || undefined,
    country: PLATFORM_COUNTRY,
    references: dto.references.trim() || undefined,
  };
}

/**
 * Application services de Direcciones. Cada funcion publica recibe
 * UNICAMENTE `repositories` (capacidad, no identidad) y datos de
 * negocio (addressId, dto) -- nunca tenantId/customerId. El scope se
 * resuelve internamente en cada llamada via
 * resolveCustomerAuthorizationContext, y el repositorio (ver
 * MockAddressRepository) vuelve a verificar la pertenencia del recurso
 * contra ese scope.
 */

export async function listAddresses(repositories: AddressRepositories): Promise<Address[]> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.addresses.getByCustomer(context.tenantId, context.customerId);
}

export async function createAddress(
  repositories: AddressRepositories,
  dto: AddressFormDto,
): Promise<Address> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.addresses.create({
    tenantId: context.tenantId,
    customerId: context.customerId,
    ...toFields(dto),
  });
}

export async function updateAddress(
  repositories: AddressRepositories,
  addressId: string,
  dto: AddressFormDto,
): Promise<Address> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.addresses.update(
    context.tenantId,
    context.customerId,
    addressId,
    toFields(dto),
  );
}

export async function removeAddress(
  repositories: AddressRepositories,
  addressId: string,
): Promise<void> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.addresses.remove(context.tenantId, context.customerId, addressId);
}

export async function setDefaultAddress(
  repositories: AddressRepositories,
  addressId: string,
): Promise<Address> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.addresses.setDefault(context.tenantId, context.customerId, addressId);
}
