"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PurchaseOrderStatus, SaleStatus } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type {
  MovementReportRow,
  PaymentReportRow,
  PurchasesReportRow,
  ReportFilter,
  ReportKind,
  ReportRow,
  ReportsDataDto,
  ReportTotals,
  SalesReportRow,
} from "@/modules/administration/application/dto/ReportDto";
import { downloadMultipleReportsXlsx, type ReportExportConfig } from "@/modules/administration/application/reportXlsx";
import { getOptions, getFilterSummary } from "@/modules/administration/application/reportHelpers";
import { GetReportsService } from "@/modules/administration/application/services/GetReportsService";
import {
  AdministrationServiceError,
  cleanError,
} from "@/modules/administration/application/services/serviceHelpers";
import {
  getMovementTypeLabel,
  getPaymentMethodLabel,
  getReportStatusLabel,
} from "@/modules/administration/application/reportLabels";
import {
  REPORTS_EXPORT_PERMISSION,
  REPORTS_READ_PERMISSION,
} from "@/modules/administration/permissions";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useEntitlementContext } from "@/shared/providers/EntitlementProvider";
import { SaasCapabilityKey } from "@/core/enums";

const EMPTY_DATA: ReportsDataDto = {
  tenantId: "",
  sales: [],
  purchases: [],
  movements: [],
  payments: [],
};

export function useReports() {
  const repositories = useRepositories();
  const { hasCapability } = useEntitlementContext();
  const { hasPermission, loading: sessionLoading } = useCurrentSession();
  const canRead = hasPermission(REPORTS_READ_PERMISSION);
  const canExport = hasPermission(REPORTS_EXPORT_PERMISSION) && hasCapability(SaasCapabilityKey.advancedReports);
  const service = useMemo(() => new GetReportsService(repositories), [repositories]);
  const [data, setData] = useState<ReportsDataDto>(EMPTY_DATA);
  const [kind, setKindState] = useState<ReportKind>("sales");
  const [filter, setFilter] = useState<ReportFilter>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (sessionLoading || !canRead) return;

    setLoading(true);
    setError(null);
    try {
      setData(await service.execute());
    } catch (caughtError) {
      setData(EMPTY_DATA);
      setError(cleanError(caughtError));
    } finally {
      setLoading(false);
    }
  }, [canRead, service, sessionLoading]);

  useDataEvent("sale.changed", reload);
  useDataEvent("purchase-order.changed", reload);
  useDataEvent("inventory.changed", reload);
  useDataEvent("payment.changed", reload);
  useDataEvent("tenant-subscription.changed", reload);

  useEffect(() => {
    let active = true;

    if (sessionLoading) {
      return () => {
        active = false;
      };
    }

    if (!canRead) {
      window.queueMicrotask(() => {
        if (active) setLoading(false);
      });
      return () => {
        active = false;
      };
    }

    service
      .execute()
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
        setError(null);
      })
      .catch((caughtError: unknown) => {
        if (!active) return;
        setData(EMPTY_DATA);
        setError(cleanError(caughtError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canRead, service, sessionLoading]);

  const rows = useMemo<ReportRow[]>(() => filterRows(data, kind, filter), [data, filter, kind]);
  const totals = useMemo<ReportTotals>(() => calculateTotals(kind, rows), [kind, rows]);
  const resetFilter = useCallback(() => setFilter({}), []);
  const setKind = useCallback((nextKind: ReportKind) => {
    setKindState(nextKind);
    setFilter({});
  }, []);
  const exportConfigs = useCallback(async (configs: { kind: ReportKind; filter: ReportFilter }[]) => {
    setError(null);
    try {
      const exportTenantId = await service.authorizeExport();
      if (!data.tenantId || exportTenantId !== data.tenantId) {
        throw new AdministrationServiceError(
          "Los datos visibles ya no pertenecen a la sesión actual. Actualizá el reporte.",
        );
      }

      const reports = configs.map(config => {
        const configRows = filterRows(data, config.kind, config.filter);
        const configTotals = calculateTotals(config.kind, configRows);
        const options = getOptions(data, config.kind);
        const filterSummary = getFilterSummary(config.filter, options);

        return {
          sheetName: REPORT_KIND_SHEET_LABELS[config.kind],
          title: `Reporte de ${REPORT_KIND_SHEET_LABELS[config.kind]}`,
          periodLabel: "",
          filterSummary,
          recordCount: configRows.length,
          data: getReportTableData(config.kind, configRows),
          totals: configTotals
        } as ReportExportConfig;
      });

      const dateKey = getLocalDateKey(new Date());
      const filename = reports.length > 1
        ? `Reportes_Administrativos_${dateKey}.xlsx`
        : `Reporte_${reports[0].sheetName}_${dateKey}.xlsx`;

      await downloadMultipleReportsXlsx(filename, reports);
    } catch (caughtError) {
      setError(cleanError(caughtError));
    }
  }, [data, service]);

  return {
    loading: loading || sessionLoading,
    error,
    data,
    kind,
    setKind,
    filter,
    setFilter,
    resetFilter,
    rows,
    totals,
    canRead,
    canExport,
    exportConfigs,
    reload,
  };
}

const REPORT_KIND_SHEET_LABELS: Record<ReportKind, string> = {
  sales: "Ventas",
  purchases: "Compras",
  movements: "Movimientos",
  payments: "Pagos",
};

export function filterRows(
  data: ReportsDataDto,
  kind: ReportKind,
  filter: ReportFilter,
): ReportRow[] {
  if (kind === "sales") {
    return data.sales.filter(
      (row) =>
        matchesDateRange(row.date, filter) &&
        (!filter.status || row.status === filter.status) &&
        (!filter.branchId || row.branchId === filter.branchId),
    );
  }
  if (kind === "purchases") {
    return data.purchases.filter(
      (row) =>
        matchesDateRange(row.date, filter) &&
        (!filter.status || row.status === filter.status) &&
        (!filter.supplierId || row.supplierId === filter.supplierId) &&
        (!filter.branchId || row.branchId === filter.branchId),
    );
  }
  if (kind === "movements") {
    return data.movements.filter(
      (row) =>
        matchesDateRange(row.date, filter) &&
        (!filter.movementType || row.type === filter.movementType) &&
        (!filter.branchId || row.branchId === filter.branchId) &&
        (!filter.productId || row.productId === filter.productId),
    );
  }
  return data.payments.filter(
    (row) =>
      matchesDateRange(row.date, filter) &&
      (!filter.method || row.method === filter.method) &&
      (!filter.status || row.status === filter.status),
  );
}

function matchesDateRange(date: string, filter: ReportFilter) {
  const dateKey = getLocalDateKey(new Date(date));
  return (!filter.from || dateKey >= filter.from) && (!filter.to || dateKey <= filter.to);
}

export function calculateTotals(kind: ReportKind, rows: ReportRow[]): ReportTotals {
  if (kind === "sales") {
    const sales = rows as SalesReportRow[];
    const effectiveSales = sales.filter((row) => row.status === SaleStatus.completed);
    return {
      kind,
      count: effectiveSales.length,
      excludedCount: sales.length - effectiveSales.length,
      total: sum(effectiveSales.map((row) => row.total)),
      discountTotal: sum(effectiveSales.map((row) => row.discountTotal)),
      taxTotal: sum(effectiveSales.map((row) => row.taxTotal)),
      byChannel: groupAmounts(effectiveSales, (row) => row.channel, (row) => row.total).map(({ key, count, amount }) => ({ channel: key, count, total: amount })),
    };
  }
  if (kind === "purchases") {
    const purchases = rows as PurchasesReportRow[];
    const operationalPurchases = purchases.filter(
      (row) =>
        row.status !== PurchaseOrderStatus.draft && row.status !== PurchaseOrderStatus.cancelled,
    );
    return {
      kind,
      count: operationalPurchases.length,
      excludedCount: purchases.length - operationalPurchases.length,
      total: sum(operationalPurchases.map((row) => row.total)),
    };
  }
  if (kind === "movements") {
    const movements = rows as MovementReportRow[];
    return {
      kind,
      byType: groupAmounts(
        movements,
        (row) => row.type,
        (row) => row.quantity,
      ).map(({ key, count, amount }) => ({ type: key, count, quantity: amount })),
    };
  }

  const payments = rows as PaymentReportRow[];
  return {
    kind: "payments",
    count: payments.length,
    byMethod: groupAmounts(
      payments,
      (row) => row.method,
      (row) => row.amount,
    ).map(({ key, amount }) => ({ method: key, amount })),
    byStatus: groupAmounts(
      payments,
      (row) => row.status,
      (row) => row.amount,
    ).map(({ key, amount }) => ({ status: key, amount })),
  };
}

function groupAmounts<T>(rows: T[], keyOf: (row: T) => string, amountOf: (row: T) => number) {
  const groups = new Map<string, { count: number; amount: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = groups.get(key) ?? { count: 0, amount: 0 };
    groups.set(key, { count: current.count + 1, amount: current.amount + amountOf(row) });
  }
  return [...groups.entries()].map(([key, value]) => ({ key, ...value }));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function getReportTableData(
  kind: ReportKind,
  rows: ReportRow[],
): { headers: string[]; rows: Array<Array<string | number>> } {
  if (kind === "sales") {
    return {
      headers: [
        "Canal",
        "Origen",
        "Número",
        "Fecha",
        "Sucursal",
        "Estado",
        "Subtotal",
        "Descuento",
        "Impuesto",
        "Total",
      ],
      rows: (rows as SalesReportRow[]).map((row) => [
        row.channel,
        row.origin,
        row.number,
        getLocalDateKey(new Date(row.date)),
        row.branchName,
        getReportStatusLabel(row.status),
        row.subtotal,
        row.discountTotal,
        row.taxTotal,
        row.total,
      ]),
    };
  }
  if (kind === "purchases") {
    return {
      headers: ["Número", "Fecha", "Sucursal", "Proveedor", "Estado", "Subtotal", "Total"],
      rows: (rows as PurchasesReportRow[]).map((row) => [
        row.number,
        getLocalDateKey(new Date(row.date)),
        row.branchName,
        row.supplierName,
        getReportStatusLabel(row.status),
        row.subtotal,
        row.total,
      ]),
    };
  }
  if (kind === "movements") {
    return {
      headers: ["Fecha", "Sucursal", "Producto", "Tipo", "Cantidad", "Motivo"],
      rows: (rows as MovementReportRow[]).map((row) => [
        getLocalDateKey(new Date(row.date)),
        row.branchName,
        row.productName,
        getMovementTypeLabel(row.type),
        row.quantity,
        row.reason,
      ]),
    };
  }
  return {
    headers: ["Fecha", "Método", "Estado", "Monto", "Referencia", "Origen"],
    rows: (rows as PaymentReportRow[]).map((row) => [
      getLocalDateKey(new Date(row.date)),
      getPaymentMethodLabel(row.method),
      getReportStatusLabel(row.status),
      row.amount,
      row.reference,
      row.origin,
    ]),
  };
}

export function getLocalDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
