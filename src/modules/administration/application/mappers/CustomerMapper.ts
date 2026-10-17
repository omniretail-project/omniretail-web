import type { Customer } from "@/core/entities";
import type { CustomerDto, CustomerProductPurchase } from "@/modules/administration/application/dto/CustomerDto";

export function toCustomerDto(
  customer: Customer,
  purchaseCount: number,
  topProducts: CustomerProductPurchase[],
): CustomerDto {
  return {
    id: customer.id,
    userId: customer.userId,
    code: customer.code,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    segmentId: customer.segmentId,
    status: customer.status,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    purchaseCount,
    topProducts,
  };
}
