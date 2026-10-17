"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { UserType } from "@/core/enums";
import type { User } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { EntitlementProvider } from "@/shared/providers/EntitlementProvider";
import { PrivateShell } from "@/shared/navigation/PrivateShell";
import type { NavigationItem } from "@/shared/types/navigation.types";
import { useOptionalStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { ExternalLinkIcon } from "@/shared/components/icons";

interface CustomerAccountShellProps {
  children: ReactNode;
  navigationItems: NavigationItem[];
}

function getAccountInitials(name: string | undefined): string {
  return name
    ?.trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

export function isCustomerAccountIdentity(user: Pick<User, "type"> | null | undefined): boolean {
  return user?.type === UserType.customer;
}

/**
 * Version de AuthorizedPrivateShell dedicada a Customer. Reutiliza los
 * mismos bloques visuales sin logica de negocio (PrivateShell -> Sidebar +
 * PrivateHeader, ver shared/navigation) que el backoffice de Employee/
 * Admin, pero es un componente PROPIO del modulo customer: nunca importa
 * ni depende de AuthorizedPrivateShell. Mi Cuenta no queda acoplada al
 * shell operativo de backoffice (un cambio ahi no afecta a Customer y
 * viceversa) aunque el resultado visual sea identico -- ese resultado
 * visual es intencional, es el diseño que el negocio ya aprobo.
 *
 * EntitlementProvider: Sidebar (compartido) ahora filtra items via
 * useEntitlementContext() (feature/saas-entitlement-enforcement) -- fuera
 * de (private)/layout.tsx (que ya lo provee para Employee/Admin) nadie
 * mas lo monta, y Mi Cuenta vive en (public)/(accessible), asi que sin
 * este wrapper CUALQUIER pantalla de Mi Cuenta tira "useEntitlement must
 * be used inside EntitlementProvider" apenas Sidebar intenta renderizar.
 * Funciona igual para Customer que para Employee: resuelve por
 * User.tenantId (ResolveTenantEntitlementsService), no depende de Role.
 */
export function CustomerAccountShell({ children, navigationItems }: CustomerAccountShellProps) {
  const { permissions, user } = useCurrentSession();
  const repositories = useRepositories();
  const router = useRouter();

  const allowedPermissions = useMemo(() => new Set(permissions), [permissions]);
  const storefrontRoutes = useOptionalStorefrontRoutes();

  const handleLogout = useCallback(async () => {
    try {
      const sessionId = await repositories.auth.getCurrentSessionId();
      if (sessionId) {
        await repositories.auth.logout(sessionId);
      }
    } finally {
      // Misma garantia que AuthorizedPrivateShell: la limpieza local de la
      // sesion y la navegacion a /iniciar-sesion ocurren pase lo que pase
      // con la revocacion remota.
      await repositories.auth.clearLocalSession();
      router.replace(storefrontRoutes ? storefrontRoutes.login() : "/iniciar-sesion");
    }
  }, [repositories, router, storefrontRoutes]);

  const localizedItems = useMemo(() => {
    if (!storefrontRoutes) return navigationItems;

    const mapHref = (href?: string) => {
      if (!href) return href;
      if (href === "/cuenta") return storefrontRoutes.account();
      if (href === "/cuenta/perfil") return storefrontRoutes.accountProfile();
      if (href === "/cuenta/direcciones") return storefrontRoutes.accountAddresses();
      if (href === "/cuenta/metodos-pago") return storefrontRoutes.accountPaymentMethods();
      if (href === "/cuenta/pedidos") return storefrontRoutes.accountOrders();
      if (href === "/cuenta/seguridad") return storefrontRoutes.accountSecurity();
      if (href === "/cuenta/soporte") return storefrontRoutes.accountSupport();
      return href;
    };

    const mapItem = (item: NavigationItem): NavigationItem => ({
      ...item,
      href: mapHref(item.href),
      children: item.children?.map(mapItem),
    });

    return navigationItems.map(mapItem);
  }, [navigationItems, storefrontRoutes]);

  const homeHref = storefrontRoutes ? storefrontRoutes.home() : "/";

  if (!isCustomerAccountIdentity(user)) {
    return <AccessDeniedState />;
  }

  return (
    <EntitlementProvider>
      <PrivateShell
        allowedPermissions={allowedPermissions}
        homeHref={homeHref}
        homeLabel="Volver al inicio"
        navigationItems={localizedItems}
        onLogout={handleLogout}
        showBranchSelector={false}
        userMenuDescription={user?.email}
        userMenuLabel={user?.name}
      >
        <div className="min-w-0 space-y-6">
          <section className="flex items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm sm:p-6">
            <span
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-topbar)] text-xl font-bold text-white"
            >
              {getAccountInitials(user?.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
                Mi cuenta
              </p>
              <h1 className="mt-1 truncate text-2xl font-bold text-[var(--color-text)]">
                {user?.name ?? "Tu cuenta"}
              </h1>
              {user?.email ? (
                <p className="mt-1 truncate text-sm text-[var(--color-text-muted)]">
                  {user.email}
                </p>
              ) : null}
            </div>
            <button
              aria-label="Cerrar sesión"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] transition hover:border-red-200 hover:bg-red-50 hover:text-[var(--color-danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
              onClick={() => void handleLogout()}
              title="Cerrar sesión"
              type="button"
            >
              <ExternalLinkIcon className="h-5 w-5" />
            </button>
          </section>
          {children}
        </div>
      </PrivateShell>
    </EntitlementProvider>
  );
}
