import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationResult,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  clearPendingRegularization,
  readPendingRegularization,
} from "@/modules/inventory/application/services/inventoryRegularizationPending";
import { InventoryServiceError } from "@/modules/inventory/application/services/serviceHelpers";
import { useInventoryRegularization } from "@/modules/inventory/hooks/useInventoryRegularization";

const mocks = vi.hoisted(() => {
  const branches = [
    { id: "branch-1", name: "Centro", tenantId: "tenant-1" },
    { id: "branch-2", name: "Norte", tenantId: "tenant-1" },
  ];
  return {
    permissions: new Set<string>(),
    user: { id: "user-1", tenantId: "tenant-1" },
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
    preview(branchId: string, productId: string, locationId: string, assign?: boolean) {
      return mocks.service.preview(branchId, productId, locationId, assign);
    }
    regularize(input: RegularizeLocationBalanceInput) {
      return mocks.service.regularize(input);
    }
  },
}));

const PRODUCT_A = { id: "product-1", name: "Producto 1", sku: "SKU-1" };
const PRODUCT_B = { id: "product-2", name: "Producto 2", sku: "SKU-2" };
const FINGERPRINT = "a".repeat(64);

function preview(
  overrides: Partial<LegacyBalanceRegularizationPreview> = {},
): LegacyBalanceRegularizationPreview {
  return {
    branchId: "branch-1",
    productId: PRODUCT_A.id,
    productName: PRODUCT_A.name,
    sku: PRODUCT_A.sku,
    locationId: "location-1",
    locationName: "Estante 1",
    eligible: true,
    blockers: [],
    sourceQuantity: 20,
    sourceReservedQuantity: 2,
    destinationQuantity: 5,
    destinationReservedQuantity: 0,
    resultingQuantity: 25,
    resultingReservedQuantity: 2,
    activeReservations: 1,
    emptyAllocationReservations: 0,
    lotBalances: 0,
    serials: 0,
    snapshotFingerprint: FINGERPRINT,
    assignedLocationId: "location-1",
    assignmentRequired: false,
    assignmentAllowed: false,
    ...overrides,
  };
}

/** Resultado persistido valido del contrato actual (incluye assignmentApplied). */
function resultData(
  overrides: Partial<LocationRegularizationResult> = {},
): LocationRegularizationResult {
  return {
    regularizationId: "reg-1",
    idempotent: false,
    createdAt: "2026-10-10T12:00:00Z",
    branchId: "branch-1",
    productId: PRODUCT_A.id,
    toLocationId: "location-1",
    movedQuantity: 20,
    movedReservedQuantity: 2,
    destinationQuantityBefore: 5,
    destinationQuantityAfter: 25,
    destinationReservedQuantityAfter: 2,
    reservationsReassigned: 1,
    lotBalancesMerged: 0,
    serialsRelocated: 0,
    movementId: "mov-1",
    assignmentApplied: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const assigned = {
  kind: "assigned" as const,
  locationId: "location-1",
  locationName: "Estante 1",
  locationCode: "ES-01",
  active: true,
};

async function readyHook() {
  const hook = renderHook(() => useInventoryRegularization());
  act(() => hook.result.current.selectProduct(PRODUCT_A));
  await waitFor(() => expect(hook.result.current.preview?.status).toBe("ready"));
  act(() => hook.result.current.setReason("Saldo heredado"));
  return hook;
}

beforeEach(() => {
  // El intento incierto se guarda en la pestana: cada prueba parte sin restos de la anterior.
  clearPendingRegularization();
  mocks.permissions = new Set(["inventory.stock.read", "inventory.adjustment.create"]);
  mocks.repositories = { inventoryStockDataSource: "api" };
  Object.values(mocks.service).forEach((fn) => fn.mockReset());
  mocks.service.resolveDestination.mockResolvedValue(assigned);
  mocks.service.preview.mockImplementation(async () => preview());
  mocks.service.regularize.mockImplementation(async () => resultData());
});

describe("useInventoryRegularization preview and gating", () => {
  it("loads the real destination and preview, and only allows execution with a valid reason", async () => {
    const { result: hook } = renderHook(() => useInventoryRegularization());
    act(() => hook.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(hook.current.preview?.status).toBe("ready"));

    expect(mocks.service.resolveDestination).toHaveBeenCalledWith("branch-1", PRODUCT_A.id);
    // Ubicacion ya asignada: flujo original (assign=false), sin elegir otra.
    expect(mocks.service.preview).toHaveBeenCalledWith("branch-1", PRODUCT_A.id, "location-1", false);
    expect(hook.current.assignMode).toBe(false);
    expect(hook.current.canSubmit).toBe(false);

    act(() => hook.current.setReason("Saldo heredado"));
    expect(hook.current.canSubmit).toBe(true);
  });

  it("does not preview or execute until a location is chosen for an unassigned product", async () => {
    mocks.service.resolveDestination.mockResolvedValue({
      kind: "unassigned",
      assignableLocations: [{ id: "location-1", code: "ES-01", name: "Estante 1" }],
    });
    const { result: hook } = renderHook(() => useInventoryRegularization());
    act(() => hook.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(hook.current.destination?.status).toBe("ready"));
    act(() => hook.current.setReason("Saldo heredado"));

    expect(hook.current.destination?.data?.kind).toBe("unassigned");
    expect(hook.current.assignMode).toBe(true);
    expect(mocks.service.preview).not.toHaveBeenCalled();
    expect(hook.current.canSubmit).toBe(false);
  });

  it("blocks execution while the backend reports blockers", async () => {
    mocks.service.preview.mockImplementation(async () =>
      preview({
        eligible: false,
        blockers: [
          { code: "INVENTORY_REGULARIZATION_THIRD_LOCATION_STOCK", message: "Hay saldo en otra ubicación." },
        ],
      }),
    );
    const hook = await readyHook();

    expect(hook.result.current.preview?.data?.blockers).toHaveLength(1);
    expect(hook.result.current.canSubmit).toBe(false);
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(mocks.service.regularize).not.toHaveBeenCalled();
  });

  it("does not execute without the adjustment permission", async () => {
    mocks.permissions = new Set(["inventory.stock.read"]);
    const hook = await readyHook();

    expect(hook.result.current.canSubmit).toBe(false);
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(mocks.service.regularize).not.toHaveBeenCalled();
  });
});

describe("useInventoryRegularization execution", () => {
  it("sends one frozen request and shows the persisted result", async () => {
    const hook = await readyHook();

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(mocks.service.regularize).toHaveBeenCalledTimes(1);
    const sent = mocks.service.regularize.mock.calls[0][0] as RegularizeLocationBalanceInput;
    expect(sent).toMatchObject({
      branchId: "branch-1",
      productId: PRODUCT_A.id,
      locationId: "location-1",
      reason: "Saldo heredado",
      expectedSourceQuantity: 20,
      expectedSourceReservedQuantity: 2,
      expectedDestinationQuantity: 5,
      snapshotFingerprint: FINGERPRINT,
    });
    expect(sent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(hook.result.current.execution.phase).toBe("succeeded");
    // La vista previa anterior ya no vale: exige otra consulta.
    expect(hook.result.current.preview?.data).toBeNull();
    expect(hook.result.current.canSubmit).toBe(false);
  });

  it("sends a single request when submit is triggered twice", async () => {
    const pending = deferred<LocationRegularizationResult>();
    mocks.service.regularize.mockImplementation(() => pending.promise);
    const hook = await readyHook();

    await act(async () => {
      void hook.result.current.submit();
      void hook.result.current.submit();
      await Promise.resolve();
    });
    expect(mocks.service.regularize).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(resultData());
      await pending.promise;
    });
    expect(hook.result.current.execution.phase).toBe("succeeded");
  });

  it("keeps an uncertain attempt, locks the context and never posts again on its own", async () => {
    mocks.service.regularize.mockRejectedValueOnce(
      new BackendRequestError("El servicio no está disponible", 503, "SERVICE_UNAVAILABLE"),
    );
    const hook = await readyHook();

    await act(async () => {
      await hook.result.current.submit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(hook.result.current.execution.phase).toBe("uncertain");
    expect(hook.result.current.locked).toBe(true);
    expect(mocks.service.regularize).toHaveBeenCalledTimes(1);

    // Cambiar de producto o sucursal no descarta el intento.
    act(() => hook.result.current.selectProduct(PRODUCT_B));
    act(() => hook.result.current.selectBranch("branch-2"));
    act(() => hook.result.current.clearProduct());
    expect(hook.result.current.product?.id).toBe(PRODUCT_A.id);
    expect(hook.result.current.branchId).toBe("branch-1");
    expect(hook.result.current.execution.phase).toBe("uncertain");
    expect(mocks.service.regularize).toHaveBeenCalledTimes(1);

    // Un cierre de pestaña pide confirmacion mientras el resultado se desconoce.
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it("retries manually with the same key and the very same request body", async () => {
    mocks.service.regularize
      .mockRejectedValueOnce(new BackendRequestError("sin red", 0))
      .mockResolvedValueOnce(resultData({ idempotent: true }));
    const hook = await readyHook();

    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.execution.phase).toBe("uncertain");

    await act(async () => {
      await hook.result.current.retryUncertain();
    });

    expect(mocks.service.regularize).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.service.regularize.mock.calls.map(
      (call) => call[0] as RegularizeLocationBalanceInput,
    );
    expect(second).toBe(first);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(hook.result.current.execution).toMatchObject({
      phase: "succeeded",
      result: { idempotent: true },
    });
    expect(hook.result.current.locked).toBe(false);
  });

  it("requires a new preview after a definitive 409 and then uses a new key", async () => {
    mocks.service.regularize.mockRejectedValueOnce(
      new BackendRequestError(
        "El inventario cambió desde la vista previa.",
        409,
        "INVENTORY_REGULARIZATION_STALE_SNAPSHOT",
      ),
    );
    const hook = await readyHook();

    await act(async () => {
      await hook.result.current.submit();
    });

    expect(hook.result.current.execution).toMatchObject({
      phase: "failed",
      failure: {
        kind: "definitive",
        status: 409,
        code: "INVENTORY_REGULARIZATION_STALE_SNAPSHOT",
        message: "El inventario cambió desde la vista previa.",
      },
    });
    expect(hook.result.current.preview?.stale).toBe(true);
    expect(hook.result.current.canSubmit).toBe(false);

    await act(async () => {
      await hook.result.current.refreshPreview();
    });
    expect(mocks.service.preview).toHaveBeenCalledTimes(2);
    expect(hook.result.current.canSubmit).toBe(true);

    await act(async () => {
      await hook.result.current.submit();
    });
    const [first, second] = mocks.service.regularize.mock.calls.map(
      (call) => call[0] as RegularizeLocationBalanceInput,
    );
    expect(mocks.service.regularize).toHaveBeenCalledTimes(2);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("discards an uncertain attempt only explicitly and then demands a new preview", async () => {
    mocks.service.regularize.mockRejectedValueOnce(new BackendRequestError("caído", 500));
    const hook = await readyHook();
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.locked).toBe(true);

    act(() => hook.result.current.discardUncertain());

    expect(hook.result.current.locked).toBe(false);
    expect(hook.result.current.execution.phase).toBe("idle");
    expect(hook.result.current.preview?.stale).toBe(true);
    expect(hook.result.current.canSubmit).toBe(false);
  });
});

describe("useInventoryRegularization context protection", () => {
  it("ignores a late preview that belongs to a previous product", async () => {
    const late = deferred<LegacyBalanceRegularizationPreview>();
    mocks.service.preview
      .mockImplementationOnce(() => late.promise)
      .mockImplementationOnce(async () =>
        preview({ productId: PRODUCT_B.id, productName: PRODUCT_B.name, sku: PRODUCT_B.sku }),
      );
    const { result: hook } = renderHook(() => useInventoryRegularization());

    act(() => hook.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(mocks.service.preview).toHaveBeenCalledTimes(1));
    act(() => hook.current.selectProduct(PRODUCT_B));
    await waitFor(() => expect(hook.current.preview?.status).toBe("ready"));
    expect(hook.current.preview?.data?.productId).toBe(PRODUCT_B.id);

    await act(async () => {
      late.resolve(preview());
      await late.promise;
    });

    expect(hook.current.preview?.data?.productId).toBe(PRODUCT_B.id);
    expect(hook.current.product?.id).toBe(PRODUCT_B.id);
  });

  it("clears product, preview and reason when the branch changes", async () => {
    const hook = await readyHook();
    expect(hook.result.current.preview?.status).toBe("ready");

    act(() => hook.result.current.selectBranch("branch-2"));

    expect(hook.result.current.branchId).toBe("branch-2");
    expect(hook.result.current.product).toBeNull();
    expect(hook.result.current.preview).toBeNull();
    expect(hook.result.current.destination).toBeNull();
    expect(hook.result.current.reason).toBe("");
    expect(hook.result.current.canSubmit).toBe(false);
  });
});

describe("useInventoryRegularization initial assignment", () => {
  const unassigned = {
    kind: "unassigned" as const,
    assignableLocations: [
      { id: "location-1", code: "ES-01", name: "Estante 1" },
      { id: "location-2", code: "ES-02", name: "Estante 2" },
    ],
  };
  const assignmentPreview = (locationId = "location-2") =>
    preview({
      locationId,
      locationName: locationId === "location-2" ? "Estante 2" : "Estante 1",
      assignedLocationId: undefined,
      assignmentRequired: true,
      assignmentAllowed: true,
    });

  async function assignHook(locationId = "location-2") {
    mocks.permissions.add("catalog.products.update");
    mocks.service.resolveDestination.mockResolvedValue(unassigned);
    // El tercer argumento del servicio es la ubicacion destino solicitada.
    mocks.service.preview.mockImplementation(async (...args: unknown[]) =>
      assignmentPreview(args[2] as string),
    );
    const hook = renderHook(() => useInventoryRegularization());
    act(() => hook.result.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(hook.result.current.destination?.status).toBe("ready"));
    act(() => hook.result.current.selectLocation(locationId));
    await waitFor(() => expect(hook.result.current.preview?.status).toBe("ready"));
    act(() => hook.result.current.setReason("Asignación inicial"));
    return hook;
  }

  it("requests the preview with assign=true when a location is chosen and sends a frozen assignment", async () => {
    const hook = await assignHook();

    expect(mocks.service.preview).toHaveBeenCalledWith(
      "branch-1",
      PRODUCT_A.id,
      "location-2",
      true,
    );
    expect(hook.result.current.assignMode).toBe(true);
    expect(hook.result.current.selectedLocationId).toBe("location-2");
    expect(hook.result.current.canSubmit).toBe(true);

    mocks.service.regularize.mockResolvedValueOnce(
      resultData({ assignmentApplied: true, toLocationId: "location-2" }),
    );
    await act(async () => {
      await hook.result.current.submit();
    });

    const sent = mocks.service.regularize.mock.calls[0][0] as RegularizeLocationBalanceInput;
    expect(sent).toMatchObject({ locationId: "location-2", assignDestination: true });
    expect(hook.result.current.execution).toMatchObject({
      phase: "succeeded",
      result: { assignmentApplied: true },
    });
  });

  it("does not choose another location for a product that already has one", async () => {
    const { result: hook } = renderHook(() => useInventoryRegularization());
    act(() => hook.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(hook.current.preview?.status).toBe("ready"));

    act(() => hook.current.selectLocation("location-2"));

    expect(hook.current.assignMode).toBe(false);
    expect(hook.current.selectedLocationId).toBeNull();
    expect(mocks.service.preview).toHaveBeenCalledTimes(1);
    expect(mocks.service.preview).toHaveBeenCalledWith("branch-1", PRODUCT_A.id, "location-1", false);
  });

  it("blocks the assignment without the product update permission", async () => {
    const hook = await assignHook();
    mocks.permissions.delete("catalog.products.update");
    hook.rerender();

    expect(hook.result.current.canAssign).toBe(false);
    expect(hook.result.current.canSubmit).toBe(false);
    await act(async () => {
      await hook.result.current.submit();
    });
    expect(mocks.service.regularize).not.toHaveBeenCalled();
  });

  it("blocks the assignment when the backend does not allow it", async () => {
    mocks.permissions.add("catalog.products.update");
    mocks.service.resolveDestination.mockResolvedValue(unassigned);
    mocks.service.preview.mockImplementation(async () =>
      preview({
        locationId: "location-2",
        assignedLocationId: undefined,
        assignmentRequired: true,
        assignmentAllowed: false,
        eligible: false,
        blockers: [{ code: "INVENTORY_REGULARIZATION_ASSIGNMENT_PERMISSION", message: "x" }],
      }),
    );
    const { result: hook } = renderHook(() => useInventoryRegularization());
    act(() => hook.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(hook.current.destination?.status).toBe("ready"));
    act(() => hook.current.selectLocation("location-2"));
    await waitFor(() => expect(hook.current.preview?.status).toBe("ready"));
    act(() => hook.current.setReason("Asignación inicial"));

    expect(hook.current.canSubmit).toBe(false);
    expect(hook.current.gate.blockedBy).toEqual(expect.any(String));
  });

  it("offers no selection when the branch has no active locations", async () => {
    mocks.service.resolveDestination.mockResolvedValue({
      kind: "unassigned",
      assignableLocations: [],
    });
    const { result: hook } = renderHook(() => useInventoryRegularization());
    act(() => hook.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(hook.current.destination?.status).toBe("ready"));

    act(() => hook.current.selectLocation("location-1"));

    expect(hook.current.selectedLocationId).toBeNull();
    expect(mocks.service.preview).not.toHaveBeenCalled();
    expect(hook.current.canSubmit).toBe(false);
  });

  it("invalidates the preview when the chosen location changes and ignores the late one", async () => {
    const late = deferred<LegacyBalanceRegularizationPreview>();
    mocks.permissions.add("catalog.products.update");
    mocks.service.resolveDestination.mockResolvedValue(unassigned);
    mocks.service.preview
      .mockImplementationOnce(() => late.promise)
      .mockImplementationOnce(async () => assignmentPreview("location-2"));
    const { result: hook } = renderHook(() => useInventoryRegularization());
    act(() => hook.current.selectProduct(PRODUCT_A));
    await waitFor(() => expect(hook.current.destination?.status).toBe("ready"));

    act(() => hook.current.selectLocation("location-1"));
    await waitFor(() => expect(mocks.service.preview).toHaveBeenCalledTimes(1));
    act(() => hook.current.selectLocation("location-2"));
    // La vista previa de la ubicacion anterior ya no vale en cuanto cambia la eleccion.
    expect(hook.current.preview?.data ?? null).toBeNull();
    await waitFor(() => expect(hook.current.preview?.status).toBe("ready"));
    expect(hook.current.preview?.data?.locationId).toBe("location-2");

    await act(async () => {
      late.resolve(assignmentPreview("location-1"));
      await late.promise;
    });

    expect(hook.current.preview?.data?.locationId).toBe("location-2");
    expect(hook.current.selectedLocationId).toBe("location-2");
  });

  it("retries an uncertain assignment with the same key and frozen body", async () => {
    mocks.service.regularize
      .mockRejectedValueOnce(new BackendRequestError("sin red", 0))
      .mockResolvedValueOnce(resultData({ idempotent: true, assignmentApplied: true }));
    const hook = await assignHook();

    await act(async () => {
      await hook.result.current.submit();
    });
    expect(hook.result.current.execution.phase).toBe("uncertain");
    expect(readPendingRegularization()?.request.assignDestination).toBe(true);

    await act(async () => {
      await hook.result.current.retryUncertain();
    });

    const [first, second] = mocks.service.regularize.mock.calls.map(
      (call) => call[0] as RegularizeLocationBalanceInput,
    );
    expect(second).toBe(first);
    expect(second.assignDestination).toBe(true);
    expect(readPendingRegularization()).toBeNull();
  });

  it("keeps the sent attempt when a local permission check fails during a retry", async () => {
    mocks.service.regularize
      .mockRejectedValueOnce(new BackendRequestError("sin red", 0))
      .mockRejectedValueOnce(new InventoryServiceError("No dispone de permisos para asignar"))
      .mockResolvedValueOnce(resultData({ idempotent: true, assignmentApplied: true }));
    const hook = await assignHook();
    await act(async () => {
      await hook.result.current.submit();
    });
    const original = readPendingRegularization();

    await act(async () => {
      await hook.result.current.retryUncertain();
    });

    expect(hook.result.current.execution).toMatchObject({
      phase: "uncertain",
      retryFailure: { kind: "definitive", local: true },
    });
    expect(hook.result.current.locked).toBe(true);
    expect(readPendingRegularization()?.request).toEqual(original?.request);

    // Resuelto el permiso, el mismo intento puede completarse con la misma clave.
    await act(async () => {
      await hook.result.current.retryUncertain();
    });
    const keys = mocks.service.regularize.mock.calls.map(
      (call) => (call[0] as RegularizeLocationBalanceInput).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(1);
    expect(hook.result.current.execution.phase).toBe("succeeded");
  });

  it("keeps the attempt when the backend denies access to a retry", async () => {
    mocks.service.regularize
      .mockRejectedValueOnce(new BackendRequestError("sin red", 0))
      .mockRejectedValueOnce(new BackendRequestError("Acceso denegado", 403, "ACCESS_DENIED"));
    const hook = await assignHook();
    await act(async () => {
      await hook.result.current.submit();
    });

    await act(async () => {
      await hook.result.current.retryUncertain();
    });

    expect(hook.result.current.execution).toMatchObject({
      phase: "uncertain",
      retryFailure: { status: 403, code: "ACCESS_DENIED" },
    });
    expect(readPendingRegularization()).not.toBeNull();
  });

  it("treats a busy backend as retryable with the same request and never posts again on its own", async () => {
    mocks.service.regularize
      .mockRejectedValueOnce(
        new BackendRequestError(
          "El producto está siendo modificado por otra operación.",
          409,
          "INVENTORY_REGULARIZATION_BUSY",
        ),
      )
      .mockResolvedValueOnce(resultData());
    const hook = await readyHook();

    await act(async () => {
      await hook.result.current.submit();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(hook.result.current.execution).toMatchObject({
      phase: "uncertain",
      failure: { code: "INVENTORY_REGULARIZATION_BUSY" },
    });
    expect(mocks.service.regularize).toHaveBeenCalledTimes(1);

    await act(async () => {
      await hook.result.current.retryUncertain();
    });
    const [first, second] = mocks.service.regularize.mock.calls.map(
      (call) => call[0] as RegularizeLocationBalanceInput,
    );
    expect(second).toBe(first);
    expect(hook.result.current.execution.phase).toBe("succeeded");
  });
});

describe("useInventoryRegularization outside API mode", () => {
  it("reports the mode so the page can explain that the feature is unavailable", () => {
    mocks.repositories = { inventoryStockDataSource: "mock" };
    const { result: hook } = renderHook(() => useInventoryRegularization());

    expect(hook.current.apiMode).toBe(false);
    expect(hook.current.apiOnlyMessage).toBe("solo con backend");
  });
});
