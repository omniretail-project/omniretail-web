"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { UserType } from "@/core/enums";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { useStorefrontDiscovery } from "@/modules/storefront/hooks/useStorefrontDiscovery";
import { StorefrontCatalogImage } from "@/modules/storefront/components/StorefrontCatalogImage";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

export function StorefrontHeader() {
  const { itemCount } = useStorefrontCart();
  const { products } = useStorefrontDiscovery();
  const { user, loading } = useCurrentSession();
  const { config } = usePublicTenant();
  const routes = useStorefrontRoutes();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const suggestions = useMemo(() => {
    if (!normalizedSearch) return [];
    return products
      .filter((product) =>
        [product.name, product.sku, product.brand, product.categoryName]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalizedSearch)),
      )
      .slice(0, 5);
  }, [normalizedSearch, products]);
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `${routes.catalog()}?q=${encodeURIComponent(query)}` : routes.catalog());
  };
  const isCustomer = user?.type === UserType.customer;
  const accountHref = !loading && user ? (isCustomer ? routes.account() : "/inicio") : routes.login();
  const accountLabel = !loading && user ? (isCustomer ? "Mi Cuenta" : "Ir a inicio") : "Ingresar";

  return (
    <header className="sticky top-0 z-30 bg-[var(--color-topbar)] text-white shadow-lg shadow-slate-900/10">
      <div className="border-b border-white/10">
        <div className="mx-auto flex max-w-[90rem] items-center justify-between px-4 py-2 text-xs font-medium text-slate-300 sm:px-5">
          <span>Compra en línea</span>
          <span className="hidden sm:inline">
            Productos, ofertas y seguimiento en un mismo lugar
          </span>
        </div>
      </div>
      <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <Link
          className="order-1 flex min-w-0 w-full basis-full items-center gap-2 text-lg font-black tracking-tight sm:order-none sm:w-auto sm:basis-auto sm:max-w-xs sm:text-xl"
          href={routes.home()}
        >
          {config?.logoImageSource ? (
            <StorefrontCatalogImage
              alt={config.storeName}
              className="h-9 w-9 shrink-0 rounded-xl border border-white/10 bg-white object-contain p-1"
              source={config.logoImageSource}
            />
          ) : (
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-primary)] text-xs text-[var(--color-topbar)] shadow-sm">
              OR
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{config?.storeName ?? "Tienda"}</span>
        </Link>
        <div className="order-2 flex w-full shrink-0 items-center justify-end gap-1 sm:order-none sm:ml-auto sm:w-auto sm:justify-start lg:order-4">
          <Link
            className="rounded-lg bg-white/10 px-2.5 py-2 text-sm font-semibold text-white transition hover:bg-white/20 sm:px-3"
            href={routes.cart()}
          >
            Carrito{" "}
            <span className="ml-1 rounded-full bg-[var(--color-primary)] px-1.5 py-0.5 text-xs text-[var(--color-topbar)]">
              {itemCount}
            </span>
          </Link>
          <Link
            aria-label={accountLabel}
            className="rounded-lg px-2.5 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3"
            href={accountHref}
          >
            <svg
              aria-hidden="true"
              className="inline-block h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c1.5-4 4.2-6 8-6s6.5 2 8 6" />
            </svg>
            <span className="ml-1 hidden min-[1180px]:inline">{accountLabel}</span>
          </Link>
        </div>
        <form
          className="order-3 basis-full lg:order-2 lg:min-w-48 lg:flex-1"
          onSubmit={submitSearch}
        >
          <label className="sr-only" htmlFor="storefront-search">
            Buscar productos
          </label>
          <div className="relative mx-auto max-w-xl">
            <input
              className="w-full rounded-xl border border-white/15 bg-white/10 py-2.5 pl-4 pr-20 text-sm text-white outline-none placeholder:text-slate-300 transition focus:border-[var(--color-primary)] focus:bg-white/15 focus:ring-2 focus:ring-[var(--color-primary)]/30"
              id="storefront-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar productos, marcas o códigos"
              value={search}
            />
            {search ? (
              <button
                aria-label="Limpiar búsqueda"
                className="absolute inset-y-1 right-11 px-2 text-slate-300 transition hover:text-white"
                onClick={() => setSearch("")}
                type="button"
              >
                ×
              </button>
            ) : null}
            <button
              aria-label="Buscar productos"
              className="absolute inset-y-1 right-1 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-black text-[var(--color-topbar)] transition hover:bg-[var(--color-primary-hover)]"
              type="submit"
            >
              ⌕
            </button>
            {normalizedSearch ? (
              <div className="absolute left-0 right-0 top-[calc(100%+.45rem)] z-50 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] shadow-2xl shadow-slate-950/25">
                <div className="flex items-center justify-between gap-4 bg-[var(--color-primary)]/10 px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--color-title)]">
                  <span>Sugerencias de productos</span>
                  <span>Presiona Enter para buscar</span>
                </div>
                {suggestions.length > 0 ? (
                  <div className="divide-y divide-[var(--color-border)]">
                    {suggestions.map((product) => (
                      <Link
                        className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                        href={routes.product(product.id)}
                        key={product.id}
                        onClick={() => setSearch("")}
                      >
                        <StorefrontCatalogImage
                          alt={product.imageAlt ?? product.name}
                          className="h-11 w-11 shrink-0 rounded-md border border-[var(--color-border)] bg-slate-50 object-contain p-1"
                          decoding="async"
                          loading="lazy"
                          source={product.imageSource}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-bold text-[var(--color-text)]">
                            {product.name}
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-[var(--color-text-muted)]">
                            {product.categoryName ?? "Sin categoría"} • SKU: {product.sku}
                          </span>
                        </span>
                        <span className="shrink-0 font-black text-[var(--color-title)]">
                          Q{product.salePrice.toFixed(2)}
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="px-4 py-5 text-center text-sm text-[var(--color-text-muted)]">
                    No encontramos productos para “{search.trim()}”.
                  </p>
                )}
                {suggestions.length > 0 ? (
                  <button
                    className="flex w-full items-center justify-center gap-2 border-t border-[var(--color-border)] bg-slate-50 px-4 py-3 text-sm font-bold text-[var(--color-title)] hover:bg-[var(--color-primary)]/10"
                    onClick={() => router.push(`${routes.catalog()}?q=${encodeURIComponent(search.trim())}`)}
                    type="button"
                  >
                    ⌕ Ver todos los resultados para “{search.trim()}”
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </form>
        <nav
          aria-label="Navegación principal"
          className="order-4 flex w-full items-center justify-between border-t border-white/10 pt-3 text-sm font-semibold lg:order-3 lg:w-auto lg:justify-start lg:border-0 lg:pt-0"
        >
          <Link
            className="rounded-lg px-2.5 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3"
            href={routes.catalog()}
          >
            Catálogo
          </Link>
          <Link
            className="rounded-lg px-2.5 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3"
            href={routes.offers()}
          >
            Ofertas
          </Link>
          <Link
            className="rounded-lg px-2.5 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3"
            href={routes.branches()}
          >
            <span aria-hidden="true">▥</span>
            <span className="ml-1">Sucursales</span>
          </Link>
          <Link
            className="rounded-lg px-2.5 py-2 text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3"
            href={routes.help()}
          >
            Ayuda
          </Link>
        </nav>
      </div>
    </header>
  );
}
