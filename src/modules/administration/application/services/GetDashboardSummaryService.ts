import { isApiMode } from "@/config/api-mode";
import { SaleStatus } from "@/core/enums";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { DashboardSummaryDto, DashboardTopProduct } from "@/modules/administration/application/dto/DashboardDto";
import {
  ensureCanReadDashboard,
  ensureDashboardTenant,
} from "@/modules/administration/application/services/serviceHelpers";
import { GetInventoryAlertsService } from "@/modules/inventory/application/services/GetInventoryAlertsService";

export class GetDashboardSummaryService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(tenantId: string, permissions: readonly string[]): Promise<DashboardSummaryDto> {
    ensureCanReadDashboard(permissions);
    ensureDashboardTenant(tenantId);

    if (isApiMode()) {
      return backendFetch<DashboardSummaryDto>("/administration/dashboard");
    }

    const [
      sales,
      pendingLogisticsOrders,
      branches,
      receipts,
      incidents,
      incidentTypes,
      purchaseOrders,
      inventoryTransfers,
      suppliers,
    ] = await Promise.all([
        this.repositories.sales.getAll(),
        this.repositories.orders.getPendingForLogistics(),
        this.repositories.branches.getActive(),
        this.repositories.receipts.getAll(),
        this.repositories.receipts.getIncidents(),
        this.repositories.incidentTypes.getAll(),
        this.repositories.purchaseOrders.getAll(),
        this.repositories.inventoryTransfers.query({ tenantId }),
        this.repositories.suppliers.getAll(),
      ]);
    const now = new Date();
    const tenantSales = sales.filter(
      (sale) => sale.tenantId === tenantId && sale.status !== SaleStatus.cancelled,
    );
    const todaySales = tenantSales.filter((sale) => isSameLocalDay(new Date(sale.createdAt), now));
    const monthSales = tenantSales.filter((sale) =>
      isSameLocalMonth(new Date(sale.createdAt), now),
    );
    const tenantReceipts = receipts.filter((receipt) => receipt.tenantId === tenantId);
    const receiptById = new Map(
      tenantReceipts.map((receipt) => [receipt.id, receipt]),
    );
    const incidentTypeNames = new Map(
      incidentTypes
        .filter((incidentType) => incidentType.tenantId === tenantId)
        .map((incidentType) => [incidentType.id, incidentType.name]),
    );
    const tenantPendingLogisticsOrders = pendingLogisticsOrders.filter(
      (order) => order.tenantId === tenantId,
    );
    const pendingOrdersByStatus = {
      confirmed: 0,
      preparing: 0,
      picking: 0,
      packing: 0,
      ready_for_dispatch: 0,
    };

    tenantPendingLogisticsOrders.forEach((order) => {
      switch (order.status) {
        case "confirmed":
          pendingOrdersByStatus.confirmed += 1;
          break;
        case "preparing":
          pendingOrdersByStatus.preparing += 1;
          break;
        case "picking":
          pendingOrdersByStatus.picking += 1;
          break;
        case "packing":
          pendingOrdersByStatus.packing += 1;
          break;
        case "ready_for_dispatch":
          pendingOrdersByStatus.ready_for_dispatch += 1;
          break;
      }
    });

    const tenantBranches = branches.filter((branch) => branch.tenantId === tenantId);
    const branchNameById = new Map(
      tenantBranches.map((branch) => [branch.id, branch.name]),
    );
    const pendingOrdersByBranch = tenantBranches
      .map((branch) => ({
        branchName: branch.name,
        count: tenantPendingLogisticsOrders.filter(
          (order) => order.branchId === branch.id,
        ).length,
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.branchName.localeCompare(right.branchName),
      );
    const purchaseOrderById = new Map(
      purchaseOrders
        .filter((purchaseOrder) => purchaseOrder.tenantId === tenantId)
        .map((purchaseOrder) => [purchaseOrder.id, purchaseOrder]),
    );
    const inventoryTransferById = new Map(
      inventoryTransfers.map((item) => [item.transfer.id, item.transfer]),
    );
    const supplierNameById = new Map(
      suppliers
        .filter((supplier) => supplier.tenantId === tenantId)
        .map((supplier) => [supplier.id, supplier.name]),
    );
    const currentMonthIncidents = incidents.filter(
      (incident) =>
        receiptById.has(incident.receiptId) &&
        isSameLocalMonth(new Date(incident.createdAt), now),
    );
    const incidentCountsByType = new Map<string, { typeName: string; count: number }>();
    const incidentCountsBySupplier = new Map<
      string,
      { supplierName: string; count: number }
    >();

    currentMonthIncidents.forEach((incident) => {
      const typeName =
        incidentTypeNames.get(incident.incidentTypeId) ?? incident.incidentTypeId;
      const typeTotals = incidentCountsByType.get(incident.incidentTypeId) ?? {
        typeName,
        count: 0,
      };
      typeTotals.count += 1;
      incidentCountsByType.set(incident.incidentTypeId, typeTotals);

      const receipt = receiptById.get(incident.receiptId);
      const purchaseOrder = receipt?.purchaseOrderId
        ? purchaseOrderById.get(receipt.purchaseOrderId)
        : undefined;
      const supplierName = purchaseOrder?.supplierId
        ? supplierNameById.get(purchaseOrder.supplierId)
        : undefined;

      if (purchaseOrder?.supplierId && supplierName) {
        const supplierTotals = incidentCountsBySupplier.get(purchaseOrder.supplierId) ?? {
          supplierName,
          count: 0,
        };
        supplierTotals.count += 1;
        incidentCountsBySupplier.set(purchaseOrder.supplierId, supplierTotals);
      }
    });

    const incidentAnalytics = {
      totalCurrentMonth: currentMonthIncidents.length,
      byType: [...incidentCountsByType.values()].sort(
        (left, right) =>
          right.count - left.count || left.typeName.localeCompare(right.typeName),
      ),
      bySupplier: [...incidentCountsBySupplier.values()]
        .sort(
          (left, right) =>
            right.count - left.count || left.supplierName.localeCompare(right.supplierName),
        )
        .slice(0, 5),
    };
    const inventoryAlertsService = new GetInventoryAlertsService(this.repositories);
    const branchAlerts = await Promise.all(
      tenantBranches.map(async (branch) => ({
        branch,
        data: await inventoryAlertsService.execute(branch.id),
      })),
    );
    const stockAlerts = branchAlerts.reduce(
      (totals, result) => ({
        outOfStock: totals.outOfStock + result.data.kpis.outOfStock,
        lowStock: totals.lowStock + result.data.kpis.lowStock,
      }),
      { outOfStock: 0, lowStock: 0 },
    );
    const stockAlertsByBranch = branchAlerts.map(({ branch, data }) => {
      const branchStockAlerts = data.kpis;

      return {
        branchId: branch.id,
        branchName: branch.name,
        outOfStock: branchStockAlerts.outOfStock,
        lowStock: branchStockAlerts.lowStock,
        total: branchStockAlerts.outOfStock + branchStockAlerts.lowStock,
      };
    });

    const topProducts = aggregateTopProducts(monthSales);
    const salesByBranch = aggregateSalesByBranch(monthSales, tenantBranches);
    const dailySalesMonth = aggregateDailySalesMonth(monthSales, now);

    return {
      salesToday: summarizeSales(todaySales),
      salesMonth: summarizeSales(monthSales),
      salesByBranch,
      dailySalesMonth,
      stockAlerts,
      stockAlertsByBranch,
      pendingOrders: tenantPendingLogisticsOrders.length,
      pendingOrdersByStatus,
      pendingOrdersByBranch,
      incidentAnalytics,
      latestIncidents: [...currentMonthIncidents]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 5)
        .map((incident) => {
          const receipt = receiptById.get(incident.receiptId);
          const purchaseOrder = receipt?.purchaseOrderId
            ? purchaseOrderById.get(receipt.purchaseOrderId)
            : undefined;
          const transfer = receipt?.inventoryTransferId
            ? inventoryTransferById.get(receipt.inventoryTransferId)
            : undefined;
          const branchName = receipt?.branchId
            ? branchNameById.get(receipt.branchId)
            : undefined;
          const supplierName = purchaseOrder?.supplierId
            ? supplierNameById.get(purchaseOrder.supplierId)
            : undefined;
          const originBranchName = transfer?.sourceBranchId
            ? branchNameById.get(transfer.sourceBranchId)
            : undefined;

          return {
            description: incident.description,
            typeName: incidentTypeNames.get(incident.incidentTypeId) ?? incident.incidentTypeId,
            createdAt: incident.createdAt,
            ...(receipt?.number ? { receiptNumber: receipt.number } : {}),
            ...(branchName ? { branchName } : {}),
            ...(purchaseOrder?.number
              ? { purchaseOrderNumber: purchaseOrder.number }
              : {}),
            ...(transfer?.number ? { transferNumber: transfer.number } : {}),
            ...(supplierName ? { supplierName } : {}),
            ...(originBranchName ? { originBranchName } : {}),
          };
        }),
      topProducts,
    };
  }
}

function aggregateTopProducts(
  sales: Array<{ items: Array<{ nameSnapshot: string; quantity: number; subtotal: number }> }>,
): DashboardTopProduct[] {
  const productMap = new Map<string, { totalQuantity: number; totalRevenue: number }>();

  for (const sale of sales) {
    for (const item of sale.items) {
      const existing = productMap.get(item.nameSnapshot) ?? { totalQuantity: 0, totalRevenue: 0 };
      existing.totalQuantity += item.quantity;
      existing.totalRevenue += item.subtotal;
      productMap.set(item.nameSnapshot, existing);
    }
  }

  return [...productMap.entries()]
    .map(([productName, data]) => ({ productName, ...data }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .slice(0, 10);
}

function summarizeSales(sales: Array<{ total: number }>) {
  return {
    amount: sales.reduce((total, sale) => total + sale.total, 0),
    count: sales.length,
  };
}

function aggregateSalesByBranch(
  sales: Array<{ branchId: string; total: number }>,
  branches: Array<{ id: string; name: string }>,
): DashboardSummaryDto["salesByBranch"] {
  const totalsByBranch = new Map(
    branches.map((branch) => [
      branch.id,
      { branchName: branch.name, amount: 0, count: 0 },
    ]),
  );

  sales.forEach((sale) => {
    const branchTotals = totalsByBranch.get(sale.branchId);

    if (branchTotals) {
      branchTotals.amount += sale.total;
      branchTotals.count += 1;
    }
  });

  return [...totalsByBranch.values()].sort(
    (left, right) => right.amount - left.amount || left.branchName.localeCompare(right.branchName),
  );
}

function aggregateDailySalesMonth(
  sales: Array<{ createdAt: string; total: number }>,
  reference: Date,
): DashboardSummaryDto["dailySalesMonth"] {
  const totalsByDay = new Map<number, { amount: number; count: number }>();

  sales.forEach((sale) => {
    const day = new Date(sale.createdAt).getDate();
    const totals = totalsByDay.get(day) ?? { amount: 0, count: 0 };
    totals.amount += sale.total;
    totals.count += 1;
    totalsByDay.set(day, totals);
  });

  return Array.from({ length: reference.getDate() }, (_, index) => {
    const day = index + 1;
    const totals = totalsByDay.get(day) ?? { amount: 0, count: 0 };
    const date = new Date(reference.getFullYear(), reference.getMonth(), day);

    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      amount: totals.amount,
      count: totals.count,
    };
  });
}

function isSameLocalDay(value: Date, reference: Date) {
  return (
    value.getFullYear() === reference.getFullYear() &&
    value.getMonth() === reference.getMonth() &&
    value.getDate() === reference.getDate()
  );
}

function isSameLocalMonth(value: Date, reference: Date) {
  return (
    value.getFullYear() === reference.getFullYear() && value.getMonth() === reference.getMonth()
  );
}
