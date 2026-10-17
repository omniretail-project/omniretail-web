"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { DispatchMutationCoordinator } from "@/modules/logistics/hooks/dispatchRequestIdentity";

const DispatchMutationCoordinatorContext = createContext<DispatchMutationCoordinator | null>(null);

export class DispatchMutationSessionScope {
  readonly coordinator = new DispatchMutationCoordinator();

  constructor(
    readonly identity: { sessionId: string; userId: string; tenantId: string },
  ) {}
}

export function DispatchMutationCoordinatorProvider({ children }: { children: ReactNode }) {
  const { sessionId, user } = useCurrentSession();
  const userId = user?.id ?? null;
  const tenantId = user?.tenantId ?? null;
  const sessionScope = useMemo(
    () => sessionId && userId && tenantId
      ? new DispatchMutationSessionScope({ sessionId, userId, tenantId })
      : null,
    [sessionId, tenantId, userId],
  );

  return (
    <DispatchMutationCoordinatorContext.Provider value={sessionScope?.coordinator ?? null}>
      {children}
    </DispatchMutationCoordinatorContext.Provider>
  );
}

export function useDispatchMutationCoordinator(): DispatchMutationCoordinator {
  const coordinator = useContext(DispatchMutationCoordinatorContext);
  if (!coordinator) {
    throw new Error("Dispatch mutations require an authenticated session scope.");
  }
  useSyncExternalStore(coordinator.subscribe, coordinator.getRevision, coordinator.getRevision);
  return coordinator;
}
