"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { StorefrontFooter } from "@/modules/storefront/components/StorefrontFooter";
import { StorefrontHeader } from "@/modules/storefront/components/StorefrontHeader";

/**
 * Mi Cuenta (/cuenta/*) trae su propio shell completo (CustomerAccountShell
 * -- Sidebar + header propio), igual que el backoffice de Employee/Admin.
 * No debe quedar envuelta ademas en el header/footer del storefront: ese
 * doble marco no es el diseño que el negocio aprobo para Mi Cuenta.
 */
const ROUTES_WITHOUT_STOREFRONT_CHROME = ["/cuenta"];

function hasOwnChrome(pathname: string): boolean {
  return ROUTES_WITHOUT_STOREFRONT_CHROME.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function PublicStorefrontShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (hasOwnChrome(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="print:hidden">
        <StorefrontHeader />
      </div>
      <div className="flex-1">{children}</div>
      <div className="print:hidden">
        <StorefrontFooter />
      </div>
    </div>
  );
}
