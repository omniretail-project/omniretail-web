"use client";

import { Modal } from "@/shared/components/Modal";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import type { ProductListItem } from "@/modules/catalog/types/catalog.types";
import { useProductPriceHistory } from "@/modules/catalog/hooks/useProductPriceHistory";

interface ProductPriceHistoryDialogProps {
  product: ProductListItem | null;
  onClose: () => void;
}

export function ProductPriceHistoryDialog({ product, onClose }: ProductPriceHistoryDialogProps) {
  const { data, error, loading } = useProductPriceHistory(product?.id ?? null);
  const currentProduct = data?.product ?? product;
  const history = data?.history ?? [];

  return (
    <Modal
      open={Boolean(product)}
      maxWidth="820px"
      size="lg"
      subtitle={currentProduct?.name}
      title="Historial de precios"
      onClose={onClose}
    >
      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Cargando historial...</p>
      ) : error ? (
        <p className="rounded-md border border-[var(--color-danger)] p-3 text-sm font-medium text-[var(--color-danger)]">
          {error}
        </p>
      ) : history.length ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-[var(--color-app-background)] text-xs uppercase text-[var(--color-title)]">
              <tr>
                <th className="px-4 py-3 font-bold">Fecha</th>
                <th className="px-4 py-3 text-right font-bold">Anterior</th>
                <th className="px-4 py-3 text-right font-bold">Nuevo</th>
                <th className="px-4 py-3 font-bold">Responsable</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr className="border-t border-[var(--color-border)]" key={item.id}>
                  <td className="px-4 py-3 text-[var(--color-text)]">
                    {formatDateTime(item.changedAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[var(--color-text-muted)]">
                    {formatCurrency(item.previousPrice)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-[var(--color-title)]">
                    {formatCurrency(item.newPrice)}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {item.actorUserId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 text-sm text-[var(--color-text)]">
          Aún no hay cambios de precio registrados.
        </p>
      )}
    </Modal>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
