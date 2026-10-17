import type { Customer } from "@/core/entities";

/**
 * Allowlist explicita de lo unico que un cliente puede editar de su
 * propio perfil. Deliberadamente separado de Partial<Customer>: ese tipo
 * generico permite (por TypeScript) tocar tenantId, userId, email,
 * status o cualquier otro campo interno, y updateProfileForCustomer NO
 * debe exponer esa superficie ni siquiera a nivel de tipo.
 */
export type UpdateCustomerProfileInput = {
  name?: string;
  phone?: string;
};

export interface CustomerRepository {
  getAll(): Promise<Customer[]>;
  listByTenant(tenantId: string): Promise<Customer[]>;
  getById(id: string): Promise<Customer | null>;
  getByUserId(userId: string): Promise<Customer | null>;
  getByEmail(email: string): Promise<Customer | null>;
  create(input: Omit<Customer, "id" | "createdAt" | "updatedAt">): Promise<Customer>;
  /**
   * Operacion generica, usada por flujos administrativos (gestion de
   * clientes) que legitimamente necesitan tocar cualquier campo de
   * Customer por id. NO usar esto para el autoservicio de perfil del
   * propio cliente -- ver updateProfileForCustomer.
   */
  update(
    id: string,
    input: Partial<Omit<Customer, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Customer>;
  /**
   * Boundary especifico para el autoservicio de "Datos personales" del
   * cliente autenticado (ver modules/customer). A diferencia de update():
   * - exige tenantId + customerId explicitos y el repositorio vuelve a
   *   verificar que el Customer realmente pertenezca a ese tenant (nunca
   *   confia en que el caller ya lo valido);
   * - el input es UpdateCustomerProfileInput (name/phone unicamente), no
   *   Partial<Customer> -- no hay forma, ni siquiera a nivel de tipo, de
   *   pedir un cambio de tenantId/userId/email/status/segmentId/code
   *   a traves de este metodo.
   */
  updateProfileForCustomer(
    tenantId: string,
    customerId: string,
    input: UpdateCustomerProfileInput,
  ): Promise<Customer>;
}
