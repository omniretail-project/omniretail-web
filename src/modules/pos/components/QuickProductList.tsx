import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import { Button } from "@/shared/components/Button";
import { formatCurrency } from "@/shared/utils/formatCurrency";

interface QuickProductListProps {
  products: PosProductDto[];
  hasProducts: boolean;
  loading: boolean;
  error: string | null;
  onAdd: (product: PosProductDto) => void;
}

export function QuickProductList({
  products,
  hasProducts,
  loading,
  error,
  onAdd,
}: QuickProductListProps) {
  if (error) {
    return (
      <p className="rounded-md border border-[var(--color-danger)] px-4 py-3 text-sm font-medium text-[var(--color-danger)]">
        {error}
      </p>
    );
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Cargando productos...</p>;
  }

  if (products.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-4 py-8 text-center">
        <p className="font-semibold text-[var(--color-text)]">
          {hasProducts ? "No encontramos productos" : "No hay productos disponibles"}
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {hasProducts
            ? "Prueba con otro nombre, código, SKU o código de barras."
            : "No hay productos disponibles para POS en esta sucursal."}
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {products.map((product) => {
        const hasAvailableStock = !product.tracksStock || (product.availableQuantity ?? 0) > 0;
        const hasUnsupportedTraceability = product.requiresUnsupportedTraceability;
        const canAdd =
          !hasUnsupportedTraceability && hasAvailableStock && product.isAvailableForSale;
        const buttonLabel = hasUnsupportedTraceability
          ? "No disponible"
          : hasAvailableStock
            ? canAdd
              ? "Agregar"
              : "No disponible"
            : "Sin existencia";

        return (
          <li
            className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-white p-3 transition-shadow hover:shadow-sm"
            key={product.productId}
          >
            <div className="min-w-0">
              <p className="truncate font-semibold text-[var(--color-title)]">{product.name}</p>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                {product.sku}
                {product.barcode ? ` · ${product.barcode}` : ""}
              </p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-lg font-bold leading-none text-[var(--color-title)]">
                    {formatCurrency(product.effectivePrice)}
                  </p>
                  {product.discount > 0 ? (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Antes {formatCurrency(product.basePrice)}
                    </p>
                  ) : null}
                </div>
                <p className="max-w-28 text-right text-xs font-medium text-[var(--color-text-muted)]">
                  {product.tracksStock
                    ? `${product.availableQuantity ?? 0} ${product.saleUnitName} disponibles`
                    : "Sin control de existencia"}
                </p>
              </div>
              {hasUnsupportedTraceability ? (
                <p className="mt-2 text-xs font-semibold text-[var(--color-warning)]">
                  Este producto requiere un proceso de venta distinto.
                </p>
              ) : null}
            </div>

            <Button
              className="w-full sm:w-auto sm:self-end"
              disabled={!canAdd}
              onClick={() => onAdd(product)}
              type="button"
              variant="secondary"
            >
              {buttonLabel}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
