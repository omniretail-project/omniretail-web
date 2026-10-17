import type { User } from "@/core/entities";
import type { UserStatus } from "@/core/enums";
export interface UserRepository {
  getAll(): Promise<User[]>;
  getById(id: string): Promise<User | null>;
  /**
   * Global a propósito, sin `tenantId`: es la fuente de unicidad de email para login() (Employee/
   * Admin se resuelven SIN restricción de tenant ahí, ver AuthRepository.LoginInput) y para
   * `admin-users`, que reutiliza este mismo método para chequear unicidad de email al crear un
   * empleado -- misma política real que ya aplica el login, no una inventada nueva.
   */
  getByEmail(email: string): Promise<User | null>;
  /**
   * Tenant-scoped, mismo patrón que `RoleRepository.listByTenant`/`getByIdScoped`. Pensado para
   * los flujos nuevos de `admin-users`; `getAll()`/`getById()` siguen existiendo sin cambios para
   * los consumidores que ya los usan (p. ej. resolución de sesión, que todavía no tiene el
   * `tenantId` disponible en el momento de resolver `User`).
   */
  listByTenant(tenantId: string): Promise<User[]>;
  getByIdScoped(tenantId: string, id: string): Promise<User | null>;
  getByEmployeeCodeScoped(tenantId: string, employeeCode: string): Promise<User | null>;
  create(input: Omit<User, "id" | "createdAt" | "updatedAt">): Promise<User>;
  update(id: string, input: Partial<Omit<User, "id" | "createdAt" | "updatedAt">>): Promise<User>;
  /**
   * Variante tenant-scoped de `update`, para `admin-users`. Excluye `tenantId`, `type` y
   * `customerId` del payload editable a nivel de tipo -- administration nunca puede convertir un
   * Employee en Customer (ni viceversa) ni mudarlo de tenant editando un usuario existente.
   */
  updateScoped(
    tenantId: string,
    id: string,
    input: Partial<Omit<User, "id" | "tenantId" | "type" | "customerId" | "createdAt" | "updatedAt">>,
  ): Promise<User>;
  updateStatus(id: string, status: UserStatus): Promise<User>;
}
