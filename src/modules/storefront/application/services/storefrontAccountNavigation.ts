import type { User } from "@/core/entities";
import { UserType } from "@/core/enums";

export interface StorefrontAccountNavigation {
  href: string;
  label: string;
}

export function getStorefrontAccountNavigation(
  user: User | null,
  loading: boolean,
): StorefrontAccountNavigation {
  if (loading || !user) {
    return { href: "/iniciar-sesion", label: "Ingresar" };
  }
  if (user.type === UserType.customer) {
    return { href: "/cuenta/perfil", label: "Mi Cuenta" };
  }
  return { href: "/inicio", label: "Ir a inicio" };
}
