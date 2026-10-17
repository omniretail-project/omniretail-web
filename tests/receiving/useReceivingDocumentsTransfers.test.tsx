import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceivingReadModel } from "@/modules/receiving/application/dto/ReceivingDocumentsDto";
import { useReceivingDocuments } from "@/modules/receiving/hooks/useReceivingDocuments";

const mocks = vi.hoisted(() => ({
  repositories: { receivingDataSource: "api" },
  branch: { currentBranch: { id: "branch-a", name: "Sucursal A" }, loading: false },
  session: {
    sessionId: "session-1",
    user: { id: "user-1", tenantId: "tenant-1" },
  },
  service: {
    execute: vi.fn(),
    loadMore: vi.fn(),
  },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));

vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => mocks.session,
}));

vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.branch,
}));

vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));

vi.mock("@/modules/receiving/application/services/ReceivingDocumentsService", () => ({
  ReceivingDocumentsService: class {
    execute = mocks.service.execute;
    loadMore = mocks.service.loadMore;
  },
}));

function readModel(branchId: string): ReceivingReadModel {
  return {
    documents: [
      {
        id: `transfer-${branchId}`,
        documentId: `transfer-${branchId}`,
        documentNumber: `TR-${branchId}`,
        documentType: "transfer",
        documentTypeLabel: "Traslado",
        supplierOrSource: `Origen ${branchId}`,
        productCount: 1,
        requestedQuantity: 2,
        receivedQuantity: 0,
        status: "pending",
        statusLabel: "Pendiente",
        lastUpdatedAt: "2026-10-14T10:00:00.000Z",
        searchText: branchId,
      },
    ],
    incidents: [],
    incidentTypes: [],
    pagination: {
      branchId,
      streams: {
        approved: { currentPage: 1, totalPages: 1 },
        sent: { currentPage: 1, totalPages: 1 },
        partially_received: { currentPage: 1, totalPages: 1 },
        received: { currentPage: 1, totalPages: 1 },
      },
      hasMore: false,
      receiptHistoryIncomplete: false,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("useReceivingDocuments transfer API", () => {
  beforeEach(() => {
    mocks.branch = { currentBranch: { id: "branch-a", name: "Sucursal A" }, loading: false };
    mocks.service.execute.mockReset();
    mocks.service.loadMore.mockReset();
  });

  it("discards the previous branch response and clears its loading state", async () => {
    const branchA = deferred<ReceivingReadModel>();
    mocks.service.execute.mockImplementation((branchId: string) =>
      branchId === "branch-a" ? branchA.promise : Promise.resolve(readModel("branch-b")),
    );
    const { result, rerender } = renderHook(() => useReceivingDocuments());
    await waitFor(() => expect(mocks.service.execute).toHaveBeenCalledWith("branch-a"));

    mocks.branch = {
      currentBranch: { id: "branch-b", name: "Sucursal B" },
      loading: false,
    };
    rerender();
    await waitFor(() => expect(result.current.data.pagination?.branchId).toBe("branch-b"));

    await act(async () => {
      branchA.resolve(readModel("branch-a"));
      await branchA.promise;
    });

    expect(result.current.data.pagination?.branchId).toBe("branch-b");
    expect(result.current.filteredDocuments).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });
});
