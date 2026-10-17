"use client";

import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
import type { ProductValidationErrors } from "@/modules/catalog/validation/product.validation";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";

interface ProductSectionProps {
  value: CreateProductDto;
  errors: ProductValidationErrors;
  onChange: (value: Partial<CreateProductDto>) => void;
}

export function ProductGeneralSection({ value, errors, onChange }: ProductSectionProps) {
  return (
    <section className="space-y-4 rounded-md border border-[var(--color-border)] bg-white p-5">
      <h2 className="text-lg font-semibold text-[var(--color-title)]">Informacion general</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="sku" label="Codigo / SKU *" error={errors.sku}>
          <Input
            id="sku"
            maxLength={TEXT_LIMITS.sku}
            onChange={(event) => onChange({ sku: event.target.value })}
            value={value.sku}
          />
        </FormField>
        <FormField id="barcode" label="Codigo de barras" error={errors.barcode}>
          <Input
            id="barcode"
            maxLength={TEXT_LIMITS.barcode}
            onChange={(event) => onChange({ barcode: event.target.value })}
            value={value.barcode ?? ""}
          />
        </FormField>
        <FormField id="name" label="Nombre *" error={errors.name}>
          <Input
            id="name"
            maxLength={TEXT_LIMITS.productName}
            onChange={(event) => onChange({ name: event.target.value })}
            value={value.name}
          />
        </FormField>
        <FormField id="brand" label="Marca" error={errors.brand}>
          <Input
            id="brand"
            maxLength={TEXT_LIMITS.brand}
            onChange={(event) => onChange({ brand: event.target.value })}
            value={value.brand ?? ""}
          />
        </FormField>
      </div>
      <FormField id="description" label="Descripcion" error={errors.description}>
        <textarea
          className="min-h-24 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
          id="description"
          maxLength={TEXT_LIMITS.description}
          onChange={(event) => onChange({ description: event.target.value })}
          value={value.description ?? ""}
        />
        <p className="text-right text-xs text-[var(--color-text-muted)]">
          {value.description?.length ?? 0} / {TEXT_LIMITS.description}
        </p>
      </FormField>
    </section>
  );
}
