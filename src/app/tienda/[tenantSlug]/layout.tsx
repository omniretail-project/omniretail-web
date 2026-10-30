import type { ReactNode } from "react";
import { PublicDemoBanner } from "@/modules/auth/components/PublicDemoBanner";
import { CurrentSessionProvider } from "@/modules/auth/providers/CurrentSessionProvider";
import { PublicStorefrontShell } from "@/modules/storefront/components/PublicStorefrontShell";
import { StorefrontCartProvider } from "@/modules/storefront/providers/StorefrontCartProvider";
import { StorefrontCheckoutConfirmationProvider } from "@/modules/storefront/providers/StorefrontCheckoutConfirmationProvider";
import { PublicTenantProvider } from "@/modules/storefront/providers/PublicTenantProvider";
import { StorefrontCatalogProvider } from "@/modules/storefront/providers/StorefrontCatalogProvider";

export default async function TenantStorefrontLayout({ children, params }: { children: ReactNode; params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  return <CurrentSessionProvider><PublicDemoBanner /><PublicTenantProvider tenantSlug={tenantSlug}><StorefrontCatalogProvider><StorefrontCartProvider><StorefrontCheckoutConfirmationProvider><PublicStorefrontShell>{children}</PublicStorefrontShell></StorefrontCheckoutConfirmationProvider></StorefrontCartProvider></StorefrontCatalogProvider></PublicTenantProvider></CurrentSessionProvider>;
}
