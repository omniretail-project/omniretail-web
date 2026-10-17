import type { Address } from "@/core/entities";

/**
 * tenantId/customerId son obligatorios pero SIEMPRE deben provenir de la
 * identidad resuelta en sesion (ver resolveCustomerAuthorizationContext
 * en modules/customer), nunca de un
 * campo de formulario. isDefault queda fuera del input de creacion: el
 * repositorio decide server-side si la direccion nace default (primera
 * del cliente) -- ver invariante en MockAddressRepository.
 */
export type CreateAddressInput = Omit<Address, "id" | "isDefault" | "createdAt" | "updatedAt">;

/**
 * isDefault y tenantId/customerId quedan fuera de lo editable por update():
 * el default solo cambia via setDefault(), y la pertenencia de una
 * direccion (a que tenant/cliente pertenece) nunca se reasigna.
 */
export type UpdateAddressInput = Partial<
  Omit<Address, "id" | "tenantId" | "customerId" | "isDefault" | "createdAt" | "updatedAt">
>;

/**
 * Todas las operaciones por id exigen tenantId + customerId explicitos y
 * los usan para scoping -- un addressId por si solo nunca es suficiente
 * para leer/mutar el recurso. Un id que exista pero pertenezca a otro
 * tenant/cliente se trata igual que "no existe" (nunca se filtra
 * informacion de pertenencia a traves del mensaje de error).
 */
export interface AddressRepository {
  getByCustomer(tenantId: string, customerId: string): Promise<Address[]>;
  getById(tenantId: string, customerId: string, id: string): Promise<Address | null>;
  create(input: CreateAddressInput): Promise<Address>;
  update(
    tenantId: string,
    customerId: string,
    id: string,
    input: UpdateAddressInput,
  ): Promise<Address>;
  remove(tenantId: string, customerId: string, id: string): Promise<void>;
  setDefault(tenantId: string, customerId: string, addressId: string): Promise<Address>;
}
