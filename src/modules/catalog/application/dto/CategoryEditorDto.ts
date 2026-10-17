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
  productCount: number;
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
