import { describe, expect, it, vi } from "vitest";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { DispatchApplicationService } from "@/modules/logistics/application/services/DispatchApplicationService";
import {
  ids,
  orderQueueModel,
  orderResult,
  preparedModel,
  transferResult,
} from "./dispatchFixtures";

function createRepositories(options?: {
  dataSource?: "api" | "mock";
  permissions?: string[];
  includeRead?: boolean;
  includeCommands?: boolean;
}) {
  const permissions = options?.permissions ?? [
    "logistics.dispatch.read",
    "logistics.dispatch.confirm",
  ];
  const dispatchRead = {
    getQueue: vi.fn(async () => [orderQueueModel]),
    getPreparedDetail: vi.fn(async () => preparedModel),
    getDetail: vi.fn(async () => orderResult),
    getTransferDetail: vi.fn(async () => transferResult),
  };
  const dispatchCommands = {
    confirmOrder: vi.fn(async () => orderResult),
    confirmTransfer: vi.fn(async () => transferResult),
  };
  const repositories = {
    dispatchReadDataSource: options?.dataSource ?? "api",
    dispatchRead: options?.includeRead === false ? undefined : dispatchRead,
    dispatchCommands: options?.includeCommands === false ? undefined : dispatchCommands,
    auth: {
      getCurrentSessionId: vi.fn(async () => "session-a"),
      getSession: vi.fn(async () => ({
        id: "session-a",
        userId: ids.user,
        createdAt: "2026-10-08T12:00:00Z",
        expiresAt: "2099-10-08T12:00:00Z",
        rememberMe: false,
      })),
    },
    users: {
      getById: vi.fn(async () => ({
        id: ids.user,
        tenantId: ids.tenant,
        name: "Operator",
        email: "operator@example.com",
        type: "employee",
        status: "active",
        roleId: ids.role,
        allowedBranchIds: [ids.branchA],
        createdAt: "2026-10-08T12:00:00Z",
        updatedAt: "2026-10-08T12:00:00Z",
      })),
    },
    roles: {
      getByIdScoped: vi.fn(async () => ({
        id: ids.role,
        tenantId: ids.tenant,
        name: "Logistics",
        isSystem: false,
        permissions,
        branchScope: "selected",
        status: "active",
        createdAt: "2026-10-08T12:00:00Z",
        updatedAt: "2026-10-08T12:00:00Z",
      })),
    },
    branches: {
      getById: vi.fn(async () => ({
        id: ids.branchA,
        tenantId: ids.tenant,
        code: "B1",
        name: "Central",
        type: "warehouse",
        status: "active",
        createdAt: "2026-10-08T12:00:00Z",
        updatedAt: "2026-10-08T12:00:00Z",
      })),
    },
  } as unknown as RepositoryRegistry;
  return { repositories, dispatchRead, dispatchCommands };
}

describe("DispatchApplicationService API mode", () => {
  it("authorizes and maps every API read using the selected branch", async () => {
    const { repositories, dispatchRead } = createRepositories();
    const service = new DispatchApplicationService(repositories);

    await expect(service.getApiQueue(ids.branchA)).resolves.toEqual([orderQueueModel]);
    await expect(service.getApiPreparedDetail(ids.branchA, ids.order)).resolves.toMatchObject({
      orderId: ids.order,
      notificationContact: { emailMode: "send" },
    });
    await expect(service.getApiDispatchDetail(ids.branchA, ids.order)).resolves.toMatchObject({
      sourceType: "order",
    });
    await expect(service.getApiTransferDetail(ids.branchA, ids.transfer)).resolves.toMatchObject({
      sourceType: "transfer",
    });

    expect(dispatchRead.getQueue).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: ids.tenant,
      branchId: ids.branchA,
      actorUserId: ids.user,
    }));
  });

  it("returns direct confirmation results without an unnecessary read-back", async () => {
    const { repositories, dispatchRead, dispatchCommands } = createRepositories();
    const service = new DispatchApplicationService(repositories);

    await expect(service.confirmApiOrder(ids.branchA, ids.order, {
      operationId: "operation-order",
    })).resolves.toMatchObject({ idempotent: false, sourceType: "order" });
    await expect(service.confirmApiTransfer(ids.branchA, ids.transfer, {
      operationId: "operation-transfer",
    })).resolves.toMatchObject({ idempotent: false, sourceType: "transfer" });

    expect(dispatchCommands.confirmOrder).toHaveBeenCalledOnce();
    expect(dispatchCommands.confirmTransfer).toHaveBeenCalledOnce();
    expect(dispatchRead.getDetail).not.toHaveBeenCalled();
    expect(dispatchRead.getTransferDetail).not.toHaveBeenCalled();
  });

  it("performs authoritative read-back for historical idempotent responses", async () => {
    const { repositories, dispatchRead, dispatchCommands } = createRepositories();
    dispatchCommands.confirmOrder.mockResolvedValue({ ...orderResult, idempotent: true });
    dispatchCommands.confirmTransfer.mockResolvedValue({ ...transferResult, idempotent: true });
    const service = new DispatchApplicationService(repositories);

    await expect(service.confirmApiOrder(ids.branchA, ids.order, {
      operationId: "operation-order",
    })).resolves.toMatchObject({ idempotent: true, sourceId: ids.order });
    await expect(service.confirmApiTransfer(ids.branchA, ids.transfer, {
      operationId: "operation-transfer",
    })).resolves.toMatchObject({ idempotent: true, sourceId: ids.transfer });

    expect(dispatchRead.getDetail).toHaveBeenCalledWith(expect.any(Object), ids.order);
    expect(dispatchRead.getTransferDetail).toHaveBeenCalledWith(expect.any(Object), ids.transfer);
  });

  it("denies reads and commands when the role lacks the required permission", async () => {
    const { repositories } = createRepositories({ permissions: [] });
    const service = new DispatchApplicationService(repositories);

    await expect(service.getApiQueue(ids.branchA)).rejects.toThrow("Dispatch access denied");
    await expect(service.confirmApiOrder(ids.branchA, ids.order, {
      operationId: "operation-order",
    })).rejects.toThrow("Dispatch access denied");
  });

  it.each([
    [{ dataSource: "mock" as const }, "getApiQueue" as const],
    [{ includeRead: false }, "getApiQueue" as const],
    [{ includeCommands: false }, "confirmApiOrder" as const],
  ])("fails closed when the API adapter is unavailable", async (options, method) => {
    const { repositories } = createRepositories(options);
    const service = new DispatchApplicationService(repositories);
    const promise = method === "getApiQueue"
      ? service.getApiQueue(ids.branchA)
      : service.confirmApiOrder(ids.branchA, ids.order, { operationId: "operation-order" });

    await expect(promise).rejects.toMatchObject({
      status: 500,
      code: "DISPATCH_API_NOT_CONFIGURED",
    });
  });
});
