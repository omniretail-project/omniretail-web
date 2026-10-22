import type { Category } from "@/core/entities";
import type { ImageUploadDraft } from "@/shared/application/dto/ImageUploadDraft";

export interface CategoryListItem {
  id: string;
  tenantId: string;
  parentId?: string;
  parentName?: string;
  depth: number;
  name: string;
  code: string;
  slug: string;
  description?: string;
  image?: Category["image"];
  status: Category["status"];
  /** Productos publicados asociados directamente. `null` = no disponible (nunca cero). */
  productCount: number | null;
  /** Productos archivados asociados directamente. `null` = no disponible (nunca cero). */
  archivedProductCount: number | null;
}

export interface CategoryEditorDto {
  name: string;
  code: string;
  description: string;
  parentId: string;
  status: Category["status"];
  image?: Category["image"];
  pendingImage?: ImageUploadDraft;
  removeImage?: boolean;
}

export interface CategoryEditorOptions {
  parents: CategoryListItem[];
}
