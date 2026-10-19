import { describe, expect, it } from "vitest";
import {
  DispatchStatus,
  InventoryTransferStatus,
  RoleStatus,
  TenantStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetInventoryTransferHistoryService } from "@/modules/inventory/application/services/GetInventoryTransferHistoryService";

const TENANT_ID = "tenant-1";
const SOURCE_ID = "branch-source";
const DESTINATION_ID = "branch-destination";

interface TransferOverrides {
  id?: string;
  number?: string;
  status?: InventoryTransferStatus;
  createdAt?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  cancelledAt?: string;
  productId?: string;
  requestedQuantity?: number;
}

function transferEntry(overrides: TransferOverrides = {}) {
  const createdAt = overrides.createdAt ?? "2026-02-01T08:00:00.000Z";
  return {
    transfer: {
      id: overrides.id ?? "transfer-1",
      tenantId: TENANT_ID,
      number: overrides.number ?? "TR-001",
      sourceBranchId: SOURCE_ID,
      destinationBranchId: DESTINATION_ID,
      status: overrides.status ?? InventoryTransferStatus.preparing,
      createdAt,
      updatedAt: createdAt,
      dispatchedAt: overrides.dispatchedAt,
      receivedAt: overrides.receivedAt,
      cancelledAt: overrides.cancelledAt,
    },
    items: [
      {
        id: "item-1",
        productId: overrides.productId ?? "product-1",
        requestedQuantity: overrides.requestedQuantity ?? 3,
      },
    ],
  };
}

function createService(options: {
  transfers: ReturnType<typeof transferEntry>[];
  picking?: unknown;
  packing?: unknown;
  dispatches?: unknown[];
  branches?: { id: string; tenantId: string; name: string }[];
}) {
  const user = {
    id: "user-1",
    tenantId: TENANT_ID,
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-1",
    allowedBranchIds: [SOURCE_ID],
  };
  const registry = {
    inventoryMovementsDataSource: "mock",
    auth: {
      getCurrentSessionId: async () => "session-1",
      getSession: async () => ({ id: "session-1", userId: user.id }),
    },
    users: { getById: async () => user },
    tenants: { getById: async () => ({ id: TENANT_ID, status: TenantStatus.active }) },
    roles: {
      getByIdScoped: async () => ({
        id: "role-1",
        tenantId: TENANT_ID,
        status: RoleStatus.active,
        permissions: ["inventory.stock.read"],
      }),
    },
    branches: {
      getById: async (id: string) => ({ id, tenantId: TENANT_ID, name: id }),
      getAll: async () =>
        options.branches ?? [
          { id: SOURCE_ID, tenantId: TENANT_ID, name: "Sucursal origen" },
          { id: DESTINATION_ID, tenantId: TENANT_ID, name: "Sucursal destino" },
        ],
    },
    inventoryTransfers: {
      query: async (filters?: { sourceBranchId?: string }) =>
        filters?.sourceBranchId ? options.transfers : [],
    },
    dispatches: { getAll: async () => options.dispatches ?? [] },
    picking: { getBySource: async () => options.picking ?? null },
    packings: { getBySource: async () => options.packing ?? null },
    inventory: { getMovements: async () => [], getMovementPage: async () => ({}) },
  };
  return new GetInventoryTransferHistoryService(registry as unknown as RepositoryRegistry);
}

describe("GetInventoryTransferHistoryService lifecycle", () => {
  it("builds the ordered lifecycle from picking, packing and a real dispatch", async () => {
    const service = createService({
      transfers: [
        transferEntry({
          status: InventoryTransferStatus.preparing,
          receivedAt: "2026-02-01T15:00:00.000Z",
        }),
      ],
      picking: {
        createdAt: "2026-02-01T09:00:00.000Z",
        startedAt: "2026-02-01T10:00:00.000Z",
        completedAt: "2026-02-01T11:00:00.000Z",
      },
      packing: {
        startedAt: "2026-02-01T11:30:00.000Z",
        finalizedAt: "2026-02-01T12:00:00.000Z",
      },
      dispatches: [
        {
          sourceType: "transfer",
          sourceId: "transfer-1",
          branchId: SOURCE_ID,
          status: DispatchStatus.dispatched,
          dispatchedAt: "2026-02-01T13:00:00.000Z",
        },
      ],
    });

    const [row] = await service.execute(SOURCE_ID);

    expect(row.lifecycle.map((step) => step.label)).toEqual([
      "Traslado creado",
      "Picking pendiente",
      "Picking iniciado",
      "Picking finalizado",
      "Packing iniciado",
      "Packing finalizado",
      "Despachado / En tránsito",
      "Recibido / Completado",
    ]);
    expect(row.canCancel).toBe(false);
  });

  it("falls back to the transfer's own in-transit mark when there is no dispatch document", async () => {
    const service = createService({
      transfers: [transferEntry({ dispatchedAt: "2026-02-01T13:00:00.000Z" })],
    });

    const [row] = await service.execute(SOURCE_ID);

    expect(row.lifecycle.map((step) => step.label)).toEqual([
      "Traslado creado",
      "Marcado en tránsito",
    ]);
  });

  it("reports a cancelled transfer and never allows cancelling it again", async () => {
    const service = createService({
      transfers: [
        transferEntry({
          status: InventoryTransferStatus.cancelled,
          cancelledAt: "2026-02-01T09:30:00.000Z",
        }),
      ],
    });

    const [row] = await service.execute(SOURCE_ID);

    expect(row.lifecycle.map((step) => step.label)).toEqual(["Traslado creado", "Cancelado"]);
    expect(row.canCancel).toBe(false);
  });

  it("does not allow cancelling without the transfer management permission", async () => {
    const service = createService({ transfers: [transferEntry()] });

    const [row] = await service.execute(SOURCE_ID);

    expect(row.status).toBe(InventoryTransferStatus.preparing);
    expect(row.canCancel).toBe(false);
  });

  it("names the branches and states when one is unknown instead of inventing it", async () => {
    const service = createService({
      transfers: [transferEntry()],
      branches: [{ id: SOURCE_ID, tenantId: TENANT_ID, name: "Sucursal origen" }],
    });

    const [row] = await service.execute(SOURCE_ID);

    expect(row.sourceBranchName).toBe("Sucursal origen");
    expect(row.destinationBranchName).toBe("Sucursal destino no disponible");
  });

  it("ignores branches from another tenant when naming", async () => {
    const service = createService({
      transfers: [transferEntry()],
      branches: [
        { id: SOURCE_ID, tenantId: "tenant-other", name: "Ajena" },
        { id: DESTINATION_ID, tenantId: TENANT_ID, name: "Sucursal destino" },
      ],
    });

    const [row] = await service.execute(SOURCE_ID);

    expect(row.sourceBranchName).toBe("Sucursal origen no disponible");
  });

  it("filters by product, sums only that product and sorts newest first", async () => {
    const service = createService({
      transfers: [
        transferEntry({ id: "t-old", number: "TR-001", createdAt: "2026-02-01T08:00:00.000Z", requestedQuantity: 2 }),
        transferEntry({ id: "t-new", number: "TR-002", createdAt: "2026-02-03T08:00:00.000Z", requestedQuantity: 5 }),
        transferEntry({ id: "t-other", number: "TR-003", productId: "product-2" }),
      ],
    });

    const filtered = await service.execute(SOURCE_ID, "product-1");
    expect(filtered.map((row) => row.id)).toEqual(["t-new", "t-old"]);
    expect(filtered.map((row) => row.requestedQuantity)).toEqual([5, 2]);

    const all = await service.execute(SOURCE_ID);
    expect(all).toHaveLength(3);
  });
});
