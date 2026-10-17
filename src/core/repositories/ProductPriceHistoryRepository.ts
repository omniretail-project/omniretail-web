import type { ProductPriceHistory } from "@/core/entities";
import type { ISODateString } from "@/core/types/common.types";

export interface ProductPriceHistoryRepository {
  getByProduct(productId: string): Promise<ProductPriceHistory[]>;
  record(
    input: Omit<ProductPriceHistory, "id" | "changedAt"> & { changedAt?: ISODateString },
  ): Promise<ProductPriceHistory>;
}
