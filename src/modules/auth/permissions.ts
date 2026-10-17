import type { User } from "@/core/entities";
import { UserType } from "@/core/enums";
import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const authPermissions = [
  {
    key: "auth.profile.read",
    module: "auth",
    name: "Leer perfil",
    description: "Permite consultar el perfil propio.",
  },
  {
    key: "auth.profile.update",
    module: "auth",
    name: "Actualizar perfil",
    description: "Permite actualizar el perfil propio.",
  },
] satisfies PermissionDefinition[];

/**
 * /inicio (landing operacional de empleado) no tiene, entre los
 * Permission ya definidos y asignados a roles en el seed, ninguno
 * semanticamente correcto: auth.profile.read/update son sobre el perfil
 * propio y ademas ningun rol los tiene asignado hoy. En vez de inventar
 * una permission key nueva que requeriria tocar demoSeed.ts/roles (fuera
 * de alcance -- auth solo consume User/Role/permissions existentes), la
 * politica minima segura se deriva directamente de datos ya existentes:
 * un Employee con al menos un permiso real en su rol. Un Employee con
 * permissions vacio (rol inexistente o sin permisos asignados) tambien
 * queda sin acceso -- fail-closed, igual que cualquier otra ruta
 * operacional, nunca "employee = acceso total".
 *
 * Se expone como un permission sintetico (nunca sera un valor real de
 * Role.permissions en un seed) para que Sidebar y RequirePermission usen
 * exactamente el mismo mecanismo de navigationConfig + permission, sin
 * mantener una politica paralela para esta unica ruta.
 */
export const EMPLOYEE_HOME_ACCESS_PERMISSION = "__internal.auth.employee_home_access";

export function hasEmployeeHomeAccess(user: User | null, permissions: string[]): boolean {
  return user?.type === UserType.employee && permissions.length > 0;
}
