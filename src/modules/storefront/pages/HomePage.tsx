"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StorefrontProductCard } from "@/modules/storefront/components/StorefrontProductCard";
import { StorefrontCatalogImage } from "@/modules/storefront/components/StorefrontCatalogImage";
import { StorefrontHorizontalCarousel } from "@/modules/storefront/components/StorefrontHorizontalCarousel";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useStorefrontDiscovery } from "@/modules/storefront/hooks/useStorefrontDiscovery";
import { useStorefrontOffers } from "@/modules/storefront/hooks/useStorefrontOffers";
import { useStorefrontRoutes } from "@/modules/storefront/hooks/useStorefrontRoutes";

const FALLBACK_HERO_SLIDE = {
  title: "Bienvenido a nuestra tienda",
  description: "Descubrí los productos disponibles para comprar en línea.",
  imageSource: undefined,
} as const;

export function HomePage() {
  const routes = useStorefrontRoutes();
  const { config } = usePublicTenant();
  const { categories, products, loading, error } = useStorefrontDiscovery();
  const { items: offers } = useStorefrontOffers();
  const slides = useMemo(() => {
    const configuredSlides = config?.heroBanner.slides ?? [];
    return configuredSlides.length > 0 ? configuredSlides : [FALLBACK_HERO_SLIDE];
  }, [config]);
  const [activeSlide, setActiveSlide] = useState(0);
  const slide = slides[activeSlide % Math.max(slides.length, 1)];
  const featuredProducts = useMemo(() => {
    const offersByProductId = new Map(offers.map((offer) => [offer.productId, offer]));
    return [...products]
      .sort(
        (left, right) =>
          Number(offersByProductId.has(right.id)) - Number(offersByProductId.has(left.id)),
      )
      .slice(0, 8)
      .map((product) => ({ product, offer: offersByProductId.get(product.id) }));
  }, [offers, products]);
  useEffect(() => {
    if (slides.length < 2) return;
    const timer = window.setInterval(
      () => setActiveSlide((current) => (current + 1) % slides.length),
      9000,
    );
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const showPreviousSlide = () =>
    setActiveSlide((current) => (current - 1 + slides.length) % slides.length);
  const showNextSlide = () => setActiveSlide((current) => (current + 1) % slides.length);
  return (
    <main>
      <section className="mx-auto max-w-[90rem] px-4 py-8 sm:px-5 sm:py-10">
        <div className="relative min-h-[26rem] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm sm:min-h-[30rem]">
          {slide?.imageSource ? (
            <>
              <StorefrontCatalogImage
                alt={slide.title}
                className="absolute inset-0 z-0 h-full w-full object-cover object-center"
                fetchPriority="high"
                loading="eager"
                source={slide.imageSource}
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 z-10 bg-gradient-to-r from-white via-white/25 via-35% to-transparent"
              />
              <div className="relative z-20 flex min-h-[26rem] max-w-xl flex-col justify-center px-7 py-14 sm:min-h-[30rem] sm:px-12">
                <h1 className="mt-5 text-4xl font-black leading-tight text-[var(--color-text)] sm:text-5xl">
                  {slide.title}
                </h1>
                <p className="mt-4 max-w-lg text-base leading-7 text-[var(--color-text-muted)] sm:text-lg">
                  {slide.description}
                </p>
                <div className="mt-7 flex flex-wrap gap-3">
                  <Link
                    className="rounded-xl bg-[var(--color-primary)] px-5 py-3 font-bold text-[var(--color-topbar)] transition hover:bg-[var(--color-primary-hover)]"
          href={routes.catalog()}
                  >
                    Explorar catálogo →
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[26rem] flex-col justify-center px-7 sm:min-h-[30rem] sm:px-12">
              <h1 className="mt-4 text-4xl font-black text-[var(--color-text)] sm:text-5xl">
                {slide.title}
              </h1>
              {slide.description ? (
                <p className="mt-4 max-w-lg text-base leading-7 text-[var(--color-text-muted)] sm:text-lg">
                  {slide.description}
                </p>
              ) : null}
              <Link
                className="mt-7 w-fit rounded-xl bg-[var(--color-primary)] px-5 py-3 font-bold text-[var(--color-topbar)]"
          href={routes.catalog()}
              >
                Explorar catálogo
              </Link>
            </div>
          )}
          {slides.length > 1 ? (
            <>
              <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2">
                {slides.map((item, index) => (
                  <button
                    aria-label={`Ver diapositiva ${index + 1}`}
                    className={`h-2.5 rounded-full transition ${index === activeSlide ? "w-7 bg-[var(--color-primary-hover)]" : "w-2.5 bg-[var(--color-border)]"}`}
                    key={`${item.title}-${index}`}
                    onClick={() => setActiveSlide(index)}
                    type="button"
                  />
                ))}
              </div>
              <div className="absolute bottom-5 right-5 z-20 flex gap-2">
                <button
                  aria-label="Diapositiva anterior"
                  className="grid h-11 w-11 place-items-center rounded-full border border-[var(--color-primary-hover)] bg-white/90 text-2xl text-[var(--color-title)] transition hover:bg-[var(--color-primary)]"
                  onClick={showPreviousSlide}
                  type="button"
                >
                  ‹
                </button>
                <button
                  aria-label="Diapositiva siguiente"
                  className="grid h-11 w-11 place-items-center rounded-full border border-[var(--color-primary-hover)] bg-white/90 text-2xl text-[var(--color-title)] transition hover:bg-[var(--color-primary)]"
                  onClick={showNextSlide}
                  type="button"
                >
                  ›
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
      <section className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto grid max-w-[90rem] grid-cols-1 gap-3 px-4 py-5 text-sm sm:grid-cols-3 sm:gap-5 sm:px-5">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
            <p className="font-bold text-[var(--color-title)]">Productos publicados</p>
            <p className="mt-1 text-[var(--color-text-muted)]">
              Consulta opciones disponibles para compra en línea.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
            <p className="font-bold text-[var(--color-title)]">Ofertas vigentes</p>
            <p className="mt-1 text-[var(--color-text-muted)]">
              Los precios promocionales se muestran con claridad.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0">
            <p className="font-bold text-[var(--color-title)]">Seguimiento de pedido</p>
            <p className="mt-1 text-[var(--color-text-muted)]">
              Mantente al tanto del estado de tu compra.
            </p>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-[90rem] px-4 py-14 sm:px-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
              Explora
            </p>
            <h2 className="mt-1 text-3xl font-black text-[var(--color-text)]">
              Compra por categoría
            </h2>
          </div>
      <Link className="text-sm font-bold text-[var(--color-title)]" href={routes.catalog()}>
            Ver todo →
          </Link>
        </div>
        {loading ? (
          <p className="mt-6 text-[var(--color-text-muted)]">Cargando categorías...</p>
        ) : null}
        {error ? <p className="mt-6 text-[var(--color-danger)]">{error}</p> : null}
        {!loading && !error ? (
          <StorefrontHorizontalCarousel ariaLabel="Categorías disponibles">
            {categories.map((category) => (
              <Link
                key={category.name}
                className="group w-36 shrink-0 snap-start text-center sm:w-40"
                href={routes.catalogCategory(category.id)}
              >
                <StorefrontCatalogImage
                  alt={category.name}
                  className="aspect-square w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] object-cover p-3 shadow-sm transition duration-300 group-hover:-translate-y-1 group-hover:border-[var(--color-primary)] group-hover:shadow-md"
                  decoding="async"
                  loading="lazy"
                  source={category.imageSource}
                />
                <p className="mt-3 font-bold text-[var(--color-text)]">{category.name}</p>
              </Link>
            ))}
          </StorefrontHorizontalCarousel>
        ) : null}
      </section>
      <section className="mx-auto max-w-[90rem] px-4 py-14 sm:px-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-[var(--color-primary-hover)]">
              Selección para ti
            </p>
            <h2 className="mt-1 text-3xl font-black text-[var(--color-text)]">
              Productos destacados
            </h2>
          </div>
      <Link className="text-sm font-bold text-[var(--color-title)]" href={routes.catalog()}>
            Ver catálogo →
          </Link>
        </div>
        {!loading && featuredProducts.length > 0 ? (
          <StorefrontHorizontalCarousel ariaLabel="Productos destacados">
            {featuredProducts.map(({ product, offer }) => (
              <div
                className="w-[92%] shrink-0 snap-start sm:w-[calc((100%_-_1.25rem)/2)] lg:w-[calc((100%_-_3.75rem)/4)]"
                key={product.id}
              >
                <StorefrontProductCard
                  offer={
                    offer
                      ? { originalPrice: offer.basePrice, promotionName: offer.promotionName }
                      : undefined
                  }
                  product={{ ...product, salePrice: offer?.effectivePrice ?? product.salePrice }}
                  uniformHeight
                />
              </div>
            ))}
          </StorefrontHorizontalCarousel>
        ) : null}
      </section>
    </main>
  );
}
