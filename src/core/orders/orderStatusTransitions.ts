import { OrderStatus } from "@/core/enums";

export type OrderCreationMethod = "create" | "createWithPayment";
export type OrderTransitionOwner = "generic" | "picking" | "packing" | "dispatch" | "storePickup";

const allowedInitialStatuses: Record<OrderCreationMethod, ReadonlySet<OrderStatus>> = {
  create: new Set([OrderStatus.pending, OrderStatus.confirmed]),
  createWithPayment: new Set([OrderStatus.pending]),
};

const transitions: Record<OrderTransitionOwner, ReadonlySet<string>> = {
  generic: new Set([
    transition(OrderStatus.pending, OrderStatus.confirmed),
    ...Object.values(OrderStatus)
      .filter((status) => status !== OrderStatus.cancelled && status !== OrderStatus.delivered)
      .map((status) => transition(status, OrderStatus.cancelled)),
  ]),
  picking: new Set([
    transition(OrderStatus.confirmed, OrderStatus.preparing),
    transition(OrderStatus.preparing, OrderStatus.picking),
    transition(OrderStatus.picking, OrderStatus.packing),
  ]),
  packing: new Set([
    transition(OrderStatus.packing, OrderStatus.ready_for_dispatch),
    transition(OrderStatus.packing, OrderStatus.ready_for_pickup),
  ]),
  dispatch: new Set([
    transition(OrderStatus.ready_for_dispatch, OrderStatus.dispatched),
    transition(OrderStatus.dispatched, OrderStatus.delivered),
  ]),
  storePickup: new Set([transition(OrderStatus.ready_for_pickup, OrderStatus.delivered)]),
};

export function isAllowedInitialOrderStatus(
  method: OrderCreationMethod,
  status: OrderStatus,
): boolean {
  return allowedInitialStatuses[method].has(status);
}

export function assertAllowedInitialOrderStatus(
  method: OrderCreationMethod,
  status: OrderStatus,
): void {
  if (!isAllowedInitialOrderStatus(method, status)) {
    throw new Error(`Order status ${status} is not allowed for ${method}`);
  }
}

export function assertOrderStatusTransition(
  current: OrderStatus,
  next: OrderStatus,
  owner: OrderTransitionOwner,
): void {
  if (current === next) return;
  if (!transitions[owner].has(transition(current, next))) {
    throw new Error(`Order transition ${current} -> ${next} is not owned by ${owner}`);
  }
}

function transition(current: OrderStatus, next: OrderStatus): string {
  return `${current}->${next}`;
}
