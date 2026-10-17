"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { navigationConfig } from "@/config/navigation";
import { UserType } from "@/core/enums";
import { canUserEnterPrivateRoute } from "@/modules/auth/application/services/postLoginNavigation";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { EMPLOYEE_HOME_ACCESS_PERMISSION, hasEmployeeHomeAccess } from "@/modules/auth/permissions";
import { isNavigationItemActive, isNavigationItemEntitled, isNavigationItemPermitted } from "@/shared/navigation/Sidebar";
import type { NavigationItem } from "@/shared/types/navigation.types";
import { useEntitlementContext } from "@/shared/providers/EntitlementProvider";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";

/**
 * Rutas privadas que solo exigen sesion valida, sin permiso operacional.
 * Lista explicita y minima -- NUNCA "cualquier ruta sin permission
 * declarado se permite". Todo lo demas que no resuelva un permiso real
 * en navigationConfig queda denegado por defecto (fail-closed), incluidas
 * rutas nuevas/dinamicas que accidentalmente no se hayan registrado.
 *
 * /cuenta NO esta aca (ver CUENTA_REDIRECT_ROUTE abajo -- necesita
 * matching EXACTO, no por prefijo, algo que esta lista no puede expresar
 * sin abrir tambien /cuenta/*). Vacio hoy, se deja el mecanismo por si
 * una ruta genuinamente sin permiso operacional lo necesita a futuro.
 */
const SESSION_ONLY_ROUTES: string[] = [];

function isSessionOnlyRoute(pathname: string): boolean {
  return SESSION_ONLY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * PR11 reestructuro customerNavigation en un grupo "Mi cuenta" sin href
 * propio + 4 hijos (/cuenta/perfil, /cuenta/direcciones, etc.), cada uno
 * con SU permiso especifico -- a proposito, para que
 * findRequiredPermission (mas abajo, primer-match sobre el arbol) pueda
 * distinguir "customer.account.read" de "customer.address.manage" por
 * ruta. Eso significa que "/cuenta" (bare, sin sub-ruta) ya no resuelve
 * NINGUN permiso: no tiene item propio, y agregarle uno con
 * href="/cuenta" rompería la resolucion de los 4 hijos (su matching por
 * prefijo lo intercepta ANTES de llegar a cualquier hijo, sin importar
 * el orden -- findRequiredPermission no tiene nocion de "el match mas
 * especifico gana").
 *
 * "/cuenta" (src/app/(public)/(accessible)/cuenta/page.tsx) solo hace
 * redirect("/cuenta/perfil") -- nunca renderiza contenido propio. Por
 * eso se permite aca de forma EXPLICITA y EXACTA (nunca por prefijo,
 * a diferencia de SESSION_ONLY_ROUTES) a cualquier sesion valida: la
 * ruta real de destino, /cuenta/perfil, sigue exigiendo su propio
 * permiso normalmente una vez completado el redirect. Este componente
 * se usa tanto desde (private)/layout.tsx (rutas de backoffice) como
 * desde (public)/(accessible)/cuenta/layout.tsx (Mi Cuenta de Customer)
 * -- la resolucion de permisos es la misma independientemente de bajo
 * que route group fisico viva la pagina, porque solo depende del
 * pathname.
 */
const CUENTA_REDIRECT_ROUTE = "/cuenta";

function findRequiredPermissionItem(
  items: NavigationItem[],
  pathname: string,
): NavigationItem | undefined {
  for (const item of items) {
    if (item.href && isNavigationItemActive(pathname, item.href)) {
      return item;
    }
    if (item.children) {
      const child = findRequiredPermissionItem(item.children, pathname);
      if (child !== undefined) return child;
    }
  }
  return undefined;
}

/**
 * Boundary de autorizacion por ruta, fail-closed por defecto: una ruta
 * privada sin item de navegacion asociado, o cuyo item no resuelve un
 * permiso concedido, se deniega -- nunca se permite por "no encontre
 * permission". Reutiliza la MISMA fuente que Sidebar (navigationConfig +
 * isNavigationItemActive), asi que un item nuevo agregado ahi queda
 * protegido automaticamente sin tocar este archivo.
 *
 * /inicio usa el permission sintetico EMPLOYEE_HOME_ACCESS_PERMISSION
 * (ver modules/auth/permissions.ts) -- mismo mecanismo, sin caso especial
 * duplicado entre sidebar y guard de rutas. /cuenta (exacto) usa el
 * mismo espiritu: ver CUENTA_REDIRECT_ROUTE arriba.
 */
export function normalizeCustomerPermissionPathname(pathname: string): string {
  const tenantMatch = pathname.match(/^\/tienda\/[^/]+(\/cuenta(?:$|\/.*))/);
  if (tenantMatch) {
    return tenantMatch[1] === "/cuenta/" ? "/cuenta" : tenantMatch[1];
  }
  return pathname;
}

export function RequirePermission({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { permissions, user } = useCurrentSession();
  const { hasCapability } = useEntitlementContext();

  if (!canUserEnterPrivateRoute(user, pathname)) {
    return <AccessDeniedState />;
  }

  // Normalize dynamic tenant Customer account paths to legacy global paths for permission resolution
  const resolvePathname = user?.type === UserType.customer
    ? normalizeCustomerPermissionPathname(pathname)
    : pathname;

  if (resolvePathname === CUENTA_REDIRECT_ROUTE || isSessionOnlyRoute(resolvePathname)) {
    return <>{children}</>;
  }

  const requiredItem = findRequiredPermissionItem(navigationConfig, resolvePathname);
  const isAllowed =
    requiredItem?.permission === EMPLOYEE_HOME_ACCESS_PERMISSION
      ? hasEmployeeHomeAccess(user, permissions)
      : requiredItem
        ? isNavigationItemPermitted(requiredItem, new Set(permissions)) &&
          isNavigationItemEntitled(requiredItem, hasCapability)
        : false;

  return isAllowed ? <>{children}</> : <AccessDeniedState />;
}
