import { describe, expect, it } from "vitest";
import {
  advanceDispatchReadContext,
  captureDispatchReadContext,
  createDispatchReadContext,
  isCurrentDispatchRead,
  readCurrentDispatchContextValue,
  removeConfirmedDispatchSource,
} from "@/modules/logistics/hooks/dispatchReadIdentity";

describe("dispatch read identity", () => {
  it("increments a monotonic generation across A -> B -> A", () => {
    const firstA = createDispatchReadContext("branch-a");
    const branchB = advanceDispatchReadContext(firstA, "branch-b");
    const secondA = advanceDispatchReadContext(branchB, "branch-a");

    expect(firstA.generation).toBe(0);
    expect(branchB).toEqual({ activeContextKey: "branch-b", generation: 1 });
    expect(secondA).toEqual({ activeContextKey: "branch-a", generation: 2 });
    expect(advanceDispatchReadContext(secondA, "branch-a")).toBe(secondA);
  });

  it("captures only the active context and rejects values from an older visit", () => {
    const firstA = createDispatchReadContext("branch-a");
    const firstToken = captureDispatchReadContext(firstA, "branch-a");
    expect(firstToken).not.toBeNull();
    expect(captureDispatchReadContext(firstA, "branch-b")).toBeNull();
    expect(captureDispatchReadContext(firstA, null)).toBeNull();

    const staleValue = { ...firstToken!, value: "old-detail" };
    expect(readCurrentDispatchContextValue(staleValue, firstA, "branch-a")).toBe("old-detail");

    const secondA = advanceDispatchReadContext(
      advanceDispatchReadContext(firstA, "branch-b"),
      "branch-a",
    );
    expect(readCurrentDispatchContextValue(staleValue, secondA, "branch-a")).toBeNull();
    expect(readCurrentDispatchContextValue(staleValue, firstA, "branch-b")).toBeNull();
    expect(readCurrentDispatchContextValue(null, firstA, "branch-a")).toBeNull();
  });

  it("requires matching sequence, generation, context and selected order", () => {
    const current = {
      sequence: 3,
      currentSequence: 3,
      requestedContextKey: "branch-a",
      activeContextKey: "branch-a",
      requestedContextGeneration: 2,
      activeContextGeneration: 2,
      requestedOrderId: "order-a",
      selectedOrderId: "order-a",
    };

    expect(isCurrentDispatchRead(current)).toBe(true);
    expect(isCurrentDispatchRead({ ...current, currentSequence: 4 })).toBe(false);
    expect(isCurrentDispatchRead({ ...current, activeContextKey: "branch-b" })).toBe(false);
    expect(isCurrentDispatchRead({ ...current, activeContextGeneration: 3 })).toBe(false);
    expect(isCurrentDispatchRead({ ...current, selectedOrderId: "order-b" })).toBe(false);
    expect(isCurrentDispatchRead({ ...current, requestedOrderId: undefined })).toBe(true);
  });

  it("removes only the confirmed source with the matching type and id", () => {
    const queue = [
      { sourceType: "order" as const, sourceId: "shared" },
      { sourceType: "transfer" as const, sourceId: "shared" },
      { sourceType: "order" as const, sourceId: "other" },
    ];

    expect(removeConfirmedDispatchSource(queue, "order", "shared")).toEqual([
      queue[1],
      queue[2],
    ]);
  });
});
