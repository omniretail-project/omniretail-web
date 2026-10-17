import type { User } from "@/core/entities";
import { UserType } from "@/core/enums";

const CUSTOMER_PUBLIC_ROUTE_ROOTS = [
  "/",
  "/ayuda",
  "/carrito",
  "/catalogo",
  "/checkout",
  "/ofertas",
  "/pedido",
  "/tienda",
] as const;

function isRouteWithin(pathname: string, root: string): boolean {
  return root === "/" ? pathname === root : pathname === root || pathname.startsWith(`${root}/`);
}

export function isCustomerAccountPath(pathname: string): boolean {
  if (isRouteWithin(pathname, "/cuenta")) return true;
  return /^\/tienda\/[^/]+\/cuenta(\/|$)/.test(pathname);
}

/**
 * Simetrico por diseno: un Customer solo entra a /cuenta/*, y un Employee/Admin nunca entra a
 * /cuenta/* -- incluso si su Role tuviera, por error de configuracion, algun permiso
 * `customer.*` (posible si el catalogo de permisos se deriva completo para un role admin, ver
 * demoSeed). La navegacion Customer respeta User.type, no solo el permission set: un permiso
 * customer.* accidental en un Role de Employee nunca debe traducirse en acceso a /cuenta.
 */
export function canUserEnterPrivateRoute(user: User | null, pathname: string): boolean {
  if (!user) return true;
  const isCustomerRoute = isCustomerAccountPath(pathname);
  return user.type === UserType.customer ? isCustomerRoute : !isCustomerRoute;
}

export function isSafeCustomerReturnUrl(returnUrl: string, tenantSlug?: string): boolean {
  if (!returnUrl.startsWith("/") || returnUrl.startsWith("//")) return false;

  try {
    const url = new URL(returnUrl, "https://omniretail.local");
    if (url.origin !== "https://omniretail.local") return false;
    const isBaseSafe = isCustomerAccountPath(url.pathname) ||
      CUSTOMER_PUBLIC_ROUTE_ROOTS.some((root) => isRouteWithin(url.pathname, root));

    if (!isBaseSafe) return false;

    if (tenantSlug) {
      const tenantRoot = `/tienda/${encodeURIComponent(tenantSlug)}`;
      return isRouteWithin(url.pathname, tenantRoot);
    }
    return true;
  } catch {
    return false;
  }
}

export function resolvePostLoginDestination(user: User, returnUrl?: string, tenantSlug?: string): string {
  if (user.type !== UserType.customer) return "/inicio";
  if (returnUrl && isSafeCustomerReturnUrl(returnUrl, tenantSlug)) return returnUrl;
  return tenantSlug ? `/tienda/${encodeURIComponent(tenantSlug)}` : "/";
}
