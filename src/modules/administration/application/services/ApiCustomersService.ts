import type { CustomerStatus } from "@/core/enums";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { CustomerDto } from "@/modules/administration/application/dto/CustomerDto";

const BASE_PATH = "/administration/customers";

/** CustomerAdminResponse del backend. */
interface ApiCustomer {
  id: string;
  userId: string | null;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  segmentId: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
  purchaseCount: number;
  topProducts: { productName: string; totalQuantity: number | string }[] | null;
}

function toCustomerDto(customer: ApiCustomer): CustomerDto {
  return {
    id: customer.id,
    userId: customer.userId ?? undefined,
    code: customer.code,
    name: customer.name,
    email: customer.email,
    phone: customer.phone ?? undefined,
    segmentId: customer.segmentId ?? undefined,
    status: customer.status,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    purchaseCount: Number(customer.purchaseCount),
    topProducts: (customer.topProducts ?? []).map((product) => ({
      productName: product.productName,
      totalQuantity: Number(product.totalQuantity),
    })),
  };
}

/** Cliente del panel administrativo para clientes de la tienda.
 * El tenant se obtiene exclusivamente del JWT en el backend, que tambien calcula las compras. */
export class ApiCustomersService {
  async list(): Promise<CustomerDto[]> {
    const customers = await backendFetch<ApiCustomer[]>(BASE_PATH);
    return customers.map(toCustomerDto);
  }
}
