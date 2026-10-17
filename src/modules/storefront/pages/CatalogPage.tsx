"use client";

import { useMemo, useSyncExternalStore } from "react";
import { StorefrontProductCard } from "@/modules/storefront/components/StorefrontProductCard";
import { useStorefrontDiscovery } from "@/modules/storefront/hooks/useStorefrontDiscovery";

export function CatalogPage() {
  const { categories, products, loading, error, reload } = useStorefrontDiscovery();
  const search = useCatalogSearchFilter();
  const selectedCategoryIds = useCatalogCategoryFilter();
  const selectedCategories = useMemo(
    () => (selectedCategoryIds ? selectedCategoryIds.split(",") : []),
    [selectedCategoryIds],
  );
  const activeCategories = categories.filter((category) => selectedCategories.includes(category.id));
  const filteredProducts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return products.filter((product) => {
      const matchesCategory =
        selectedCategories.length === 0 || selectedCategories.includes(product.categoryId);
      const matchesSearch =
        !normalized ||
        [product.name, product.sku, product.brand, product.description]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalized));
      return matchesCategory && matchesSearch;
    });
  }, [products, search, selectedCategories]);
  if (loading)
    return (
      <main className="mx-auto max-w-7xl px-5 py-12">
        <p className="text-[var(--color-text-muted)]">Cargando catálogo...</p>
      </main>
    );
  if (error)
    return (
      <main className="mx-auto max-w-7xl px-5 py-12">
        <h1 className="text-3xl font-black text-[var(--color-text)]">Catálogo</h1>
        <p className="mt-4 text-[var(--color-text-muted)]">{error}</p>
        <button
          className="mt-5 rounded-xl bg-[var(--color-primary)] px-4 py-2 font-bold text-[var(--color-topbar)]"
          onClick={reload}
          type="button"
        >
          Reintentar
        </button>
      </main>
    );
  return (
    <main className="mx-auto max-w-7xl px-5 py-12">
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="h-fit space-y-4 lg:sticky lg:top-5">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-wider text-[var(--color-primary-hover)]">
                Buscar productos
              </span>
              <span className="relative mt-3 block">
                <span className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm text-[var(--color-text-muted)]">
                  ⌕
                </span>
                <input
                  className="w-full rounded-lg border border-[var(--color-border)] bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-normal text-[var(--color-text)] outline-none transition focus:border-[var(--color-primary-hover)] focus:ring-4 focus:ring-[var(--color-primary)]/15"
                  onChange={(event) => updateCatalogSearchFilter(event.target.value)}
                  placeholder="Nombre, SKU o tipo..."
                  value={search}
                />
              </span>
            </label>
          </section>
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-[var(--color-primary-hover)]">
                Categoría
              </h2>
              {selectedCategories.length > 0 ? (
                <button
                  className="text-xs font-bold text-[var(--color-title)] underline"
                  onClick={() => updateCatalogCategoryFilter([])}
                  type="button"
                >
                  Limpiar
                </button>
              ) : null}
            </div>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
              {categories.map((category) => {
                const count = products.filter(
                  (product) => product.categoryId === category.id,
                ).length;
                return (
                  <label
                    className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]"
                    key={category.id}
                  >
                    <input
                      checked={selectedCategories.includes(category.id)}
                      className="h-4 w-4 accent-[var(--color-primary-hover)]"
                      onChange={() =>
                        updateCatalogCategoryFilter(
                          selectedCategories.includes(category.id)
                            ? selectedCategories.filter((id) => id !== category.id)
                            : [...selectedCategories, category.id],
                        )
                      }
                      type="checkbox"
                    />
                    <span className="flex-1 truncate">{category.name}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
                      {count}
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        </aside>
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 shadow-sm">
            <div>
              <p className="font-black text-[var(--color-text)]">
                Mostrando {filteredProducts.length} de {products.length} productos
              </p>
              {activeCategories.length > 0 ? (
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  Categorías: {activeCategories.map((category) => category.name).join(", ")}
                </p>
              ) : null}
            </div>
          </div>
          {filteredProducts.length === 0 ? (
            <section className="mt-6 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-10 text-center text-[var(--color-text-muted)]">
              No hay productos que coincidan con tus filtros.
            </section>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProducts.map((product) => (
                <StorefrontProductCard compact key={product.id} product={product} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
function useCatalogCategoryFilter() {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("popstate", onStoreChange);
      return () => window.removeEventListener("popstate", onStoreChange);
    },
    () => new URLSearchParams(window.location.search).getAll("categoria").join(","),
    () => "",
  );
}
function useCatalogSearchFilter() {
  return useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("popstate", onStoreChange);
      return () => window.removeEventListener("popstate", onStoreChange);
    },
    () => new URLSearchParams(window.location.search).get("q") ?? "",
    () => "",
  );
}
function updateCatalogSearchFilter(search: string) {
  const url = new URL(window.location.href);
  if (search) url.searchParams.set("q", search);
  else url.searchParams.delete("q");
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
function updateCatalogCategoryFilter(categoryIds: string[]) {
  const url = new URL(window.location.href);
  url.searchParams.delete("categoria");
  categoryIds.forEach((categoryId) => url.searchParams.append("categoria", categoryId));
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
