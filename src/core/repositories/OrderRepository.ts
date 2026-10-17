import type { Order, OrderItem, Payment } from "@/core/entities";
import type { OrderStatus } from "@/core/enums";

export type CreateOrderInput = Omit<
  Order,
  "id" | "items" | "idempotencyKey" | "idempotencyFingerprint" | "createdAt" | "updatedAt"
> & {
  items: Array<Omit<OrderItem, "orderId">>;
  idempotencyKey?: string;
};

export interface CreateOrderWithPaymentInput {
  order: CreateOrderInput;
  payment: Omit<Payment, "id" | "orderId" | "createdAt">;
}

export interface CreateOrderWithPaymentResult {
  order: Order;
  payment: Payment;
}

export interface OrderRepository {
  getAll(): Promise<Order[]>;
  listByTenant(tenantId: string): Promise<Order[]>;
  listByBranch(tenantId: string, branchId: string): Promise<Order[]>;
  getByIdsScoped(tenantId: string, branchId: string, ids: string[]): Promise<Order[]>;
  getById(id: string): Promise<Order | null>;
  getByTrackingToken(tenantId: string, trackingToken: string): Promise<Order | null>;
  getByCustomer(tenantId: string, customerId: string): Promise<Order[]>;
  getPendingForLogistics(): Promise<Order[]>;
  create(input: CreateOrderInput): Promise<Order>;
  createWithPayment(input: CreateOrderWithPaymentInput): Promise<CreateOrderWithPaymentResult>;
  updateStatus(id: string, status: OrderStatus): Promise<Order>;
}
