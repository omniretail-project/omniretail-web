import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiDispatchRepository } from "@/infrastructure/api/repositories/ApiDispatchRepository";
import { withApiLogisticsDispatch } from "@/infrastructure/api/withApiLogisticsDispatch";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ids,
  orderQueueModel,
  orderResult,
  preparedModel,
  transferQueueModel,
  transferResult,
} from "./dispatchFixtures";

const scope = { tenantId: ids.tenant, branchId: ids.branchA };

describe("ApiDispatchRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls every read endpoint with the authorized branch scope", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/prepared?branchId=" + ids.branchA)) {
        return Response.json(preparedModel);
      }
      if (url.includes("/transfers/")) return Response.json(transferResult);
      if (url === `/api/backend/logistics/dispatch?branchId=${ids.branchA}`) {
        return Response.json([orderQueueModel, transferQueueModel]);
      }
      return Response.json(orderResult);
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiDispatchRepository();

    await expect(repository.getQueue(scope)).resolves.toHaveLength(2);
    await expect(repository.getPreparedDetail(scope, ids.order)).resolves.toMatchObject({
      orderId: ids.order,
      packingStatus: "finalized",
    });
    await expect(repository.getDetail(scope, ids.order)).resolves.toMatchObject({
      sourceType: "order",
    });
    await expect(repository.getTransferDetail(scope, ids.transfer)).resolves.toMatchObject({
      sourceType: "transfer",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/backend/logistics/dispatch?branchId=${ids.branchA}`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/backend/logistics/dispatch/${ids.order}/prepared?branchId=${ids.branchA}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/backend/logistics/dispatch/${ids.order}?branchId=${ids.branchA}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `/api/backend/logistics/dispatch/transfers/${ids.transfer}?branchId=${ids.branchA}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends validated command bodies to both confirmation endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(String(input).includes("/transfers/") ? transferResult : orderResult));
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiDispatchRepository();

    await repository.confirmOrder(scope, ids.order, {
      operationId: " operation-order ",
      carrierName: " Carrier ",
      trackingNumber: " TRACK-1 ",
    });
    await repository.confirmTransfer(scope, ids.transfer, {
      operationId: " operation-transfer ",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/backend/logistics/dispatch/${ids.order}/confirm?branchId=${ids.branchA}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          operationId: "operation-order",
          carrierName: "Carrier",
          trackingNumber: "TRACK-1",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/backend/logistics/dispatch/transfers/${ids.transfer}/confirm?branchId=${ids.branchA}`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ operationId: "operation-transfer" }),
      }),
    );
  });

  it.each([401, 403, 404, 409, 500])("preserves HTTP %s errors", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { code: `DISPATCH_${status}`, message: `Error ${status}` },
      { status },
    )));

    await expect(new ApiDispatchRepository().getQueue(scope)).rejects.toMatchObject({
      status,
      code: `DISPATCH_${status}`,
    });
  });

  it("normalizes network failures and rejects invalid identifiers before fetch", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    const repository = new ApiDispatchRepository();

    await expect(repository.getQueue(scope)).rejects.toMatchObject({ status: 0 });
    await expect(repository.getDetail(scope, "not-a-uuid")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects backend payloads that violate the Dispatch response contract", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ invalid: true }])));

    await expect(new ApiDispatchRepository().getQueue(scope)).rejects.toMatchObject({
      status: 502,
      code: "INVALID_BACKEND_RESPONSE",
    });
  });

  it("installs one API adapter for reads and commands without replacing legacy Dispatch", () => {
    const legacyDispatches = { marker: "legacy" };
    const original = {
      dispatchReadDataSource: "mock",
      dispatches: legacyDispatches,
    } as unknown as RepositoryRegistry;

    const wrapped = withApiLogisticsDispatch(original);

    expect(wrapped.dispatchReadDataSource).toBe("api");
    expect(wrapped.dispatchRead).toBeInstanceOf(ApiDispatchRepository);
    expect(wrapped.dispatchCommands).toBe(wrapped.dispatchRead);
    expect(wrapped.dispatches).toBe(legacyDispatches);
    expect(original.dispatchReadDataSource).toBe("mock");
  });
});
