import type { User } from "@/core/entities";
import { type UserStatus, UserType } from "@/core/enums";
import type { UserRepository } from "@/core/repositories";
import type { PaginatedResult } from "@/core/types";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  type ApiUser,
  toCreateUserRequest,
  toUpdateUserRequest,
  toUser,
} from "@/infrastructure/api/apiUserMapper";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";

const BASE_PATH = "/administration/users";
/** Tamaño de pagina al recorrer el listado completo. */
const PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UserUpdate = Partial<Omit<User, "id" | "tenantId" | "type" | "customerId" | "createdAt" | "updatedAt">>;

/**
 * UserRepository de modo api contra `/api/backend/administration/users`. Ese endpoint solo maneja
 * EMPLEADOS de la tienda del JWT: `getAll`/`getByEmail` no ven clientes ni otras tiendas, y crear un
 * usuario que no sea empleado se rechaza aqui. La unicidad real de email/codigo la valida el backend.
 */
export class ApiUserRepository implements UserRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getAll(): Promise<User[]> {
    const users: User[] = [];
    for (let page = 1; ; page++) {
      const result = await backendFetch<PaginatedResult<ApiUser>>(BASE_PATH, {
        query: { page, size: PAGE_SIZE },
      });
      users.push(...result.items.map(toUser));
      if (page >= result.totalPages) return users;
    }
  }

  async getById(id: string): Promise<User | null> {
    // Los ids del backend son UUID; cualquier otro (p. ej. un id del mock) no puede existir alli.
    if (!UUID_PATTERN.test(id)) return null;
    try {
      return toUser(await backendFetch<ApiUser>(`${BASE_PATH}/${id}`));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async getByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    return (await this.getAll()).find((user) => user.email.toLowerCase() === normalized) ?? null;
  }

  async listByTenant(tenantId: string): Promise<User[]> {
    return (await this.getAll()).filter((user) => user.tenantId === tenantId);
  }

  async getByIdScoped(tenantId: string, id: string): Promise<User | null> {
    const user = await this.getById(id);
    return user?.tenantId === tenantId ? user : null;
  }

  async getByEmployeeCodeScoped(tenantId: string, employeeCode: string): Promise<User | null> {
    const normalized = employeeCode.trim().toUpperCase();
    return (
      (await this.listByTenant(tenantId)).find(
        (user) => user.employeeCode?.toUpperCase() === normalized,
      ) ?? null
    );
  }

  async create(input: Omit<User, "id" | "createdAt" | "updatedAt">): Promise<User> {
    if (input.type !== UserType.employee) {
      throw new Error("El backend de administración solo crea empleados.");
    }
    const created = toUser(
      await backendFetch<ApiUser>(BASE_PATH, { method: "POST", body: toCreateUserRequest(input) }),
    );
    this.emitChanged(created, "created");
    return created;
  }

  async update(id: string, input: Partial<Omit<User, "id" | "createdAt" | "updatedAt">>): Promise<User> {
    const current = await this.requireById(id);
    return this.put(current, input);
  }

  async updateScoped(tenantId: string, id: string, input: UserUpdate): Promise<User> {
    const current = await this.getByIdScoped(tenantId, id);
    if (!current) throw new Error("Empleado no encontrado.");
    return this.put(current, input);
  }

  async updateStatus(id: string, status: UserStatus): Promise<User> {
    const updated = toUser(
      await backendFetch<ApiUser>(`${BASE_PATH}/${id}/status`, {
        method: "PUT",
        query: { status },
      }),
    );
    this.emitChanged(updated, "updated");
    return updated;
  }

  /** El PUT reemplaza el empleado completo: se combina el estado actual con los cambios. */
  private async put(current: User, input: UserUpdate): Promise<User> {
    const updated = toUser(
      await backendFetch<ApiUser>(`${BASE_PATH}/${current.id}`, {
        method: "PUT",
        body: toUpdateUserRequest({ ...current, ...input }),
      }),
    );
    this.emitChanged(updated, "updated");
    return updated;
  }

  private async requireById(id: string): Promise<User> {
    const user = await this.getById(id);
    if (!user) throw new Error("Empleado no encontrado.");
    return user;
  }

  private emitChanged(user: User, action: "created" | "updated") {
    this.eventBus.emit("user.changed", { entityId: user.id, tenantId: user.tenantId, action });
  }
}
