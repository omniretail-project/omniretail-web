"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import {
  useOptionalPublicTenant,
  usePublicTenant,
} from "@/modules/storefront/providers/PublicTenantProvider";

const segment = (value: string) => encodeURIComponent(value);

function createStorefrontRoutes(base: string) {
  return {
    home: () => base || "/",
    catalog: () => `${base}/catalogo`,
    catalogCategory: (categoryId: string) =>
      `${base}/catalogo?categoria=${segment(categoryId)}`,
    product: (id: string) => `${base}/catalogo/${segment(id)}`,
    offers: () => `${base}/ofertas`,
    cart: () => `${base}/carrito`,
    checkout: () => `${base}/checkout`,
    register: () => `${base}/registro`,
    login: () => `${base}/iniciar-sesion`,
    forgotPassword: () => `${base}/recuperar-contrasena`,
    resetPassword: (token: string) => `${base}/restablecer-contrasena/${segment(token)}`,
    account: () => `${base}/cuenta`,
    accountOrders: () => `${base}/cuenta/pedidos`,
    accountAddresses: () => `${base}/cuenta/direcciones`,
    accountPaymentMethods: () => `${base}/cuenta/metodos-pago`,
    accountProfile: () => `${base}/cuenta/perfil`,
    accountSecurity: () => `${base}/cuenta/seguridad`,
    accountSupport: () => `${base}/cuenta/soporte`,
    accountOrder: (id: string) => `${base}/cuenta/pedidos/${segment(id)}`,
    confirmation: (trackingToken?: string) =>
      trackingToken
        ? `${base}/pedido/confirmacion/${segment(trackingToken)}`
        : `${base}/pedido/confirmacion`,
    tracking: (token: string) => `${base}/pedido/seguimiento/${segment(token)}`,
    help: () => `${base}/ayuda`,
    branches: () => `${base}/sucursales`,
  };
}

function useTenantScopedBase(tenantSlug: string) {
  const pathname = usePathname();
  return pathname.startsWith("/tienda/") ? `/tienda/${segment(tenantSlug)}` : "";
}

export function useStorefrontRoutes() {
  const { tenantSlug } = usePublicTenant();
  const base = useTenantScopedBase(tenantSlug);
  return useMemo(() => createStorefrontRoutes(base), [base]);
}

export function useOptionalStorefrontRoutes() {
  const tenant = useOptionalPublicTenant();
  const pathname = usePathname();
  const tenantSlug = tenant?.tenantSlug;
  const base = pathname.startsWith("/tienda/")
    ? tenantSlug
      ? `/tienda/${segment(tenantSlug)}`
      : null
    : tenant
      ? ""
      : null;

  return useMemo(() => (base === null ? null : createStorefrontRoutes(base)), [base]);
}
