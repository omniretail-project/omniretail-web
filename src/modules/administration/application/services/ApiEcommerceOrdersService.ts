import type { OrderStatus } from "@/core/enums";
import type { PaginatedResult } from "@/core/types";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { EcommerceOrderDto } from "@/modules/administration/application/dto/EcommerceOrderDto";

const BASE_PATH = "/administration/orders";

/** Cliente del panel administrativo para pedidos de la tienda.
 * El tenant se obtiene exclusivamente del JWT en el backend. */
export class ApiEcommerceOrdersService {
  list(input: { page: number; pageSize: number; status: OrderStatus | "all" }) {
    return backendFetch<PaginatedResult<EcommerceOrderDto>>(BASE_PATH, {
      query: {
        page: input.page,
        size: input.pageSize,
        status: input.status === "all" ? undefined : input.status,
      },
    });
  }

  updateStatus(id: string, status: OrderStatus) {
    return backendFetch<EcommerceOrderDto>(`${BASE_PATH}/${id}/status`, {
      method: "PATCH",
      body: { status },
    });
  }
}
