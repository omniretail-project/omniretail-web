"use client";

import type { ReactNode } from "react";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { EntitlementProvider } from "@/shared/providers/EntitlementProvider";

/**
 * Conecta EntitlementProvider (shared) con el tenant de la sesion ya resuelta por
 * CurrentSessionProvider, evitando una segunda resolucion de sesion dentro del arbol privado.
 */
export function ScopedEntitlementProvider({ children }: { children: ReactNode }) {
  const { user } = useCurrentSession();

  return <EntitlementProvider tenantId={user?.tenantId ?? null}>{children}</EntitlementProvider>;
}
