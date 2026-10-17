import type {
  InventoryMovementType,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  SaleStatus,
} from "@/core/enums";

export type ReportKind = "sales" | "purchases" | "movements" | "payments";

export interface ReportFilter {
  from?: string;
  to?: string;
  status?: string;
  branchId?: string;
  supplierId?: string;
  productId?: string;
  movementType?: string;
  method?: string;
}

export interface SalesReportRow {
  number: string;
  date: string;
  branchId: string;
  branchName: string;
  status: SaleStatus;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  channel: "POS" | "En línea";
  origin: string;
}

export interface PurchasesReportRow {
  number: string;
  date: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  subtotal: number;
  total: number;
}

export interface MovementReportRow {
  date: string;
  branchId: string;
  branchName: string;
  productId: string;
  productName: string;
  type: InventoryMovementType;
  quantity: number;
  reason: string;
}

export interface PaymentReportRow {
  date: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  reference: string;
  origin: "Orden" | "Venta" | "—";
}

export interface ReportsDataDto {
  tenantId: string;
  sales: SalesReportRow[];
  purchases: PurchasesReportRow[];
  movements: MovementReportRow[];
  payments: PaymentReportRow[];
}

export type ReportRow = SalesReportRow | PurchasesReportRow | MovementReportRow | PaymentReportRow;

export type ReportTotals =
  | {
      kind: "sales";
      count: number;
      excludedCount: number;
      total: number;
      discountTotal: number;
      taxTotal: number;
      byChannel: Array<{ channel: string; count: number; total: number }>;
    }
  | { kind: "purchases"; count: number; excludedCount: number; total: number }
  | {
      kind: "movements";
      byType: Array<{ type: string; count: number; quantity: number }>;
    }
  | {
      kind: "payments";
      count: number;
      byMethod: Array<{ method: string; amount: number }>;
      byStatus: Array<{ status: string; amount: number }>;
    };
