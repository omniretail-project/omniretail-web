export interface DashboardIncidentDto {
  description: string;
  typeName?: string;
  createdAt: string;
  receiptNumber?: string;
  branchName?: string;
  purchaseOrderNumber?: string;
  transferNumber?: string;
  supplierName?: string;
  originBranchName?: string;
}

export interface DashboardIncidentTypeCountDto {
  typeName: string;
  count: number;
}

export interface DashboardIncidentSupplierCountDto {
  supplierName: string;
  count: number;
}

export interface DashboardIncidentAnalyticsDto {
  totalCurrentMonth: number;
  byType: DashboardIncidentTypeCountDto[];
  bySupplier: DashboardIncidentSupplierCountDto[];
}

export interface DashboardTopProduct {
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
}

export type DashboardPendingOrderStatus =
  | "confirmed"
  | "preparing"
  | "picking"
  | "packing"
  | "ready_for_dispatch";

export type DashboardPendingOrdersByStatus = Record<
  DashboardPendingOrderStatus,
  number
>;

export interface DashboardStockAlertsByBranchDto {
  branchId: string;
  branchName: string;
  outOfStock: number;
  lowStock: number;
  total: number;
}

export interface DashboardSalesByBranchDto {
  branchName: string;
  amount: number;
  count: number;
}

export interface DashboardDailySaleDto {
  date: string;
  amount: number;
  count: number;
}

export interface DashboardPendingOrdersByBranchDto {
  branchName: string;
  count: number;
}

export interface DashboardSummaryDto {
  salesToday: { amount: number; count: number };
  salesMonth: { amount: number; count: number };
  salesByBranch: DashboardSalesByBranchDto[];
  dailySalesMonth: DashboardDailySaleDto[];
  stockAlerts: { outOfStock: number; lowStock: number };
  stockAlertsByBranch: DashboardStockAlertsByBranchDto[];
  pendingOrders: number;
  pendingOrdersByStatus: DashboardPendingOrdersByStatus;
  pendingOrdersByBranch: DashboardPendingOrdersByBranchDto[];
  incidentAnalytics: DashboardIncidentAnalyticsDto;
  latestIncidents: DashboardIncidentDto[];
  topProducts: DashboardTopProduct[];
}
