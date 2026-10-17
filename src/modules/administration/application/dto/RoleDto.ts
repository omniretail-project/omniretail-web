import type { Role } from "@/core/entities";

export type RoleDto = Omit<Role, "tenantId">;

/**
 * `isSystem` nunca se acepta desde este DTO: lo define el seed/la plataforma, no el formulario de
 * alta. Un rol creado desde acá siempre nace con `isSystem: false` (ver CreateRoleService).
 *
 * `branchScope` NO forma parte de este input a propósito. Decisión de dominio: el Rol define
 * `name`/`description`/`status`/`permissions`; qué sucursales puede operar un usuario es
 * responsabilidad de `User` (`roleId` + sucursales asignadas), no del Rol. `branchScope` sigue
 * existiendo en la entity porque otros consumidores (`userBranchAccess.ts`, sesión, POS,
 * Picking) todavía lo leen -- no se puede borrar del contrato sin romperlos. `CreateRoleService`
 * lo fija a un valor neutro sin exponerlo como decisión funcional en esta pantalla.
 */
export type RoleInputDto = Pick<Role, "name" | "description" | "permissions" | "status">;
