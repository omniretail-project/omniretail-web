"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { UserType } from "@/core/enums";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

export function TenantCustomerAccountGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useCurrentSession();
  const { tenantId, loading: tenantLoading } = usePublicTenant();
  const routes = useStorefrontRoutes();
  const allowed = Boolean(user && tenantId && user.type === UserType.customer && user.tenantId === tenantId);
  const router = useRouter();
  useEffect(() => { if (!loading && !tenantLoading && !allowed) router.replace(routes.login()); }, [allowed, loading, router, routes, tenantLoading]);
  if (loading || tenantLoading || !allowed) return <main className="mx-auto max-w-4xl px-5 py-12">Cargando cuenta...</main>;
  return <>{children}</>;
}
