"use client";

import type { CustomerDto } from "@/modules/administration/application/dto/CustomerDto";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatDate } from "@/shared/utils/formatDate";

interface CustomerDetailViewProps {
  customer: CustomerDto;
}

export function CustomerDetailView({ customer }: CustomerDetailViewProps) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold text-[var(--color-title)]">{customer.code}</h3>
        <StatusBadge status={customer.status} />
      </div>

      <div className="rounded-lg bg-slate-50 px-4 py-3">
        <p className="text-sm font-semibold text-[var(--color-text)]">{customer.name}</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{customer.email}</p>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <dt className="font-medium text-[var(--color-text-muted)]">Total de compras</dt>
          <dd className="mt-1 text-lg font-bold tabular-nums text-[var(--color-title)]">
            {customer.purchaseCount}
          </dd>
        </div>
        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <dt className="font-medium text-[var(--color-text-muted)]">Cliente desde</dt>
          <dd className="mt-1 text-[var(--color-text)]">{formatDate(customer.createdAt)}</dd>
        </div>
      </dl>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-[var(--color-title)]">
          Productos comprados ({customer.topProducts.length})
        </h4>
        {customer.topProducts.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
            Sin registros de compras.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[var(--color-title)]">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Producto</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Cantidad</th>
                </tr>
              </thead>
              <tbody>
                {customer.topProducts.map((product, index) => (
                  <tr
                    className="border-t border-[var(--color-border)] transition-colors hover:bg-slate-50/70 motion-reduce:transition-none"
                    key={`${product.productName}-${index}`}
                  >
                    <td className="px-4 py-2.5 text-[var(--color-text)]">
                      {product.productName}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[var(--color-title)]">
                      {product.totalQuantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
