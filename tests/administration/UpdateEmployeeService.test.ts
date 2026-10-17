import { describe, expect, it, vi } from "vitest";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EmployeeInputDto } from "@/modules/administration/application/dto/EmployeeDto";
import { UpdateEmployeeService } from "@/modules/administration/application/services/UpdateEmployeeService";

vi.mock("@/modules/administration/application/mappers/EmployeeMapper", () => ({
  toEmployeeDto: (user: { id: string }) => ({ id: user.id }),
}));
vi.mock("@/modules/administration/validation/employee.validation", () => ({
  normalizeEmployeeInput: (dto: unknown) => dto,
  validateEmployeeInput: () => undefined,
  ensureRoleAssignable: (role: unknown) => role,
  ensureDelegatableRole: () => undefined,
}));

const TENANT = "tenant-1";
const EMPLOYEE = "employee-1";

const currentUser = {
  id: EMPLOYEE,
  tenantId: TENANT,
  type: "employee",
  employeeCode: "INV-001",
  roleId: "role-inventory",
  status: "active",
  allowedBranchIds: ["branch-centro"],
};

const baseInput = {
  name: "Inventario Demo",
  employeeCode: "INV-001",
  email: "inventario@example.com",
  phone: "",
  roleId: "role-inventory",
  status: "active",
  allowedBranchIds: ["branch-centro"],
} as unknown as EmployeeInputDto;

function createRegistry(revoke: () => Promise<void>) {
  const append = vi.fn().mockResolvedValue(undefined);
  const updateScoped = vi.fn().mockImplementation(async (_tenant, _id, patch) => ({
    ...currentUser,
    ...patch,
  }));
  const registry = {
    users: {
      getByIdScoped: vi.fn().mockResolvedValue(currentUser),
      getByEmployeeCodeScoped: vi.fn().mockResolvedValue(null),
      updateScoped,
    },
    roles: {
      getByIdScoped: vi.fn().mockImplementation(async (_tenant, id: string) => ({ id })),
    },
    branches: {
      getActiveByTenant: vi.fn().mockResolvedValue([
        { id: "branch-centro", status: "active" },
        { id: "branch-norte", status: "active" },
      ]),
    },
    auth: { revokeAllSessionsByUserId: vi.fn().mockImplementation(revoke) },
    auditLogs: { append },
  } as unknown as RepositoryRegistry;
  return { registry, append };
}

function execute(registry: RepositoryRegistry, input: EmployeeInputDto) {
  return new UpdateEmployeeService(registry).execute(
    TENANT,
    EMPLOYEE,
    input,
    ["admin.users.manage"],
    "actor-1",
  );
}

describe("UpdateEmployeeService", () => {
  it("no revoca sesiones cuando solo cambia el nombre o el telefono", async () => {
    const { registry, append } = createRegistry(async () => undefined);

    await execute(registry, { ...baseInput, name: "Otro Nombre" });

    expect(registry.auth.revokeAllSessionsByUserId).not.toHaveBeenCalled();
    expect(append.mock.calls[0][0].metadata).toMatchObject({ sessionsRevoked: false });
  });

  it("revoca sesiones al cambiar las sucursales y lo deja en la auditoria", async () => {
    const { registry, append } = createRegistry(async () => undefined);

    await execute(registry, { ...baseInput, allowedBranchIds: ["branch-centro", "branch-norte"] });

    expect(registry.auth.revokeAllSessionsByUserId).toHaveBeenCalledWith(TENANT, EMPLOYEE);
    expect(append.mock.calls[0][0].metadata).toMatchObject({
      branchesChanged: true,
      sessionsRevoked: true,
    });
  });

  it("si la revocacion falla, la edicion ya guardada no falla y se audita igual", async () => {
    const { registry, append } = createRegistry(async () => {
      throw new Error("Esta función aún no está disponible en modo API.");
    });

    const result = await execute(registry, { ...baseInput, roleId: "role-purchasing" });

    expect(result).toEqual({ id: EMPLOYEE });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][0].metadata).toMatchObject({
      roleChanged: true,
      sessionsRevoked: false,
    });
  });

  it("rechaza a quien no puede gestionar empleados", async () => {
    const { registry } = createRegistry(async () => undefined);

    await expect(
      new UpdateEmployeeService(registry).execute(TENANT, EMPLOYEE, baseInput, [], "actor-1"),
    ).rejects.toThrow("No dispone de permisos");
  });
});
