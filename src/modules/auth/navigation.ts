import { EMPLOYEE_HOME_ACCESS_PERMISSION } from "@/modules/auth/permissions";
import type { NavigationItem } from "@/shared/types/navigation.types";

/**
 * "Mi perfil" (datos personales de solo lectura + cambio de contraseña)
 * debe estar disponible para cualquier Employee/Admin real, sin importar
 * su rol operacional -- mismo criterio y mismo permission sintetico que
 * ya usa /inicio (ver EMPLOYEE_HOME_ACCESS_PERMISSION en permissions.ts):
 * "un Employee con al menos un permiso real en su rol", en vez de
 * inventar una permission key nueva que requeriria tocar demoSeed/roles.
 */
export const authNavigation = [
  {
    id: "auth-profile",
    label: "Mi perfil",
    permission: EMPLOYEE_HOME_ACCESS_PERMISSION,
    children: [
      {
        id: "auth-profile-data",
        label: "Datos personales",
        href: "/perfil",
        permission: EMPLOYEE_HOME_ACCESS_PERMISSION,
      },
      {
        id: "auth-profile-security",
        label: "Seguridad",
        href: "/perfil/seguridad",
        permission: EMPLOYEE_HOME_ACCESS_PERMISSION,
      },
    ],
  },
] satisfies NavigationItem[];
