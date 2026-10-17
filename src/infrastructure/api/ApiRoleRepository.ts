import type { Role } from "@/core/entities";
import type { RoleRepository } from "@/core/repositories";
import type { PaginatedResult } from "@/core/types";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { type ApiRole, toRole, toRoleRequest } from "@/infrastructure/api/apiRoleMapper";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import { TtlCache } from "@/infrastructure/api/TtlCache";

const BASE_PATH = "/administration/roles";
/** Tamaño de pagina al recorrer el listado completo. */
const PAGE_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RoleRepository de modo api contra `/api/backend/administration/roles`. El backend resuelve la
 * tienda desde el JWT, asi que `tenantId` solo filtra el resultado para respetar el contrato.
 * `listByTenant` cachea el listado completo 30s con deduplicacion en vuelo; `role.changed`,
 * `auth.changed` y las mutaciones propias invalidan la cache.
 * El backend tambien protege los roles `isSystem` (no se editan ni archivan).
 */
export class ApiRoleRepository implements RoleRepository {
  private readonly listCache = new TtlCache<Role[]>();

  constructor(private readonly eventBus: DataEventBus) {
    eventBus.subscribe("role.changed", () => this.listCache.invalidate());
    eventBus.subscribe("auth.changed", () => this.listCache.invalidate());
  }

  async listByTenant(tenantId: string): Promise<Role[]> {
    const roles = await this.listCache.get(() => this.fetchAll());
    return roles.filter((role) => role.tenantId === tenantId);
  }

  private async fetchAll(): Promise<Role[]> {
    const roles: Role[] = [];
    for (let page = 1; ; page++) {
      const result = await backendFetch<PaginatedResult<ApiRole>>(BASE_PATH, {
        query: { page, size: PAGE_SIZE },
      });
      roles.push(...result.items.map(toRole));
      if (page >= result.totalPages) {
        return roles;
      }
    }
  }

  async getByIdScoped(tenantId: string, id: string): Promise<Role | null> {
    // Los ids del backend son UUID; cualquier otro (p. ej. un id del mock) no puede existir alli.
    if (!UUID_PATTERN.test(id)) return null;
    try {
      const role = toRole(await backendFetch<ApiRole>(`${BASE_PATH}/${id}`));
      return role.tenantId === tenantId ? role : null;
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async create(input: Omit<Role, "id" | "createdAt" | "updatedAt">): Promise<Role> {
    const created = toRole(
      await backendFetch<ApiRole>(BASE_PATH, { method: "POST", body: toRoleRequest(input) }),
    );
    this.emitChanged(created, "created");
    return created;
  }

  async updateScoped(
    tenantId: string,
    id: string,
    input: Partial<Omit<Role, "id" | "tenantId" | "isSystem" | "createdAt" | "updatedAt">>,
  ): Promise<Role> {
    const current = await this.requireScoped(tenantId, id);
    const updated = toRole(
      await backendFetch<ApiRole>(`${BASE_PATH}/${id}`, {
        method: "PUT",
        body: toRoleRequest({ ...current, ...input }),
      }),
    );
    this.emitChanged(updated, "updated");
    return updated;
  }

  async archiveScoped(tenantId: string, id: string): Promise<Role> {
    await this.requireScoped(tenantId, id);
    // DELETE responde 204 sin cuerpo; se relee el rol para devolverlo ya archivado.
    await backendFetch<void>(`${BASE_PATH}/${id}`, { method: "DELETE" });
    const archived = await this.requireScoped(tenantId, id);
    this.emitChanged(archived, "archived");
    return archived;
  }

  private async requireScoped(tenantId: string, id: string): Promise<Role> {
    const role = await this.getByIdScoped(tenantId, id);
    if (!role) throw new Error("Rol no encontrado.");
    return role;
  }

  private emitChanged(role: Role, action: "created" | "updated" | "archived") {
    this.listCache.invalidate();
    this.eventBus.emit("role.changed", { entityId: role.id, tenantId: role.tenantId, action });
  }
}
