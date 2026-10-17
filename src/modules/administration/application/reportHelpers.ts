import type { ReportFilter, ReportKind, ReportsDataDto } from "@/modules/administration/application/dto/ReportDto";
import { getMovementTypeLabel, getPaymentMethodLabel, getReportStatusLabel } from "@/modules/administration/application/reportLabels";

export function getOptions(data: ReportsDataDto, kind: ReportKind) {
  if (kind === "sales") {
    return {
      statuses: uniqueOptions(
        data.sales.map((row) => [row.status, getReportStatusLabel(row.status)]),
      ),
      branches: uniqueOptions(data.sales.map((row) => [row.branchId, row.branchName])),
      suppliers: [],
      products: [],
      movementTypes: [],
      methods: [],
    };
  }
  if (kind === "purchases") {
    return {
      statuses: uniqueOptions(
        data.purchases.map((row) => [row.status, getReportStatusLabel(row.status)]),
      ),
      branches: uniqueOptions(data.purchases.map((row) => [row.branchId, row.branchName])),
      suppliers: uniqueOptions(data.purchases.map((row) => [row.supplierId, row.supplierName])),
      products: [],
      movementTypes: [],
      methods: [],
    };
  }
  if (kind === "movements") {
    return {
      statuses: [],
      branches: uniqueOptions(data.movements.map((row) => [row.branchId, row.branchName])),
      suppliers: [],
      products: uniqueOptions(data.movements.map((row) => [row.productId, row.productName])),
      movementTypes: uniqueOptions(
        data.movements.map((row) => [row.type, getMovementTypeLabel(row.type)]),
      ),
      methods: [],
    };
  }
  return {
    statuses: uniqueOptions(
      data.payments.map((row) => [row.status, getReportStatusLabel(row.status)]),
    ),
    branches: [],
    suppliers: [],
    products: [],
    movementTypes: [],
    methods: uniqueOptions(
      data.payments.map((row) => [row.method, getPaymentMethodLabel(row.method)]),
    ),
  };
}

export function uniqueOptions(entries: string[][]) {
  return [...new Map(entries.map(([value, label]) => [value, label])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "es"));
}

export function getDateRangeLabel(from: string, to: string) {
  if (from && to) return `${formatDate(from)} → ${formatDate(to)}`;
  if (from) return `${formatDate(from)} → Seleccionar fin`;
  if (to) return `Seleccionar inicio → ${formatDate(to)}`;
  return "Seleccionar rango";
}

export function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export function getFilterSummary(filter: ReportFilter, options: ReturnType<typeof getOptions>): string[] {
  const summary: string[] = [];
  if (filter.from || filter.to) {
    summary.push(`Rango: ${getDateRangeLabel(filter.from || "", filter.to || "")}`);
  }
  if (filter.status) {
    summary.push(`Estado: ${options.statuses.find((o) => o.value === filter.status)?.label || filter.status}`);
  }
  if (filter.branchId) {
    summary.push(`Sucursal: ${options.branches.find((o) => o.value === filter.branchId)?.label || filter.branchId}`);
  }
  if (filter.supplierId) {
    summary.push(`Proveedor: ${options.suppliers.find((o) => o.value === filter.supplierId)?.label || filter.supplierId}`);
  }
  if (filter.productId) {
    summary.push(`Producto: ${options.products.find((o) => o.value === filter.productId)?.label || filter.productId}`);
  }
  if (filter.movementType) {
    summary.push(`Tipo: ${options.movementTypes.find((o) => o.value === filter.movementType)?.label || filter.movementType}`);
  }
  if (filter.method) {
    summary.push(`Método: ${options.methods.find((o) => o.value === filter.method)?.label || filter.method}`);
  }
  if (summary.length === 0) return ["Sin filtros aplicados"];
  return summary;
}
