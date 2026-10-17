import type { Category } from "@/core/entities";

export class CategoryImagePartialSaveError extends Error {
  readonly categoryId: string;
  readonly coreSaved = true;
  readonly imageFailed = true;

  constructor(readonly category: Category, cause?: unknown) {
    const detail = cause instanceof Error && cause.message ? ` ${cause.message}` : "";
    super(
      `La categoría fue guardada, pero su imagen quedó pendiente.${detail} ` +
        "Revise los datos recargados e intente guardar nuevamente.",
    );
    this.name = "CategoryImagePartialSaveError";
    this.categoryId = category.id;
  }
}
