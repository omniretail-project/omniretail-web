import { describe, expect, it, vi } from "vitest";
import {
  PlanStatus,
  ProductType,
  SaasCapabilityKey,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationOptions,
  PreviewLocationRegularizationInput,
  RegularizeLocationBalanceInput,
} from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  classifyRegularizationFailure,
  freezeRegularizationRequest,
} from "@/modules/inventory/application/services/inventoryRegularizationAttempt";
import {
  InventoryRegularizationService,
  REGULARIZATION_API_ONLY_MESSAGE,
} from "@/modules/inventory/application/services/InventoryRegularizationService";
import {
  INVENTORY_ADJUSTMENT_CREATE_PERMISSION,
  INVENTORY_STOCK_READ_PERMISSION,
  InventoryServiceError,
} from "@/modules/inventory/application/services/serviceHelpers";
import { evaluateRegularizationGate } from "@/modules/inventory/validation/inventoryRegularization.validation";

const TENANT = "tenant-1";
const BRANCH = "branch-1";
const OTHER_BRANCH = "branch-2";
const PRODUCT = "product-1";
const LOCATION = "location-1";
const FINGERPRINT = "f".repeat(64);

function preview(
  overrides: Partial<LegacyBalanceRegularizationPreview> = {},
): LegacyBalanceRegularizationPreview {
  return {
    branchId: BRANCH,
    productId: PRODUCT,
    productName: "Producto 1",
    sku: "SKU-1",
    locationId: LOCATION,
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
    assignedLocationId: LOCATION,
    assignmentRequired: false,
    assignmentAllowed: false,
    ...overrides,
  };
}

const assigned = {
  kind: "assigned" as const,
  locationId: LOCATION,
  locationName: "Estante 1",
  locationCode: "ES-01",
  active: true,
};

describe("evaluateRegularizationGate", () => {
  const ready = {
    preview: preview(),
    previewStale: false,
    destination: assigned,
    selectedLocationId: null,
    reason: "Saldo heredado",
    canAdjust: true,
    canAssign: true,
  };
  const unassigned = {
    kind: "unassigned" as const,
    assignableLocations: [
      { id: LOCATION, code: "ES-01", name: "Estante 1" },
      { id: "location-2", code: "ES-02", name: "Estante 2" },
    ],
  };
  const assignReady = {
    ...ready,
    destination: unassigned,
    selectedLocationId: LOCATION,
    preview: preview({ assignedLocationId: undefined, assignmentRequired: true, assignmentAllowed: true }),
  };

  it("allows only an eligible preview without blockers, with valid fingerprint, reason and permission", () => {
    expect(evaluateRegularizationGate(ready)).toEqual({ allowed: true, blockedBy: null });
  });

  it("allows the initial assignment with a chosen location, allowed preview and both permissions", () => {
    expect(evaluateRegularizationGate(assignReady)).toEqual({ allowed: true, blockedBy: null });
  });

  it.each([
    ["no chosen location", { selectedLocationId: null }],
    ["a location that is no longer assignable", { selectedLocationId: "location-9" }],
    ["a preview for another location", { selectedLocationId: "location-2" }],
    [
      "a preview that does not allow the assignment",
      { preview: preview({ assignmentRequired: true, assignmentAllowed: false }) },
    ],
    ["no catalog update permission", { canAssign: false }],
  ])("blocks the initial assignment with %s", (_label, override) => {
    const gate = evaluateRegularizationGate({ ...assignReady, ...override });
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toEqual(expect.any(String));
  });

  it("does not ask for the assignment permission when the product already has a location", () => {
    expect(evaluateRegularizationGate({ ...ready, canAssign: false }).allowed).toBe(true);
  });

  it.each([
    ["no adjustment permission", { canAdjust: false }],
    ["no preview", { preview: null }],
    ["a stale preview after a 409", { previewStale: true }],
    ["disabled locations", { destination: { kind: "locations_disabled" as const } }],
    [
      "an unassigned destination without a choice",
      { destination: { kind: "unassigned" as const, assignableLocations: [] } },
    ],
    ["a preview for another location", { preview: preview({ locationId: "other" }) }],
    ["a non eligible preview", { preview: preview({ eligible: false }) }],
    [
      "backend blockers even if eligible is true",
      { preview: preview({ blockers: [{ code: "X", message: "Bloqueo" }] }) },
    ],
    ["a short fingerprint", { preview: preview({ snapshotFingerprint: "abc" }) }],
    ["an empty reason", { reason: "   " }],
    ["a reason over 200 characters", { reason: "x".repeat(201) }],
  ])("blocks execution with %s", (_label, override) => {
    const gate = evaluateRegularizationGate({ ...ready, ...override });
    expect(gate.allowed).toBe(false);
    expect(gate.blockedBy).toEqual(expect.any(String));
  });
});

describe("classifyRegularizationFailure", () => {
  it("treats network, timeout, 5xx, 503 and unreadable responses as uncertain", () => {
    expect(classifyRegularizationFailure(new BackendRequestError("red", 0)).kind).toBe("uncertain");
    expect(classifyRegularizationFailure(new BackendRequestError("t", 408)).kind).toBe("uncertain");
    expect(classifyRegularizationFailure(new BackendRequestError("e", 500)).kind).toBe("uncertain");
    expect(
      classifyRegularizationFailure(
        new BackendRequestError("no", 503, "SERVICE_UNAVAILABLE"),
      ).kind,
    ).toBe("uncertain");
    expect(
      classifyRegularizationFailure(
        new BackendRequestError("ilegible", 502, "INVALID_BACKEND_RESPONSE"),
      ).kind,
    ).toBe("uncertain");
    expect(classifyRegularizationFailure(new SyntaxError("Unexpected token")).kind).toBe(
      "uncertain",
    );
    // Carrera entre dos envios de la misma clave: se repite la misma solicitud, no se cambia de clave.
    expect(
      classifyRegularizationFailure(
        new BackendRequestError("reintente", 409, "INVENTORY_REGULARIZATION_KEY_REUSED"),
      ).kind,
    ).toBe("uncertain");
  });

  it("treats 4xx and local validation as definitive and keeps the real code and message", () => {
    const failure = classifyRegularizationFailure(
      new BackendRequestError("El inventario cambió", 409, "INVENTORY_REGULARIZATION_STALE_SNAPSHOT"),
    );
    expect(failure).toMatchObject({
      kind: "definitive",
      status: 409,
      code: "INVENTORY_REGULARIZATION_STALE_SNAPSHOT",
      message: "El inventario cambió",
    });
    expect(classifyRegularizationFailure(new InventoryServiceError("Sin permiso")).kind).toBe(
      "definitive",
    );
  });
});

describe("freezeRegularizationRequest", () => {
  it("copies the preview snapshot, trims the reason and cannot be mutated", () => {
    const request = freezeRegularizationRequest({
      preview: preview(),
      reason: "  Motivo  ",
      idempotencyKey: "key-1",
      assignDestination: false,
    });

    expect(request).toEqual({
      branchId: BRANCH,
      productId: PRODUCT,
      locationId: LOCATION,
      idempotencyKey: "key-1",
      reason: "Motivo",
      expectedSourceQuantity: 20,
      expectedSourceReservedQuantity: 2,
      expectedDestinationQuantity: 5,
      snapshotFingerprint: FINGERPRINT,
      assignDestination: false,
    });
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("freezes the assignment mode together with the key and the snapshot", () => {
    const request = freezeRegularizationRequest({
      preview: preview({ assignmentRequired: true, assignmentAllowed: true }),
      reason: "Asignación inicial",
      idempotencyKey: "key-2",
      assignDestination: true,
    });

    expect(request.assignDestination).toBe(true);
    expect(request.idempotencyKey).toBe("key-2");
    expect(request.snapshotFingerprint).toBe(FINGERPRINT);
  });
});

function createService(options: {
  permissions?: string[];
  api?: boolean;
  branchTenant?: string;
  regularizationOptions?: Partial<LocationRegularizationOptions>;
}) {
  const permissions = options.permissions ?? [
    INVENTORY_STOCK_READ_PERMISSION,
    INVENTORY_ADJUSTMENT_CREATE_PERMISSION,
  ];
  const user = {
    id: "user-1",
    tenantId: TENANT,
    status: UserStatus.active,
    type: UserType.customer,
    roleId: "role-1",
    allowedBranchIds: [BRANCH],
  };
  const optionsResponse: LocationRegularizationOptions = {
    branchId: BRANCH,
    productId: PRODUCT,
    productName: "Producto 1",
    sku: "SKU-1",
    locationsEnabled: true,
    assignedLocationId: LOCATION,
    assignedLocation: { id: LOCATION, code: "ES-01", name: "Estante 1", status: "active" },
    assignableLocations: [
      { id: LOCATION, code: "ES-01", name: "Estante 1", status: "active" },
      { id: "location-2", code: "ES-02", name: "Estante 2", status: "active" },
    ],
    ...options.regularizationOptions,
  };
  const adjustments = {
    getLocationRegularizationOptions: vi.fn(async () => optionsResponse),
    previewLocationRegularization: vi.fn<
      (input: PreviewLocationRegularizationInput) => Promise<LegacyBalanceRegularizationPreview>
    >(async () => preview()),
    // Firma real del metodo: sin ella el mock se infiere sin argumentos y calls[0][0] no existe.
    regularizeLocationBalance: vi.fn<
      (input: RegularizeLocationBalanceInput) => Promise<{ regularizationId: string }>
    >(async () => ({ regularizationId: "r-1" })),
  };
  const getPageScoped = vi.fn(async () => ({
    items: [
      {
        id: "p-physical",
        tenantId: TENANT,
        name: "Fisico",
        sku: "F-1",
        productType: ProductType.physical,
        tracking: { stock: true },
      },
      {
        id: "p-no-stock",
        tenantId: TENANT,
        name: "Sin stock",
        sku: "N-1",
        productType: ProductType.physical,
        tracking: { stock: false },
      },
      {
        id: "p-kit",
        tenantId: TENANT,
        name: "Kit",
        sku: "K-1",
        productType: ProductType.kit,
        tracking: { stock: true },
      },
      {
        id: "p-other-tenant",
        tenantId: "tenant-2",
        name: "Ajeno",
        sku: "A-1",
        productType: ProductType.physical,
        tracking: { stock: true },
      },
    ],
    page: 1,
    pageSize: 20,
    totalItems: 4,
    totalPages: 1,
  }));
  const repositories = {
    inventoryStockDataSource: options.api === false ? "mock" : "api",
    auth: {
      getCurrentSessionId: async () => "session-1",
      getSession: async () => ({ id: "session-1", userId: user.id }),
    },
    users: { getById: async () => user },
    roles: {
      getByIdScoped: async () => ({
        id: "role-1",
        tenantId: TENANT,
        status: "active",
        permissions,
      }),
    },
    tenants: { getById: async () => ({ id: TENANT, status: "active" }) },
    tenantSubscriptions: {
      getByTenantId: async () => ({
        tenantId: TENANT,
        planId: "plan-1",
        status: TenantSubscriptionStatus.active,
      }),
    },
    plans: {
      getById: async () => ({
        id: "plan-1",
        code: "pro",
        status: PlanStatus.active,
        capabilities: [SaasCapabilityKey.inventory],
        limits: {},
      }),
    },
    branches: {
      getById: async (id: string) => ({ id, tenantId: options.branchTenant ?? TENANT }),
    },
    products: { getPageScoped },
    inventoryAdjustments: adjustments,
  } as unknown as RepositoryRegistry;
  return {
    service: new InventoryRegularizationService(repositories),
    adjustments,
    getPageScoped,
  };
}

function executionInput(
  overrides: Partial<RegularizeLocationBalanceInput> = {},
): RegularizeLocationBalanceInput {
  return {
    branchId: BRANCH,
    productId: PRODUCT,
    locationId: LOCATION,
    idempotencyKey: "40000000-0000-4000-8000-000000000001",
    reason: "Saldo heredado",
    expectedSourceQuantity: 20,
    expectedSourceReservedQuantity: 2,
    expectedDestinationQuantity: 5,
    snapshotFingerprint: FINGERPRINT,
    ...overrides,
  };
}

describe("InventoryRegularizationService permissions and scope", () => {
  it("searches only physical products with stock control of the current business", async () => {
    const { service, getPageScoped } = createService({});

    const results = await service.searchProducts(BRANCH, "  pin ");

    expect(results).toEqual([{ id: "p-physical", name: "Fisico", sku: "F-1" }]);
    expect(getPageScoped).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ search: "pin", productType: ProductType.physical }),
    );
  });

  it("uses the assigned location from options as the only destination", async () => {
    const { service, adjustments } = createService({});

    expect(await service.resolveDestination(BRANCH, PRODUCT)).toEqual(assigned);
    expect(adjustments.getLocationRegularizationOptions).toHaveBeenCalledWith({
      branchId: BRANCH,
      productId: PRODUCT,
    });
  });

  it("offers only the active assignable locations when the product has none assigned", async () => {
    const { service } = createService({
      regularizationOptions: {
        assignedLocationId: undefined,
        assignedLocation: undefined,
        assignableLocations: [
          { id: LOCATION, code: "ES-01", name: "Estante 1", status: "active" },
          { id: "location-3", code: "ES-03", name: "Estante 3", status: "inactive" },
        ],
      },
    });

    expect(await service.resolveDestination(BRANCH, PRODUCT)).toEqual({
      kind: "unassigned",
      assignableLocations: [{ id: LOCATION, code: "ES-01", name: "Estante 1" }],
    });
  });

  it("reports no active locations, disabled control and unavailable assignment", async () => {
    expect(
      await createService({
        regularizationOptions: {
          assignedLocationId: undefined,
          assignedLocation: undefined,
          assignableLocations: [],
        },
      }).service.resolveDestination(BRANCH, PRODUCT),
    ).toEqual({ kind: "unassigned", assignableLocations: [] });
    expect(
      await createService({
        regularizationOptions: { locationsEnabled: false, assignableLocations: [] },
      }).service.resolveDestination(BRANCH, PRODUCT),
    ).toEqual({ kind: "locations_disabled" });
    expect(
      await createService({
        regularizationOptions: { assignedLocation: undefined },
      }).service.resolveDestination(BRANCH, PRODUCT),
    ).toEqual({ kind: "unavailable", locationId: LOCATION });
    expect(
      await createService({
        regularizationOptions: {
          assignedLocation: { id: LOCATION, code: "ES-01", name: "Estante 1", status: "inactive" },
        },
      }).service.resolveDestination(BRANCH, PRODUCT),
    ).toMatchObject({ kind: "assigned", active: false });
  });

  it("does not need catalog location permissions to resolve the destination", async () => {
    const { service } = createService({
      permissions: [INVENTORY_STOCK_READ_PERMISSION],
    });

    await expect(service.resolveDestination(BRANCH, PRODUCT)).resolves.toMatchObject({
      kind: "assigned",
    });
  });

  it("rejects options that belong to another product or branch", async () => {
    const { service } = createService({
      regularizationOptions: { productId: "other-product" },
    });

    await expect(service.resolveDestination(BRANCH, PRODUCT)).rejects.toBeInstanceOf(
      InventoryServiceError,
    );
  });

  it("asks the backend for the assignment preview only when requested", async () => {
    const { service, adjustments } = createService({});

    await service.preview(BRANCH, PRODUCT, LOCATION);
    await service.preview(BRANCH, PRODUCT, LOCATION, true);

    expect(adjustments.previewLocationRegularization.mock.calls[0][0]).toEqual({
      branchId: BRANCH,
      productId: PRODUCT,
      locationId: LOCATION,
    });
    expect(adjustments.previewLocationRegularization.mock.calls[1][0]).toEqual({
      branchId: BRANCH,
      productId: PRODUCT,
      locationId: LOCATION,
      assign: true,
    });
  });

  it("requires the product update permission to send an initial assignment", async () => {
    const withoutUpdate = createService({});
    await expect(
      withoutUpdate.service.regularize(executionInput({ assignDestination: true })),
    ).rejects.toThrow("asignar ubicaciones");
    expect(withoutUpdate.adjustments.regularizeLocationBalance).not.toHaveBeenCalled();

    const withUpdate = createService({
      permissions: [
        INVENTORY_STOCK_READ_PERMISSION,
        INVENTORY_ADJUSTMENT_CREATE_PERMISSION,
        "catalog.products.update",
      ],
    });
    const input = executionInput({ assignDestination: true });
    await withUpdate.service.regularize(input);
    expect(withUpdate.adjustments.regularizeLocationBalance.mock.calls[0][0]).toBe(input);

    // El modo original no exige el permiso adicional.
    const original = createService({});
    await original.service.regularize(executionInput({ assignDestination: false }));
    expect(original.adjustments.regularizeLocationBalance).toHaveBeenCalledTimes(1);
  });

  it("does not preview without stock read permission or outside the user's branches", async () => {
    const noRead = createService({ permissions: [INVENTORY_ADJUSTMENT_CREATE_PERMISSION] });
    await expect(noRead.service.preview(BRANCH, PRODUCT, LOCATION)).rejects.toThrow(
      "permisos",
    );
    expect(noRead.adjustments.previewLocationRegularization).not.toHaveBeenCalled();

    const foreign = createService({});
    await expect(foreign.service.preview(OTHER_BRANCH, PRODUCT, LOCATION)).rejects.toThrow(
      "acceso a la sucursal",
    );
    expect(foreign.adjustments.previewLocationRegularization).not.toHaveBeenCalled();
  });

  it("does not regularize without adjustment permission, API mode, valid reason or fingerprint", async () => {
    const noAdjust = createService({ permissions: [INVENTORY_STOCK_READ_PERMISSION] });
    await expect(noAdjust.service.regularize(executionInput())).rejects.toBeInstanceOf(
      InventoryServiceError,
    );
    expect(noAdjust.adjustments.regularizeLocationBalance).not.toHaveBeenCalled();

    const mock = createService({ api: false });
    await expect(mock.service.regularize(executionInput())).rejects.toThrow(
      REGULARIZATION_API_ONLY_MESSAGE,
    );
    expect(mock.adjustments.regularizeLocationBalance).not.toHaveBeenCalled();

    const invalid = createService({});
    await expect(invalid.service.regularize(executionInput({ reason: " " }))).rejects.toThrow();
    await expect(
      invalid.service.regularize(executionInput({ snapshotFingerprint: "corta" })),
    ).rejects.toThrow();
    expect(invalid.adjustments.regularizeLocationBalance).not.toHaveBeenCalled();
  });

  it("sends the received request unchanged in a single call", async () => {
    const { service, adjustments } = createService({});
    const input = executionInput();

    await service.regularize(input);

    expect(adjustments.regularizeLocationBalance).toHaveBeenCalledTimes(1);
    expect(adjustments.regularizeLocationBalance.mock.calls[0][0]).toBe(input);
  });
});
