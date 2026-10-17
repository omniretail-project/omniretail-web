"use client";

import Link from "next/link";
import { useState } from "react";
import { useStorefrontOffers } from "@/modules/storefront/hooks/useStorefrontOffers";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { useToast } from "@/shared/components/Toast";
import { StorefrontCatalogImage } from "@/modules/storefront/components/StorefrontCatalogImage";
import { StorefrontUnavailableQuantityModal } from "@/modules/storefront/components/StorefrontUnavailableQuantityModal";
import { useStorefrontDiscovery } from "@/modules/storefront/hooks/useStorefrontDiscovery";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

export function OffersPage() {
  const routes = useStorefrontRoutes();
  const { items, loading, error } = useStorefrontOffers();
  const { addProduct, items: cartItems } = useStorefrontCart();
  const { products } = useStorefrontDiscovery();
  const { showToast } = useToast();
  const [addedProductId, setAddedProductId] = useState<string | null>(null);
  const [unavailableQuantityModalOpen, setUnavailableQuantityModalOpen] = useState(false);

  const addOffer = async (productId: string, name: string) => {
    const availableQuantity = products.find((product) => product.id === productId)?.availableQuantity;
    const quantityInCart = cartItems.find((item) => item.productId === productId)?.quantity ?? 0;
    if (availableQuantity !== undefined && availableQuantity !== null && quantityInCart >= availableQuantity) {
      setUnavailableQuantityModalOpen(true);
      return;
    }
    if (!(await addProduct(productId))) {
      setUnavailableQuantityModalOpen(true);
      return;
    }
    setAddedProductId(productId);
    showToast({
      title: "Producto agregado al carrito",
      description: `${name} ya está en tu selección.`,
      tone: "success",
    });
    window.setTimeout(() => setAddedProductId(null), 1400);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-5 py-10">
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text-muted)]">
          Cargando ofertas...
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:py-12">
      <section className="overflow-hidden rounded-3xl bg-[var(--color-topbar)] px-6 py-9 text-white shadow-lg sm:px-10 sm:py-12">
        <div className="max-w-2xl">
          <p className="inline-flex rounded-full bg-[var(--color-primary)] px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-topbar)]">
            Ofertas activas
          </p>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-5xl">
            Encuentra mejores precios para tu compra.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-white/75 sm:text-lg">
            Promociones disponibles para la tienda en línea, con precios claros y ahorro visible.
          </p>
          <div className="mt-7 flex flex-wrap gap-3 text-sm font-medium text-white/80">
            <span className="rounded-full border border-white/20 px-3 py-1.5">
              Promociones vigentes
            </span>
            <span className="rounded-full border border-white/20 px-3 py-1.5">Compra segura</span>
          </div>
        </div>
      </section>

      {error ? (
        <p className="mt-7 rounded-2xl border border-[var(--color-danger)]/30 bg-[var(--color-surface)] p-5 text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {!error && items.length === 0 ? (
        <p className="mt-7 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text-muted)]">
          No hay ofertas disponibles en este momento.
        </p>
      ) : null}

      {items.length > 0 ? (
        <section className="mt-9">
          <div className="mb-5 flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div>
              <p className="text-sm font-semibold text-[var(--color-primary)]">Selección para ti</p>
              <h2 className="mt-1 text-2xl font-bold text-[var(--color-title)]">
                Ofertas disponibles
              </h2>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              {items.length} producto{items.length === 1 ? "" : "s"} con promoción
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <article
                key={item.productId}
                className="group overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-md"
              >
                <Link className="block" href={routes.product(item.productId)}>
                  <div className="relative bg-slate-50">
                    <StorefrontCatalogImage
                      alt={item.imageAlt ?? item.name}
                      className="h-52 w-full object-contain object-center p-4 transition duration-300 group-hover:scale-[1.03]"
                      decoding="async"
                      loading="lazy"
                      source={item.imageSource}
                    />
                    <span className="absolute left-3 top-3 rounded-md bg-red-700 px-3 py-1 text-sm font-black text-white">
                      -{Math.round((item.discount / item.basePrice) * 100)}%
                    </span>
                    <span className="absolute left-3 top-12 rounded-md bg-[var(--color-primary)]/90 px-2 py-1 text-xs font-bold text-[var(--color-topbar)]">
                      {item.promotionName}
                    </span>
                  </div>
                  <div className="p-5">
                    <p className="text-xs font-black uppercase tracking-wider text-[var(--color-primary-hover)]">
                      {item.sku}
                    </p>
                    <h3 className="mt-2 line-clamp-2 text-xl font-bold leading-tight text-[var(--color-title)]">
                      {item.name}
                    </h3>
                    <p className="mt-3 inline-flex rounded-md bg-[var(--color-success)]/10 px-2 py-1 text-sm font-bold text-[var(--color-success)]">
                      Ahorras: Q{item.discount.toFixed(2)}
                    </p>
                    <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                      <p className="text-sm text-[var(--color-text-muted)] line-through">
                        Q{item.basePrice.toFixed(2)}
                      </p>
                      <p className="mt-1 text-2xl font-black text-red-700">
                        Q{item.effectivePrice.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </Link>
                <div className="flex justify-end px-5 pb-5">
                  <button
                    className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-bold text-[var(--color-topbar)] transition hover:bg-[var(--color-primary-hover)]"
                    onClick={() => void addOffer(item.productId, item.name)}
                    type="button"
                  >
                    {addedProductId === item.productId ? "Agregado" : "Agregar"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <StorefrontUnavailableQuantityModal
        onClose={() => setUnavailableQuantityModalOpen(false)}
        open={unavailableQuantityModalOpen}
      />
    </main>
  );
}
