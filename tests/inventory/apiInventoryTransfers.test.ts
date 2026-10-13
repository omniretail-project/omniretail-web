import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryTransferReason, InventoryTransferRequestStatus } from "@/core/enums";
import { ApiInventoryTransferRepository } from "@/infrastructure/api/repositories/ApiInventoryTransferRepository";
import { ApiInventoryTransferRequestRepository } from "@/infrastructure/api/repositories/ApiInventoryTransferRequestRepository";
import {
  parseApiInventoryTransfer,
  parseApiInventoryTransferRequest,
} from "@/infrastructure/api/repositories/inventoryTransfersApi.schema";
import { withApiInventoryTransfers } from "@/infrastructure/api/withApiInventoryTransfers";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

const id = (suffix: number) => `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = {
  tenant: id(1),
  request: id(2),
  transfer: id(3),
  sourceBranch: id(4),
  destinationBranch: id(5),
  product: id(6),
  item: id(7),
  location: id(8),
};
const timestamp = "2026-10-13T12:00:00.000Z";

function transferResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ids.transfer,
    number: "TR-001",
    sourceBranchId: ids.sourceBranch,
    destinationBranchId: ids.destinationBranch,
    status: "preparing",
    reason: "replenishment",
    notes: null,
    items: [
      {
        id: ids.item,
        productId: ids.product,
        sourceRequestId: ids.request,
        requestedQuantity: 3,
        dispatchedQuantity: 0,
        receivedQuantity: 0,
      },
    ],
    preparedByUserId: null,
    preparedAt: timestamp,
    dispatchedByUserId: null,
    dispatchedAt: null,
    receivedByUserId: null,
    receivedAt: null,
    cancelledByUserId: null,
    cancelledAt: null,
    cancelReason: null,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function requestResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ids.request,
    requestingBranchId: ids.destinationBranch,
    sourceBranchId: ids.sourceBranch,
    productId: ids.product,
    requestedQuantity: 3,
    reason: "replenishment",
    notes: null,
    persistedStatus: "approved",
    effectiveStatus: "inTransit",
    requestedByUserId: null,
    requestedAt: timestamp,
    reviewedByUserId: null,
    reviewedAt: timestamp,
    reviewNotes: null,
    transferId: ids.transfer,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function page(items: unknown[], currentPage = 1, totalPages = 1) {
  return { items, page: currentPage, pageSize: 100, totalItems: items.length, totalPages };
}

describe("API repositories for inventory transfers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("approves a request from the returned transfer without listing requests", async () => {
    const fetchMock = vi.fn(async () => Response.json(transferResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryTransferRequestRepository(
      new DataEventBus(),
      async () => ids.tenant,
    );

    const approved = await repository.approveRequest(ids.request, { operationId: "approve-1" });

    expect(approved).toMatchObject({
      id: ids.request,
      transferId: ids.transfer,
      status: InventoryTransferRequestStatus.approved,
      reason: InventoryTransferReason.replenishment,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backend/inventory/transfer-requests/${ids.request}/approve`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operationId: "approve-1", reviewNotes: null }),
        headers: expect.objectContaining({ "Idempotency-Key": "approve-1" }),
      }),
    );
  });

  it("looks up a request page by page and preserves its approval date in transit", async () => {
    const otherRequest = requestResponse({ id: id(9), transferId: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return Response.json(
        url.includes("page=2") ? page([requestResponse()], 2, 2) : page([otherRequest], 1, 2),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryTransferRequestRepository(
      new DataEventBus(),
      async () => ids.tenant,
    );

    const found = await repository.getById(ids.request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(found).toMatchObject({ id: ids.request, approvedAt: timestamp });
  });

  it("lists, creates and updates requests through their API commands", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/reject")) {
        return Response.json(
          requestResponse({ effectiveStatus: "rejected", reviewNotes: "Sin stock" }),
        );
      }
      if (init?.method === "POST" && url.endsWith("/cancel")) {
        return Response.json(requestResponse({ effectiveStatus: "cancelled" }));
      }
      if (init?.method === "POST")
        return Response.json(requestResponse({ effectiveStatus: "requested" }));
      if (url.includes("page=2")) return Response.json(page([requestResponse()], 2, 2));
      return Response.json(
        page([requestResponse({ id: id(9), effectiveStatus: "requested" })], 1, 2),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryTransferRequestRepository(
      new DataEventBus(),
      async () => ids.tenant,
    );

    const requests = await repository.getRequests({
      status: InventoryTransferRequestStatus.inTransit,
    });
    const created = await repository.createRequest({
      tenantId: ids.tenant,
      requestingBranchId: ids.destinationBranch,
      sourceBranchId: ids.sourceBranch,
      productId: ids.product,
      requestedQuantity: 3,
      reason: InventoryTransferReason.replenishment,
      notes: "  Reposición  ",
    });
    const rejected = await repository.rejectRequest(ids.request, "Sin stock");
    const cancelled = await repository.cancelRequest(ids.request, "Ya no se necesita");

    expect(requests).toHaveLength(1);
    expect(created.status).toBe(InventoryTransferRequestStatus.requested);
    expect(rejected.rejectionReason).toBe("Sin stock");
    expect(cancelled.status).toBe(InventoryTransferRequestStatus.cancelled);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/inventory/transfer-requests",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          requestingBranchId: ids.destinationBranch,
          sourceBranchId: ids.sourceBranch,
          productId: ids.product,
          requestedQuantity: 3,
          reason: InventoryTransferReason.replenishment,
          notes: "Reposición",
        }),
      }),
    );
  });

  it("creates transfer commands and reloads the authoritative transfer", async () => {
    const fetchMock = vi.fn(async () => Response.json(transferResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryTransferRepository(
      new DataEventBus(),
      async () => ids.tenant,
    );

    await repository.markInTransit(ids.transfer, {
      dispatchedByUserId: id(10),
      operationId: "dispatch-1",
      items: [{ itemId: ids.item, dispatchedQuantity: 3 }],
    });
    await repository.markReceived(ids.transfer, {
      confirmationId: "receipt-1",
      receivedByUserId: id(10),
      items: [{ itemId: ids.item, locationId: ids.location, receivedQuantity: 3 }],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/backend/logistics/dispatch/transfers/${ids.transfer}/confirm`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operationId: "dispatch-1" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/backend/inventory/transfers/${ids.transfer}/receipts`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          confirmationId: "receipt-1",
          destinationLocationId: ids.location,
          items: [{ itemId: ids.item, receivedQuantity: 3, receivedSelections: [] }],
        }),
      }),
    );
  });

  it("rejects unsupported multi-location and traceability confirmations before calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryTransferRepository(
      new DataEventBus(),
      async () => ids.tenant,
    );

    await expect(
      repository.markReceived(ids.transfer, {
        confirmationId: "receipt-2",
        receivedByUserId: id(10),
        items: [
          { itemId: ids.item, locationId: ids.location, receivedQuantity: 1 },
          { itemId: id(11), locationId: id(12), receivedQuantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_RECEIPT_LOCATION_REQUIRED" });
    await expect(
      repository.markReceived(ids.transfer, {
        confirmationId: "receipt-3",
        receivedByUserId: id(10),
        items: [
          { itemId: ids.item, locationId: ids.location, receivedQuantity: 1, lotNumber: "L-1" },
        ],
      }),
    ).rejects.toMatchObject({ code: "TRANSFER_TRACEABILITY_NOT_SUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads, lists and cancels transfers while rejecting malformed payloads", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") return Response.json(transferResponse({ status: "cancelled" }));
      if (url.includes("page=2")) return Response.json(page([transferResponse()], 2, 2));
      if (url.includes("/inventory/transfers?"))
        return Response.json(page([transferResponse()], 1, 2));
      return Response.json(transferResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiInventoryTransferRepository(
      new DataEventBus(),
      async () => ids.tenant,
    );

    const detail = await repository.getById(ids.transfer);
    const transfers = await repository.query({ sourceBranchId: ids.sourceBranch });
    const cancelled = await repository.cancel(ids.transfer, {
      reason: "Cancelado",
      actorUserId: id(10),
      operationId: "cancel-1",
    });

    expect(detail?.transfer.id).toBe(ids.transfer);
    expect(transfers).toHaveLength(2);
    expect(cancelled.transfer.status).toBe("cancelled");
    expect(() => parseApiInventoryTransfer({ invalid: true })).toThrow(/invalido/i);
    expect(() => parseApiInventoryTransferRequest({ invalid: true })).toThrow(/invalido/i);
  });

  it("installs API adapters while preserving unsupported operations and delegates", async () => {
    const legacyTransfers = {
      create: vi.fn(),
      getByNumber: vi.fn(),
    };
    const legacyRequests = {
      markInTransit: vi.fn(),
      markReceived: vi.fn(),
    };
    const repositories = {
      inventoryTransfersDataSource: "mock",
      inventoryTransfers: legacyTransfers,
      inventoryTransferRequests: legacyRequests,
    } as unknown as RepositoryRegistry;

    const configured = withApiInventoryTransfers(repositories, new DataEventBus());

    expect(configured.inventoryTransfersDataSource).toBe("api");
    await expect(configured.inventoryTransfers.create({} as never)).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
    });
    await expect(
      configured.inventoryTransferRequests.markInTransit(ids.request),
    ).rejects.toMatchObject({
      code: "NOT_SUPPORTED",
    });
    expect(configured.inventoryTransfers.getByNumber).toBeTypeOf("function");
  });
});
