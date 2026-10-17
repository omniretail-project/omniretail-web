"use client";

import Link from "next/link";
import { useState } from "react";
import { StorefrontAvailability } from "@/modules/storefront/components/StorefrontAvailability";
import { useStorefrontProductDetail } from "@/modules/storefront/hooks/useStorefrontProductDetail";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { useToast } from "@/shared/components/Toast";
import { StorefrontUnavailableQuantityModal } from "@/modules/storefront/components/StorefrontUnavailableQuantityModal";
import { StorefrontCatalogImage } from "@/modules/storefront/components/StorefrontCatalogImage";
import { ProductType } from "@/core/enums";
import { useStorefrontDiscovery } from "@/modules/storefront/hooks/useStorefrontDiscovery";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";
import { calculateEffectivePrice, resolveQuantityPrice } from "@/core/pricing";
import { useStorefrontOffers } from "@/modules/storefront/hooks/useStorefrontOffers";

export function ProductDetailPage({ productId }: { productId: string }) {
  const routes = useStorefrontRoutes();
  const { data, loading, error, reload } = useStorefrontProductDetail(productId);
  const { addProduct, items } = useStorefrontCart();
  const { products } = useStorefrontDiscovery();
  const { showToast } = useToast();
  const [quantity, setQuantity] = useState(1);
  const { items: offers } = useStorefrontOffers({ productId, quantity });
  const [addedQuantity, setAddedQuantity] = useState<number | null>(null);
  const [unavailableQuantityModalOpen, setUnavailableQuantityModalOpen] = useState(false);
  if (loading)
    return (
      <main className="mx-auto max-w-5xl px-5 py-12 text-[var(--color-text-muted)]">
        Cargando producto...
      </main>
    );
  if (error || !data)
    return (
      <main className="mx-auto max-w-5xl px-5 py-12">
        <h1 className="text-3xl font-black text-[var(--color-text)]">Producto</h1>
        <p className="mt-4 text-[var(--color-text-muted)]">
          {error ?? "El producto no está disponible."}
        </p>
        <div className="mt-5 flex gap-3">
          <button
            className="rounded-xl bg-[var(--color-primary)] px-4 py-2 font-bold text-[var(--color-topbar)]"
            onClick={reload}
            type="button"
          >
            Reintentar
          </button>
          <Link
            className="rounded-xl border border-[var(--color-border)] px-4 py-2 font-bold"
          href={routes.catalog()}
          >
            Volver al catálogo
          </Link>
        </div>
      </main>
    );
  const { product, availability, categoryName, media, attributes } = data;
  const discoveryProduct = products.find((item) => item.id === product.id);
  // El stock del propio detalle manda; asi no depende de que el catalogo haya terminado de cargar.
  const availableQuantity =
    data.availableQuantity !== undefined
      ? data.availableQuantity
      : discoveryProduct?.availableQuantity;
  const promotion = offers.find((item) => item.productId === product.id)?.promotion;
  const price = calculateEffectivePrice(
    resolveQuantityPrice({
      basePrice: product.salePrice,
      quantity,
      tiers: discoveryProduct?.salesPriceTiers,
    }),
    promotion,
  );
  const quantityAlreadyInCart = items.find((item) => item.productId === product.id)?.quantity ?? 0;
  const isOutOfStock =
    availableQuantity === 0 ||
    (availableQuantity === undefined &&
      product.productType !== ProductType.service &&
      Boolean(availability?.length) &&
      !availability!.some((branch) => branch.available));
  const notifyUnavailableQuantity = () => setUnavailableQuantityModalOpen(true);
  const increaseQuantity = () => {
    if (
      availableQuantity !== undefined &&
      availableQuantity !== null &&
      quantityAlreadyInCart + quantity >= availableQuantity
    ) {
      notifyUnavailableQuantity();
      return;
    }
    setQuantity((current) => current + 1);
  };
  const addToCart = async () => {
    if (isOutOfStock) return;
    if (
      availableQuantity !== undefined &&
      availableQuantity !== null &&
      quantityAlreadyInCart + quantity > availableQuantity
    ) {
      notifyUnavailableQuantity();
      return;
    }
    if (!(await addProduct(product.id, quantity))) {
      notifyUnavailableQuantity();
      return;
    }
    setAddedQuantity(quantity);
    showToast({
      title: "Producto agregado al carrito",
      description: `${quantity} ${quantity === 1 ? "unidad fue agregada" : "unidades fueron agregadas"}.`,
      tone: "success",
    });
  };
  return (
    <main className="mx-auto max-w-7xl px-5 py-10">
      <Link className="text-sm font-bold text-[var(--color-title)]" href={routes.catalog()}>
        ← Volver al catálogo
      </Link>
      <section className="mt-5 grid gap-7 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm lg:grid-cols-[1.25fr_.9fr] lg:p-7">
        <div>
          <StorefrontCatalogImage
            alt={media[0]?.alt ?? product.name}
            className="h-72 w-full rounded-xl bg-slate-50 object-contain object-center p-5 md:h-[29rem]"
            fetchPriority="high"
            loading="eager"
            source={media[0]?.source}
          />
        </div>
        <div className="flex flex-col rounded-xl border border-[var(--color-border)] p-5">
          <div className="flex flex-wrap gap-2">
            {categoryName ? (
              <p className="rounded-md bg-[var(--color-primary)]/20 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-[var(--color-title)]">
                {categoryName}
              </p>
            ) : null}
            <p className="rounded-md border border-[var(--color-border)] bg-slate-50 px-2.5 py-1 text-xs font-bold text-[var(--color-text-muted)]">
              SKU: {product.sku}
            </p>
          </div>
          <h1 className="mt-4 text-3xl font-black leading-tight text-[var(--color-text)] sm:text-4xl">
            {product.name}
          </h1>
          {product.brand ? (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">Marca · {product.brand}</p>
          ) : null}
          <p className="mt-5 leading-7 text-[var(--color-text-muted)]">
            {product.description ?? "Sin descripción disponible."}
          </p>
          <div className="mt-6 border-t border-[var(--color-border)] pt-5">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <p className="text-3xl font-black text-[var(--color-title)]">
                Q{price.effectivePrice.toFixed(2)}
              </p>
              <div className="text-left sm:text-right">
                <p className="text-sm text-[var(--color-text-muted)]">Total calculado</p>
                <p className="text-2xl font-black text-[var(--color-title)]">
                  Q{(price.effectivePrice * quantity).toFixed(2)}
                </p>
              </div>
            </div>
            <p className="mt-5 text-sm font-bold text-[var(--color-text)]">Cantidad a ordenar</p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <div className="flex h-12 items-center justify-between rounded-xl border border-[var(--color-border)] bg-slate-50 sm:w-44">
                <button
                  aria-label="Reducir cantidad"
                  className="px-4 text-xl font-bold text-[var(--color-title)] disabled:opacity-40"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  −
                </button>
                <span className="font-black text-[var(--color-text)]">{quantity}</span>
                <button
                  aria-label="Aumentar cantidad"
                  className="px-4 text-xl font-bold text-[var(--color-title)] disabled:opacity-40"
                  disabled={isOutOfStock}
                  onClick={increaseQuantity}
                  type="button"
                >
                  +
                </button>
              </div>
              <button
                className="h-12 flex-1 rounded-xl bg-[var(--color-primary-hover)] px-5 font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
                disabled={isOutOfStock}
                onClick={() => void addToCart()}
                type="button"
              >
                {isOutOfStock ? "Agotado" : "Agregar al carrito"}
              </button>
            </div>
            {isOutOfStock ? (
              <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">
                Agotado por el momento. Podrás agregarlo cuando vuelva a haber disponibilidad.
              </p>
            ) : null}
            {addedQuantity ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-3 py-2 text-sm text-[var(--color-success)]">
                <span>
                  {addedQuantity} {addedQuantity === 1 ? "unidad agregada" : "unidades agregadas"}{" "}
                  al carrito.
                </span>
          <Link className="font-bold underline underline-offset-2" href={routes.cart()}>
                  Ver carrito
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </section>
      {attributes.length > 0 ? (
        <details
          className="group mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
          open
        >
          <summary className="flex cursor-pointer list-none items-center justify-between p-5">
            <span className="text-xl font-bold text-[var(--color-text)]">Características</span>
            <span className="text-sm font-bold text-[var(--color-title)]">Mostrar / ocultar</span>
          </summary>
          <dl className="grid gap-3 border-t border-[var(--color-border)] p-5 sm:grid-cols-2">
            {attributes.map((attribute) => (
              <div key={attribute.name} className="rounded-xl bg-slate-50 p-4">
                <dt className="text-sm text-[var(--color-text-muted)]">{attribute.name}</dt>
                <dd className="mt-1 font-bold text-[var(--color-text)]">{attribute.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {availability ? <StorefrontAvailability branches={availability} /> : null}
      <StorefrontUnavailableQuantityModal
        onClose={() => setUnavailableQuantityModalOpen(false)}
        open={unavailableQuantityModalOpen}
      />
    </main>
  );
}
