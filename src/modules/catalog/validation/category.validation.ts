import { CategoryStatus } from "@/core/enums";
import type {
  CategoryListItem,
  CategoryEditorDto,
} from "@/modules/catalog/application/dto/CategoryEditorDto";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";

export interface CategoryValidationErrors {
  name?: string;
  code?: string;
  parentId?: string;
  description?: string;
}

export function normalizeCategoryCode(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function formatCategoryCode(value: string) {
  return value.trim().toUpperCase();
}

export function buildDefaultCategoryDto(): CategoryEditorDto {
  return {
    name: "",
    code: "",
    description: "",
    parentId: "",
    status: CategoryStatus.active,
    image: undefined,
  };
}

export function categoryToDto(category: CategoryListItem): CategoryEditorDto {
  return {
    name: category.name,
    code: formatCategoryCode(category.slug),
    description: category.description ?? "",
    parentId: category.parentId ?? "",
    status: category.status,
    image: category.image,
  };
}

export function validateCategoryDto(
  dto: CategoryEditorDto,
  categories: CategoryListItem[],
  currentCategoryId?: string,
): CategoryValidationErrors {
  const errors: CategoryValidationErrors = {};
  const name = dto.name.trim();
  const code = normalizeCategoryCode(dto.code);

  if (!name) errors.name = "El nombre es requerido.";
  else if (dto.name.length > TEXT_LIMITS.categoryName)
    errors.name = "El nombre admite hasta 60 caracteres.";
  if (!code) {
    errors.code = "El código interno es requerido.";
  } else if (!/^[a-z0-9][a-z0-9-]*$/.test(code)) {
    errors.code = "Usa letras, números y guiones; debe iniciar con letra o número.";
  }
  if (dto.code.length > TEXT_LIMITS.categoryCode)
    errors.code = "El codigo admite hasta 30 caracteres.";
  if (dto.description.length > 500)
    errors.description = "La descripcion admite hasta 500 caracteres.";

  if (dto.parentId && dto.parentId === currentCategoryId) {
    errors.parentId = "Una categoría no puede ser su propia categoría padre.";
  }

  const duplicate = categories.find(
    (category) =>
      category.id !== currentCategoryId &&
      (category.name.trim().toLowerCase() === name.toLowerCase() || category.slug === code),
  );
  if (duplicate) {
    if (duplicate.name.trim().toLowerCase() === name.toLowerCase()) {
      errors.name = "Ya existe una categoría con este nombre.";
    }
    if (duplicate.slug === code) {
      errors.code = "Ya existe una categoría con este código.";
    }
  }

  return errors;
}

export function hasCategoryValidationErrors(errors: CategoryValidationErrors) {
  return Object.values(errors).some(Boolean);
}
