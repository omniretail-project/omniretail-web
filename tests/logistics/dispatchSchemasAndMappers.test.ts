import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  parseApiDispatchQueue,
  parseApiDispatchResult,
  parseApiPreparedDispatch,
  parseConfirmDispatchCommand,
  parseConfirmTransferDispatchCommand,
} from "@/infrastructure/api/repositories/dispatchApi.schema";
import {
  toApiDispatchResultDto,
  toDispatchQueueItemDto,
  toPreparedDispatchDetailDto,
} from "@/modules/logistics/application/mappers/DispatchApiMapper";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

const orderQueueItem = {
  orderId: id(1),
  orderReference: "ORD-100",
  createdAt: "2026-10-08T14:00:00Z",
  transportMode: "third_party",
  packingId: id(2),
  packingFinalizedAt: "2026-10-08T15:00:00Z",
  sourceType: "order",
  sourceId: id(1),
  sourceReference: "ORD-100",
};

const transferQueueItem = {
  ...orderQueueItem,
  orderId: null,
  orderReference: null,
  transportMode: "own_fleet",
  sourceType: "transfer",
  sourceId: id(3),
  sourceReference: "TRF-100",
};

const preparedDetail = {
  orderId: id(1),
  orderReference: "ORD-100",
  createdAt: "2026-10-08T14:00:00Z",
  orderStatus: "ready_for_dispatch",
  recipientName: null,
  recipientPhone: null,
  deliveryAddress: { line1: "Zona 1", customBackendField: "preserved" },
  notificationContact: { emailMode: "send", email: "customer@example.com" },
  transportMode: "third_party",
  pickingOrderId: id(4),
  pickingStatus: "completed",
  pickingCompletedAt: "2026-10-08T14:30:00Z",
  packingId: id(2),
  packingStatus: "finalized",
  packingFinalizedAt: "2026-10-08T15:00:00Z",
  packageCount: 2,
  totalWeight: 3.125,
  labelCode: "LBL-ORD-100",
};

const orderResult = {
  orderId: id(1),
  orderStatus: "dispatched",
  dispatchId: id(5),
  dispatchStatus: "dispatched",
  transportMode: "third_party",
  carrierName: "Carrier",
  trackingNumber: "TRACK-1",
  dispatchedAt: "2026-10-08T16:00:00Z",
  packages: [{ id: id(6), number: "PKG-1", weight: 3.125, description: null }],
  idempotent: false,
  sourceType: "order",
  sourceId: id(1),
  sourceReference: "ORD-100",
  transferStatus: null,
};

describe("Dispatch API schemas and mappers", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses and maps a mixed queue without changing its source identity", () => {
    const queue = parseApiDispatchQueue([orderQueueItem, transferQueueItem]);

    expect(queue).toHaveLength(2);
    expect(toDispatchQueueItemDto(queue[0]!)).toEqual(queue[0]);
    expect(queue[1]).toMatchObject({ sourceType: "transfer", orderId: null });
  });

  it("rejects queue records that mix order and transfer contracts", () => {
    expectInvalidResponse(() => parseApiDispatchQueue([{ ...transferQueueItem, orderId: id(1) }]));
    expectInvalidResponse(() => parseApiDispatchQueue([{ ...orderQueueItem, orderReference: null }]));
  });

  it("normalizes the prepared address and maps all notification contact variants", () => {
    const parsed = parseApiPreparedDispatch(preparedDetail);
    expect(parsed.recipientName).toBeNull();
    expect(parsed.deliveryAddress).toMatchObject({
      line1: "Zona 1",
      city: null,
      recipientPhone: null,
      customBackendField: "preserved",
    });

    expect(toPreparedDispatchDetailDto(parsed)).toMatchObject({
      recipientName: null,
      address: { line1: "Zona 1", city: null },
      notificationContact: { emailMode: "send", email: "customer@example.com" },
    });
    expect(toPreparedDispatchDetailDto(parseApiPreparedDispatch({
      ...preparedDetail,
      deliveryAddress: null,
      notificationContact: { emailMode: "not_applicable" },
    }))).toMatchObject({ address: null, notificationContact: { emailMode: "not_applicable" } });
    expect(toPreparedDispatchDetailDto(parseApiPreparedDispatch({
      ...preparedDetail,
      notificationContact: { emailMode: "send", email: "" },
    })).notificationContact).toEqual({ emailMode: "legacy_unknown" });
  });

  it("rejects invalid prepared-state invariants", () => {
    expectInvalidResponse(() => parseApiPreparedDispatch({ ...preparedDetail, packageCount: 0 }));
    expectInvalidResponse(() => parseApiPreparedDispatch({ ...preparedDetail, packingStatus: "in_progress" }));
  });

  it("parses order and transfer results and clones package DTOs", () => {
    const parsedOrder = parseApiDispatchResult(orderResult);
    const mappedOrder = toApiDispatchResultDto(parsedOrder);
    expect(mappedOrder).toEqual(parsedOrder);
    expect(mappedOrder.packages).not.toBe(parsedOrder.packages);
    expect(mappedOrder.packages[0]).not.toBe(parsedOrder.packages[0]);

    const transfer = parseApiDispatchResult({
      ...orderResult,
      orderId: null,
      orderStatus: null,
      transportMode: "own_fleet",
      carrierName: null,
      trackingNumber: null,
      sourceType: "transfer",
      sourceId: id(3),
      sourceReference: "TRF-100",
      transferStatus: "inTransit",
    });
    expect(transfer).toMatchObject({ sourceType: "transfer", transferStatus: "inTransit" });
  });

  it("rejects incompatible result discriminators", () => {
    expectInvalidResponse(() => parseApiDispatchResult({ ...orderResult, transferStatus: "inTransit" }));
    expectInvalidResponse(() => parseApiDispatchResult({
      ...orderResult,
      sourceType: "transfer",
      orderId: null,
      orderStatus: null,
      transferStatus: null,
    }));
  });

  it("trims and validates order and transfer commands", () => {
    expect(parseConfirmDispatchCommand({
      operationId: " operation-order ",
      carrierName: " Carrier ",
      trackingNumber: " TRACK-1 ",
      packages: [{ number: " PKG-1 ", weight: 1.5, description: " Box " }],
    })).toEqual({
      operationId: "operation-order",
      carrierName: "Carrier",
      trackingNumber: "TRACK-1",
      packages: [{ number: "PKG-1", weight: 1.5, description: "Box" }],
    });
    expect(parseConfirmTransferDispatchCommand({ operationId: " operation-transfer " })).toEqual({
      operationId: "operation-transfer",
    });
    expect(() => parseConfirmDispatchCommand({ operationId: " " })).toThrow();
    expect(() => parseConfirmDispatchCommand({
      operationId: "operation-order",
      packages: [{ number: "PKG-1", weight: 0 }],
    })).toThrow();
    expect(() => parseConfirmTransferDispatchCommand({ operationId: "x".repeat(129) })).toThrow();
  });
});

function expectInvalidResponse(action: () => unknown) {
  try {
    action();
  } catch (cause) {
    expect(cause).toBeInstanceOf(BackendRequestError);
    expect(cause).toMatchObject({ status: 502, code: "INVALID_BACKEND_RESPONSE" });
    return;
  }
  throw new Error("Expected Dispatch response parsing to fail.");
}
