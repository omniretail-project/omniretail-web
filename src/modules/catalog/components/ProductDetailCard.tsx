"use client";

import { StatusBadge } from "@/shared/components/StatusBadge";
import { CatalogImage } from "@/modules/catalog/components/CatalogImage";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import type { ProductDetailViewModel } from "@/modules/catalog/types/catalog.types";
import {
  formatChannels,
  formatTracking,
  productTypeLabels,
} from "@/modules/catalog/components/productLabels";

interface ProductDetailCardProps {
  detail: ProductDetailViewModel;
}

export function ProductDetailCard({ detail }: ProductDetailCardProps) {
  const { product } = detail;

  return (
    <section className="grid gap-6 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5 lg:grid-cols-[280px_1fr]">
      <CatalogImage
        alt={product.name}
        className="mx-auto aspect-square w-full max-w-72 rounded-md border border-[var(--color-border)] object-cover lg:mx-0"
        source={detail.imageSource}
        tenantId={product.tenantId}
      />
      <div className="space-y-5">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={product.status} />
            <span className="rounded-md bg-[var(--color-app-background)] px-2 py-1 text-xs font-semibold text-[var(--color-title)]">
              {productTypeLabels[product.productType]}
            </span>
          </div>
          <h2 className="break-words text-2xl font-bold text-[var(--color-title)]">
            {product.name}
          </h2>
          {product.description ? (
            <p className="mt-2 text-sm text-[var(--color-text)]">{product.description}</p>
          ) : null}
        </div>
        <dl className="grid gap-4 md:grid-cols-2">
          <DetailItem label="Codigo / SKU" value={product.sku} />
          <DetailItem label="Codigo de barras" value={product.barcode ?? "No registrado"} />
          <DetailItem label="Marca" value={product.brand ?? "Sin marca"} />
          <DetailItem label="Categoria" value={detail.category?.name ?? "Sin categoria"} />
          <DetailItem label="Unidad base" value={detail.unit?.name ?? "Sin unidad"} />
          <DetailItem label="Precio" value={formatCurrency(product.salePrice)} />
          <DetailItem label="Canales" value={formatChannels(product.channels)} />
          <DetailItem label="Tracking" value={formatTracking(product.tracking)} />
        </dl>
      </div>
    </section>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}
