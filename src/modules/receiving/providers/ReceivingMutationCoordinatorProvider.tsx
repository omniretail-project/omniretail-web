"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { ReceivingMutationCoordinator } from "@/modules/receiving/hooks/receivingRequestIdentity";

const ReceivingMutationCoordinatorContext = createContext<ReceivingMutationCoordinator | null>(
  null,
);

export function ReceivingMutationCoordinatorProvider({ children }: { children: ReactNode }) {
  const { sessionId, user } = useCurrentSession();
  const userId = user?.id ?? null;
  const tenantId = user?.tenantId ?? null;
  const coordinator = useMemo(
    () => sessionId && userId && tenantId ? new ReceivingMutationCoordinator() : null,
    [sessionId, tenantId, userId],
  );

  return (
    <ReceivingMutationCoordinatorContext.Provider value={coordinator}>
      {children}
    </ReceivingMutationCoordinatorContext.Provider>
  );
}

export function useReceivingMutationCoordinator(): ReceivingMutationCoordinator {
  const coordinator = useContext(ReceivingMutationCoordinatorContext);
  if (!coordinator) {
    throw new Error("Receiving mutations require an authenticated session scope.");
  }
  useSyncExternalStore(coordinator.subscribe, coordinator.getRevision, coordinator.getRevision);
  return coordinator;
}
