import type { Payment } from "@/core/entities";
import type { PaymentStatus } from "@/core/enums";
export interface PaymentRepository {
  getAll(): Promise<Payment[]>;
  getById(id: string): Promise<Payment | null>;
  getByOrder(orderId: string): Promise<Payment[]>;
  getBySale(saleId: string): Promise<Payment[]>;
  getBySaleScoped(tenantId: string, branchId: string, saleId: string): Promise<Payment[]>;
  create(input: Omit<Payment, "id" | "createdAt">): Promise<Payment>;
  updateStatus(id: string, status: PaymentStatus): Promise<Payment>;
}
