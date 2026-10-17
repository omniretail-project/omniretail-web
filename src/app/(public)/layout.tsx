"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PublicDemoBanner } from "@/modules/auth/components/PublicDemoBanner";
import { CurrentSessionProvider } from "@/modules/auth/providers/CurrentSessionProvider";
import { PublicStorefrontShell } from "@/modules/storefront/components/PublicStorefrontShell";
import { StorefrontCartProvider } from "@/modules/storefront/providers/StorefrontCartProvider";
import { StorefrontCheckoutConfirmationProvider } from "@/modules/storefront/providers/StorefrontCheckoutConfirmationProvider";
import { PublicTenantProvider } from "@/modules/storefront/providers/PublicTenantProvider";
import { publicStorefrontSlug } from "@/config/publicStorefront";

export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const isGlobalRegistrationRoute = pathname === "/registro";
  const isGlobalAuthRoute =
    pathname === "/recuperar-contrasena" ||
    pathname.startsWith("/restablecer-contrasena/") ||
    pathname.startsWith("/verificar-correo/");

  useEffect(() => {
    if (isGlobalRegistrationRoute) router.replace("/contratar");
  }, [isGlobalRegistrationRoute, router]);

  if (isGlobalRegistrationRoute) return null;

  if (isGlobalAuthRoute) {
    return (
      <CurrentSessionProvider>
        <PublicDemoBanner />
        {children}
      </CurrentSessionProvider>
    );
  }

  return (
    <CurrentSessionProvider>
      <PublicDemoBanner />
      <PublicTenantProvider tenantSlug={publicStorefrontSlug}>
        <StorefrontCartProvider>
          <StorefrontCheckoutConfirmationProvider>
            <PublicStorefrontShell>{children}</PublicStorefrontShell>
          </StorefrontCheckoutConfirmationProvider>
        </StorefrontCartProvider>
      </PublicTenantProvider>
    </CurrentSessionProvider>
  );
}
import type { ReactNode } from "react";
