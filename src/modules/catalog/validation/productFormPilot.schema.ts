import { z } from "zod";
import type { ProductEditorDto } from "@/modules/catalog/application/dto/ProductEditorDto";
import type { ProductValidationErrors } from "@/modules/catalog/validation/product.validation";

const productFormPilotSchema = z
  .object({
    name: z.string().trim().min(1, "El nombre es requerido."),
    salePrice: z.number().finite().nonnegative("El precio debe ser mayor o igual a 0."),
    tracking: z.object({
      lot: z.boolean(),
      expiration: z.boolean(),
    }),
  })
  .refine((value) => value.tracking.lot === value.tracking.expiration, {
    path: ["tracking"],
    message: "Lotes y fecha de vencimiento deben estar activados o desactivados juntos.",
  });

export function validateProductFormPilot(value: ProductEditorDto): ProductValidationErrors {
  const result = productFormPilotSchema.safeParse({
    name: value.name,
    salePrice: Number(value.salePrice),
    tracking: value.tracking,
  });
  if (result.success) return {};

  const errors: ProductValidationErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === "name" || field === "salePrice" || field === "tracking") {
      errors[field] ??= issue.message;
    }
  }
  return errors;
}
