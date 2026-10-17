import type { PaginatedResult } from "@/core/types/pagination.types";
import type { Category, StorageLocation, Unit } from "@/core/entities";
import type { BackendQuery } from "@/infrastructure/api/backendClient";
import { backendFetch } from "@/infrastructure/api/backendClient";

export interface ApiCategory {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  status: Category["status"];
  createdAt: string;
  updatedAt: string;
}

export interface ApiLocation {
  id: string;
  tenantId: string;
  branchId: string;
  parentId: string | null;
  code: string;
  name: string;
  type: Extract<StorageLocation["type"], "warehouse" | "aisle" | "shelf" | "level">;
  status: StorageLocation["status"];
  createdAt: string;
  updatedAt: string;
}

export interface ApiUnit {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  symbol: string;
  category: Unit["category"];
  allowsDecimals: boolean;
  status: Unit["status"];
  createdAt: string;
  updatedAt: string;
}

export interface ApiUnitConversion {
  id: string;
  tenantId: string;
  productId: string | null;
  fromUnitId: string;
  toUnitId: string;
  factor: number;
  createdAt: string;
}

const API_PAGE_SIZE = 100;

export async function fetchAllApiPages<T>(path: string, query: BackendQuery = {}): Promise<T[]> {
  const first = await backendFetch<PaginatedResult<T>>(path, {
    query: { ...query, page: 0, size: API_PAGE_SIZE },
  });
  const items = [...first.items];

  for (let page = 1; page < first.totalPages; page += 1) {
    const next = await backendFetch<PaginatedResult<T>>(path, {
      query: { ...query, page, size: API_PAGE_SIZE },
    });
    items.push(...next.items);
  }

  return items;
}
