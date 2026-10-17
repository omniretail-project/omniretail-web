"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Promotion } from "@/core/entities";
import { ProductStatus, ProductType, PromotionStatus, PromotionType } from "@/core/enums";
import { calculateEffectivePrice } from "@/core/pricing";
import { Button } from "@/shared/components/Button";
import { CatalogImage } from "@/modules/catalog/components/CatalogImage";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { cn } from "@/shared/utils/cn";
import { formatTracking, productTypeLabels } from "@/modules/catalog/components/productLabels";
import {
  CheckIcon,
  GlobeIcon,
  MobileIcon,
  PencilIcon,
  PosIcon,
} from "@/modules/catalog/components/CatalogIcons";
import type { InventoryStockStatus } from "@/core/repositories";
import { useProductQuickView } from "@/modules/catalog/hooks/useProductQuickView";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import type { ProductQuickViewModel } from "@/modules/catalog/types/catalog.types";

type QuickViewTab = "general" | "inventory" | "suppliers";

interface ProductQuickViewProps {
  canUpdate: boolean;
  /** Id del producto a consultar (viene de ?quickView=); el detalle se carga por id, no del listado. */
  productId: string | null;
  onClose: () => void;
  onRestore: (product: { id: string }) => void;
}

const tabs: { id: QuickViewTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "inventory", label: "Inventario" },
  { id: "suppliers", label: "Proveedores" },
];

export function ProductQuickView({
  canUpdate,
  productId,
  onClose,
  onRestore,
}: ProductQuickViewProps) {
  const router = useRouter();
  const { currentBranch } = useActiveBranch();
  const branchId = currentBranch?.id;
  const branchTenantId = currentBranch?.tenantId;
  const branchName = currentBranch?.name;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<QuickViewTab>("general");
  const { loading, data, error } = useProductQuickView(
    productId,
    branchId,
    branchTenantId,
    branchName,
  );
  const open = Boolean(productId);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
  }, [open, productId]);

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const detail = data;
  const title = detail?.product.name ?? "Producto";
  const sku = detail?.product.sku ?? "";

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <button
        aria-label="Cerrar consulta rápida"
        className="absolute inset-0 bg-[var(--color-topbar)]/25"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label="Consulta rápida de producto"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-[540px] flex-col overflow-hidden border-l border-[var(--color-border)] bg-white shadow-xl sm:w-[min(94vw,540px)]"
        role="dialog"
      >
        <header className="border-b border-[var(--color-border)] px-4 py-4 sm:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                PRODUCTO
              </p>
              <h2 className="mt-1 break-words text-xl font-bold text-[var(--color-title)]">
                {title}
              </h2>
              <p className="mt-1 text-xs font-semibold text-[var(--color-text-muted)]">SKU {sku}</p>
            </div>
            <button
              aria-label="Cerrar"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-lg font-bold text-[var(--color-title)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist">
            {tabs.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
                  activeTab === tab.id
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-title)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-app-background)]/70",
                )}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-5 sm:px-5">
          {loading ? (
            <p className="text-sm text-[var(--color-text-muted)]">Cargando consulta rápida...</p>
          ) : error ? (
            <p className="rounded-md border border-[var(--color-danger)] p-3 text-sm font-medium text-[var(--color-danger)]">
              {error}
            </p>
          ) : !detail ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              El producto solicitado no existe.
            </p>
          ) : (
            <>
              {activeTab === "general" ? <QuickViewGeneral detail={detail} /> : null}
              {activeTab === "inventory" ? (
                <QuickViewInventory activeBranchId={branchId} detail={detail} />
              ) : null}
              {activeTab === "suppliers" ? <QuickViewSuppliers detail={detail} /> : null}
            </>
          )}
        </div>
        {detail && canUpdate ? (
          <footer className="border-t border-[var(--color-border)] px-4 py-4 sm:px-5">
            {detail.product.status === ProductStatus.published ? (
              <Button
                className="w-full"
                onClick={() => router.push(`/catalogo/productos/${detail.product.id}/editar`)}
                type="button"
              >
                <PencilIcon />
                Editar producto
              </Button>
            ) : null}
            {detail.product.status === ProductStatus.archived ? (
              <Button
                className="w-full"
                onClick={() => {
                  onClose();
                  onRestore({ id: detail.product.id });
                }}
                type="button"
              >
                <CheckIcon />
                Restaurar producto
              </Button>
            ) : null}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

function QuickViewGeneral({ detail }: { detail: ProductQuickViewModel }) {
  const { product } = detail;
  const [nowTimestamp] = useState(() => Date.now());
  const activePromotion =
    product.status === ProductStatus.published
      ? getCurrentPromotion(detail.promotions, nowTimestamp)
      : undefined;
  const effectivePrice = activePromotion
    ? calculateEffectivePrice(product.salePrice, activePromotion)
    : null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-app-background)] p-3">
        <CatalogImage
          alt={product.name}
          className="mx-auto h-44 max-h-56 w-full object-contain sm:h-56"
          source={detail.imageSource}
          tenantId={product.tenantId}
        />
      </div>
      {activePromotion && effectivePrice ? (
        <section className="rounded-xl border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 p-4">
          <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
            Promoción activa
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <DetailItem label="Precio regular" value={formatCurrency(effectivePrice.basePrice)} />
            <DetailItem
              label="Precio promocional"
              value={formatCurrency(effectivePrice.effectivePrice)}
            />
            <DetailItem label="Tipo" value={promotionTypeLabels[activePromotion.type]} />
          </div>
        </section>
      ) : null}
      <dl className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-white p-4 md:grid-cols-2">
        <DetailItem label="Marca" value={product.brand ?? "Sin marca"} />
        <DetailItem label="Categoría" value={detail.category?.name ?? "Sin categoría"} />
        <DetailItem label="Unidad" value={detail.unit?.name ?? "Sin unidad"} />
        <DetailItem label="Estado" value={<StatusBadge status={product.status} />} />
        <DetailItem label="Precio" value={formatCurrency(product.salePrice)} />
        <DetailItem label="Tipo" value={productTypeLabels[product.productType]} />
        <DetailItem label="Canales" value={<ChannelSummary product={product} />} />
        <DetailItem label="Tracking" value={formatTracking(product.tracking)} />
      </dl>
    </div>
  );
}

const stockStatusLabels: Record<InventoryStockStatus, string> = {
  normal: "Normal",
  near_minimum: "Cerca del mínimo",
  critical: "Crítico",
  out_of_stock: "Sin existencias",
};

function QuickViewInventory({
  detail,
  activeBranchId,
}: {
  detail: ProductQuickViewModel;
  activeBranchId?: string;
}) {
  if (detail.product.productType === ProductType.service) {
    return <EmptyPanel message="Los servicios no utilizan control de inventario." />;
  }

  if (detail.product.productType === ProductType.kit) {
    return <EmptyPanel message="Los kits no administran inventario propio." />;
  }

  if (!detail.product.tracking.stock) {
    return <EmptyPanel message="Este producto no controla existencias." />;
  }

  if (!activeBranchId && !detail.inventory.length) {
    return <EmptyPanel message="Selecciona una sucursal para consultar las existencias." />;
  }

  if (!detail.inventory.length) {
    const loadedBranchId = detail.inventoryStock?.branchId ?? detail.inventorySettings?.branchId;
    if (loadedBranchId && loadedBranchId !== activeBranchId) {
      // Respuesta de otra sucursal mientras llega la nueva: no se muestra como existencia actual.
      return <p className="text-sm text-[var(--color-text-muted)]">Cargando consulta rápida...</p>;
    }

    if (detail.inventoryStock || detail.inventorySettings) {
      const stock = detail.inventoryStock;
      const settings = detail.inventorySettings;
      const minStock = stock ? stock.item.minStock : settings?.minStock;
      const reorderPoint = stock ? stock.item.reorderPoint : settings?.reorderPoint;
      return (
        <article className="rounded-md border border-[var(--color-border)] bg-white p-4">
          <div>
            <h3 className="font-semibold text-[var(--color-title)]">
              {stock?.branchName ?? settings?.branchName}
            </h3>
            {settings ? (
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {settings.defaultLocationName ?? "Sin ubicación predeterminada"}
              </p>
            ) : null}
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            {stock ? (
              <>
                <DetailItem label="Físico sucursal" value={String(stock.item.quantity)} />
                <DetailItem
                  label="Reservado sucursal"
                  value={String(stock.item.reservedQuantity)}
                />
                <DetailItem
                  label="Disponible agregado"
                  value={String(stock.item.availableQuantity)}
                />
                {stock.operational ? (
                  <>
                    <DetailItem
                      label="Existencia operativa"
                      value={String(stock.operational.quantity)}
                    />
                    <DetailItem
                      label="Reservado operativo"
                      value={String(stock.operational.reservedQuantity)}
                    />
                    <DetailItem
                      label="Disponible vendible"
                      value={String(stock.operational.availableQuantity)}
                    />
                  </>
                ) : null}
              </>
            ) : null}
            {minStock !== undefined && minStock !== null ? (
              <DetailItem label="Mínimo" value={String(minStock)} />
            ) : null}
            <DetailItem
              label="Punto de reorden"
              value={
                reorderPoint === undefined || reorderPoint === null
                  ? "No configurado"
                  : String(reorderPoint)
              }
            />
            {stock ? (
              <DetailItem label="Estado" value={stockStatusLabels[stock.item.status]} />
            ) : null}
          </dl>
          {stock && !stock.operational ? (
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              No se pudo validar de forma segura el balance operativo; el agregado de sucursal no se
              considera disponibilidad vendible.
            </p>
          ) : null}
          {detail.inventoryStockFailed ? (
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              No se pudo cargar la información de inventario.
            </p>
          ) : null}
        </article>
      );
    }

    if (detail.inventoryStockFailed) {
      return <EmptyPanel message="No se pudo cargar la información de inventario." />;
    }

    return (
      <EmptyPanel
        message={
          detail.inventorySettingsAvailable
            ? "No hay configuración de inventario para este producto en la sucursal activa."
            : "La configuración de inventario no está disponible para la sucursal activa o sus permisos."
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {detail.inventory.map((item) => (
        <article
          className="rounded-md border border-[var(--color-border)] bg-white p-4"
          key={item.balance.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--color-title)]">{item.branchName}</h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {item.locationName ?? "Sin ubicación principal"}
              </p>
            </div>
            <span className="rounded-md bg-[var(--color-app-background)] px-2 py-1 text-xs font-semibold text-[var(--color-title)]">
              {item.stockStatus}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <DetailItem label="Stock" value={String(item.balance.quantity)} />
            <DetailItem label="Reservado" value={String(item.balance.reservedQuantity)} />
            <DetailItem
              label="Disponible"
              value={String(Math.max(0, item.balance.quantity - item.balance.reservedQuantity))}
            />
            <DetailItem label="Mínimo" value={String(item.balance.minStock ?? "-")} />
          </dl>
        </article>
      ))}
    </div>
  );
}

function QuickViewSuppliers({ detail }: { detail: ProductQuickViewModel }) {
  if (!detail.suppliersAvailable) {
    return (
      <EmptyPanel message="La información de proveedores no está disponible con los permisos actuales." />
    );
  }

  if (!detail.suppliers.length) {
    return <EmptyPanel message="No hay proveedores asociados a este producto." />;
  }

  return (
    <div className="space-y-3">
      {detail.suppliers.map((item) => (
        <article
          className="rounded-md border border-[var(--color-border)] bg-white p-4"
          key={item.supplierProduct.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-[var(--color-title)]">{item.supplier.name}</h3>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {item.supplierProduct.supplierSku ?? "Sin código de proveedor"}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {item.supplierProduct.preferred ? (
                <span className="rounded-md bg-[var(--color-primary)]/10 px-2 py-1 text-xs font-semibold text-[var(--color-title)]">
                  Preferido
                </span>
              ) : null}
              <span className="rounded-md bg-[var(--color-app-background)] px-2 py-1 text-xs font-semibold text-[var(--color-title)]">
                {item.supplierProduct.active ? "Activo" : "Archivado"}
              </span>
            </div>
          </div>
          <dl className="mt-4 grid gap-3 md:grid-cols-2">
            <DetailItem label="Unidad compra" value={item.purchaseUnitName ?? "-"} />
            <DetailItem
              label="Costo"
              value={
                typeof item.supplierProduct.lastCost === "number"
                  ? formatCurrency(item.supplierProduct.lastCost)
                  : "-"
              }
            />
            <DetailItem
              label="Mínimo"
              value={String(item.supplierProduct.minimumOrderQuantity ?? "-")}
            />
            <DetailItem
              label="Entrega"
              value={
                typeof item.supplierProduct.leadTimeDays === "number"
                  ? `${item.supplierProduct.leadTimeDays} días`
                  : "-"
              }
            />
          </dl>
        </article>
      ))}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

const promotionTypeLabels: Record<PromotionType, string> = {
  [PromotionType.percentage]: "Descuento porcentual",
  [PromotionType.fixedDiscount]: "Descuento fijo",
  [PromotionType.fixedPrice]: "Precio promocional",
};

function getCurrentPromotion(promotions: Promotion[], now: number) {
  return promotions.find((promotion) => {
    const startsAt = new Date(promotion.startAt).getTime();
    const endsAt = promotion.endAt ? new Date(promotion.endAt).getTime() : Number.POSITIVE_INFINITY;
    return promotion.status === PromotionStatus.active && startsAt <= now && now <= endsAt;
  });
}

function ChannelSummary({ product }: { product: ProductQuickViewModel["product"] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <ChannelPill active={product.channels.pos} icon={<PosIcon />}>
        POS
      </ChannelPill>
      <ChannelPill active={product.channels.ecommerce} icon={<GlobeIcon />}>
        Web
      </ChannelPill>
      <ChannelPill active={product.channels.mobileApp} icon={<MobileIcon />}>
        App
      </ChannelPill>
    </div>
  );
}

function ChannelPill({
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

function EmptyPanel({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-4 text-sm text-[var(--color-text)]">
      {message}
    </p>
  );
}
