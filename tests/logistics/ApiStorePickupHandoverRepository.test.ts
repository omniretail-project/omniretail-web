import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiStorePickupHandoverRepository } from "@/infrastructure/api/repositories/ApiStorePickupHandoverRepository";
import { withApiStorePickupHandover } from "@/infrastructure/api/withApiStorePickupHandover";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

const id = (suffix: number) =>
  `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const ids = { branch: id(1), order: id(2) };
const deliveredAt = "2026-10-18T16:30:00-06:00";

describe("ApiStorePickupHandoverRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("confirma la entrega con POST, branchId y sin body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      orderId: ids.order,
      status: "delivered",
      deliveredAt,
      idempotent: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ApiStorePickupHandoverRepository().confirm({ branchId: ids.branch }, ids.order),
    ).resolves.toEqual({
      orderId: ids.order,
      status: "delivered",
      deliveredAt,
      idempotent: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backend/logistics/pickups/${ids.order}/handover?branchId=${ids.branch}`,
      expect.objectContaining({
        method: "POST",
        body: undefined,
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual({ Accept: "application/json" });
  });

  it("acepta una respuesta idempotente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      orderId: ids.order,
      status: "delivered",
      deliveredAt,
      idempotent: true,
    })));

    await expect(
      new ApiStorePickupHandoverRepository().confirm({ branchId: ids.branch }, ids.order),
    ).resolves.toMatchObject({ idempotent: true, status: "delivered" });
  });

  it.each([
    ["orderId", { orderId: "not-a-uuid" }],
    ["status", { status: "ready_for_pickup" }],
    ["deliveredAt", { deliveredAt: "2026-10-18T16:30:00" }],
    ["idempotent", { idempotent: "false" }],
    ["campo desconocido", { unexpected: true }],
  ])("rechaza una respuesta con %s invalido", async (_caseName, patch) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      orderId: ids.order,
      status: "delivered",
      deliveredAt,
      idempotent: false,
      ...patch,
    })));

    await expect(
      new ApiStorePickupHandoverRepository().confirm({ branchId: ids.branch }, ids.order),
    ).rejects.toMatchObject({ status: 502, code: "INVALID_BACKEND_RESPONSE" });
  });

  it.each([400, 401, 403, 404, 409, 429, 500])(
    "propaga el error HTTP %s",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn(async () => Response.json(
        { code: `PICKUP_${status}`, message: `Error ${status}` },
        { status },
      )));

      await expect(
        new ApiStorePickupHandoverRepository().confirm({ branchId: ids.branch }, ids.order),
      ).rejects.toMatchObject({ status, code: `PICKUP_${status}`, message: `Error ${status}` });
    },
  );

  it("normaliza errores de red y rechaza UUID invalidos antes de fetch", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiStorePickupHandoverRepository();

    await expect(repository.confirm({ branchId: ids.branch }, ids.order)).rejects.toMatchObject({
      status: 0,
    });
    await expect(repository.confirm({ branchId: "branch-1" }, ids.order)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_UUID",
    });
    await expect(repository.confirm({ branchId: ids.branch }, "order-1")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_UUID",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("instala el comando API sin sustituir ni usar el repositorio mock de entregas", async () => {
    const mockConfirm = vi.fn();
    const storePickupDeliveries = {
      marker: "mock-store-pickup-deliveries",
      confirm: mockConfirm,
    };
    const original = { storePickupDeliveries } as unknown as RepositoryRegistry;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      orderId: ids.order,
      status: "delivered",
      deliveredAt,
      idempotent: false,
    })));

    const wrapped = withApiStorePickupHandover(original);
    await wrapped.storePickupHandoverCommands!.confirm({ branchId: ids.branch }, ids.order);

    expect(wrapped.storePickupHandoverCommands).toBeInstanceOf(
      ApiStorePickupHandoverRepository,
    );
    expect(wrapped.storePickupDeliveries).toBe(storePickupDeliveries);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(original.storePickupHandoverCommands).toBeUndefined();
  });
});
