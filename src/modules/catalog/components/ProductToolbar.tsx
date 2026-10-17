"use client";

import { Button } from "@/shared/components/Button";
import { SearchInput } from "@/shared/components/SearchInput";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import { FilterIcon, PlusIcon } from "@/modules/catalog/components/CatalogIcons";

interface ProductToolbarProps {
  canCreate: boolean;
  search: string;
  filtersOpen: boolean;
  activeFiltersCount: number;
  filtersEnabled: boolean;
  onSearchChange: (value: string) => void;
  onToggleFilters: () => void;
}

export function ProductToolbar({
  canCreate,
  search,
  filtersOpen,
  activeFiltersCount,
  filtersEnabled,
  onSearchChange,
  onToggleFilters,
}: ProductToolbarProps) {
  return (
    <header className="flex min-w-0 flex-col gap-4 border-b border-[var(--color-border)] pb-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          CATÁLOGO
        </p>
        <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-title)]">
          Catálogo y precios
        </h1>
      </div>
      <div className="flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end">
        <SearchInput
          aria-label="Buscar productos"
          maxLength={TEXT_LIMITS.search}
          className="w-full md:w-96"
          disabled={!filtersEnabled}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Buscar por nombre, SKU, marca o código de barras"
          value={search}
        />
        <Button
          aria-controls="product-filters-panel"
          aria-expanded={filtersOpen}
          className="w-full md:w-auto"
          disabled={!filtersEnabled}
          onClick={onToggleFilters}
          type="button"
          variant="secondary"
        >
          <FilterIcon />
          Filtros
          {activeFiltersCount ? (
            <span className="rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-xs text-white">
              {activeFiltersCount}
            </span>
          ) : null}
        </Button>
        {canCreate ? (
          <Button className="w-full md:w-auto" href="/catalogo/productos/nuevo">
            <PlusIcon />
            Nuevo producto
          </Button>
        ) : null}
      </div>
    </header>
  );
}
