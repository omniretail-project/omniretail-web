"use client";

import type { Category, Unit } from "@/core/entities";
import { ProductStatus, ProductType } from "@/core/enums";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import type { ProductEditorDto } from "@/modules/catalog/application/dto/ProductEditorDto";
import type { ProductValidationErrors } from "@/modules/catalog/validation/product.validation";
import { productTypeLabels } from "@/modules/catalog/components/productLabels";
import { parseDecimalInput } from "@/shared/utils/numberInput";
import { MONEY_DECIMAL_PLACES } from "@/shared/utils/inputLimits";

interface ProductCommercialSectionProps {
  value: ProductEditorDto;
  categories: Category[];
  units: Unit[];
  errors: ProductValidationErrors;
  onChange: (value: Partial<ProductEditorDto>) => void;
}

export function ProductCommercialSection({
  value,
  categories,
  units,
  errors,
  onChange,
}: ProductCommercialSectionProps) {
  return (
    <section className="space-y-4 rounded-md border border-[var(--color-border)] bg-white p-5">
      <h2 className="text-lg font-semibold text-[var(--color-title)]">Clasificacion y venta</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <FormField id="productType" label="Tipo de producto *" error={errors.productType}>
          <Select
            id="productType"
            onChange={(event) => onChange({ productType: event.target.value as ProductType })}
            value={value.productType}
          >
            {Object.values(ProductType).map((type) => (
              <option key={type} value={type}>
                {productTypeLabels[type]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="categoryId" label="Categoria *" error={errors.categoryId}>
          <Select
            id="categoryId"
            onChange={(event) => onChange({ categoryId: event.target.value })}
            value={value.categoryId}
          >
            <option value="">Seleccione una categoría</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="baseUnitId" label="Unidad base *" error={errors.baseUnitId}>
          <Select
            id="baseUnitId"
            onChange={(event) => onChange({ baseUnitId: event.target.value })}
            value={value.baseUnitId}
          >
            <option value="">Seleccione una unidad</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="salePrice" label="Precio de venta *" error={errors.salePrice}>
          <Input
            id="salePrice"
            inputMode="decimal"
            maxLength={11}
            onChange={(event) =>
              onChange({
                salePrice: parseDecimalInput(event.target.value, MONEY_DECIMAL_PLACES),
              })
            }
            type="text"
            value={value.salePrice}
          />
        </FormField>
        <FormField id="status" label="Estado" error={errors.status}>
          <Select
            id="status"
            onChange={(event) => onChange({ status: event.target.value as ProductStatus })}
            value={value.status}
          >
            <option value={ProductStatus.published}>Publicado</option>
            <option value={ProductStatus.archived}>Archivado</option>
          </Select>
        </FormField>
      </div>
      {value.productType === ProductType.kit ? (
        <p className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text)]">
          La configuracion de componentes del kit se realizara en una funcion especifica.
        </p>
      ) : null}
    </section>
  );
}
