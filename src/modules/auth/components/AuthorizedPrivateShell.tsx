"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { EMPLOYEE_HOME_ACCESS_PERMISSION, hasEmployeeHomeAccess } from "@/modules/auth/permissions";
import { PrivateShell } from "@/shared/navigation/PrivateShell";
import type { NavigationItem } from "@/shared/types/navigation.types";

interface AuthorizedPrivateShellProps {
  children: ReactNode;
  navigationItems: NavigationItem[];
}

/**
 * Conecta el PrivateShell (shared, sin logica de negocio) con los permisos
 * reales de la sesion autenticada -- misma fuente (Role.permissions via
 * permissions/hasPermission, mas el permission sintetico de /inicio) que
 * usa RequirePermission para bloquear rutas, para que sidebar y
 * autorizacion de rutas nunca queden desincronizados.
 *
 * Tambien provee el contenido real del UserMenu (nombre/correo de la
 * sesion) y el handler de logout -- UserMenu/PrivateHeader/PrivateShell
 * siguen siendo puramente presentacionales, reciben todo por props.
 */
export function AuthorizedPrivateShell({ children, navigationItems }: AuthorizedPrivateShellProps) {
  const { permissions, user } = useCurrentSession();
  const repositories = useRepositories();
  const router = useRouter();
  const pathname = usePathname();

  const allowedPermissions = useMemo(() => {
    const set = new Set(permissions);
    if (hasEmployeeHomeAccess(user, permissions)) {
      set.add(EMPLOYEE_HOME_ACCESS_PERMISSION);
    }
    return set;
  }, [permissions, user]);

  const handleLogout = useCallback(async () => {
    try {
      const sessionId = await repositories.auth.getCurrentSessionId();
      if (sessionId) {
        await repositories.auth.logout(sessionId);
      }
    } finally {
      // La revocacion remota (logout(), arriba) puede fallar antes de
      // llegar a limpiar nada -- pero el navegador nunca debe conservar
      // una credencial local utilizable pase lo que pase con ese intento.
      // clearLocalSession() no depende de que logout() haya llegado a
      // ejecutarse ni de que haya tenido exito: es la garantia de ultimo
      // recurso, y la navegacion a /iniciar-sesion ocurre siempre despues.
      await repositories.auth.clearLocalSession();
      router.replace("/iniciar-sesion");
    }
  }, [repositories, router]);

  const showBranchSelector = !pathname.startsWith("/administracion");

  return (
    <PrivateShell
      allowedPermissions={allowedPermissions}
      navigationItems={navigationItems}
      onLogout={handleLogout}
      showBranchSelector={showBranchSelector}
      userMenuDescription={user?.email}
      userMenuLabel={user?.name}
    >
      {children}
    </PrivateShell>
  );
}
