import { describe, expect, it, vi } from "vitest";
import { RoleStatus, TenantStatus, UserStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveAdminActorContext } from "@/modules/administration/application/services/resolveAdminActorContext";
import { resolveEmailSenderAdminContext } from "@/modules/administration/application/services/resolveEmailSenderAdminContext";

const TENANT = "tenant-1";

function repositories(
  overrides: {
    session?: unknown;
    user?: unknown;
    tenant?: unknown;
    role?: unknown;
    permissions?: string[];
  } = {},
) {
  const pick = <T>(key: keyof typeof overrides, fallback: T) =>
    key in overrides ? overrides[key] : fallback;
  return {
    auth: {
      getCurrentSessionId: vi.fn().mockResolvedValue("session-1"),
      getSession: vi.fn().mockResolvedValue(pick("session", { id: "session-1", userId: "user-1" })),
    },
    users: {
      getById: vi
        .fn()
        .mockResolvedValue(
          pick("user", {
            id: "user-1",
            tenantId: TENANT,
            roleId: "role-1",
            status: UserStatus.active,
          }),
        ),
    },
    tenants: {
      getById: vi
        .fn()
        .mockResolvedValue(pick("tenant", { id: TENANT, status: TenantStatus.active })),
    },
    roles: {
      getByIdScoped: vi.fn().mockResolvedValue(
        pick("role", {
          id: "role-1",
          status: RoleStatus.active,
          permissions: overrides.permissions ?? [],
        }),
      ),
    },
  } as unknown as RepositoryRegistry;
}

describe("resolveAdminActorContext", () => {
  it("devuelve tenant, actor y permisos del rol activo", async () => {
    await expect(
      resolveAdminActorContext(repositories({ permissions: ["admin.x"] })),
    ).resolves.toEqual({ tenantId: TENANT, actorUserId: "user-1", permissions: ["admin.x"] });
  });

  it.each([
    ["una sesión inexistente", { session: null }, /sesion actual/],
    [
      "un usuario inactivo",
      { user: { id: "u", tenantId: TENANT, status: UserStatus.inactive } },
      /usuario actual/,
    ],
    [
      "un negocio inactivo",
      { tenant: { id: TENANT, status: TenantStatus.inactive } },
      /negocio activo/,
    ],
    ["un usuario sin rol", { role: null }, /rol del usuario/],
  ])("rechaza %s", async (_label, overrides, message) => {
    await expect(resolveAdminActorContext(repositories(overrides))).rejects.toThrow(message);
  });
});

describe("resolveEmailSenderAdminContext", () => {
  it("lectura acepta el permiso de lectura y gestión exige el de gestión", async () => {
    const reader = repositories({ permissions: ["admin.email_config.read"] });

    await expect(resolveEmailSenderAdminContext(reader, "read")).resolves.toEqual({
      tenantId: TENANT,
      actorUserId: "user-1",
    });
    await expect(resolveEmailSenderAdminContext(reader, "manage")).rejects.toThrow(
      /gestionar el correo remitente/,
    );
    await expect(
      resolveEmailSenderAdminContext(
        repositories({ permissions: ["admin.email_config.manage"] }),
        "manage",
      ),
    ).resolves.toEqual({ tenantId: TENANT, actorUserId: "user-1" });
  });
});
