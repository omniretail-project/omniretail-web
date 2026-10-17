import type { PageParams } from "@/core/types/pagination.types";

export interface RepositorySort<T> {
  field: keyof T;
  direction: "asc" | "desc";
}

export interface RepositoryFilter<T> {
  search?: string;
  filters?: Partial<Record<keyof T, T[keyof T]>>;
  page?: PageParams;
  sort?: RepositorySort<T>;
}
