import { describe, expect, it, vi } from "vitest";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";

const id = (suffix: number) =>
  `60000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = { tenant: id(1), user: id(2), role: id(3), branch: id(4), picking: id(5), line: id(6), product: id(7), location: id(8), lot: id(9) };

function createRepositories(options: { permission?: boolean; api?: boolean } = {}) {
  const getFefoPreview = vi.fn(async () => ({
    pickingOrderId: ids.picking,
    pickingLineId: ids.line,
    productId: ids.product,
    branchId: ids.branch,
    location: { id: ids.location, code: "A-01", name: "Estante" },
    currentPickedQuantity: 0,
    targetPickedQuantity: 5,
    incrementalQuantity: 5,
    existingSelections: [],
    incrementalAllocations: [{ locationId: ids.location, locationCode: "A-01", locationName: "Estante", lotId: ids.lot, lotNumber: "LOT-1", expirationDate: "2027-01-01", quantity: 5 }],
    resultingSelections: [],
    calculatedAt: "2026-10-19T12:00:00-06:00",
    provisional: true as const,
  }));
  const forbiddenMockRead = vi.fn();
  const repositories = {
    auth: {
      getCurrentSessionId: vi.fn(async () => "session"),
      getSession: vi.fn(async () => ({ id: "session", userId: ids.user, createdAt: "2026-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", rememberMe: false })),
    },
    users: { getById: vi.fn(async () => ({ id: ids.user, tenantId: ids.tenant, name: "Operador", email: "picker@example.com", type: "employee", status: "active", roleId: ids.role, allowedBranchIds: [ids.branch], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })) },
    roles: { getByIdScoped: vi.fn(async () => ({ id: ids.role, tenantId: ids.tenant, name: "Bodega", isSystem: false, permissions: options.permission === false ? ["logistics.picking.read"] : ["logistics.picking.start"], branchScope: "assigned", status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })) },
    branches: { getById: vi.fn(async () => ({ id: ids.branch, tenantId: ids.tenant, code: "B1", name: "Central", type: "store", status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" })) },
    pickingReadDataSource: options.api === false ? "mock" : "api",
    pickingRead: { getQueue: forbiddenMockRead, getDetail: forbiddenMockRead, getFefoPreview },
    picking: { getQueue: forbiddenMockRead },
  } as unknown as RepositoryRegistry;
  return { repositories, getFefoPreview, forbiddenMockRead };
}

describe("PickingApplicationService vista previa FEFO", () => {
  it("exige solo logistics.picking.start y consulta exclusivamente el repositorio API", async () => {
    const { repositories, getFefoPreview, forbiddenMockRead } = createRepositories();
    const result = await new PickingApplicationService(repositories).getFefoPreview(ids.branch, {
      pickingOrderId: ids.picking,
      pickingLineId: ids.line,
      productId: ids.product,
      locationId: ids.location,
      pickedQuantity: 5,
    });
    expect(result.incrementalQuantity).toBe(5);
    expect(getFefoPreview).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ids.tenant, branchId: ids.branch }),
      ids.picking,
      ids.line,
      { locationId: ids.location, pickedQuantity: 5 },
    );
    expect(forbiddenMockRead).not.toHaveBeenCalled();
  });

  it("deniega la consulta sin logistics.picking.start", async () => {
    const { repositories, getFefoPreview } = createRepositories({ permission: false });
    await expect(new PickingApplicationService(repositories).getFefoPreview(ids.branch, {
      pickingOrderId: ids.picking, pickingLineId: ids.line, productId: ids.product, locationId: ids.location, pickedQuantity: 5,
    })).rejects.toThrow("Picking access denied");
    expect(getFefoPreview).not.toHaveBeenCalled();
  });

  it("falla cerrado en modo mock sin consultar repositorios alternos", async () => {
    const { repositories, getFefoPreview, forbiddenMockRead } = createRepositories({ api: false });
    await expect(new PickingApplicationService(repositories).getFefoPreview(ids.branch, {
      pickingOrderId: ids.picking, pickingLineId: ids.line, productId: ids.product, locationId: ids.location, pickedQuantity: 5,
    })).rejects.toMatchObject({ status: 409, code: "PICKING_FEFO_PREVIEW_NOT_AVAILABLE" });
    expect(getFefoPreview).not.toHaveBeenCalled();
    expect(forbiddenMockRead).not.toHaveBeenCalled();
  });

  it("rechaza una respuesta perteneciente a otro producto o contexto", async () => {
    const { repositories, getFefoPreview } = createRepositories();
    getFefoPreview.mockResolvedValueOnce({
      ...(await getFefoPreview()),
      productId: id(99),
    });
    getFefoPreview.mockClear();

    await expect(new PickingApplicationService(repositories).getFefoPreview(ids.branch, {
      pickingOrderId: ids.picking,
      pickingLineId: ids.line,
      productId: ids.product,
      locationId: ids.location,
      pickedQuantity: 5,
    })).rejects.toMatchObject({ status: 502, code: "INVALID_BACKEND_RESPONSE" });
  });
});
