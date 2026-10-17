import type { DashboardTopProduct } from "@/modules/administration/application/dto/DashboardDto";
import { formatCurrency } from "@/shared/utils/formatCurrency";

interface DashboardTopProductsProps {
  loading: boolean;
  products: DashboardTopProduct[];
}

export function DashboardTopProducts({ loading, products }: DashboardTopProductsProps) {
  const maxQuantity = products.length > 0 ? products[0].totalQuantity : 0;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-[var(--color-title)]">Productos más vendidos</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Top 10 por cantidad vendida en el mes.
        </p>
      </div>

      {loading ? (
        <div aria-live="polite" className="mt-4 space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div
              className="h-10 animate-pulse rounded-lg bg-slate-100"
              key={item}
            />
          ))}
          <span className="sr-only">Cargando productos...</span>
        </div>
      ) : products.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-slate-50 px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">
          No hay ventas registradas este mes.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-border)]">
          {products.map((product, index) => {
            const barWidth = maxQuantity > 0
              ? Math.max(4, (product.totalQuantity / maxQuantity) * 100)
              : 0;

            return (
              <li className="group py-3 first:pt-0 last:pb-0" key={`${product.productName}-${index}`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-[var(--color-title)]">
                      {index + 1}
                    </span>
                    <span className="truncate font-medium text-[var(--color-text)]">
                      {product.productName}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <span className="font-semibold text-[var(--color-title)]">
                      {product.totalQuantity} uds
                    </span>
                    <span className="text-[var(--color-text-muted)]">
                      {formatCurrency(product.totalRevenue)}
                    </span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[var(--color-structure)] transition-all duration-500"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
