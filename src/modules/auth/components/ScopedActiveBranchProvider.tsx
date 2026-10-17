"use client";

import { type ReactNode, useCallback } from "react";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type { Branch } from "@/core/entities";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import { ActiveBranchProvider } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

/**
 * Conecta ActiveBranchProvider (shared, sin logica de negocio) con la fuente autoritativa de
 * alcance OPERATIVO: User.allowedBranchIds (canUserOperateBranch), no Role.branchScope -- un
 * User sin sucursales asignadas termina con la lista vacia ("Sin sucursales"), nunca con un
 * fallback a todas las sucursales del tenant. Deliberadamente ya no depende de `role`: esta
 * fuente es por-User, no por-Role (ver core/scopes/userBranchAccess.ts).
 */
export function ScopedActiveBranchProvider({ children }: { children: ReactNode }) {
  const { user } = useCurrentSession();
  // Identidad estable mientras no cambie el usuario: ActiveBranchProvider vuelve a filtrar la lista
  // ya cargada cuando cambia el predicado, y no debe hacerlo en cada render de este componente.
  const canAccessBranch = useCallback(
    (branch: Branch) => (user ? canUserOperateBranch(user, branch) : false),
    [user],
  );

  return (
    <ActiveBranchProvider tenantId={user?.tenantId ?? null} canAccessBranch={canAccessBranch}>
      {children}
    </ActiveBranchProvider>
  );
}
