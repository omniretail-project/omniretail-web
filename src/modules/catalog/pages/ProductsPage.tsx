"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ProductStatus } from "@/core/enums";
import { Button } from "@/shared/components/Button";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { Select } from "@/shared/components/Select";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { useToast } from "@/shared/components/Toast";
import { getActiveProductFiltersCount } from "@/modules/catalog/components/ActiveProductFilters";
import { ProductFilters } from "@/modules/catalog/components/ProductFilters";
import { ProductPriceHistoryDialog } from "@/modules/catalog/components/ProductPriceHistoryDialog";
import { ProductPromotionDialog } from "@/modules/catalog/components/ProductPromotionDialog";
import { ProductQuickView } from "@/modules/catalog/components/ProductQuickView";
import { ProductTable } from "@/modules/catalog/components/ProductTable";
import { ProductToolbar } from "@/modules/catalog/components/ProductToolbar";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from "@/modules/catalog/components/CatalogIcons";
import { useProductMutations } from "@/modules/catalog/hooks/useProductMutations";
import { useProductPermissions } from "@/modules/catalog/hooks/useProductPermissions";
import { useProducts } from "@/modules/catalog/hooks/useProducts";
import type { ProductFiltersState, ProductListItem } from "@/modules/catalog/types/catalog.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";

export function ProductsPage() {
  const repositories = useRepositories();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // La URL es la fuente de verdad de la categoria (?categoryId=) y del Quick View (?quickView=).
  const categoryIdParam = searchParams.get("categoryId");
  const categoryId = categoryIdParam ? categoryIdParam : "all";
  const quickViewId = searchParams.get("quickView") || null;
  const { showToast } = useToast();
  const {
    canRead,
    canCreate,
    canUpdate,
    canReadPromotions,
    canManagePromotions,
  } = useProductPermissions();
  const {
    loading,
    initialLoading,
    refreshing,
    error,
    items,
    categories,
    filters,
    filtersEnabled,
    page,
    pageSize,
    totalPages,
    totalItems,
    setPage,
    setPageSize,
    updateFilters,
  } = useProducts(categoryId);
  const mutations = useProductMutations();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProductListItem | null>(null);
  const [promotionTarget, setPromotionTarget] = useState<ProductListItem | null>(null);
  const [priceHistoryTarget, setPriceHistoryTarget] = useState<ProductListItem | null>(null);
  const activeFiltersCount = filtersEnabled ? getActiveProductFiltersCount(filters) : 0;
  const firstVisible = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisible = Math.min(page * pageSize, totalItems);

  async function archiveProduct() {
    if (!archiveTarget) return;
    try {
      await mutations.archive(archiveTarget.id);
      showToast({ title: "Producto archivado", tone: "success" });
      setArchiveTarget(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo archivar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function restoreProduct(product: { id: string }) {
    try {
      await mutations.restore(product.id);
      showToast({ title: "Producto restaurado", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo restaurar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  const emptyMessage =
    totalItems === 0
      ? "Aun no hay productos registrados."
      : "No hay productos que coincidan con los filtros.";

  // Construye la URL actual con cambios SOLO en los parametros indicados (los ajenos se preservan).
  function buildUrl(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function openQuickView(product: { id: string }) {
    router.push(buildUrl((params) => params.set("quickView", product.id)));
  }

  function closeQuickView() {
    router.replace(buildUrl((params) => params.delete("quickView")), { scroll: false });
  }

  // La categoria vive en la URL: el selector solo escribe la URL y el filtro se deriva de ella.
  function handleFiltersChange(patch: Partial<ProductFiltersState>) {
    const { categoryId: nextCategoryId, ...rest } = patch;
    if (Object.keys(rest).length > 0) updateFilters(rest);
    if (nextCategoryId === undefined) return;
    router.replace(
      buildUrl((params) => {
        if (nextCategoryId && nextCategoryId !== "all") params.set("categoryId", nextCategoryId);
        else params.delete("categoryId");
      }),
      { scroll: false },
    );
  }

  if (!loading && !canRead) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
        <header className="border-b border-[var(--color-border)] pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            CATÁLOGO
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--color-title)]">Catálogo y precios</h1>
        </header>
        <AccessDeniedState />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <ProductToolbar
        activeFiltersCount={activeFiltersCount}
        canCreate={canCreate}
        filtersEnabled={filtersEnabled}
        filtersOpen={filtersOpen}
        onSearchChange={(search) => updateFilters({ search })}
        onToggleFilters={() => setFiltersOpen((current) => !current)}
        search={filters.search}
      />
      {!filtersEnabled ? (
        <InlineAlert
          description="La búsqueda avanzada y los filtros globales estarán disponibles próximamente. Por ahora, puedes usar la paginación para navegar por el catálogo."
          title="Filtros no disponibles temporalmente"
          tone="info"
        />
      ) : null}
      {filtersOpen && filtersEnabled ? (
        <ProductFilters
          categories={categories}
          filters={filters}
          onChange={handleFiltersChange}
        />
      ) : null}
      {error ? <InlineAlert title={error.message} tone="danger" /> : null}
      {initialLoading ? (
        <p className="rounded-md border border-[var(--color-border)] bg-white p-5 text-sm text-[var(--color-text-muted)]">
          Cargando productos...
        </p>
      ) : (
        <>
          {refreshing ? (
            <p className="text-xs font-semibold text-[var(--color-text-muted)]" role="status">
              Actualizando productos...
            </p>
          ) : null}
          <ProductTable
            canUpdate={canUpdate}
            inventoryAdjustmentEnabled={repositories.productDataSource === "mock"}
            priceHistoryEnabled={canRead}
            promotionsEnabled={canReadPromotions && canManagePromotions}
            emptyMessage={emptyMessage}
            footer={
              totalItems > 0 ? (
                <ProductTableFooter
                  firstVisible={firstVisible}
                  lastVisible={lastVisible}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  page={page}
                  pageSize={pageSize}
                  totalItems={totalItems}
                  totalPages={totalPages}
                />
              ) : null
            }
            onArchive={setArchiveTarget}
            onOpenQuickView={openQuickView}
            onPriceHistory={setPriceHistoryTarget}
            onPromotion={setPromotionTarget}
            onRestore={restoreProduct}
            products={items}
            refreshing={refreshing}
          />
          {totalItems === 0 && canCreate && !refreshing ? (
            <div className="flex justify-center">
              <Button href="/catalogo/productos/nuevo">
                <PlusIcon />
                Nuevo producto
              </Button>
            </div>
          ) : null}
        </>
      )}
      <ProductQuickView
        canUpdate={canUpdate}
        productId={quickViewId}
        onClose={closeQuickView}
        onRestore={restoreProduct}
      />
      <ProductPromotionDialog
        key={promotionTarget?.id ?? "promotion-dialog"}
        product={promotionTarget}
        onClose={() => setPromotionTarget(null)}
      />
      <ProductPriceHistoryDialog
        product={priceHistoryTarget}
        onClose={() => setPriceHistoryTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archivar producto"
        message="El producto dejara de estar disponible para nuevas operaciones, pero se conservara su historial."
        confirmLabel={archiveTarget?.status === ProductStatus.published ? "Archivar" : "Confirmar"}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={archiveProduct}
      />
    </div>
  );
}

function ProductTableFooter({
  firstVisible,
  lastVisible,
  page,
  pageSize,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  firstVisible: number;
  lastVisible: number;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          Mostrando {firstVisible}-{lastVisible} de {totalItems} productos
        </p>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          Filas
          <Select
            aria-label="Filas por página"
            className="h-9 w-20 px-2"
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            value={pageSize}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </Select>
        </label>
      </div>
      <nav
        aria-label="Paginación de productos"
        className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start"
      >
        <Button
          aria-label="Página anterior"
          className="min-h-9 px-3 py-1.5"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          type="button"
          variant="secondary"
        >
          <ChevronLeftIcon />
        </Button>
        <span className="min-w-12 text-center text-sm font-semibold text-[var(--color-text)]">
          {page} / {totalPages}
        </span>
        <Button
          aria-label="Página siguiente"
          className="min-h-9 px-3 py-1.5"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          type="button"
          variant="secondary"
        >
          <ChevronRightIcon />
        </Button>
      </nav>
    </div>
  );
}
