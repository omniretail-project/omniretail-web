"use client";

/* eslint-disable @next/next/no-img-element */

import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { PRODUCT_IMAGE_PLACEHOLDER } from "@/shared/utils/getProductImage";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
import type { ProductValidationErrors } from "@/modules/catalog/validation/product.validation";

interface ProductImageSectionProps {
  value: CreateProductDto;
  errors: ProductValidationErrors;
  onChange: (value: Partial<CreateProductDto>) => void;
}

export function ProductImageSection({ value, errors, onChange }: ProductImageSectionProps) {
  const previewUrl = value.primaryImageUrl?.trim() || PRODUCT_IMAGE_PLACEHOLDER;

  return (
    <section className="space-y-4 rounded-md border border-[var(--color-border)] bg-white p-5">
      <h2 className="text-lg font-semibold text-[var(--color-title)]">Imagen principal</h2>
      <div className="grid gap-4 md:grid-cols-[160px_1fr]">
        <img
          alt="Vista previa de imagen principal"
          className="aspect-square w-40 rounded-md border border-[var(--color-border)] object-cover"
          src={previewUrl}
        />
        <FormField
          id="primaryImageUrl"
          label="Ruta o URL de imagen principal"
          error={errors.primaryImageUrl}
          hint="Ingrese una ruta de imagen o una URL http(s) válida."
        >
          <Input
            id="primaryImageUrl"
            onChange={(event) => onChange({ primaryImageUrl: event.target.value })}
            placeholder="/images/products/placeholder-product.webp"
            value={value.primaryImageUrl ?? ""}
          />
        </FormField>
      </div>
    </section>
  );
}
