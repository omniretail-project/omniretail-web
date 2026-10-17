import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const permissionModuleLabels: Record<string, string> = {
  auth: "Autenticación",
  customer: "Cliente (self-service)",
  storefront: "Storefront",
  administration: "Administración",
  catalog: "Catálogo",
  inventory: "Inventario",
  purchasing: "Compras",
  receiving: "Recepción",
  pos: "POS",
  logistics: "Logística",
};

/** Agrupa una lista de permisos por `module`, preservando el orden de aparición. */
export function groupPermissionsByModule(
  permissions: readonly PermissionDefinition[],
): [string, PermissionDefinition[]][] {
  const groups = new Map<string, PermissionDefinition[]>();
  for (const permission of permissions) {
    const group = groups.get(permission.module) ?? [];
    group.push(permission);
    groups.set(permission.module, group);
  }
  return [...groups.entries()];
}

/**
 * Módulos de solo consumo self-service (cuenta de cliente, storefront) que no son
 * asignables a roles operativos de empleado. El catálogo y la evaluación de permisos
 * permanecen intactos: esto sólo filtra qué se ofrece en el editor de roles de Admin.
 */
const EMPLOYEE_NON_ASSIGNABLE_MODULES = new Set(["customer", "storefront"]);

/** Permisos que un administrador puede asignar a roles operativos de empleado. */
export function getEmployeeAssignablePermissions(
  permissions: readonly PermissionDefinition[],
): PermissionDefinition[] {
  return permissions.filter((permission) => !EMPLOYEE_NON_ASSIGNABLE_MODULES.has(permission.module));
}
