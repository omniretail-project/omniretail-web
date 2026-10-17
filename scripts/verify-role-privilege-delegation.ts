import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { permissionsConfig } from "@/config/permissions";
import { RoleStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockAuditLogRepository, MockRoleRepository } from "@/infrastructure/mock/repositories";
import { demoSeedDatabase } from "@/infrastructure/mock/seeds/demoSeed";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { RoleInputDto } from "@/modules/administration/application/dto/RoleDto";
import { ArchiveRoleService } from "@/modules/administration/application/services/ArchiveRoleService";
import { CreateRoleService } from "@/modules/administration/application/services/CreateRoleService";
import { GetRolesService } from "@/modules/administration/application/services/GetRolesService";
import { UpdateRoleService } from "@/modules/administration/application/services/UpdateRoleService";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

const NOW = "2026-01-01T00:00:00.000Z";
const TENANT = "role-delegation-tenant";
const ACTOR_ID = "role-delegation-actor";
const READ_PERMISSION = "admin.roles.read";
const MANAGE_PERMISSION = "admin.roles.manage";

function baseRoleInput(overrides: Partial<RoleInputDto> = {}): RoleInputDto {
  return {
    name: "Rol de prueba",
    description: undefined,
    permissions: ["catalog.products.read"],
    status: RoleStatus.active,
    ...overrides,
  };
}

function createHarness() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.roles = [
      {
        id: "role-system-fixture",
        tenantId: TENANT,
        name: "Sistema",
        description: undefined,
        isSystem: true,
        permissions: ["catalog.products.read"],
        branchScope: "all",
        status: RoleStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
  });

  const roles = new MockRoleRepository(store, eventBus);
  const auditLogs = new MockAuditLogRepository(store, eventBus);

  return {
    repositories: { roles, auditLogs } as unknown as RepositoryRegistry,
  };
}

async function verifyReadVsManage(harness: ReturnType<typeof createHarness>) {
  const getService = new GetRolesService(harness.repositories);
  const createService = new CreateRoleService(harness.repositories);

  // C. admin.roles.read puede leer...
  const roles = await getService.execute(TENANT, [READ_PERMISSION]);
  assert.ok(Array.isArray(roles), "admin.roles.read debe poder consultar roles");

  // C. ...pero no puede mutar.
  await assert.rejects(
    () =>
      createService.execute(
        TENANT,
        baseRoleInput({ permissions: [] }),
        [READ_PERMISSION],
        ACTOR_ID,
      ),
    /permiso/i,
    "admin.roles.read en solitario no debe poder crear roles",
  );

  // Sin ningún permiso de roles, ni lectura.
  await assert.rejects(() => getService.execute(TENANT, []), /permiso/i);
}

async function verifyPrivilegeDelegation(harness: ReturnType<typeof createHarness>) {
  const createService = new CreateRoleService(harness.repositories);
  const updateService = new UpdateRoleService(harness.repositories);

  const actorPermissions = [MANAGE_PERMISSION, "inventory.stock.read"];

  // D. Un actor con admin.roles.manage SÍ puede mutar, dentro de sus propios permisos efectivos.
  const created = await createService.execute(
    TENANT,
    baseRoleInput({ permissions: [MANAGE_PERMISSION, "inventory.stock.read"] }),
    actorPermissions,
    ACTOR_ID,
  );
  assert.deepEqual(created.permissions, [MANAGE_PERMISSION, "inventory.stock.read"]);

  // E / F. El mismo actor NO puede delegar un permiso que él mismo no tiene -- ya sea "desde la
  // UI" o por una llamada directa al service (acá no hay una UI separada del service: el service
  // ES el boundary, así que esta es literalmente la llamada directa).
  //
  // Ticket "FIXES FOCALIZADOS" §3: el mensaje debe ser amigable y NUNCA exponer las permission
  // keys crudas que el actor no puede delegar -- se verifica ambas cosas explícitamente acá.
  await assert.rejects(
    () =>
      createService.execute(
        TENANT,
        baseRoleInput({
          permissions: [MANAGE_PERMISSION, "admin.reports.export", "pos.sales.create"],
        }),
        actorPermissions,
        ACTOR_ID,
      ),
    /permisos que tu cuenta no puede asignar/i,
    "Un actor no debe poder crear un rol con permisos que él mismo no posee",
  );
  try {
    await createService.execute(
      TENANT,
      baseRoleInput({
        permissions: [MANAGE_PERMISSION, "admin.reports.export", "pos.sales.create"],
      }),
      actorPermissions,
      ACTOR_ID,
    );
    assert.fail("se esperaba que la creación fallara por permisos no delegables");
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : String(caughtError);
    assert.equal(
      /admin\.reports\.export|pos\.sales\.create/.test(message),
      false,
      "El mensaje de error no debe exponer permission keys crudas al usuario",
    );
  }

  await assert.rejects(
    () =>
      updateService.execute(
        TENANT,
        created.id,
        baseRoleInput({ permissions: [...actorPermissions, "pos.sales.void"] }),
        actorPermissions,
        ACTOR_ID,
      ),
    /permisos que tu cuenta no puede asignar/i,
    "UpdateRoleService debe aplicar la misma regla de delegación que CreateRoleService",
  );

  // Actualizar con un subconjunto válido sí debe funcionar.
  const updated = await updateService.execute(
    TENANT,
    created.id,
    baseRoleInput({ permissions: [MANAGE_PERMISSION] }),
    actorPermissions,
    ACTOR_ID,
  );
  assert.deepEqual(updated.permissions, [MANAGE_PERMISSION]);
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

async function verifyNoSuperAdminBypass() {
  // No debe existir en el CÓDIGO (no en los comentarios que explican esta misma regla) ningún
  // atajo de "super admin"/isSystem que salte la delegación -- si alguien lo agrega después, este
  // check lo va a romper a propósito.
  const source = stripComments(
    readFileSync(
      join(process.cwd(), "src/modules/administration/validation/role.validation.ts"),
      "utf8",
    ),
  );
  assert.equal(
    /role\.name\s*===|isSystem\s*\?\s*true|SUPER_ADMIN|\bbypass\b/i.test(source),
    false,
    "No debe existir un bypass hardcodeado de super admin en la validación de roles",
  );
}

async function verifyCatalogAndSystemRoleInvariants(harness: ReturnType<typeof createHarness>) {
  const createService = new CreateRoleService(harness.repositories);
  const updateService = new UpdateRoleService(harness.repositories);
  const archiveService = new ArchiveRoleService(harness.repositories);
  const actorPermissions = ["not-a-real-permission-key", MANAGE_PERMISSION];

  // G. Key de permiso inválida (no existe en el catálogo) se rechaza, incluso si el actor
  // "tiene" esa key inventada entre sus propios permisos.
  await assert.rejects(
    () =>
      createService.execute(
        TENANT,
        baseRoleInput({ permissions: ["not-a-real-permission-key"] }),
        actorPermissions,
        ACTOR_ID,
      ),
    /no es válido/i,
    "Una key de permiso que no existe en el catálogo debe rechazarse",
  );

  // I. Create role nunca puede inyectar isSystem=true -- RoleInputDto no expone el campo y el
  // service lo fija a false explícitamente.
  const created = await createService.execute(
    TENANT,
    baseRoleInput({ permissions: [MANAGE_PERMISSION] }),
    [MANAGE_PERMISSION],
    ACTOR_ID,
  );
  assert.equal(created.isSystem, false, "Un rol creado desde el service nunca es isSystem");

  // H. isSystem update/archive rechazados.
  await assert.rejects(
    () =>
      updateService.execute(
        TENANT,
        "role-system-fixture",
        baseRoleInput({ permissions: ["catalog.products.read"] }),
        ["catalog.products.read", MANAGE_PERMISSION],
        ACTOR_ID,
      ),
    /sistema/i,
    "Un rol isSystem no debe poder editarse",
  );
  await assert.rejects(
    () => archiveService.execute(TENANT, "role-system-fixture", [MANAGE_PERMISSION], ACTOR_ID),
    /sistema/i,
    "Un rol isSystem no debe poder archivarse",
  );

  // J. UpdateRole no puede fijar status=archived directamente.
  await assert.rejects(
    () =>
      updateService.execute(
        TENANT,
        created.id,
        baseRoleInput({ permissions: [MANAGE_PERMISSION], status: RoleStatus.archived }),
        [MANAGE_PERMISSION],
        ACTOR_ID,
      ),
    /archiv/i,
    "UpdateRoleService debe rechazar status=archived; solo ArchiveRoleService puede archivar",
  );

  // K. ArchiveRole sí archiva correctamente un rol no-sistema.
  const archived = await archiveService.execute(
    TENANT,
    created.id,
    [MANAGE_PERMISSION],
    ACTOR_ID,
  );
  assert.equal(archived.status, RoleStatus.archived);
}

function verifySourceInvariants() {
  const read = (path: string) => stripComments(readFileSync(join(process.cwd(), path), "utf8"));

  // A. El formulario Create/Edit ya no configura branchScope.
  const roleForm = read("src/modules/administration/components/RoleForm.tsx");
  assert.equal(
    /branchScope|Alcance de sucursal/.test(roleForm),
    false,
    "RoleForm no debe volver a exponer branchScope como decisión del formulario",
  );

  const roleDto = read("src/modules/administration/application/dto/RoleDto.ts");
  assert.equal(
    /RoleInputDto = Pick<Role,[^>]*branchScope/.test(roleDto),
    false,
    "RoleInputDto no debe incluir branchScope",
  );

  // Create/Edit solo ofrece active/inactive como opciones seleccionables (fuera de comentarios).
  assert.equal(
    /archived/i.test(roleForm),
    false,
    "El formulario no debe ofrecer 'archived' como estado seleccionable",
  );

  // Ticket §5: RoleTable ya no presenta branchScope como responsabilidad del Rol (columna
  // "Alcance" removida). branchScope puede seguir existiendo en el dominio/DTO -- eso no se toca
  // acá, solo su presentación en la UI de Roles.
  const roleTable = read("src/modules/administration/components/RoleTable.tsx");
  assert.equal(
    /branchScope|branchScopeLabels|header:\s*"Alcance"/.test(roleTable),
    false,
    "RoleTable no debe volver a presentar branchScope como columna/dato de la UI de Roles",
  );

  // Ticket §2: RoleForm debe conocer los permisos delegables del actor (`actorPermissionSet`) y
  // deshabilitar -- no ocultar -- los checkboxes que el actor no puede otorgar, con una pista
  // visible en vez de solo un atributo `disabled` silencioso.
  assert.ok(
    /actorPermissionSet/.test(roleForm),
    "RoleForm debe calcular qué permisos puede delegar el actor (actorPermissionSet)",
  );
  assert.ok(
    /disabled=\{disabled\}/.test(roleForm) || /disabled\s*=\s*busy\s*\|\|/.test(roleForm),
    "RoleForm debe deshabilitar el checkbox de un permiso no delegable, no solo mostrarlo",
  );
  assert.ok(
    /No disponible para tu cuenta/.test(roleForm),
    "RoleForm debe mostrar una pista visible para permisos fuera del alcance del actor (no solo ocultarlos)",
  );
}

/**
 * Ticket §4: el seed de demo (role-admin, admin@ferrepharma.demo) debe derivar SUS permisos del
 * catálogo canónico real (`src/config/permissions.ts`), nunca de una segunda lista hardcodeada
 * que se desincroniza. Se verifica en runtime contra `demoSeedDatabase` (el resultado final que
 * consume `createMockDatabase()`, ya con el override de hardwareCatalogSeed aplicado) y también a
 * nivel de código fuente, para que agregar un permiso nuevo al catálogo sin tocar demoSeed.ts siga
 * dejando a role-admin con el permiso completo automáticamente.
 */
function verifyDemoAdminHasAllCanonicalPermissions() {
  const roleAdmin = demoSeedDatabase.roles.find((role) => role.id === "role-admin");
  assert.ok(roleAdmin, "El seed de demo debe seguir teniendo role-admin");
  assert.equal(roleAdmin!.isSystem, true, "role-admin debe seguir siendo isSystem");
  assert.equal(roleAdmin!.status, RoleStatus.active, "role-admin debe seguir activo");

  const canonicalKeys = new Set(permissionsConfig.map((permission) => permission.key));
  const roleAdminKeys = new Set(roleAdmin!.permissions);
  assert.equal(
    roleAdminKeys.size,
    canonicalKeys.size,
    "role-admin debe tener EXACTAMENTE la cantidad de permisos del catálogo canónico, ni más ni menos",
  );
  for (const key of canonicalKeys) {
    assert.ok(roleAdminKeys.has(key), `role-admin debe incluir el permiso canónico ${key}`);
  }

  const source = readFileSync(
    join(process.cwd(), "src/infrastructure/mock/seeds/demoSeed.ts"),
    "utf8",
  );
  assert.ok(
    /permissionsConfig\.map/.test(source),
    "demoSeed.ts debe derivar los permisos de role-admin de permissionsConfig, no de una lista hardcodeada",
  );

  const admin = demoSeedDatabase.users.find((user) => user.email === "admin@ferrepharma.demo");
  assert.ok(admin, "admin@ferrepharma.demo debe seguir existiendo en el seed");
  assert.equal(admin!.roleId, "role-admin", "admin@ferrepharma.demo debe seguir apuntando a role-admin");
}

/**
 * Ticket §4: "no bypass de producción" -- el seed de demo puede darle a role-admin todos los
 * permisos, pero el mecanismo tiene que seguir siendo "tiene la key", nunca un atajo de
 * super-admin/isSystem en la validación real. verifyNoSuperAdminBypass() ya cubre
 * role.validation.ts; esto además confirma que employee.validation.ts tampoco lo tiene.
 */
function verifyNoSuperAdminBypassInEmployeeValidation() {
  const source = stripComments(
    readFileSync(
      join(process.cwd(), "src/modules/administration/validation/employee.validation.ts"),
      "utf8",
    ),
  );
  assert.equal(
    /SUPER_ADMIN|\bbypass\b|isSystem\s*\?\s*true/i.test(source),
    false,
    "No debe existir un bypass hardcodeado de super admin en la validación de empleados",
  );
}

async function main() {
  const harness = createHarness();
  await verifyReadVsManage(createHarness());
  await verifyPrivilegeDelegation(harness);
  await verifyNoSuperAdminBypass();
  await verifyNoSuperAdminBypassInEmployeeValidation();
  await verifyCatalogAndSystemRoleInvariants(createHarness());
  verifySourceInvariants();
  verifyDemoAdminHasAllCanonicalPermissions();
  console.log("role privilege delegation verification: PASS");
}

void main();
