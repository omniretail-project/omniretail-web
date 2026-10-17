export interface NavigationItem {
  id: string;
  label: string;
  capability?: import("@/core/enums").SaasCapabilityKey;
  href?: string;
  permission?: string;
  /**
   * Alternativa a `permission` para pantallas visibles con CUALQUIERA de varios permisos
   * (ej. admin.users.read O admin.users.manage) -- `permission` sigue siendo un unico string
   * exigido, sin mecanismo de "OR"; `anyPermission`, cuando esta presente, reemplaza esa
   * verificacion en vez de sumarse a ella. Ver isNavigationItemPermitted.
   */
  anyPermission?: string[];
  children?: NavigationItem[];
}
