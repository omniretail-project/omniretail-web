import { OrderStatus } from "@/core/enums";

/** Public order phases; exceptional and pre-payment states retain their own meaning. */
export type CustomerOrderStatus =
  | OrderStatus.pending
  | OrderStatus.confirmed
  | OrderStatus.preparing
  | "sent"
  | OrderStatus.delivered
  | OrderStatus.cancelled;

export function mapOrderStatusToCustomerStatus(status: OrderStatus): CustomerOrderStatus {
  switch (status) {
    case OrderStatus.confirmed:
      return OrderStatus.confirmed;
    case OrderStatus.preparing:
    case OrderStatus.picking:
    case OrderStatus.packing:
    case OrderStatus.ready_for_pickup:
    case OrderStatus.ready_for_dispatch:
      return OrderStatus.preparing;
    case OrderStatus.dispatched:
      return "sent";
    case OrderStatus.pending:
    case OrderStatus.delivered:
    case OrderStatus.cancelled:
      return status;
  }
}
