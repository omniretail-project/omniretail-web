import { OrderStatus, SaleStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { CustomerDto, CustomerProductPurchase } from "@/modules/administration/application/dto/CustomerDto";
import { toCustomerDto } from "@/modules/administration/application/mappers/CustomerMapper";
import {
  ensureCanReadCustomers,
  ensureCustomerTenant,
} from "@/modules/administration/application/services/serviceHelpers";

export class GetCustomersService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, permissions: readonly string[]): Promise<CustomerDto[]> {
    ensureCanReadCustomers(permissions);
    ensureCustomerTenant(tenantId);

    const [customers, orders, sales] = await Promise.all([
      this.repositories.customers.listByTenant(tenantId),
      this.repositories.orders.listByTenant(tenantId),
      this.repositories.sales.listByTenant(tenantId),
    ]);

    const purchaseCounts = new Map<string, number>();
    const productQuantities = new Map<string, Map<string, number>>();
    const countedOrdersById = new Map<string, string>();

    for (const order of orders) {
      if (order.status === OrderStatus.cancelled) continue;
      if (!order.customerId) continue;
      purchaseCounts.set(order.customerId, (purchaseCounts.get(order.customerId) ?? 0) + 1);
      countedOrdersById.set(order.id, order.customerId);

      for (const item of order.items) {
        const customerProducts = productQuantities.get(order.customerId) ?? new Map<string, number>();
        customerProducts.set(
          item.nameSnapshot,
          (customerProducts.get(item.nameSnapshot) ?? 0) + item.quantity,
        );
        productQuantities.set(order.customerId, customerProducts);
      }
    }

    for (const sale of sales) {
      if (sale.status === SaleStatus.cancelled) continue;
      if (!sale.customerId) continue;
      const linkedOrderCustomerId = sale.sourceOrderId
        ? countedOrdersById.get(sale.sourceOrderId)
        : undefined;
      if (linkedOrderCustomerId === sale.customerId) continue;
      purchaseCounts.set(sale.customerId, (purchaseCounts.get(sale.customerId) ?? 0) + 1);

      for (const item of sale.items) {
        const customerProducts = productQuantities.get(sale.customerId) ?? new Map<string, number>();
        customerProducts.set(
          item.nameSnapshot,
          (customerProducts.get(item.nameSnapshot) ?? 0) + item.quantity,
        );
        productQuantities.set(sale.customerId, customerProducts);
      }
    }

    return customers
      .filter((customer) => customer.tenantId === tenantId)
      .map((customer) => {
        const products = productQuantities.get(customer.id);
        const topProducts: CustomerProductPurchase[] = products
          ? [...products.entries()]
              .map(([productName, totalQuantity]) => ({ productName, totalQuantity }))
              .sort((a, b) => b.totalQuantity - a.totalQuantity)
          : [];
        return toCustomerDto(customer, purchaseCounts.get(customer.id) ?? 0, topProducts);
      })
      .sort(
        (left, right) => right.purchaseCount - left.purchaseCount || left.name.localeCompare(right.name),
      );
  }
}
