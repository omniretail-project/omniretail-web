import { describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { StorePickupHandoverApplicationService } from "@/modules/logistics/application/services/StorePickupHandoverApplicationService";

const id = (suffix: number) =>
  `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const ids = {
  tenant: id(1),
  user: id(2),
  role: id(3),
  branch: id(4),
  otherBranch: id(5),
  otherTenant: id(6),
  order: id(7),
};

const deliveredResult = {
  orderId: ids.order,
  status: "delivered" as const,
  deliveredAt: "2026-10-18T16:30:00-06:00",
  idempotent: false,
};

const activeUser = {
  id: ids.user,
  tenantId: ids.tenant,
  name: "Operador",
  email: "operator@example.com",
  type: "employee",
  status: "active",
  roleId: ids.role,
  allowedBranchIds: [ids.branch],
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-18T12:00:00Z",
};

const activeBranch = {
  id: ids.branch,
  tenantId: ids.tenant,
  code: "B1",
  name: "Central",
  type: "store",
  status: "active",
  createdAt: "2026-10-18T12:00:00Z",
  updatedAt: "2026-10-18T12:00:00Z",
};

function createRepositories(options?: {
  currentSessionId?: string | null;
  session?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  permissions?: string[];
  branch?: Record<string, unknown> | null;
  includeCommands?: boolean;
}) {
  const commandConfirm = vi.fn(async () => deliveredResult);
  const mockDeliveryConfirm = vi.fn();
  const session = options && "session" in options
    ? options.session
    : {
        id: "session-a",
        userId: ids.user,
        createdAt: "2026-10-18T12:00:00Z",
        expiresAt: "2099-10-18T12:00:00Z",
        rememberMe: false,
      };
  const user = options && "user" in options
    ? options.user
    : activeUser;
  const branch = options && "branch" in options
    ? options.branch
    : activeBranch;

  const repositories = {
    auth: {
      getCurrentSessionId: vi.fn(async () =>
        options && "currentSessionId" in options ? options.currentSessionId : "session-a"
      ),
      getSession: vi.fn(async () => session),
    },
    users: { getById: vi.fn(async () => user) },
    roles: {
      getByIdScoped: vi.fn(async () => ({
        id: ids.role,
        tenantId: ids.tenant,
        name: "Despachos",
        isSystem: false,
        permissions: options?.permissions ?? ["logistics.dispatch.confirm"],
        branchScope: "selected",
        status: "active",
        createdAt: "2026-10-18T12:00:00Z",
        updatedAt: "2026-10-18T12:00:00Z",
      })),
    },
    branches: { getById: vi.fn(async () => branch) },
    storePickupHandoverCommands: options?.includeCommands === false
      ? undefined
      : { confirm: commandConfirm },
    storePickupDeliveries: { confirm: mockDeliveryConfirm },
  } as unknown as RepositoryRegistry;

  return { repositories, commandConfirm, mockDeliveryConfirm };
}

describe("StorePickupHandoverApplicationService", () => {
  it("confirma con el contexto confiable y exige solo el permiso de confirmacion", async () => {
    const { repositories, commandConfirm, mockDeliveryConfirm } = createRepositories({
      permissions: ["logistics.dispatch.confirm"],
    });
    const service = new StorePickupHandoverApplicationService(repositories);

    await expect(service.confirm(ids.branch, ids.order)).resolves.toEqual(deliveredResult);

    expect(commandConfirm).toHaveBeenCalledWith({ branchId: ids.branch }, ids.order);
    expect(mockDeliveryConfirm).not.toHaveBeenCalled();
  });

  it("propaga una respuesta idempotente sin recurrir al mock", async () => {
    const { repositories, commandConfirm, mockDeliveryConfirm } = createRepositories();
    commandConfirm.mockResolvedValue({ ...deliveredResult, idempotent: true });

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(ids.branch, ids.order),
    ).resolves.toMatchObject({ status: "delivered", idempotent: true });
    expect(mockDeliveryConfirm).not.toHaveBeenCalled();
  });

  it("deniega al usuario que no posee logistics.dispatch.confirm", async () => {
    const { repositories, commandConfirm } = createRepositories({
      permissions: ["logistics.dispatch.read"],
    });

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(ids.branch, ids.order),
    ).rejects.toThrow("Dispatch access denied");
    expect(commandConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ["ausente", { currentSessionId: null }],
    ["expirada", { session: {
      id: "session-a",
      userId: ids.user,
      createdAt: "2020-01-01T00:00:00Z",
      expiresAt: "2020-01-02T00:00:00Z",
      rememberMe: false,
    } }],
    ["revocada", { session: {
      id: "session-a",
      userId: ids.user,
      createdAt: "2026-10-18T12:00:00Z",
      expiresAt: "2099-10-18T12:00:00Z",
      revokedAt: "2026-10-18T13:00:00Z",
      rememberMe: false,
    } }],
  ])("deniega una sesion %s", async (_caseName, options) => {
    const { repositories, commandConfirm } = createRepositories(options);

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(ids.branch, ids.order),
    ).rejects.toThrow("Dispatch access denied");
    expect(commandConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ["inactivo", { status: "inactive", type: "employee", roleId: ids.role }],
    ["no empleado", { status: "active", type: "customer", roleId: ids.role }],
  ])("deniega un usuario %s", async (_caseName, patch) => {
    const { repositories, commandConfirm } = createRepositories({
      user: { ...activeUser, ...patch },
    });

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(ids.branch, ids.order),
    ).rejects.toThrow("Dispatch access denied");
    expect(commandConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ["fuera del alcance", {
      id: ids.otherBranch,
      tenantId: ids.tenant,
      code: "B2",
      name: "Norte",
      type: "store",
      status: "active",
      createdAt: "2026-10-18T12:00:00Z",
      updatedAt: "2026-10-18T12:00:00Z",
    }],
    ["de otro tenant", {
      id: ids.branch,
      tenantId: ids.otherTenant,
      code: "B1",
      name: "Externa",
      type: "store",
      status: "active",
      createdAt: "2026-10-18T12:00:00Z",
      updatedAt: "2026-10-18T12:00:00Z",
    }],
  ])("deniega una sucursal %s", async (_caseName, branch) => {
    const selectedBranchId = branch.id as string;
    const { repositories, commandConfirm } = createRepositories({ branch });

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(selectedBranchId, ids.order),
    ).rejects.toThrow("Dispatch access denied");
    expect(commandConfirm).not.toHaveBeenCalled();
  });

  it("falla cerrado cuando el repositorio API no esta disponible", async () => {
    const { repositories, mockDeliveryConfirm } = createRepositories({ includeCommands: false });

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(ids.branch, ids.order),
    ).rejects.toMatchObject({
      status: 500,
      code: "STORE_PICKUP_HANDOVER_API_NOT_CONFIGURED",
    });
    expect(mockDeliveryConfirm).not.toHaveBeenCalled();
  });

  it.each([
    ["branchId", "branch-1", ids.order],
    ["orderId", ids.branch, "order-1"],
  ])("rechaza un %s invalido antes de resolver el contexto", async (_field, branchId, orderId) => {
    const { repositories, commandConfirm } = createRepositories();

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(branchId, orderId),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_UUID" });
    expect(repositories.auth.getCurrentSessionId).not.toHaveBeenCalled();
    expect(commandConfirm).not.toHaveBeenCalled();
  });

  it.each([
    new BackendRequestError("Conflicto", 409, "PICKUP_STATE_CONFLICT"),
    new BackendRequestError("Sin conexion", 0),
    new BackendRequestError("Respuesta invalida", 502, "INVALID_BACKEND_RESPONSE"),
  ])("propaga sin reclasificar el error del repositorio %#", async (repositoryError) => {
    const { repositories, commandConfirm, mockDeliveryConfirm } = createRepositories();
    commandConfirm.mockRejectedValue(repositoryError);

    await expect(
      new StorePickupHandoverApplicationService(repositories).confirm(ids.branch, ids.order),
    ).rejects.toBe(repositoryError);
    expect(mockDeliveryConfirm).not.toHaveBeenCalled();
  });
});
