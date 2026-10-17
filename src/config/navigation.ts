import { isPublicDemo } from "@/config/demo-mode";
import { administrationNavigation } from "@/modules/administration/navigation";
import { authNavigation } from "@/modules/auth/navigation";
import { EMPLOYEE_HOME_ACCESS_PERMISSION } from "@/modules/auth/permissions";
import { customerNavigation } from "@/modules/customer/navigation";
import { inventoryNavigation } from "@/modules/inventory/navigation";
import { logisticsNavigation } from "@/modules/logistics/navigation";
import { posNavigation } from "@/modules/pos/navigation";
import { purchasingNavigation } from "@/modules/purchasing/navigation";
import { receivingNavigation } from "@/modules/receiving/navigation";
import { storefrontNavigation } from "@/modules/storefront/navigation";
import type { NavigationItem } from "@/shared/types/navigation.types";

export const baseNavigation = [
  {
    id: "home",
    label: "Inicio",
    href: "/inicio",
    permission: EMPLOYEE_HOME_ACCESS_PERMISSION,
  },
] satisfies NavigationItem[];

const fullNavigationConfig = [
  ...baseNavigation,
  ...authNavigation,
  ...customerNavigation,
  ...storefrontNavigation,
  ...administrationNavigation,
  ...inventoryNavigation,
  ...purchasingNavigation,
  ...receivingNavigation,
  ...posNavigation,
  ...logisticsNavigation,
] satisfies NavigationItem[];

/**
 * Rutas que la demo publica no ofrece. Al quedar fuera de navigationConfig,
 * RequirePermission (fail-closed) tambien bloquea el acceso por URL directa.
 */
export const DEMO_HIDDEN_NAVIGATION_HREFS: readonly string[] = ["/inventario/regularizacion"];

export function filterNavigationForDemo<T extends NavigationItem>(items: readonly T[]): T[] {
  return items
    .filter((item) => !item.href || !DEMO_HIDDEN_NAVIGATION_HREFS.includes(item.href))
    .map((item) =>
      item.children ? { ...item, children: filterNavigationForDemo(item.children) } : item,
    );
}

/** Se evalua una vez por build: `NEXT_PUBLIC_PUBLIC_DEMO` es constante en el bundle. */
export const navigationConfig: typeof fullNavigationConfig = isPublicDemo()
  ? (filterNavigationForDemo(fullNavigationConfig) as typeof fullNavigationConfig)
  : fullNavigationConfig;
