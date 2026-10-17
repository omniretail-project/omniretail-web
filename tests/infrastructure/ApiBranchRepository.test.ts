import { afterEach, describe, expect, it, vi } from "vitest";
import { toSessionBranch } from "@/infrastructure/api/apiBranchMapper";
import { ApiBranchRepository } from "@/infrastructure/api/ApiBranchRepository";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";

const TENANT = "tenant-1";

function createEventBus() {
  const handlers = new Map<string, () => void>();
  const eventBus = {
    subscribe: vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
    emit: vi.fn(),
  } as unknown as DataEventBus;
  return { eventBus, handlers };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("toSessionBranch", () => {
  it("completa tenant y fechas cuando la respuesta acotada no los trae", () => {
    expect(
      toSessionBranch(
        { id: "b1", code: "CEN", name: "Centro", type: "store", status: "active" },
        TENANT,
        "2026-10-08T00:00:00.000Z",
      ),
    ).toEqual({
      id: "b1",
      tenantId: TENANT,
      code: "CEN",
      name: "Centro",
      type: "store",
      status: "active",
      address: undefined,
      phone: undefined,
      email: undefined,
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
    });
  });

  it("respeta los datos que si vienen en la respuesta", () => {
    const branch = toSessionBranch(
      {
        id: "b1",
        tenantId: "otro",
        code: "CEN",
        name: "Centro",
        type: "store",
        status: "active",
        address: "Zona 1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
      },
      TENANT,
      "2026-10-08T00:00:00.000Z",
    );

    expect(branch).toMatchObject({
      tenantId: "otro",
      address: "Zona 1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
  });
});

describe("ApiBranchRepository.getAssignedActive", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lee /api/auth/session/branches (BFF) y mapea las sucursales", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse([{ id: "b1", code: "CEN", name: "Centro", type: "store", status: "active" }]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const branches = await new ApiBranchRepository(createEventBus().eventBus).getAssignedActive(TENANT);

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session/branches", {
      credentials: "same-origin",
      cache: "no-store",
    });
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({ id: "b1", tenantId: TENANT, name: "Centro" });
  });

  it("lanza BackendRequestError con el status si el backend rechaza la lectura", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 403)));

    const error = await new ApiBranchRepository(createEventBus().eventBus)
      .getAssignedActive(TENANT)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BackendRequestError);
    expect((error as BackendRequestError).status).toBe(403);
  });

  it("cachea la lectura y la invalida con branch.changed y auth.changed", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      jsonResponse([{ id: "b1", code: "CEN", name: "Centro", type: "store", status: "active" }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { eventBus, handlers } = createEventBus();
    const repository = new ApiBranchRepository(eventBus);

    await repository.getAssignedActive(TENANT);
    await repository.getAssignedActive(TENANT);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    handlers.get("branch.changed")?.();
    await repository.getAssignedActive(TENANT);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    handlers.get("auth.changed")?.();
    await repository.getAssignedActive(TENANT);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("solo se ejecuta en el navegador: sin window falla sin llamar al backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", undefined);

    await expect(
      new ApiBranchRepository(createEventBus().eventBus).getAssignedActive(TENANT),
    ).rejects.toThrow("solo se pueden leer desde el navegador");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
