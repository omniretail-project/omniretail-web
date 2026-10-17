import Link from "next/link";
import { BASE_MONTHLY_QUETZALES, SUBSCRIPTION_ADDONS } from "@/core/subscription/catalog";

export default function LandingPricing() {
  const baseFeatures = [
    "Inventario",
    "Compras",
    "Recepciones",
    "Punto de Venta",
    "Lotes",
    "Vencimientos",
    "Números de serie",
  ];

  return (
    <section id="precios" className="bg-[var(--mkt-bg)] py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="mb-4 text-3xl font-bold text-[var(--mkt-primary)] md:text-4xl">
            Precios simples y transparentes
          </h2>
          <p className="text-lg text-[var(--mkt-muted)]">
            Comienza con la base sólida que tu negocio necesita y agrega funciones según tu crecimiento.
          </p>
        </div>

        <div className="mx-auto max-w-lg lg:max-w-none lg:flex lg:justify-center gap-8 items-stretch">
          {/* Base Plan */}
          <div className="flex flex-col rounded-3xl border border-[var(--mkt-border)] bg-[var(--mkt-surface)] p-8 shadow-[0_12px_28px_rgba(14,35,64,0.08)] lg:w-[400px]">
            <div className="mb-8">
              <h3 className="mb-2 text-2xl font-semibold text-[var(--mkt-primary)]">MARJYM Base</h3>
              <p className="text-[var(--color-title)]/70 text-sm mb-6">La solución integral para la gestión comercial y operativa diaria.</p>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-black tracking-tight text-[var(--mkt-primary)]">Q{BASE_MONTHLY_QUETZALES}</span>
                <span className="font-medium text-[var(--mkt-muted)]">/ mes</span>
              </div>
            </div>
            <ul className="flex-1 space-y-4 mb-8">
              {baseFeatures.map((feature, idx) => (
                <li key={idx} className="flex items-center gap-3 text-[var(--mkt-text)]">
                  <svg className="h-5 w-5 shrink-0 text-[var(--mkt-accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>
            <Link
              href="/contratar"
              className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[var(--mkt-accent)] px-8 text-base font-semibold text-white shadow transition-colors hover:bg-[var(--mkt-accent-hover)]"
            >
              Contratar MARJYM
            </Link>
          </div>

          {/* Addons Section */}
          <div className="mt-8 lg:mt-0 lg:w-[450px] flex flex-col justify-center gap-6">
            <h3 className="px-2 text-xl font-bold text-[var(--mkt-primary)]">
              Complementos adicionales
            </h3>
            <p className="mb-2 px-2 text-sm text-[var(--mkt-muted)]">
              Estos módulos pueden agregarse a tu plan Base en cualquier momento.
            </p>

            {SUBSCRIPTION_ADDONS.map((addon) => (
              <div key={addon.code} className="rounded-2xl border border-[var(--mkt-border-light)] bg-[var(--mkt-bg-alt)] p-6 transition-colors hover:border-[var(--mkt-border)]">
                <div className="flex justify-between items-start mb-3">
                  <h4 className="font-semibold text-[var(--color-title)]">{addon.name}</h4>
                  <div className="text-right">
                    <span className="font-bold text-[var(--color-title)]">Q{addon.monthlyQuetzales}</span>
                    <span className="text-[var(--color-title)]/60 text-sm"> / mes</span>
                  </div>
                </div>
                <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--mkt-accent)]">Disponible para activar después</p>
                {addon.code === "ecommerce_delivery" ? (
                  <p className="text-sm text-[var(--color-title)]/70">
                    Incluye catálogo en línea, carrito de compras, portal para clientes y seguimiento de pedidos.
                  </p>
                ) : (
                  <p className="text-sm text-[var(--color-title)]/70">
                    {addon.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
