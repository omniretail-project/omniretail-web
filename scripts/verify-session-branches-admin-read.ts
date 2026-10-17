import assert from "node:assert/strict";
import type { Branch, User } from "@/core/entities";
import { BranchStatus, BranchType, UserStatus, UserType } from "@/core/enums";
import type { DataEventPayloadFor } from "@/core/types/events.types";
import {
  canUserOperateBranch,
  isBranchIdInUserAllowedScope,
  resolveUserAllowedBranchIds,
} from "@/core/scopes/userBranchAccess";
import { canUserEnterPrivateRoute } from "@/modules/auth/application/services/postLoginNavigation";
import {
  shouldRevalidateSessionOnIdentityChanged,
  shouldRevalidateSessionOnRoleChanged,
} from "@/modules/auth/providers/CurrentSessionProvider";
import { administrationNavigation } from "@/modules/administration/navigation";
import {
  isBranchIdSelectable,
  selectNextActiveBranchId,
} from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import { isNavigationItemPermitted } from "@/shared/navigation/Sidebar";

const NOW = "2026-09-15T12:00:00.000Z";
const TENANT_A = "tenant-demo";
const TENANT_B = "tenant-other";

function makeBranch(id: string, tenantId = TENANT_A, status = BranchStatus.active): Branch {
  return {
    id,
    tenantId,
    code: id.toUpperCase(),
    name: id,
    type: BranchType.store,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeUser(overrides: Partial<User> & Pick<User, "id">): User {
  return {
    tenantId: TENANT_A,
    name: overrides.id,
    email: `${overrides.id}@hardening.test`,
    type: UserType.employee,
    status: UserStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ==================================================
// SESSION (tests 1-3 del ticket)
// ==================================================

function verifySessionRoleScoping() {
  const currentRoleId = "role-A";

  // 1. crear Role B (role.created, entityId = Role B) -- sesion en Role A permanece valida.
  const roleBCreated: DataEventPayloadFor<"role.changed"> = {
    entityId: "role-B",
    tenantId: TENANT_A,
    action: "created",
  };
  assert.equal(
    shouldRevalidateSessionOnRoleChanged(roleBCreated, currentRoleId),
    false,
    "1: role.created de un Role ajeno no debe revalidar la sesion actual",
  );

  // 2. modificar Role B -- no reload/invalidation global.
  const roleBUpdated: DataEventPayloadFor<"role.changed"> = {
    entityId: "role-B",
    tenantId: TENANT_A,
    action: "updated",
  };
  assert.equal(
    shouldRevalidateSessionOnRoleChanged(roleBUpdated, currentRoleId),
    false,
    "2: role.changed de un Role ajeno no debe revalidar la sesion actual",
  );

  // 3. modificar Role A (el de la sesion actual) -- SI debe revalidar.
  const roleAUpdated: DataEventPayloadFor<"role.changed"> = {
    entityId: "role-A",
    tenantId: TENANT_A,
    action: "updated",
  };
  assert.equal(
    shouldRevalidateSessionOnRoleChanged(roleAUpdated, currentRoleId),
    true,
    "3: role.changed del Role de la sesion actual SI debe revalidar",
  );

  // Evento sin entityId (defensivo, no deberia ocurrir hoy segun MockRoleRepository, pero un
  // evento ambiguo no debe descartarse silenciosamente si no hay forma de probar que es ajeno).
  const ambiguous: DataEventPayloadFor<"role.changed"> = { tenantId: TENANT_A, action: "updated" };
  assert.equal(
    shouldRevalidateSessionOnRoleChanged(ambiguous, currentRoleId),
    true,
    "defensivo: un role.changed sin entityId no puede probarse ajeno, se revalida (fail-closed)",
  );

  // Sin sesion resuelta todavia (currentRoleId undefined): nada que comparar, se ignora.
  assert.equal(
    shouldRevalidateSessionOnRoleChanged(roleAUpdated, undefined),
    false,
    "sin sesion resuelta todavia, un role.changed no dispara nada",
  );
}

function verifySessionIdentityScoping() {
  const adminUserId = "user-admin";
  const adminSessionId = "session-admin";

  // inviteEmployee/registerCustomer sobre OTRO usuario (entityId = ese OTRO userId) -- el
  // admin logueado en esta misma pestana no debe revalidar su propia sesion.
  const inviteOtherEmployee: DataEventPayloadFor<"auth.changed"> = {
    entityId: "user-new-employee",
    tenantId: TENANT_A,
    action: "updated",
  };
  assert.equal(
    shouldRevalidateSessionOnIdentityChanged(inviteOtherEmployee, adminUserId, adminSessionId),
    false,
    "inviteEmployee sobre otro empleado no debe recargar la sesion del admin actual",
  );

  // revokeAllSessionsByUserId / user.changed sobre OTRO empleado -- tampoco revalida.
  const updateOtherUser: DataEventPayloadFor<"user.changed"> = {
    entityId: "user-other-employee",
    tenantId: TENANT_A,
    action: "updated",
  };
  assert.equal(
    shouldRevalidateSessionOnIdentityChanged(updateOtherUser, adminUserId, adminSessionId),
    false,
    "user.changed/revokeAllSessionsByUserId sobre otro usuario no debe recargar la sesion actual",
  );

  // revokeAllSessionsByUserId / user.changed sobre el PROPIO admin -- SI debe revalidar
  // (ej. el admin se cambia su propio roleId/status/allowedBranchIds).
  const updateSelf: DataEventPayloadFor<"user.changed"> = {
    entityId: adminUserId,
    tenantId: TENANT_A,
    action: "updated",
  };
  assert.equal(
    shouldRevalidateSessionOnIdentityChanged(updateSelf, adminUserId, adminSessionId),
    true,
    "un cambio sobre el propio usuario SI debe revalidar la sesion",
  );

  // logout(sessionId) identifica el evento por SESSION id, no por userId -- debe matchear
  // igual contra el sessionId actual.
  const ownLogout: DataEventPayloadFor<"auth.changed"> = {
    entityId: adminSessionId,
    action: "updated",
  };
  assert.equal(
    shouldRevalidateSessionOnIdentityChanged(ownLogout, adminUserId, adminSessionId),
    true,
    "el propio logout (entityId=sessionId) debe revalidar la sesion actual",
  );

  // Eventos ambiguos (sin entityId: changePassword/clearLocalSession/requestPasswordReset/
  // resetPassword/verifyEmail/activateEmployeeAccount) -- fail-open, siempre revalidan porque
  // no hay forma segura de probar que son ajenos.
  const ambiguous: DataEventPayloadFor<"auth.changed"> = { action: "updated" };
  assert.equal(shouldRevalidateSessionOnIdentityChanged(ambiguous, adminUserId, adminSessionId), true);

  // Sin sesion resuelta todavia (login/registro en curso, o justo despues de un logout) --
  // siempre revalida, sin importar el entityId.
  assert.equal(
    shouldRevalidateSessionOnIdentityChanged(inviteOtherEmployee, undefined, undefined),
    true,
    "sin identidad resuelta todavia, cualquier evento revalida (login/registro en curso)",
  );
}

// ==================================================
// BRANCHES (tests 4-9 del ticket)
// ==================================================

function verifyBranchPropagation() {
  const centro = makeBranch("branch-centro");
  const norte = makeBranch("branch-norte");
  const branchOtherTenant = makeBranch("branch-b1", TENANT_B);

  // 4. Employee allowedBranchIds=[Centro], login -- Centro disponible.
  const employeeCentro = makeUser({ id: "user-centro", allowedBranchIds: ["branch-centro"] });
  assert.deepEqual(
    resolveUserAllowedBranchIds(employeeCentro),
    ["branch-centro"],
    "4: allowedBranchIds=[Centro] llega intacto al contexto operativo",
  );
  assert.equal(canUserOperateBranch(employeeCentro, centro), true);

  // 5. Solo Centro permitida -- Centro auto-selected.
  const autoSelected = selectNextActiveBranchId([centro], null);
  assert.equal(autoSelected, "branch-centro", "5: unica sucursal permitida se auto-selecciona");

  // 6. Centro + Norte permitidas -- selector solo Centro/Norte (via canUserOperateBranch, no
  // via ninguna sucursal fuera de allowedBranchIds).
  const employeeCentroNorte = makeUser({
    id: "user-centro-norte",
    allowedBranchIds: ["branch-centro", "branch-norte"],
  });
  const otraSucursal = makeBranch("branch-sur");
  assert.equal(canUserOperateBranch(employeeCentroNorte, centro), true);
  assert.equal(canUserOperateBranch(employeeCentroNorte, norte), true);
  assert.equal(
    canUserOperateBranch(employeeCentroNorte, otraSucursal),
    false,
    "6: una sucursal fuera de allowedBranchIds no es operable aunque este activa",
  );
  // preserva la seleccion si sigue siendo valida dentro del nuevo set
  assert.equal(selectNextActiveBranchId([centro, norte], "branch-norte"), "branch-norte");

  // 7. allowedBranchIds=[] -- ninguna branch operativa ("Sin sucursales", NUNCA fallback a
  // todas las sucursales del tenant).
  const employeeZero = makeUser({ id: "user-zero", allowedBranchIds: [] });
  assert.deepEqual(resolveUserAllowedBranchIds(employeeZero), []);
  assert.equal(canUserOperateBranch(employeeZero, centro), false);
  assert.equal(canUserOperateBranch(employeeZero, norte), false);
  assert.equal(
    selectNextActiveBranchId([], null),
    null,
    "7: sin sucursales accesibles, no hay auto-seleccion posible",
  );

  // 8. User A tenia Centro activa. Logout. User B solo tiene Norte. Login User B -- Centro NO
  // permanece seleccionada (se descarta por no pertenecer al nuevo set accesible).
  const userBAccessible = [norte];
  assert.equal(
    selectNextActiveBranchId(userBAccessible, "branch-centro"),
    "branch-norte",
    "8: una branch de otro User/sesion se descarta si no pertenece al set accesible actual",
  );

  // 9. User con solo Centro permitida intenta branch Norte directamente -- DENIED, tanto a
  // nivel de scope (canUserOperateBranch) como a nivel de seleccion (isBranchIdSelectable,
  // defensa en profundidad del setter expuesto por ActiveBranchProvider).
  assert.equal(canUserOperateBranch(employeeCentro, norte), false, "9: DENIED via scope");
  assert.equal(
    isBranchIdSelectable([centro], "branch-norte"),
    false,
    "9: DENIED via el setter -- branchId fuera del set accesible se ignora",
  );
  assert.equal(isBranchIdSelectable([centro], "branch-centro"), true);

  // Cross-tenant: una branch de otro tenant nunca es operable aunque el id coincidiera.
  assert.equal(canUserOperateBranch(employeeCentroNorte, branchOtherTenant), false);

  // Fallback legacy: un User semilla sin allowedBranchIds (undefined, NO []) pero con
  // branchId sigue funcionando -- no rompe cuentas existentes que dependen de branchId.
  const legacyUser = makeUser({ id: "user-legacy", allowedBranchIds: undefined, branchId: "branch-centro" });
  assert.equal(isBranchIdInUserAllowedScope(legacyUser, "branch-centro"), true);
  assert.equal(isBranchIdInUserAllowedScope(legacyUser, "branch-norte"), false);

  // Customer (sin allowedBranchIds ni branchId): sin sucursales operativas, igual que hoy.
  const customer = makeUser({
    id: "user-customer",
    type: UserType.customer,
    allowedBranchIds: undefined,
    branchId: undefined,
  });
  assert.deepEqual(resolveUserAllowedBranchIds(customer), []);
}

// ==================================================
// ADMIN READ-ONLY NAVIGATION (tests 10-13 del ticket)
// ==================================================

function verifyAdminReadOnlyNavigation() {
  const administrationRoot = administrationNavigation[0];
  assert.ok(administrationRoot?.children);
  const usersItem = administrationRoot.children.find((item) => item.id === "administration-users");
  const rolesItem = administrationRoot.children.find((item) => item.id === "administration-roles");
  const branchesItem = administrationRoot.children.find(
    (item) => item.id === "administration-branches",
  );
  assert.ok(usersItem && rolesItem && branchesItem);

  // 10. admin.users.read sin manage -- Usuarios visible.
  assert.equal(
    isNavigationItemPermitted(usersItem, new Set(["admin.users.read"])),
    true,
    "10: admin.users.read sin manage ve la entrada Usuarios",
  );
  assert.equal(
    isNavigationItemPermitted(usersItem, new Set([])),
    false,
    "10: sin ningun permiso admin.users.*, Usuarios sigue oculto",
  );

  // 11. admin.roles.read sin manage -- Roles visible.
  assert.equal(isNavigationItemPermitted(rolesItem, new Set(["admin.roles.read"])), true);
  assert.equal(isNavigationItemPermitted(rolesItem, new Set([])), false);

  // 12. admin.branches.read sin manage -- Sucursales visible.
  assert.equal(isNavigationItemPermitted(branchesItem, new Set(["admin.branches.read"])), true);
  assert.equal(isNavigationItemPermitted(branchesItem, new Set([])), false);

  // 13. manage existente -- comportamiento actual de escritura permanece (sigue viendo la
  // entrada; las mutaciones las siguen exigiendo los Application Services, no tocados aca).
  assert.equal(isNavigationItemPermitted(usersItem, new Set(["admin.users.manage"])), true);
  assert.equal(isNavigationItemPermitted(rolesItem, new Set(["admin.roles.manage"])), true);
  assert.equal(isNavigationItemPermitted(branchesItem, new Set(["admin.branches.manage"])), true);

  // Un item con `permission` simple (sin anyPermission) sigue exigiendo exactamente ese
  // permiso -- no se aflojo nada para el resto de la navegacion.
  const customersItem = administrationRoot.children.find(
    (item) => item.id === "administration-customers",
  );
  assert.ok(customersItem);
  assert.equal(isNavigationItemPermitted(customersItem, new Set(["admin.branches.read"])), false);
  assert.equal(isNavigationItemPermitted(customersItem, new Set(["admin.customers.read"])), true);
}

// ==================================================
// EMPLOYEE VS CUSTOMER (test 14 del ticket)
// ==================================================

function verifyEmployeeCustomerSeparation() {
  // 14. Employee con permission customer.* accidental -- no se convierte en Customer ni
  // obtiene flujo Customer incorrecto: canUserEnterPrivateRoute respeta User.type, no solo el
  // permission set del Role.
  const employeeWithCustomerPermission = makeUser({ id: "user-employee-odd", type: UserType.employee });
  assert.equal(
    canUserEnterPrivateRoute(employeeWithCustomerPermission, "/cuenta/perfil"),
    false,
    "14: un Employee nunca entra a /cuenta aunque su Role tenga customer.* por accidente",
  );
  assert.equal(
    canUserEnterPrivateRoute(employeeWithCustomerPermission, "/administracion/usuarios"),
    true,
    "14: el mismo Employee sigue entrando normalmente a rutas de backoffice",
  );

  // Flujo Customer normal: sin cambios.
  const customer = makeUser({ id: "user-customer-normal", type: UserType.customer });
  assert.equal(canUserEnterPrivateRoute(customer, "/cuenta/perfil"), true);
  assert.equal(
    canUserEnterPrivateRoute(customer, "/inicio"),
    false,
    "un Customer sigue sin poder entrar a rutas de backoffice",
  );
}

async function main() {
  verifySessionRoleScoping();
  console.log("session role.changed scoping: PASS");
  verifySessionIdentityScoping();
  console.log("session auth.changed/user.changed identity scoping: PASS");
  verifyBranchPropagation();
  console.log("user allowedBranchIds propagation and active branch selection: PASS");
  verifyAdminReadOnlyNavigation();
  console.log("admin read-only navigation (users/roles/branches): PASS");
  verifyEmployeeCustomerSeparation();
  console.log("employee vs customer navigation separation: PASS");
}

void main();
