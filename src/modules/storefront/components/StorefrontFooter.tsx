"use client";

import Link from "next/link";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

export function StorefrontFooter() {
  const { config } = usePublicTenant();
  const routes = useStorefrontRoutes();
  const businessName = config?.storeName ?? "Tienda";
  return (
    <footer className="mt-auto border-t border-white/10 bg-[var(--color-topbar)] text-slate-300">
      <div className="mx-auto grid max-w-[90rem] gap-8 px-4 py-10 sm:px-5 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <p className="text-lg font-black text-white">{businessName}</p>
          <p className="mt-2 max-w-sm text-sm leading-6">
            Compra en línea con envío a domicilio, precios claros y seguimiento de pedido.
          </p>
        </div>
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-white">Compra</p>
          <div className="mt-3 grid gap-2 text-sm">
            <Link href={routes.catalog()}>Catálogo</Link>
            <Link href={routes.offers()}>Ofertas</Link>
            <Link href={routes.cart()}>Mi carrito</Link>
          </div>
        </div>
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-white">Atención</p>
          <div className="mt-3 grid gap-2 text-sm">
            <Link href={routes.help()}>Ayuda de compra</Link>
            <span>Soporte para pedidos en línea</span>
            <span>Envío a domicilio disponible</span>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10 px-5 py-4 text-center text-xs text-slate-400">
        © 2026 {businessName} · Compra segura y transparente
      </div>
    </footer>
  );
}
