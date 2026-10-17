import type { PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DispatchMutationCoordinatorProvider,
  DispatchMutationSessionScope,
  useDispatchMutationCoordinator,
} from "@/modules/logistics/providers/DispatchMutationCoordinatorProvider";
import { ids } from "./dispatchFixtures";

const mocks = vi.hoisted(() => ({
  session: {} as {
    sessionId: string | null;
    user: { id: string; tenantId: string } | null;
  },
}));

vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => mocks.session,
}));

function Wrapper({ children }: PropsWithChildren) {
  return (
    <DispatchMutationCoordinatorProvider>
      {children}
    </DispatchMutationCoordinatorProvider>
  );
}

describe("DispatchMutationCoordinatorProvider", () => {
  beforeEach(() => {
    mocks.session = {
      sessionId: "session-a",
      user: { id: ids.user, tenantId: ids.tenant },
    };
  });

  it("creates a stable coordinator for one authenticated scope", () => {
    const { result, rerender } = renderHook(() => useDispatchMutationCoordinator(), {
      wrapper: Wrapper,
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    expect(result.current.isRequestInFlight()).toBe(false);
  });

  it("replaces the coordinator when session, user or tenant changes", () => {
    const { result, rerender } = renderHook(() => useDispatchMutationCoordinator(), {
      wrapper: Wrapper,
    });
    const first = result.current;

    mocks.session = {
      sessionId: "session-b",
      user: { id: ids.user, tenantId: ids.tenant },
    };
    rerender();
    const second = result.current;
    expect(second).not.toBe(first);

    mocks.session = {
      sessionId: "session-b",
      user: { id: "user-b", tenantId: "tenant-b" },
    };
    rerender();
    expect(result.current).not.toBe(second);
  });

  it("subscribes React consumers to coordinator state changes", () => {
    const { result } = renderHook(() => {
      const coordinator = useDispatchMutationCoordinator();
      return { coordinator, revision: coordinator.getRevision() };
    }, { wrapper: Wrapper });

    act(() => {
      result.current.coordinator.beginRequest();
    });
    expect(result.current.revision).toBe(1);
    expect(result.current.coordinator.isRequestInFlight()).toBe(true);

    act(() => {
      result.current.coordinator.finishRequest(1);
    });
    expect(result.current.revision).toBe(2);
    expect(result.current.coordinator.isRequestInFlight()).toBe(false);
  });

  it("fails closed when there is no authenticated scope", () => {
    mocks.session = { sessionId: null, user: null };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderHook(() => useDispatchMutationCoordinator(), {
      wrapper: Wrapper,
    })).toThrow("Dispatch mutations require an authenticated session scope");
  });

  it("retains the immutable identity carried by a session scope", () => {
    const scope = new DispatchMutationSessionScope({
      sessionId: "session-a",
      userId: ids.user,
      tenantId: ids.tenant,
    });

    expect(scope.identity).toEqual({
      sessionId: "session-a",
      userId: ids.user,
      tenantId: ids.tenant,
    });
    expect(scope.coordinator.isRequestInFlight()).toBe(false);
  });
});
