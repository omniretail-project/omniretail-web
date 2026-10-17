import { describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  createDispatchOperationFingerprint,
  DispatchMutationCoordinator,
  shouldRetainDispatchOperationIdentity,
} from "@/modules/logistics/hooks/dispatchRequestIdentity";

const baseIdentity = {
  action: "confirm-order" as const,
  sessionId: "session-a",
  userId: "user-a",
  tenantId: "tenant-a",
  branchId: "branch-a",
  sourceType: "order" as const,
  sourceId: "order-a",
  payload: { carrierName: "Carrier", trackingNumber: "TRACK-1" },
};

describe("dispatch request identity", () => {
  it("includes action, security scope, resource and payload in the fingerprint", () => {
    const fingerprint = createDispatchOperationFingerprint(baseIdentity);

    expect(JSON.parse(fingerprint)).toEqual(baseIdentity);
    expect(createDispatchOperationFingerprint({ ...baseIdentity, branchId: "branch-b" })).not.toBe(fingerprint);
    expect(createDispatchOperationFingerprint({ ...baseIdentity, sessionId: "session-b" })).not.toBe(fingerprint);
    expect(createDispatchOperationFingerprint({ ...baseIdentity, userId: "user-b" })).not.toBe(fingerprint);
    expect(createDispatchOperationFingerprint({ ...baseIdentity, tenantId: "tenant-b" })).not.toBe(fingerprint);
    expect(createDispatchOperationFingerprint({ ...baseIdentity, sourceId: "order-b" })).not.toBe(fingerprint);
    expect(createDispatchOperationFingerprint({ ...baseIdentity, payload: { trackingNumber: "TRACK-2" } })).not.toBe(fingerprint);
    expect(createDispatchOperationFingerprint({
      ...baseIdentity,
      action: "confirm-transfer",
      sourceType: "transfer",
      payload: undefined,
    })).toContain('"payload":null');
  });

  it("allows one owner token and notifies subscribers on begin and finish", () => {
    const coordinator = new DispatchMutationCoordinator();
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribe(listener);

    const token = coordinator.beginRequest();
    expect(token).toBe(1);
    expect(coordinator.isRequestInFlight()).toBe(true);
    expect(coordinator.getRevision()).toBe(1);
    expect(coordinator.beginRequest()).toBeNull();
    expect(coordinator.finishRequest(999)).toBe(false);
    expect(coordinator.isRequestInFlight()).toBe(true);
    expect(coordinator.finishRequest(token!)).toBe(true);
    expect(coordinator.isRequestInFlight()).toBe(false);
    expect(coordinator.getRevision()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    coordinator.beginRequest();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("reuses uncertain identities, clears definitive ones and applies LRU retention", () => {
    const coordinator = new DispatchMutationCoordinator(2);

    expect(coordinator.getOrCreateOperationId("a", () => "operation-a")).toBe("operation-a");
    expect(coordinator.getOrCreateOperationId("b", () => "operation-b")).toBe("operation-b");
    expect(coordinator.getOrCreateOperationId("a", () => "unexpected")).toBe("operation-a");
    expect(coordinator.getOrCreateOperationId("c", () => "operation-c")).toBe("operation-c");
    expect(coordinator.retainedOperationCount()).toBe(2);
    expect(coordinator.getOrCreateOperationId("b", () => "operation-b-new")).toBe("operation-b-new");

    coordinator.markOperationDefinitive("a");
    expect(coordinator.getOrCreateOperationId("a", () => "operation-a-new")).toBe("operation-a-new");
  });

  it("rejects invalid retention limits", () => {
    expect(() => new DispatchMutationCoordinator(0)).toThrow(/positive integer/);
    expect(() => new DispatchMutationCoordinator(1.5)).toThrow(/positive integer/);
  });

  it.each([
    [new Error("unknown"), true],
    [new BackendRequestError("network", 0), true],
    [new BackendRequestError("timeout", 408), true],
    [new BackendRequestError("server", 500), true],
    [new BackendRequestError("unauthorized", 401), false],
    [new BackendRequestError("conflict", 409), false],
  ])("classifies whether an operation identity must be retained", (cause, expected) => {
    expect(shouldRetainDispatchOperationIdentity(cause)).toBe(expected);
  });
});
