import type { Branch, Role, User } from "@/core/entities";

/**
 * Resuelve el alcance de sucursales de un User a partir de `User.allowedBranchIds` -- fuente
 * autoritativa desde admin-users (#92), NUNCA de `Role.branchScope`. `User.branchId` (legacy, un
 * solo valor) se usa como fallback SOLO cuando `allowedBranchIds` es `undefined` (campo nunca
 * seteado -- cuentas semilla/legacy, ej. cashier/warehouse del seed demo). Un `allowedBranchIds`
 * definido pero vacío (`[]`) significa "cero sucursales" a propósito y NO cae al fallback -- un
 * User dado de alta por `CreateEmployeeService` siempre setea `allowedBranchIds` (nunca
 * `branchId`), así que el fallback nunca se activa para altas nuevas.
 */
export function resolveUserAllowedBranchIds(user: User): string[] {
  if (user.allowedBranchIds !== undefined) return user.allowedBranchIds;
  return user.branchId ? [user.branchId] : [];
}

/**
 * `branchScope === "all"` sigue siendo un bypass explícito del Role (acceso a cualquier
 * sucursal del tenant). Para `"selected"` y `"assigned"` el alcance real es SIEMPRE
 * `resolveUserAllowedBranchIds(user)` -- antes de este fix, `"assigned"` caía a
 * `user.branchId === branchId` (legacy), y como `CreateEmployeeService` (#92) nunca setea
 * `branchId`, todo empleado dado de alta por Admin Users con un Role `branchScope: "assigned"`
 * (ej. seed role-cashier/role-warehouse) quedaba SIEMPRE denegado en POS/Logistics/Caja para su
 * propia sucursal asignada. `branchScope` en sí NO se elimina: sigue siendo el campo que
 * distingue "todas las sucursales" de "restringido a allowedBranchIds".
 */
export function isBranchIdInUserScope(user: User, role: Role, branchId: string): boolean {
  if (user.tenantId !== role.tenantId) return false;
  if (role.branchScope === "all") return true;
  return resolveUserAllowedBranchIds(user).includes(branchId);
}

export function canUserAccessBranch(
  user: User,
  role: Role,
  branch: Pick<Branch, "id" | "tenantId">,
): boolean {
  return branch.tenantId === user.tenantId && isBranchIdInUserScope(user, role, branch.id);
}

export function isBranchIdInUserAllowedScope(user: User, branchId: string): boolean {
  return resolveUserAllowedBranchIds(user).includes(branchId);
}

/**
 * Fuente para el selector de sucursal activa del header (`ScopedActiveBranchProvider`) --
 * deliberadamente sin el bypass de `branchScope === "all"` que sí tiene `canUserAccessBranch`:
 * un admin con `branchScope: "all"` ve en el selector exactamente lo que tenga en
 * `allowedBranchIds` (el seed demo se lo asigna explícito), no "cualquier sucursal existente".
 */
export function canUserOperateBranch(
  user: User,
  branch: Pick<Branch, "id" | "tenantId">,
): boolean {
  return branch.tenantId === user.tenantId && isBranchIdInUserAllowedScope(user, branch.id);
}
