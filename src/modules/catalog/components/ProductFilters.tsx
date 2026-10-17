"use client";

import type { ReactNode } from "react";
import type { Category } from "@/core/entities";
import { ProductStatus } from "@/core/enums";
import { Select } from "@/shared/components/Select";
import { cn } from "@/shared/utils/cn";
import {
  CheckIcon,
  GlobeIcon,
  MobileIcon,
  PosIcon,
  TagIcon,
} from "@/modules/catalog/components/CatalogIcons";
import { productTypeLabels } from "@/modules/catalog/components/productLabels";
import { productStatusOptions, productTypeOptions } from "@/modules/catalog/hooks/useProducts";
import type {
  ProductChannelKey,
  ProductFiltersState,
  ProductPromotionFilter,
} from "@/modules/catalog/types/catalog.types";

interface ProductFiltersProps {
  filters: ProductFiltersState;
  categories: Category[];
  onChange: (filters: Partial<ProductFiltersState>) => void;
}

export function ProductFilters({ filters, categories, onChange }: ProductFiltersProps) {
  function toggleStatus(status: ProductStatus) {
    onChange({ status: filters.status === status ? "all" : status });
  }

  function toggleChannel(channel: ProductChannelKey) {
    onChange({
      channels: filters.channels.includes(channel)
        ? filters.channels.filter((item) => item !== channel)
        : [...filters.channels, channel],
    });
  }

  function togglePromotion(promotion: Exclude<ProductPromotionFilter, "all">) {
    onChange({ promotion: filters.promotion === promotion ? "all" : promotion });
  }

  return (
    <section
      className="max-w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm"
      id="product-filters-panel"
    >
      <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr_1fr_1.15fr_1.2fr] xl:items-end">
        <FilterGroup label="Estado">
          <div className="flex min-w-0 flex-wrap gap-2">
            {productStatusOptions.map((status) => (
              <FilterChip
                active={filters.status === status}
                icon={filters.status === status ? <CheckIcon /> : null}
                key={status}
                onClick={() => toggleStatus(status)}
              >
                {status === ProductStatus.published ? "Publicado" : "Archivado"}
              </FilterChip>
            ))}
          </div>
        </FilterGroup>
        <FilterGroup label="Tipo">
          <Select
            aria-label="Filtrar por tipo"
            className="rounded-lg hover:border-[var(--color-structure)]"
            onChange={(event) =>
              onChange({ productType: event.target.value as ProductFiltersState["productType"] })
            }
            value={filters.productType}
          >
            <option value="all">Todos los tipos</option>
            {productTypeOptions.map((type) => (
              <option key={type} value={type}>
                {productTypeLabels[type]}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <FilterGroup label="Categoría">
          <Select
            aria-label="Filtrar por categoría"
            className="rounded-lg hover:border-[var(--color-structure)]"
            onChange={(event) => onChange({ categoryId: event.target.value })}
            value={filters.categoryId}
          >
            <option value="all">Todas las categorías</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </FilterGroup>
        <FilterGroup label="Canales">
          <div className="flex min-w-0 flex-wrap gap-2">
            <FilterChip
              active={filters.channels.includes("pos")}
              icon={<PosIcon />}
              onClick={() => toggleChannel("pos")}
            >
              POS
            </FilterChip>
            <FilterChip
              active={filters.channels.includes("ecommerce")}
              icon={<GlobeIcon />}
              onClick={() => toggleChannel("ecommerce")}
            >
              Web
            </FilterChip>
            <FilterChip
              active={filters.channels.includes("mobileApp")}
              icon={<MobileIcon />}
              onClick={() => toggleChannel("mobileApp")}
            >
              App
            </FilterChip>
          </div>
        </FilterGroup>
        <FilterGroup label="Promoción">
          <div className="flex min-w-0 flex-wrap gap-2">
            <FilterChip
              active={filters.promotion === "with"}
              icon={<TagIcon />}
              onClick={() => togglePromotion("with")}
            >
              Con promoción
            </FilterChip>
            <FilterChip
              active={filters.promotion === "without"}
              icon={<TagIcon />}
              onClick={() => togglePromotion("without")}
            >
              Sin promoción
            </FilterChip>
          </div>
        </FilterGroup>
      </div>
    </section>
  );
}

function FilterGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      {children}
    </div>
  );
}

function FilterChip({
  active,
  children,
  icon,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
          : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-[var(--color-structure)] hover:text-[var(--color-title)]",
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {children}
    </button>
  );
}
