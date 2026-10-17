"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useStorefrontCart } from "@/modules/storefront/providers/StorefrontCartProvider";
import { useStorefrontDiscovery } from "@/modules/storefront/hooks/useStorefrontDiscovery";
import { StorefrontUnavailableQuantityModal } from "@/modules/storefront/components/StorefrontUnavailableQuantityModal";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";
import {
  calculateStorefrontShipping,
  STOREFRONT_FREE_SHIPPING_THRESHOLD,
} from "@/config/storefront-shipping-policy";

export function CartPage() {
  const routes = useStorefrontRoutes();
  const { items, subtotal, updateQuantity, removeProduct, clearCart } = useStorefrontCart();
  const shippingTotal = calculateStorefrontShipping(subtotal);
  const total = subtotal + shippingTotal;
  const { products } = useStorefrontDiscovery();
  const [unavailableQuantityModalOpen, setUnavailableQuantityModalOpen] = useState(false);
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>({});

  const setQuantityInput = (productId: string, quantity: number) => {
    setQuantityInputs((current) => ({ ...current, [productId]: String(quantity) }));
  };

  const availableFor = (productId: string) =>
    products.find((product) => product.id === productId)?.availableQuantity;

  const increaseQuantity = (productId: string, quantity: number) => {
    const availableQuantity = availableFor(productId);
    if (availableQuantity !== undefined && availableQuantity !== null && quantity >= availableQuantity) {
      setUnavailableQuantityModalOpen(true);
      return;
    }
    const nextQuantity = quantity + 1;
    updateQuantity(productId, nextQuantity);
    setQuantityInput(productId, nextQuantity);
  };

  const changeQuantityInput = (
    productId: string,
    currentQuantity: number,
    input: string,
  ) => {
    const digits = input.replace(/\D/g, "");
    setQuantityInputs((current) => ({ ...current, [productId]: digits }));
    if (!digits) return;

    const nextQuantity = Number(digits);
    if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 1) return;

    const availableQuantity = availableFor(productId);
    if (availableQuantity !== undefined && availableQuantity !== null && nextQuantity > availableQuantity) {
      setQuantityInput(productId, currentQuantity);
      setUnavailableQuantityModalOpen(true);
      return;
    }
    updateQuantity(productId, nextQuantity);
  };

  const commitQuantityInput = (productId: string, quantity: number) => {
    const draft = quantityInputs[productId];
    const nextQuantity = Number(draft);
    if (!draft || !Number.isSafeInteger(nextQuantity) || nextQuantity < 1) {
      setQuantityInput(productId, quantity);
    }
  };
  const itemCount = items.reduce((total, item) => total + item.quantity, 0);
  if (items.length === 0)
    return (
      <main className="mx-auto max-w-5xl px-4 py-14 sm:px-5">
        <section className="rounded-3xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
            Tu selección
          </p>
          <h1 className="mt-2 text-3xl font-black text-[var(--color-text)]">
            Tu carrito está vacío
          </h1>
          <p className="mt-3 text-[var(--color-text-muted)]">
            Explora el catálogo y agrega lo que necesitas.
          </p>
          <Link
            className="mt-6 inline-block rounded-xl bg-[var(--color-primary)] px-5 py-3 font-bold text-[var(--color-topbar)]"
          href={routes.catalog()}
          >
            Ver catálogo
          </Link>
        </section>
      </main>
    );
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-5 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
            Tu selección
          </p>
          <h1 className="mt-2 text-4xl font-black text-[var(--color-text)]">Carrito</h1>
        </div>
        <button
          className="text-sm font-bold text-[var(--color-danger)] underline-offset-4 hover:underline"
          onClick={clearCart}
          type="button"
        >
          Vaciar carrito
        </button>
      </div>
      <div className="mt-8 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
          <div className="hidden grid-cols-[minmax(14rem,1fr)_6rem_10rem_7rem_7rem_3rem] gap-3 border-b border-[var(--color-border)] px-5 py-3 text-xs font-semibold text-[var(--color-text-muted)] xl:grid">
            <span>Producto</span>
            <span className="text-center">SKU</span>
            <span className="text-center">Cantidad</span>
            <span className="text-right">Precio unit.</span>
            <span className="text-center">Total</span>
            <span className="text-right">Acción</span>
          </div>
          {items.map((item) => {
            return (
            <article
              key={item.productId}
              className="grid min-h-32 gap-3 border-b border-[var(--color-border)] px-4 py-5 transition last:border-b-0 hover:bg-slate-50/70 sm:px-5 xl:grid-cols-[minmax(14rem,1fr)_6rem_10rem_7rem_7rem_3rem] xl:items-center"
            >
              <div className="flex min-w-0 items-center gap-4">
                {item.imageUrl ? (
                  <Image
                    alt={item.imageAlt ?? item.name}
                    className="h-20 w-20 shrink-0 rounded-xl border border-[var(--color-border)] bg-slate-50 object-contain object-center p-2"
                    height={80}
                    src={item.imageUrl}
                    width={80}
                  />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-slate-50 text-center text-xs text-[var(--color-text-muted)]">
                    Sin imagen
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="mt-1 break-words text-lg font-black text-[var(--color-text)] xl:truncate">
                    {item.name}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    Producto disponible para compra en línea
                  </p>
                </div>
              </div>
              <p className="break-words text-sm font-mono text-[var(--color-text-muted)] xl:text-center">{item.sku}</p>
              <div className="flex items-center justify-between gap-4 xl:block xl:justify-self-center">
                <span className="text-sm font-bold text-[var(--color-text-muted)] xl:hidden">
                  Cantidad
                </span>
                <div className="flex w-fit items-center rounded-xl border border-[var(--color-border)] bg-slate-50">
                  <button
                    aria-label={`Reducir cantidad de ${item.name}`}
                    className="px-4 py-2 font-black disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={item.quantity <= 1}
                    onClick={() => {
                      const nextQuantity = item.quantity - 1;
                      updateQuantity(item.productId, nextQuantity);
                      setQuantityInput(item.productId, nextQuantity);
                    }}
                    type="button"
                  >
                    −
                  </button>
                  <input
                    aria-label={`Cantidad de ${item.name}`}
                    className="w-14 bg-transparent py-2 text-center font-bold outline-none focus:bg-white focus:ring-2 focus:ring-[var(--color-primary)]/35"
                    inputMode="numeric"
                    maxLength={6}
                    onBlur={() => commitQuantityInput(item.productId, item.quantity)}
                    onChange={(event) =>
                      changeQuantityInput(item.productId, item.quantity, event.target.value)
                    }
                    type="text"
                    value={quantityInputs[item.productId] ?? String(item.quantity)}
                  />
                  <button
                    aria-label={`Aumentar cantidad de ${item.name}`}
                    className="px-4 py-2 font-black"
                    onClick={() => increaseQuantity(item.productId, item.quantity)}
                    type="button"
                  >
                    +
                  </button>
                </div>
              </div>
              <p className="flex justify-between text-base font-bold text-[var(--color-text)] xl:block xl:text-right">
                <span className="text-sm font-bold text-[var(--color-text-muted)] xl:hidden">
                  Precio unitario
                </span>
                Q{item.unitPrice.toFixed(2)}
              </p>
              <p className="flex justify-between text-lg font-black text-[var(--color-text)] xl:block xl:text-right">
                <span className="text-sm font-bold text-[var(--color-text-muted)] xl:hidden">
                  Total
                </span>
                Q{(item.unitPrice * item.quantity).toFixed(2)}
              </p>
              <button
                aria-label={`Quitar ${item.name}`}
                className="grid h-9 w-9 justify-self-end place-items-center rounded-full border border-[var(--color-danger)]/35 bg-red-50 text-xl font-black leading-none text-[var(--color-danger)] shadow-sm transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-[var(--color-danger)]/35"
                onClick={() => removeProduct(item.productId)}
                type="button"
              >
                ×
              </button>
            </article>
            );
          })}
        </div>
        <aside className="h-fit rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm">
          <p className="text-xl font-black text-[var(--color-text)]">Resumen de compra</p>
          <div className="mt-5 space-y-4 border-y border-[var(--color-border)] py-4">
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">
                Subtotal ({itemCount} {itemCount === 1 ? "producto" : "productos"})
              </span>
              <span className="font-bold text-[var(--color-text)]">Q{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--color-text-muted)]">Envío</span>
              <span className="font-bold text-[var(--color-text)]">
                {shippingTotal === 0 ? "Gratis" : `Q${shippingTotal.toFixed(2)}`}
              </span>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              {shippingTotal === 0
                ? "Tu compra tiene envío gratis."
                : `Envío gratis desde Q${STOREFRONT_FREE_SHIPPING_THRESHOLD.toFixed(2)}.`}
            </p>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <span className="font-black text-[var(--color-text)]">Total estimado</span>
            <span className="text-3xl font-black tracking-tight text-[var(--color-title)]">
              Q{total.toFixed(2)}
            </span>
          </div>
          <Link
            className="mt-6 block rounded-xl bg-[var(--color-primary)] px-4 py-3 text-center font-black text-[var(--color-topbar)] transition hover:bg-[var(--color-primary-hover)]"
          href={routes.checkout()}
          >
            Continuar al checkout
          </Link>
          <Link
            className="mt-4 block text-center text-sm font-bold text-[var(--color-title)] hover:underline"
          href={routes.catalog()}
          >
            Seguir comprando
          </Link>
        </aside>
      </div>
      <StorefrontUnavailableQuantityModal
        onClose={() => setUnavailableQuantityModalOpen(false)}
        open={unavailableQuantityModalOpen}
      />
    </main>
  );
}
