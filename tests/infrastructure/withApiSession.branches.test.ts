import { describe, expect, it, vi } from "vitest";
import type { Branch } from "@/core/entities";
import type { BranchRepository } from "@/core/repositories";
import type { ApiBranchRepository } from "@/infrastructure/api/ApiBranchRepository";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";
import { apiBranchesForEmployees } from "@/infrastructure/api/withApiSession";

const TENANT = "tenant-1";

function branch(id: string, type = "store", tenantId = TENANT) {
  return { id, tenantId, code: id, name: id, type, status: "active" } as unknown as Branch;
}

function session(type: string, permissions: string[], tenantId = TENANT) {
  return {
    get: vi.fn().mockResolvedValue({ user: { type, tenantId }, role: { permissions } }),
  } as unknown as CurrentSessionClient;
}

function createRepositories() {
  // Una sesion de otro tenant (o no empleada) cae al mock: aqui responde vacio.
  const mock = {
    getActive: vi.fn().mockResolvedValue([branch("mock")]),
    getActiveByTenant: vi.fn().mockResolvedValue([]),
    listByTenant: vi.fn().mockResolvedValue([]),
    getByIdScoped: vi.fn().mockResolvedValue(null),
    getActiveByTenantAndType: vi.fn().mockResolvedValue([]),
  } as unknown as BranchRepository;
  const api = {
    getActive: vi.fn().mockResolvedValue([branch("admin-active")]),
    getAll: vi.fn().mockResolvedValue([branch("admin-all")]),
    getAssignedActive: vi
      .fn()
      .mockResolvedValue([branch("centro"), branch("norte", "warehouse")]),
    create: vi.fn().mockResolvedValue(branch("nueva")),
    update: vi.fn().mockResolvedValue(branch("centro")),
  } as unknown as ApiBranchRepository;
  return { mock, api };
}

describe("apiBranchesForEmployees", () => {
  it("con permiso administrativo usa el backend de administracion", async () => {
    const { mock, api } = createRepositories();
    const repository = apiBranchesForEmployees(mock, api, session("employee", ["admin.branches.read"]));

    expect(await repository.getActive()).toEqual([branch("admin-active")]);
    expect(api.getAssignedActive).not.toHaveBeenCalled();
  });

  it("sin permiso administrativo lee solo las sucursales asignadas, nunca el mock", async () => {
    const { mock, api } = createRepositories();
    const repository = apiBranchesForEmployees(mock, api, session("employee", ["inventory.stock.read"]));

    expect((await repository.getActiveByTenant(TENANT)).map((item) => item.id)).toEqual([
      "centro",
      "norte",
    ]);
    expect((await repository.getAll()).map((item) => item.id)).toEqual(["centro", "norte"]);
    expect((await repository.getActive()).map((item) => item.id)).toEqual(["centro", "norte"]);
    expect((await repository.listByTenant(TENANT)).map((item) => item.id)).toEqual(["centro", "norte"]);
    expect(api.getAssignedActive).toHaveBeenCalledWith(TENANT);
    expect(mock.getActive).not.toHaveBeenCalled();
    expect(api.getActive).not.toHaveBeenCalled();
  });

  it("sin permiso resuelve por id solo dentro de las asignadas", async () => {
    const { mock, api } = createRepositories();
    const repository = apiBranchesForEmployees(mock, api, session("employee", []));

    expect((await repository.getById("centro"))?.id).toBe("centro");
    expect(await repository.getById("sucursal-no-asignada")).toBeNull();
    expect((await repository.getByIdScoped(TENANT, "norte"))?.id).toBe("norte");
    expect(await repository.getByIdScoped("otro-tenant", "norte")).toBeNull();
  });

  it("sin permiso filtra por tenant y por tipo", async () => {
    const { mock, api } = createRepositories();
    const repository = apiBranchesForEmployees(mock, api, session("employee", []));

    expect(await repository.getActiveByTenant("otro-tenant")).toEqual([]);
    expect(await repository.listByTenant("otro-tenant")).toEqual([]);
    expect(await repository.getActiveByTenantAndType("otro-tenant", "warehouse" as never)).toEqual([]);
    expect(
      (await repository.getActiveByTenantAndType(TENANT, "warehouse" as never)).map((item) => item.id),
    ).toEqual(["norte"]);
  });

  it("crear y editar siguen yendo al backend administrativo", async () => {
    const { mock, api } = createRepositories();
    const repository = apiBranchesForEmployees(mock, api, session("employee", []));

    await repository.create({ tenantId: TENANT } as never);
    await repository.update("centro", { name: "Nuevo" });

    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).toHaveBeenCalledWith("centro", { name: "Nuevo" });
  });

  it("clientes y sesiones de otro tenant siguen en el mock", async () => {
    const { mock, api } = createRepositories();

    const forCustomer = apiBranchesForEmployees(mock, api, session("customer", []));
    expect((await forCustomer.getActive()).map((item) => item.id)).toEqual(["mock"]);

    const forOtherTenant = apiBranchesForEmployees(mock, api, session("employee", ["admin.branches.read"]));
    expect(await forOtherTenant.getActiveByTenant("otro-tenant")).toBeDefined();
    expect(api.getAssignedActive).not.toHaveBeenCalled();
  });
});
