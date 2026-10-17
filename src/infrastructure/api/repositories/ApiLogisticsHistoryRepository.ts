import type {
  LogisticsHistoryReadRepository,
  LogisticsHistorySearchQuery,
  LogisticsHistorySourceType,
} from "@/core/repositories";
import { backendFetch } from "@/infrastructure/api/backendClient";
import {
  parseLogisticsHistoryDetail,
  parseLogisticsHistoryPage,
} from "@/infrastructure/api/repositories/logisticsHistoryApi.schema";
import { assertApiUuid } from "@/infrastructure/api/uuid";

/** Tope del backend (`LogisticsHistoryService.MAX_PAGE_SIZE`). */
export const LOGISTICS_HISTORY_MAX_PAGE_SIZE = 100;

export class ApiLogisticsHistoryRepository implements LogisticsHistoryReadRepository {
  async search(query: LogisticsHistorySearchQuery) {
    assertApiUuid(query.branchId, "branchId");
    if (query.from && query.to && query.from > query.to) {
      throw new RangeError("La fecha inicial no puede ser posterior a la fecha final.");
    }
    return parseLogisticsHistoryPage(
      await backendFetch<unknown>("/logistics/history", {
        query: {
          branchId: query.branchId,
          search: query.search?.trim() || undefined,
          status: query.status || undefined,
          transferStatus: query.transferStatus,
          deliveryMethod: query.deliveryMethod,
          from: query.from || undefined,
          to: query.to || undefined,
          // El backend recibe la página desde 0 y responde numerada desde 1.
          page: Math.max(1, Math.trunc(query.page)) - 1,
          size: Math.min(Math.max(1, Math.trunc(query.pageSize)), LOGISTICS_HISTORY_MAX_PAGE_SIZE),
        },
      }),
    );
  }

  async getDetail(branchId: string, sourceType: LogisticsHistorySourceType, sourceId: string) {
    assertApiUuid(branchId, "branchId");
    assertApiUuid(sourceId, "sourceId");
    return parseLogisticsHistoryDetail(
      await backendFetch<unknown>(`/logistics/history/${sourceType}/${sourceId}`, {
        query: { branchId },
      }),
    );
  }
}
