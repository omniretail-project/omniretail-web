import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationResult,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  PENDING_REGULARIZATION_STORAGE_KEY,
  clearPendingRegularization,
  isPendingRegularizationValidFor,
  parsePendingRegularization,
  readPendingRegularization,
  savePendingRegularization,
} from "@/modules/inventory/application/services/inventoryRegularizationPending";
import { useInventoryRegularization } from "@/modules/inventory/hooks/useInventoryRegularization";

const BRANCH_1 = "10000000-0000-4000-8000-000000000001";
const BRANCH_2 = "10000000-0000-4000-8000-000000000002";
const PRODUCT = "20000000-0000-4000-8000-000000000001";
const LOCATION = "30000000-0000-4000-8000-000000000001";
const KEY = "40000000-0000-4000-8000-000000000001";
const FINGERPRINT = "c".repeat(64);
const TENANT = "tenant-1";

const mocks = vi.hoisted(() => {
  const branches = [
    { id: "10000000-0000-4000-8000-000000000001", name: "Centro", tenantId: "tenant-1" },
    { id: "10000000-0000-4000-8000-000000000002", name: "Norte", tenantId: "tenant-1" },
  ];
  return {
    permissions: new Set<string>(),
    user: { id: "user-1", tenantId: "tenant-1" } as { id: string; tenantId: string } | null,
    repositories: { inventoryStockDataSource: "api" } as object,
    activeBranch: { branches, currentBranch: branches[0] },
    service: {
      searchProducts: vi.fn(),
      resolveDestination: vi.fn(),
      preview: vi.fn(),
      regularize: vi.fn(),
    },
  };
});

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));

vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    user: mocks.user,
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));

vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.activeBranch,
}));

vi.mock("@/modules/inventory/application/services/InventoryRegularizationService", () => ({
  REGULARIZATION_API_ONLY_MESSAGE: "solo con backend",
  InventoryRegularizationService: class {
    searchProducts(branchId: string, term: string) {
      return mocks.service.searchProducts(branchId, term);
    }
    resolveDestination(branchId: string, productId: string) {
      return mocks.service.resolveDestination(branchId, productId);
    }
    preview(branchId: string, productId: string, locationId: string) {
      return mocks.service.preview(branchId, productId, locationId);
    }
    regularize(input: RegularizeLocationBalanceInput) {
      return mocks.service.regularize(input);
    }
  },
}));

const PRODUCT_OPTION = { id: PRODUCT, name: "Pintura bronce", sku: "PIN-BRO-001" };

function previewData(): LegacyBalanceRegularizationPreview {
  return {
    branchId: BRANCH_1,
    productId: PRODUCT,
    productName: PRODUCT_OPTION.name,
    sku: PRODUCT_OPTION.sku,
    locationId: LOCATION,
    locationName: "Estante 1",
    eligible: true,
    blockers: [],
    sourceQuantity: 20,
    sourceReservedQuantity: 2.5,
    destinationQuantity: 0.001,
    destinationReservedQuantity: 0,
    resultingQuantity: 20.001,
    resultingReservedQuantity: 2.5,
    activeReservations: 1,
    emptyAllocationReservations: 0,
    lotBalances: 0,
    serials: 0,
    snapshotFingerprint: FINGERPRINT,
    assignedLocationId: LOCATION,
    assignmentRequired: false,
    assignmentAllowed: false,
  };
}

function resultData(overrides: Partial<LocationRegularizationResult> = {}): LocationRegularizationResult {
  return {
    regularizationId: "50000000-0000-4000-8000-000000000001",
    idempotent: false,
    createdAt: "2026-10-10T12:00:00Z",
    branchId: BRANCH_1,
    productId: PRODUCT,
    toLocationId: LOCATION,
    movedQuantity: 20,
    movedReservedQuantity: 2.5,
    destinationQuantityBefore: 0.001,
    destinationQuantityAfter: 20.001,
    destinationReservedQuantityAfter: 2.5,
    reservationsReassigned: 1,
    lotBalancesMerged: 0,
    serialsRelocated: 0,
    movementId: "60000000-0000-4000-8000-000000000001",
    assignmentApplied: false,
    ...overrides,
  };
}

function frozenRequest(
  overrides: Partial<RegularizeLocationBalanceInput> = {},
): RegularizeLocationBalanceInput {
  return {
    branchId: BRANCH_1,
    productId: PRODUCT,
    locationId: LOCATION,
    idempotencyKey: KEY,
    reason: "Saldo heredado",
    expectedSourceQuantity: 20,
    expectedSourceReservedQuantity: 2.5,
    expectedDestinationQuantity: 0.001,
    snapshotFingerprint: FINGERPRINT,
    assignDestination: false,
    ...overrides,
  };
}

function seedPending(
  overrides: {
    tenantId?: string;
    userId?: string;
    request?: Partial<RegularizeLocationBalanceInput>;
    failure?: { message: string; code?: string; status?: number } | null;
  } = {},
) {
  savePendingRegularization({
    tenantId: overrides.tenantId ?? TENANT,
    userId: overrides.userId ?? "user-1",
    request: frozenRequest(overrides.request),
    summary: { productName: PRODUCT_OPTION.name, sku: PRODUCT_OPTION.sku, locationName: "Estante 1" },
    failure:
      overrides.failure === undefined
        ? { message: "El servicio no está disponible", code: "SERVICE_UNAVAILABLE", status: 503 }
        : overrides.failure,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  clearPendingRegularization();
  mocks.permissions = new Set(["inventory.stock.read", "inventory.adjustment.create"]);
  mocks.user = { id: "user-1", tenantId: TENANT };
  mocks.repositories = { inventoryStockDataSource: "api" };
  Object.values(mocks.service).forEach((fn) => fn.mockReset());
  mocks.service.resolveDestination.mockResolvedValue({
    kind: "assigned",
    locationId: LOCATION,
    locationName: "Estante 1",
    locationCode: "ES-01",
    active: true,
  });
  mocks.service.preview.mockImplementation(async () => previewData());
  mocks.service.regularize.mockImplementation(async () => resultData());
});

async function readyHook() {
  const hook = renderHook(() => useInventoryRegularization());
  act(() => hook.result.current.selectProduct(PRODUCT_OPTION));
  await waitFor(() => expect(hook.result.current.preview?.status).toBe("ready"));
  act(() => hook.result.current.setReason("  Saldo heredado  "));
  return hook;
}

describe("pending regularization store", () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    version: 1,
    tenantId: TENANT,
    userId: "user-1",
    savedAt: 1_700_000_000_000,
    request: frozenRequest(),
    summary: { productName: "P", sku: "S", locationName: "L" },
    failure: null,
    ...overrides,
  });

  it("restores a valid record with a frozen, unchanged request and no credentials", () => {
    const parsed = parsePendingRegularization(stored());

    expect(parsed?.request).toEqual(frozenRequest());
    expect(Object.isFrozen(parsed?.request)).toBe(true);
    expect(Object.keys(parsed ?? {}).sort()).toEqual(
      ["failure", "request", "savedAt", "summary", "tenantId", "userId"].sort(),
    );
  });

  it.each([
    ["another storage version", { version: 2 }],
    ["a non UUID idempotency key", { request: frozenRequest({ idempotencyKey: "clave" }) }],
    ["a reason with surrounding spaces", { request: frozenRequest({ reason: " motivo " }) }],
    ["an empty reason", { request: frozenRequest({ reason: "" }) }],
    ["a short fingerprint", { request: frozenRequest({ snapshotFingerprint: "abc" }) }],
    ["a negative quantity", { request: frozenRequest({ expectedSourceQuantity: -1 }) }],
    ["more than three decimals", { request: frozenRequest({ expectedDestinationQuantity: 1.0005 }) }],
    ["a missing summary", { summary: null }],
    ["a malformed failure", { failure: { code: "X" } }],
    ["a missing user", { userId: "" }],
  ])("does not restore a record with %s", (_label, overrides) => {
    expect(parsePendingRegularization(stored(overrides))).toBeNull();
  });

  it("reads from the tab storage and removes corrupt or incompatible content", () => {
    window.sessionStorage.setItem(
      PENDING_REGULARIZATION_STORAGE_KEY,
      JSON.stringify(stored({ failure: { message: "caído", status: 500 } })),
    );
    expect(readPendingRegularization()?.failure).toEqual({ message: "caído", status: 500 });

    clearPendingRegularization();
    window.sessionStorage.setItem(PENDING_REGULARIZATION_STORAGE_KEY, "{no es json");
    expect(readPendingRegularization()).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_REGULARIZATION_STORAGE_KEY)).toBeNull();

    window.sessionStorage.setItem(
      PENDING_REGULARIZATION_STORAGE_KEY,
      JSON.stringify(stored({ version: 99 })),
    );
    expect(readPendingRegularization()).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_REGULARIZATION_STORAGE_KEY)).toBeNull();
  });

  it("keeps the assignment mode of the frozen request", () => {
    const parsed = parsePendingRegularization(
      stored({ request: frozenRequest({ assignDestination: true }) }),
    );

    expect(parsed?.request.assignDestination).toBe(true);
  });

  it("reads attempts saved before the assignment mode existed as assignDestination=false", () => {
    const { assignDestination: _omitted, ...legacyRequest } = frozenRequest();
    void _omitted;

    const parsed = parsePendingRegularization(stored({ request: legacyRequest }));

    expect(parsed?.request.assignDestination).toBe(false);
    expect(parsed?.request.idempotencyKey).toBe(KEY);
    expect(parsed?.request.snapshotFingerprint).toBe(FINGERPRINT);
  });

  it("does not restore a record whose assignment mode is not a boolean", () => {
    expect(
      parsePendingRegularization(
        stored({ request: { ...frozenRequest(), assignDestination: "yes" } }),
      ),
    ).toBeNull();
    expect(
      parsePendingRegularization(
        stored({ request: { ...frozenRequest(), assignDestination: 1 } }),
      ),
    ).toBeNull();
  });

  it("clears only the record of the given key", () => {
    seedPending();

    clearPendingRegularization("40000000-0000-4000-8000-0000000000ff");
    expect(readPendingRegularization()).not.toBeNull();

    clearPendingRegularization(KEY);
    expect(readPendingRegularization()).toBeNull();
    expect(window.sessionStorage.getItem(PENDING_REGULARIZATION_STORAGE_KEY)).toBeNull();
  });

  it("only validates for the same business, user and an authorized branch", () => {
    const pending = parsePendingRegularization(stored())!;
    const scope = { tenantId: TENANT, userId: "user-1", branchIds: [BRANCH_1, BRANCH_2] };

    expect(isPendingRegularizationValidFor(pending, scope)).toBe(true);
    expect(isPendingRegularizationValidFor(pending, { ...scope, tenantId: "tenant-2" })).toBe(false);
    expect(isPendingRegularizationValidFor(pending, { ...scope, userId: "user-2" })).toBe(false);
    expect(isPendingRegularizationValidFor(pending, { ...scope, branchIds: [BRANCH_2] })).toBe(false);
  });
});

describe("recovery of an uncertain attempt after leaving the screen", () => {
  it("recovers it after unmount/remount without posting and retries the exact same body and key", async () => {
    mocks.service.regularize
      .mockRejectedValueOnce(new BackendRequestError("no disponible", 503, "SERVICE_UNAVAILABLE"))
      .mockResolvedValueOnce(resultData({ idempotent: true }));
    const first = await readyHook();
    await act(async () => {
      await first.result.current.submit();
    });
    expect(first.result.current.execution.phase).toBe("uncertain");
    const original = mocks.service.regularize.mock.calls[0][0] as RegularizeLocationBalanceInput;

    first.unmount();
    const second = renderHook(() => useInventoryRegularization());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(second.result.current.execution).toMatchObject({
      phase: "uncertain",
      recovered: true,
      request: original,
      summary: { productName: PRODUCT_OPTION.name, sku: PRODUCT_OPTION.sku },
      failure: { code: "SERVICE_UNAVAILABLE", status: 503 },
    });
    expect(second.result.current.locked).toBe(true);
    expect(second.result.current.branchId).toBe(BRANCH_1);
    // Recuperar no ejecuta ningun POST.
    expect(mocks.service.regularize).toHaveBeenCalledTimes(1);
    // Mientras no se resuelva no se puede cambiar de producto ni de sucursal.
    act(() => second.result.current.selectBranch(BRANCH_2));
    act(() => second.result.current.selectProduct(PRODUCT_OPTION));
    expect(second.result.current.branchId).toBe(BRANCH_1);
    expect(second.result.current.product).toBeNull();

    await act(async () => {
      await second.result.current.retryUncertain();
    });

    expect(mocks.service.regularize).toHaveBeenCalledTimes(2);
    const retried = mocks.service.regularize.mock.calls[1][0] as RegularizeLocationBalanceInput;
    expect(retried).toEqual(original);
    expect(retried.idempotencyKey).toBe(original.idempotencyKey);
    expect(second.result.current.execution).toMatchObject({
      phase: "succeeded",
      result: { idempotent: true },
      summary: { productName: PRODUCT_OPTION.name },
    });
    expect(readPendingRegularization()).toBeNull();

    // Tras un exito confirmado no queda nada que recuperar.
    second.unmount();
    const third = renderHook(() => useInventoryRegularization());
    expect(third.result.current.execution.phase).toBe("idle");
    expect(third.result.current.locked).toBe(false);
  });

  it("saves the attempt before sending so leaving with the POST in flight is recoverable", async () => {
    const pending = deferred<LocationRegularizationResult>();
    mocks.service.regularize.mockImplementation(() => pending.promise);
    const first = await readyHook();

    act(() => {
      void first.result.current.submit();
    });
    const saved = readPendingRegularization();
    expect(saved?.failure).toBeNull();
    expect(saved?.request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);

    first.unmount();
    const second = renderHook(() => useInventoryRegularization());
    expect(second.result.current.execution).toMatchObject({
      phase: "uncertain",
      recovered: true,
      request: saved?.request,
    });
    expect(mocks.service.regularize).toHaveBeenCalledTimes(1);

    // La respuesta de la primera pantalla llega despues: confirma y limpia el registro.
    await act(async () => {
      pending.resolve(resultData());
      await pending.promise;
    });
    expect(readPendingRegularization()).toBeNull();
  });

  it("recovers an uncertain initial assignment and retries the same assigning request", async () => {
    seedPending({ request: { assignDestination: true } });
    mocks.service.regularize.mockResolvedValueOnce(
      resultData({ idempotent: true, assignmentApplied: true }),
    );
    const { result: hook } = renderHook(() => useInventoryRegularization());

    expect(hook.current.execution).toMatchObject({
      phase: "uncertain",
      recovered: true,
      request: { assignDestination: true, idempotencyKey: KEY },
    });
    expect(mocks.service.regularize).not.toHaveBeenCalled();

    await act(async () => {
      await hook.current.retryUncertain();
    });

    const sent = mocks.service.regularize.mock.calls[0][0] as RegularizeLocationBalanceInput;
    expect(sent).toEqual(frozenRequest({ assignDestination: true }));
    expect(hook.current.execution).toMatchObject({
      phase: "succeeded",
      result: { idempotent: true, assignmentApplied: true },
    });
    expect(readPendingRegularization()).toBeNull();
  });

  it("keeps a recovered attempt when the retry fails a permission check", async () => {
    seedPending({ request: { assignDestination: true } });
    mocks.service.regularize.mockRejectedValueOnce(
      new BackendRequestError("Acceso denegado", 403, "ACCESS_DENIED"),
    );
    const { result: hook } = renderHook(() => useInventoryRegularization());

    await act(async () => {
      await hook.current.retryUncertain();
    });

    expect(hook.current.execution).toMatchObject({
      phase: "uncertain",
      recovered: true,
      retryFailure: { code: "ACCESS_DENIED", status: 403 },
    });
    expect(readPendingRegularization()?.request.idempotencyKey).toBe(KEY);
  });

  it("clears the record on an explicit discard", async () => {
    seedPending();
    const { result: hook } = renderHook(() => useInventoryRegularization());
    expect(hook.current.execution.phase).toBe("uncertain");

    act(() => hook.current.discardUncertain());

    expect(hook.current.execution.phase).toBe("idle");
    expect(hook.current.locked).toBe(false);
    expect(readPendingRegularization()).toBeNull();
    expect(mocks.service.regularize).not.toHaveBeenCalled();
  });

  it("clears the record and requires a new preview after a definitive rejection on retry", async () => {
    seedPending({ failure: null });
    mocks.service.regularize.mockRejectedValueOnce(
      new BackendRequestError(
        "El inventario cambió desde la vista previa.",
        409,
        "INVENTORY_REGULARIZATION_STALE_SNAPSHOT",
      ),
    );
    const { result: hook, unmount } = renderHook(() => useInventoryRegularization());
    expect(hook.current.execution).toMatchObject({
      phase: "uncertain",
      failure: { message: expect.stringContaining("antes de conocer su resultado") },
    });

    await act(async () => {
      await hook.current.retryUncertain();
    });

    expect(hook.current.execution).toMatchObject({
      phase: "failed",
      failure: { code: "INVENTORY_REGULARIZATION_STALE_SNAPSHOT", status: 409 },
    });
    expect(readPendingRegularization()).toBeNull();
    unmount();
    expect(renderHook(() => useInventoryRegularization()).result.current.execution.phase).toBe(
      "idle",
    );
  });

  it("does not store a definitive failure: it cannot be applied", async () => {
    mocks.service.regularize.mockRejectedValueOnce(
      new BackendRequestError("Sin permiso", 403, "FORBIDDEN"),
    );
    const first = await readyHook();

    await act(async () => {
      await first.result.current.submit();
    });

    expect(first.result.current.execution.phase).toBe("failed");
    expect(readPendingRegularization()).toBeNull();
  });
});

describe("recovery validation", () => {
  it("does not recover an attempt of another user and removes it", async () => {
    seedPending({ userId: "user-2" });
    const { result: hook } = renderHook(() => useInventoryRegularization());

    expect(hook.current.execution.phase).toBe("idle");
    expect(hook.current.locked).toBe(false);
    await waitFor(() => expect(readPendingRegularization()).toBeNull());
  });

  it("does not recover an attempt of another business", async () => {
    seedPending({ tenantId: "tenant-2" });
    const { result: hook } = renderHook(() => useInventoryRegularization());

    expect(hook.current.execution.phase).toBe("idle");
    await waitFor(() => expect(readPendingRegularization()).toBeNull());
  });

  it("does not recover an attempt of a branch the user can no longer operate", async () => {
    seedPending({ request: { branchId: "10000000-0000-4000-8000-0000000000aa" } });
    const { result: hook } = renderHook(() => useInventoryRegularization());

    expect(hook.current.execution.phase).toBe("idle");
    expect(hook.current.locked).toBe(false);
    await waitFor(() => expect(readPendingRegularization()).toBeNull());
  });

  it("does not recover corrupt content from the tab storage", () => {
    clearPendingRegularization();
    window.sessionStorage.setItem(PENDING_REGULARIZATION_STORAGE_KEY, '{"version":1,"request":7}');

    const { result: hook } = renderHook(() => useInventoryRegularization());

    expect(hook.current.execution.phase).toBe("idle");
    expect(window.sessionStorage.getItem(PENDING_REGULARIZATION_STORAGE_KEY)).toBeNull();
  });
});
