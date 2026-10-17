import { afterEach, describe, expect, it, vi } from "vitest";
import type { RegularizeLocationBalanceInput } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ApiInventoryAdjustmentRepository } from "@/infrastructure/api/repositories/ApiInventoryAdjustmentRepository";
import {
  parseApiLocationRegularizationOptions,
  parseApiLocationRegularizationPreview,
  parseApiLocationRegularizationResult,
  parseBackendDecimal,
} from "@/infrastructure/api/repositories/inventoryRegularizationApi.schema";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockInventoryAdjustmentRepository } from "@/infrastructure/mock/repositories/MockInventoryAdjustmentRepository";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";

const BRANCH = "10000000-0000-4000-8000-000000000001";
const PRODUCT = "20000000-0000-4000-8000-000000000001";
const LOCATION = "30000000-0000-4000-8000-000000000001";
const OTHER_LOCATION = "30000000-0000-4000-8000-000000000002";
const KEY = "40000000-0000-4000-8000-000000000001";
const REGULARIZATION = "50000000-0000-4000-8000-000000000001";
const MOVEMENT = "60000000-0000-4000-8000-000000000001";
const FINGERPRINT = "ab".repeat(32);

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();
  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }
  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }
  override remove(key: string): void {
    this.values.delete(key);
  }
}

function wirePreview(overrides: Record<string, unknown> = {}) {
  return {
    branchId: BRANCH,
    productId: PRODUCT,
    productName: "Pintura bronce",
    sku: "PIN-BRO-001",
    locationId: LOCATION,
    locationName: "Estante 1",
    eligible: true,
    blockers: [],
    sourceQuantity: 20,
    sourceReservedQuantity: "2.500",
    destinationQuantity: 0,
    destinationReservedQuantity: 0,
    resultingQuantity: "20.000",
    resultingReservedQuantity: 2.5,
    activeReservations: 1,
    emptyAllocationReservations: 0,
    lotBalances: 0,
    serials: 0,
    snapshotFingerprint: FINGERPRINT,
    assignedLocationId: LOCATION,
    assignmentRequired: false,
    assignmentAllowed: false,
    ...overrides,
  };
}

function wireOptions(overrides: Record<string, unknown> = {}) {
  return {
    branchId: BRANCH,
    productId: PRODUCT,
    productName: "Pintura bronce",
    sku: "PIN-BRO-001",
    locationsEnabled: true,
    assignedLocationId: LOCATION,
    assignedLocation: { id: LOCATION, code: "ES-01", name: "Estante 1", status: "active" },
    assignableLocations: [
      { id: LOCATION, code: "ES-01", name: "Estante 1", status: "active" },
      { id: OTHER_LOCATION, code: "ES-02", name: "Estante 2", status: "active" },
    ],
    ...overrides,
  };
}

function wireResult(overrides: Record<string, unknown> = {}) {
  return {
    regularizationId: REGULARIZATION,
    idempotent: false,
    createdAt: "2026-10-10T12:00:00Z",
    branchId: BRANCH,
    productId: PRODUCT,
    fromLocationId: null,
    toLocationId: LOCATION,
    movedQuantity: "20.000",
    movedReservedQuantity: 2.5,
    destinationQuantityBefore: 0,
    destinationQuantityAfter: 20,
    destinationReservedQuantityAfter: 2.5,
    reservationsReassigned: 1,
    lotBalancesMerged: 0,
    serialsRelocated: 0,
    movementId: MOVEMENT,
    assignmentApplied: false,
    previousAssignedLocationId: null,
    ...overrides,
  };
}

function request(overrides: Partial<RegularizeLocationBalanceInput> = {}) {
  return {
    branchId: BRANCH,
    productId: PRODUCT,
    locationId: LOCATION,
    idempotencyKey: KEY,
    reason: "  Saldo heredado  ",
    expectedSourceQuantity: 20,
    expectedSourceReservedQuantity: 2.5,
    expectedDestinationQuantity: 0.001,
    snapshotFingerprint: FINGERPRINT,
    ...overrides,
  } satisfies RegularizeLocationBalanceInput;
}

function stubFetch(status: number, body: unknown) {
  // Firma de fetch declarada en el tipo: calls[n] queda como [input, init?] sin parametros sin usar.
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () => Response.json(body, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseBackendDecimal", () => {
  it("accepts numbers and decimal strings without losing thousandths", () => {
    expect(parseBackendDecimal(20)).toBe(20);
    expect(parseBackendDecimal("10.000")).toBe(10);
    expect(parseBackendDecimal("0.001")).toBe(0.001);
    expect(parseBackendDecimal(999_999_999.999)).toBe(999_999_999.999);
    expect(parseBackendDecimal("1E+3")).toBe(1000);
    expect(Object.is(parseBackendDecimal(-0), 0)).toBe(true);
  });

  it("rejects values it cannot represent exactly instead of rounding", () => {
    expect(parseBackendDecimal("1.0005")).toBeNull();
    expect(parseBackendDecimal(Number.NaN)).toBeNull();
    expect(parseBackendDecimal("abc")).toBeNull();
    expect(parseBackendDecimal(null)).toBeNull();
    expect(parseBackendDecimal("")).toBeNull();
  });
});

describe("regularization preview contract", () => {
  it("normalizes BigDecimal as number or string and keeps blockers and fingerprint", () => {
    const preview = parseApiLocationRegularizationPreview(
      wirePreview({
        eligible: false,
        blockers: [
          {
            code: "INVENTORY_REGULARIZATION_THIRD_LOCATION_STOCK",
            message: "El producto conserva existencias en otra ubicación.",
          },
        ],
      }),
    );

    expect(preview.sourceQuantity).toBe(20);
    expect(preview.sourceReservedQuantity).toBe(2.5);
    expect(preview.resultingQuantity).toBe(20);
    expect(preview.eligible).toBe(false);
    expect(preview.blockers).toEqual([
      {
        code: "INVENTORY_REGULARIZATION_THIRD_LOCATION_STOCK",
        message: "El producto conserva existencias en otra ubicación.",
      },
    ]);
    expect(preview.snapshotFingerprint).toBe(FINGERPRINT);
  });

  it.each([
    ["a fingerprint that is not 64 characters", { snapshotFingerprint: "abc" }],
    ["a non-UUID product", { productId: "not-a-uuid" }],
    ["a negative quantity", { sourceQuantity: -1 }],
    ["more than three decimals", { sourceQuantity: "1.0005" }],
    ["a missing field", { eligible: undefined }],
    ["a null quantity", { destinationQuantity: null }],
  ])("rejects %s with INVALID_BACKEND_RESPONSE", (_label, overrides) => {
    expect(() => parseApiLocationRegularizationPreview(wirePreview(overrides))).toThrow(
      BackendRequestError,
    );
    try {
      parseApiLocationRegularizationPreview(wirePreview(overrides));
    } catch (error) {
      expect((error as BackendRequestError).code).toBe("INVALID_BACKEND_RESPONSE");
    }
  });
});

describe("regularization result contract", () => {
  it("maps the persisted result and drops a null origin location", () => {
    const result = parseApiLocationRegularizationResult(wireResult());

    expect(result).toMatchObject({
      regularizationId: REGULARIZATION,
      idempotent: false,
      toLocationId: LOCATION,
      movedQuantity: 20,
      movedReservedQuantity: 2.5,
      movementId: MOVEMENT,
    });
    expect("fromLocationId" in result).toBe(false);
  });
});

describe("ApiInventoryAdjustmentRepository location regularization", () => {
  it("reads the preview with branch, product and destination and emits nothing", async () => {
    const fetchMock = stubFetch(200, wirePreview());
    const bus = new DataEventBus();
    const emitted: string[] = [];
    bus.subscribe("inventory.changed", () => emitted.push("inventory"));
    bus.subscribe("stock.changed", () => emitted.push("stock"));

    const preview = await new ApiInventoryAdjustmentRepository(bus).previewLocationRegularization({
      branchId: BRANCH,
      productId: PRODUCT,
      locationId: LOCATION,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `/api/backend/inventory/location-regularizations/preview?branchId=${BRANCH}&productId=${PRODUCT}&locationId=${LOCATION}`,
    );
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(preview.snapshotFingerprint).toBe(FINGERPRINT);
    expect(emitted).toEqual([]);
  });

  it("rejects an invalid UUID before calling the backend", async () => {
    const fetchMock = stubFetch(200, wirePreview());

    await expect(
      new ApiInventoryAdjustmentRepository(new DataEventBus()).previewLocationRegularization({
        branchId: "branch-1",
        productId: PRODUCT,
        locationId: LOCATION,
      }),
    ).rejects.toMatchObject({ code: "INVALID_UUID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the exact body with idempotencyKey in the JSON and no Idempotency-Key header", async () => {
    const fetchMock = stubFetch(201, wireResult());

    const result = await new ApiInventoryAdjustmentRepository(
      new DataEventBus(),
    ).regularizeLocationBalance(request());

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/backend/inventory/location-regularizations");
    expect(init?.method).toBe("POST");
    const rawBody = String(init?.body);
    expect(JSON.parse(rawBody)).toEqual({
      branchId: BRANCH,
      productId: PRODUCT,
      locationId: LOCATION,
      idempotencyKey: KEY,
      reason: "Saldo heredado",
      expectedSourceQuantity: 20,
      expectedSourceReservedQuantity: 2.5,
      expectedDestinationQuantity: 0.001,
      snapshotFingerprint: FINGERPRINT,
      // Modo original: se envia explicito en false.
      assignDestination: false,
    });
    // Sin notacion cientifica en ninguna cantidad.
    expect(rawBody).not.toMatch(/\d[eE][+-]?\d/);
    expect(JSON.stringify(init?.headers)).not.toMatch(/idempotency-key/i);
    expect(result.idempotent).toBe(false);
  });

  it("refuses quantities with more than three decimals instead of rounding them", async () => {
    const fetchMock = stubFetch(201, wireResult());

    await expect(
      new ApiInventoryAdjustmentRepository(new DataEventBus()).regularizeLocationBalance(
        request({ expectedSourceQuantity: 1.0005 }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("emits inventory and stock events once per confirmed regularization, even on replay", async () => {
    const bus = new DataEventBus();
    const emitted: Array<{ event: string; entityId?: string; branchId?: string }> = [];
    bus.subscribe("inventory.changed", (payload) =>
      emitted.push({ event: "inventory", entityId: payload.entityId, branchId: payload.branchId }),
    );
    bus.subscribe("stock.changed", (payload) =>
      emitted.push({ event: "stock", entityId: payload.entityId, branchId: payload.branchId }),
    );
    const repository = new ApiInventoryAdjustmentRepository(bus);

    stubFetch(201, wireResult());
    await repository.regularizeLocationBalance(request());
    stubFetch(200, wireResult({ idempotent: true }));
    const replay = await repository.regularizeLocationBalance(request());

    expect(replay.idempotent).toBe(true);
    expect(emitted).toEqual([
      { event: "inventory", entityId: PRODUCT, branchId: BRANCH },
      { event: "stock", entityId: PRODUCT, branchId: BRANCH },
    ]);
  });

  it("keeps the real backend code and message on a 409 and emits nothing", async () => {
    stubFetch(409, {
      status: 409,
      code: "INVENTORY_REGULARIZATION_STALE_SNAPSHOT",
      message: "El inventario cambió desde la vista previa. Vuelva a cargar la vista previa.",
    });
    const bus = new DataEventBus();
    const listener = vi.fn();
    bus.subscribe("inventory.changed", listener);
    bus.subscribe("stock.changed", listener);

    await expect(
      new ApiInventoryAdjustmentRepository(bus).regularizeLocationBalance(request()),
    ).rejects.toMatchObject({
      status: 409,
      code: "INVENTORY_REGULARIZATION_STALE_SNAPSHOT",
      message: "El inventario cambió desde la vista previa. Vuelva a cargar la vista previa.",
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("treats an unreadable success body as 502 INVALID_BACKEND_RESPONSE without events", async () => {
    stubFetch(201, { regularizationId: "no-es-uuid" });
    const bus = new DataEventBus();
    const listener = vi.fn();
    bus.subscribe("stock.changed", listener);

    await expect(
      new ApiInventoryAdjustmentRepository(bus).regularizeLocationBalance(request()),
    ).rejects.toMatchObject({ status: 502, code: "INVALID_BACKEND_RESPONSE" });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("regularization options contract", () => {
  it("maps a product with an assigned location", () => {
    const options = parseApiLocationRegularizationOptions(wireOptions());

    expect(options.locationsEnabled).toBe(true);
    expect(options.assignedLocationId).toBe(LOCATION);
    expect(options.assignedLocation).toEqual({
      id: LOCATION,
      code: "ES-01",
      name: "Estante 1",
      status: "active",
    });
    expect(options.assignableLocations.map((item) => item.code)).toEqual(["ES-01", "ES-02"]);
  });

  it("maps a product without assignment and omits the null fields", () => {
    const options = parseApiLocationRegularizationOptions(
      wireOptions({ assignedLocationId: null, assignedLocation: null }),
    );

    expect("assignedLocationId" in options).toBe(false);
    expect("assignedLocation" in options).toBe(false);
    expect(options.assignableLocations).toHaveLength(2);
  });

  it("accepts disabled locations and no active locations", () => {
    expect(
      parseApiLocationRegularizationOptions(
        wireOptions({ locationsEnabled: false, assignableLocations: [] }),
      ).locationsEnabled,
    ).toBe(false);
    expect(
      parseApiLocationRegularizationOptions(
        wireOptions({ assignedLocationId: null, assignedLocation: null, assignableLocations: [] }),
      ).assignableLocations,
    ).toEqual([]);
  });

  it.each([
    ["a non UUID location", { assignableLocations: [{ id: "x", code: "A", name: "B", status: "active" }] }],
    ["a missing flag", { locationsEnabled: undefined }],
    ["a missing list", { assignableLocations: undefined }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseApiLocationRegularizationOptions(wireOptions(overrides))).toThrow(
      BackendRequestError,
    );
  });
});

describe("initial assignment contract", () => {
  it("exposes the assignment fields of the preview", () => {
    const preview = parseApiLocationRegularizationPreview(
      wirePreview({ assignedLocationId: null, assignmentRequired: true, assignmentAllowed: true }),
    );

    expect("assignedLocationId" in preview).toBe(false);
    expect(preview.assignmentRequired).toBe(true);
    expect(preview.assignmentAllowed).toBe(true);
  });

  it("rejects a preview without the assignment flags", () => {
    expect(() =>
      parseApiLocationRegularizationPreview(wirePreview({ assignmentRequired: undefined })),
    ).toThrow(BackendRequestError);
  });

  it("maps assignmentApplied and the previous assignment of the result", () => {
    const applied = parseApiLocationRegularizationResult(
      wireResult({ assignmentApplied: true, previousAssignedLocationId: null }),
    );
    expect(applied.assignmentApplied).toBe(true);
    expect("previousAssignedLocationId" in applied).toBe(false);

    const withPrevious = parseApiLocationRegularizationResult(
      wireResult({ assignmentApplied: false, previousAssignedLocationId: OTHER_LOCATION }),
    );
    expect(withPrevious.previousAssignedLocationId).toBe(OTHER_LOCATION);
  });

  it("reads the options with branch and product only", async () => {
    const fetchMock = stubFetch(200, wireOptions());

    const options = await new ApiInventoryAdjustmentRepository(
      new DataEventBus(),
    ).getLocationRegularizationOptions({ branchId: BRANCH, productId: PRODUCT });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      `/api/backend/inventory/location-regularizations/options?branchId=${BRANCH}&productId=${PRODUCT}`,
    );
    expect(init?.method).toBe("GET");
    expect(options.assignableLocations).toHaveLength(2);
  });

  it("requests the preview with assign=true only for the initial assignment", async () => {
    const fetchMock = stubFetch(200, wirePreview());
    const repository = new ApiInventoryAdjustmentRepository(new DataEventBus());

    await repository.previewLocationRegularization({
      branchId: BRANCH,
      productId: PRODUCT,
      locationId: OTHER_LOCATION,
      assign: true,
    });
    await repository.previewLocationRegularization({
      branchId: BRANCH,
      productId: PRODUCT,
      locationId: LOCATION,
    });

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `/api/backend/inventory/location-regularizations/preview?branchId=${BRANCH}&productId=${PRODUCT}&locationId=${OTHER_LOCATION}&assign=true`,
    );
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("assign=");
  });

  it("posts assignDestination=true and keeps the same body on every retry", async () => {
    const fetchMock = stubFetch(201, wireResult({ assignmentApplied: true }));
    const repository = new ApiInventoryAdjustmentRepository(new DataEventBus());
    const frozen = request({ locationId: OTHER_LOCATION, assignDestination: true });

    const first = await repository.regularizeLocationBalance(frozen);
    await repository.regularizeLocationBalance(frozen);

    const bodies = fetchMock.mock.calls.map((call) => String(call[1]?.body));
    expect(JSON.parse(bodies[0])).toMatchObject({
      locationId: OTHER_LOCATION,
      idempotencyKey: KEY,
      assignDestination: true,
    });
    expect(bodies[1]).toBe(bodies[0]);
    expect(first.assignmentApplied).toBe(true);
  });
});

describe("MockInventoryAdjustmentRepository location regularization", () => {
  it("fails explicitly instead of simulating the operation", async () => {
    const repository = new MockInventoryAdjustmentRepository(
      new MockDatabaseStore(new MemoryStorageAdapter()),
      new DataEventBus(),
    );

    await expect(repository.previewLocationRegularization()).rejects.toThrow(
      "no esta disponible en modo mock",
    );
    await expect(repository.regularizeLocationBalance()).rejects.toThrow(
      "no esta disponible en modo mock",
    );
    await expect(repository.getLocationRegularizationOptions()).rejects.toThrow(
      "no esta disponible en modo mock",
    );
  });
});
