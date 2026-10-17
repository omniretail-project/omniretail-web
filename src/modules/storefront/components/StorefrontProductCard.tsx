"use client";

import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/shared/components/Toast";
import type { StorefrontDiscoveryProductDto } from "@/modules/storefront/application/dto/StorefrontDiscoveryDto";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { StorefrontCatalogImage } from "@/modules/storefront/components/StorefrontCatalogImage";
import { StorefrontUnavailableQuantityModal } from "@/modules/storefront/components/StorefrontUnavailableQuantityModal";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

export function StorefrontProductCard({
  product,
  compact = false,
  uniformHeight = false,
  offer,
}: {
  product: StorefrontDiscoveryProductDto;
  compact?: boolean;
  uniformHeight?: boolean;
  offer?: { originalPrice: number; promotionName: string };
}) {
  const { addProduct, items } = useStorefrontCart();
  const routes = useStorefrontRoutes();
  const [added, setAdded] = useState(false);
  const [unavailableQuantityModalOpen, setUnavailableQuantityModalOpen] = useState(false);
  const { showToast } = useToast();
  const isOutOfStock = product.availableQuantity !== null && product.availableQuantity <= 0;
  const add = async () => {
    if (isOutOfStock) return;
    const quantityInCart = items.find((item) => item.productId === product.id)?.quantity ?? 0;
    if (product.availableQuantity !== null && quantityInCart >= product.availableQuantity) {
      setUnavailableQuantityModalOpen(true);
      return;
    }
    if (!(await addProduct(product.id))) {
      setUnavailableQuantityModalOpen(true);
      return;
    }
    setAdded(true);
    showToast({
      title: "Producto agregado al carrito",
      description: `${product.name} ya está en la selección.`,
      tone: "success",
    });
    window.setTimeout(() => setAdded(false), 1400);
  };
  return (
    <>
    <article className={`group flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-md ${uniformHeight ? "min-h-[31rem]" : ""}`}>
      <Link className="flex min-h-0 flex-1 flex-col text-left" href={routes.product(product.id)}>
        <div className="relative">
          <StorefrontCatalogImage
            alt={product.imageAlt ?? product.name}
            className={`${compact ? "h-40" : "h-48"} w-full bg-slate-50 object-contain object-center p-3 transition duration-500 group-hover:scale-[1.03]`}
            decoding="async"
            loading="lazy"
            source={product.imageSource}
          />
          {offer ? (
            <span className="absolute left-3 top-3 rounded-md bg-[var(--color-danger)] px-2.5 py-1 text-xs font-black uppercase tracking-wider text-white">
              Oferta
            </span>
          ) : null}
          {isOutOfStock ? (
            <span className="absolute right-3 top-3 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-white">
              Agotado
            </span>
          ) : null}
        </div>
        <div className={`${uniformHeight ? "flex flex-1 flex-col " : ""}${compact ? "p-4 pb-2" : "p-5 pb-3"}`}>
          {product.categoryName ? (
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
              {product.categoryName}
            </p>
          ) : null}
          {!compact ? (
            <div className="mt-2">
              <p className="text-xs text-[var(--color-text-muted)]">
                {product.brand ?? `Código · ${product.sku}`}
              </p>
            </div>
          ) : null}
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Código · {product.sku}</p>
          <h2 className={`mt-2 line-clamp-2 text-lg font-bold text-[var(--color-text)] ${uniformHeight ? "min-h-[3.5rem] leading-7" : ""}`}>
            {product.name}
          </h2>
          {!compact ? (
            <p className={`mt-2 line-clamp-2 text-sm leading-5 text-[var(--color-text-muted)] ${uniformHeight ? "min-h-10" : ""}`}>
              {product.description ?? "Sin descripción disponible."}
            </p>
          ) : null}
        </div>
      </Link>
      <div
        className={`flex items-end justify-between gap-3 border-t border-[var(--color-border)] pt-4 ${compact ? "px-4 pb-4" : "px-5 pb-5"}`}
      >
        <div>
          {offer ? (
            <p className="text-sm text-[var(--color-text-muted)] line-through">
              Q{offer.originalPrice.toFixed(2)}
            </p>
          ) : null}
          <p className="text-2xl font-black tracking-tight text-[var(--color-title)]">
            Q{product.salePrice.toFixed(2)}
          </p>
          {offer ? (
            <p className="text-xs font-bold text-[var(--color-danger)]">{offer.promotionName}</p>
          ) : null}
        </div>
        <button
          aria-label={`Agregar ${product.name} al carrito`}
        className="shrink-0 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-bold text-[var(--color-topbar)] transition hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
          disabled={isOutOfStock}
          onClick={() => void add()}
          type="button"
        >
          {isOutOfStock ? "Agotado" : added ? "Agregado" : "Agregar"}
        </button>
      </div>
    </article>
    <StorefrontUnavailableQuantityModal
      onClose={() => setUnavailableQuantityModalOpen(false)}
      open={unavailableQuantityModalOpen}
    />
    </>
  );
}
