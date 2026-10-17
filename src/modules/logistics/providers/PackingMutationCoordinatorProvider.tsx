"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { PackingMutationCoordinator } from "@/modules/logistics/hooks/packingRequestIdentity";

const PackingMutationCoordinatorContext = createContext<PackingMutationCoordinator | null>(null);

export class PackingMutationSessionScope {
  readonly coordinator = new PackingMutationCoordinator();

  constructor(
    readonly identity: { sessionId: string; userId: string; tenantId: string },
  ) {}
}

export function PackingMutationCoordinatorProvider({ children }: { children: ReactNode }) {
  const { sessionId, user } = useCurrentSession();
  const userId = user?.id ?? null;
  const tenantId = user?.tenantId ?? null;
  const sessionScope = useMemo(
    () => sessionId && userId && tenantId
      ? new PackingMutationSessionScope({ sessionId, userId, tenantId })
      : null,
    [sessionId, tenantId, userId],
  );

  return (
    <PackingMutationCoordinatorContext.Provider value={sessionScope?.coordinator ?? null}>
      {children}
    </PackingMutationCoordinatorContext.Provider>
  );
}

export function usePackingMutationCoordinator(): PackingMutationCoordinator {
  const coordinator = useContext(PackingMutationCoordinatorContext);
  if (!coordinator) {
    throw new Error("Packing mutations require an authenticated session scope.");
  }
  return coordinator;
}
