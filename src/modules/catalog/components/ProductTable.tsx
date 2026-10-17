"use client";

import type { ReactNode } from "react";
import { ProductStatus, ProductType } from "@/core/enums";
import { ProductActionsMenu } from "@/modules/catalog/components/ProductActionsMenu";
import { CatalogImage } from "@/modules/catalog/components/CatalogImage";
import { GlobeIcon, MobileIcon, PosIcon, TagIcon } from "@/modules/catalog/components/CatalogIcons";
import { productTypeLabels } from "@/modules/catalog/components/productLabels";
import type { ProductListItem } from "@/modules/catalog/types/catalog.types";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";
import { formatCurrency } from "@/shared/utils/formatCurrency";

interface ProductTableProps {
  canUpdate: boolean;
  inventoryAdjustmentEnabled: boolean;
  priceHistoryEnabled: boolean;
  promotionsEnabled: boolean;
  products: ProductListItem[];
  emptyMessage: string;
  onOpenQuickView: (product: ProductListItem) => void;
  onPromotion: (product: ProductListItem) => void;
  onPriceHistory: (product: ProductListItem) => void;
  onArchive: (product: ProductListItem) => void;
  onRestore: (product: ProductListItem) => void;
  footer?: ReactNode;
  /** Filas previas mientras llega la nueva pagina/filtro: atenuadas y sin interaccion. */
  refreshing?: boolean;
}

export function ProductTable({
  canUpdate,
  inventoryAdjustmentEnabled,
  priceHistoryEnabled,
  promotionsEnabled,
  products,
  emptyMessage,
  onOpenQuickView,
  onPromotion,
  onPriceHistory,
  onArchive,
  onRestore,
  footer,
  refreshing = false,
}: ProductTableProps) {
  return (
    <div className="max-w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
      <div
        aria-busy={refreshing}
        className={cn("overflow-x-auto transition-opacity", refreshing && "opacity-60")}
        inert={refreshing}
      >
        <table className="w-full min-w-[640px] border-collapse text-left text-sm lg:min-w-[920px]">
          <thead className="bg-[var(--color-structure)] text-xs uppercase text-white">
            <tr>
              <th className="px-4 py-3 font-semibold">Producto</th>
              <th className="hidden px-4 py-3 font-semibold lg:table-cell">Categoría</th>
              <th className="px-4 py-3 font-semibold">Precio</th>
              <th className="hidden px-4 py-3 font-semibold md:table-cell">Unidad</th>
              <th className="hidden px-4 py-3 font-semibold lg:table-cell">Canales</th>
              <th className="hidden px-4 py-3 font-semibold xl:table-cell">Promoción</th>
              <th className="w-24 px-4 py-3 text-right font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-center text-[var(--color-text-muted)]" colSpan={7}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr
                  className={cn(
                    "cursor-pointer border-t border-[var(--color-border)] transition hover:bg-[var(--color-primary)]/5 focus:bg-[var(--color-primary)]/5 focus:outline focus:outline-2 focus:outline-inset focus:outline-[var(--color-structure)]",
                    product.status === ProductStatus.archived && "bg-slate-50/70 opacity-75",
                  )}
                  key={product.id}
                  onClick={() => onOpenQuickView(product)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onOpenQuickView(product);
                  }}
                  tabIndex={0}
                >
                  <td className="min-w-[300px] px-4 py-3 sm:min-w-[360px]">
                    <div className="flex items-center gap-3">
                      <CatalogImage
                        alt={product.name}
                        className="h-11 w-11 rounded-md border border-[var(--color-border)] object-contain"
                        decoding="async"
                        loading="lazy"
                        source={product.imageSource}
                        tenantId={product.tenantId}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-[var(--color-title)]">
                          {product.name}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <StatusBadge status={product.status} />
                          <span className="inline-flex rounded-md bg-[var(--color-app-background)] px-2 py-1 text-xs font-semibold text-[var(--color-title)]">
                            {productTypeLabels[product.productType]}
                          </span>
                          {product.productType === ProductType.physical &&
                          product.tracking.stock && product.availableQuantity === 0 ? (
                            inventoryAdjustmentEnabled ? (
                              <a
                                className="inline-flex rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 hover:underline"
                                href={`/inventario/alertas?productId=${encodeURIComponent(product.id)}&openAdjustment=1`}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                Sin existencia · Agregar existencia
                              </a>
                            ) : (
                              <span className="inline-flex rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
                                Sin existencia
                              </span>
                            )
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          SKU {product.sku}
                          {product.brand ? ` · ${product.brand}` : ""}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-text)] lg:table-cell">
                    {product.categoryName}
                  </td>
                  <td className="px-4 py-3">
                    {product.activePromotion ? (
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-text-muted)] line-through">
                          {formatCurrency(product.salePrice)}
                        </p>
                        <p className="mt-0.5 text-sm font-bold text-[var(--color-title)]">
                          {formatCurrency(product.activePromotion.effectivePrice)}
                        </p>
                      </div>
                    ) : (
                      <p className="font-semibold text-[var(--color-text)]">
                        {formatCurrency(product.salePrice)}
                      </p>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-[var(--color-text)] md:table-cell">
                    {product.baseUnitName}
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <div className="flex flex-wrap gap-1.5">
                      <ChannelChip active={product.channels.pos} icon={<PosIcon />}>
                        POS
                      </ChannelChip>
                      <ChannelChip active={product.channels.ecommerce} icon={<GlobeIcon />}>
                        Web
                      </ChannelChip>
                      <ChannelChip active={product.channels.mobileApp} icon={<MobileIcon />}>
                        App
                      </ChannelChip>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 xl:table-cell">
                    {product.activePromotion ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2.5 py-1 text-xs font-semibold text-[var(--color-title)]">
                        <TagIcon />
                        {product.activePromotion.label}
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-[var(--color-text-muted)]">
                        Sin promoción
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ProductActionsMenu
                      canUpdate={canUpdate}
                      priceHistoryEnabled={priceHistoryEnabled}
                      promotionsEnabled={promotionsEnabled}
                      onArchive={onArchive}
                      onPriceHistory={onPriceHistory}
                      onPromotion={onPromotion}
                      onRestore={onRestore}
                      product={product}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer ? (
        <div className="border-t border-[var(--color-border)] px-4 py-3">{footer}</div>
      ) : null}
    </div>
  );
}

function ChannelChip({
  active,
  children,
  icon,
}: {
  active: boolean;
  children: string;
  icon: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
          : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)]",
      )}
    >
      {icon}
      {children}
    </span>
  );
}
