import type { Workbook } from "exceljs";
import type { ReportTotals } from "@/modules/administration/application/dto/ReportDto";
import { getMovementTypeLabel, getPaymentMethodLabel, getReportStatusLabel } from "@/modules/administration/application/reportLabels";

export interface ReportXlsxData {
  headers: string[];
  rows: Array<Array<string | number>>;
}

export interface ReportExportConfig {
  sheetName: string;
  title: string;
  periodLabel: string;
  filterSummary: string[];
  recordCount: number;
  data: ReportXlsxData;
  totals: ReportTotals;
}

const HEADER_FILL = "FF3E668F"; // System blue (--color-structure)
const ACCENT_FILL = "FFFFF2D0"; // Cream accent (--color-app-background)
const BORDER_COLOR = "FFD1D5DB"; // Neutral gray border
const MIN_COLUMN_WIDTH = 12;
const MAX_COLUMN_WIDTH = 45;

export async function buildReportWorkbook(data: ReportXlsxData, sheetName: string) {
  const ExcelJS = await import("exceljs");
  const Workbook = ExcelJS.Workbook ?? ExcelJS.default.Workbook;
  const workbook = new Workbook();
  workbook.creator = "OmniRetail";
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sanitizeSheetName(sheetName), {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
  });

  worksheet.columns = data.headers.map((header, columnIndex) => ({
    header,
    width: getColumnWidth(header, data.rows, columnIndex),
  }));
  data.rows.forEach((row) => worksheet.addRow(row));

  worksheet.eachRow((row, rowNumber) => {
    const isHeaderRow = rowNumber === 1;
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = borderAll();
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      if (isHeaderRow) {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      }
    });
  });
  worksheet.getRow(1).height = 24;

  return workbook;
}

export async function downloadReportXlsx(
  filename: string,
  data: ReportXlsxData,
  sheetName: string,
): Promise<void> {
  const workbook = await buildReportWorkbook(data, sheetName);
  await saveWorkbook(workbook, filename);
}

export async function downloadMultipleReportsXlsx(
  filename: string,
  reports: ReportExportConfig[],
): Promise<void> {
  const ExcelJS = await import("exceljs");
  const Workbook = ExcelJS.Workbook ?? ExcelJS.default.Workbook;
  const workbook = new Workbook();
  workbook.creator = "OmniRetail";
  workbook.created = new Date();

  const now = new Date();
  const generationDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${now.toLocaleTimeString("es-GT", { hour: '2-digit', minute: '2-digit', hour12: true })}`;

  // --- Estilos Globales ---
  const titleFont = { bold: true, color: { argb: HEADER_FILL }, size: 20 };
  const subtitleFont = { bold: true, color: { argb: "FF4B5563" }, size: 14 }; // Gray 600
  const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
  const normalBoldFont = { bold: true, color: { argb: "FF1F2937" } }; // Gray 800
  const metricValueFont = { bold: true, color: { argb: HEADER_FILL }, size: 12 };

  const fillPrimary = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: HEADER_FILL } };
  const fillAccent = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: ACCENT_FILL } };
  const fillAlternate = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF9FAFB" } }; // Gray 50

  // --- Hoja Resumen ---
  const summarySheet = workbook.addWorksheet("Resumen", {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  summarySheet.getColumn(1).width = 3;
  summarySheet.getColumn(2).width = 35;
  summarySheet.getColumn(3).width = 25;
  summarySheet.getColumn(4).width = 25;

  let row = 2;
  summarySheet.mergeCells(`B${row}:D${row}`);
  const titleCell = summarySheet.getCell(`B${row}`);
  titleCell.value = "REPORTE ADMINISTRATIVO";
  titleCell.font = titleFont;
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  row++;

  summarySheet.mergeCells(`B${row}:D${row}`);
  const subCell = summarySheet.getCell(`B${row}`);
  subCell.value = "Resumen ejecutivo de reportes seleccionados";
  subCell.font = subtitleFont;
  subCell.alignment = { vertical: "middle", horizontal: "left" };
  row += 2;

  // Encontrar rango general si hay filtros de fecha
  let dateRange = "Histórico completo";
  const fromDates = reports.map(r => r.filterSummary.find(f => f.startsWith("Desde:"))?.replace("Desde: ", "")).filter((f): f is string => typeof f === "string");
  const toDates = reports.map(r => r.filterSummary.find(f => f.startsWith("Hasta:"))?.replace("Hasta: ", "")).filter((f): f is string => typeof f === "string");
  if (fromDates.length > 0 || toDates.length > 0) {
    const minFrom = fromDates.length ? fromDates.sort()[0] : "Inicio";
    const maxTo = toDates.length ? toDates.sort().reverse()[0] : "Hoy";
    dateRange = `${formatDateString(minFrom)} al ${formatDateString(maxTo)}`;
  }

  const reportNames = reports.map(r => r.sheetName).join(", ");

  const addMetaCard = (label: string, value: string | number) => {
    const labelCell = summarySheet.getCell(`B${row}`);
    labelCell.value = label;
    labelCell.font = normalBoldFont;
    labelCell.fill = fillAccent;
    labelCell.border = borderAll();
    labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

    summarySheet.mergeCells(`C${row}:D${row}`);
    const valCell = summarySheet.getCell(`C${row}`);
    valCell.value = value;
    valCell.border = borderAll();
    valCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    row++;
  };

  addMetaCard("Fecha de generación", generationDate);
  addMetaCard("Período consultado", dateRange);
  addMetaCard("Reportes incluidos", `${reports.length} (${reportNames})`);
  row += 2;

  for (const report of reports) {
    summarySheet.mergeCells(`B${row}:D${row}`);
    const modTitle = summarySheet.getCell(`B${row}`);
    modTitle.value = `Reporte de ${report.sheetName.toLowerCase()}`;
    modTitle.font = headerFont;
    modTitle.fill = fillPrimary;
    modTitle.alignment = { vertical: "middle", horizontal: "center" };
    modTitle.border = borderAll();
    summarySheet.getRow(row).height = 22;
    row++;

    summarySheet.getCell(`B${row}`).value = "Registros encontrados";
    summarySheet.getCell(`B${row}`).font = normalBoldFont;
    summarySheet.getCell(`B${row}`).border = borderAll();
    summarySheet.getCell(`B${row}`).alignment = { indent: 1 };

    summarySheet.mergeCells(`C${row}:D${row}`);
    summarySheet.getCell(`C${row}`).value = report.recordCount;
    summarySheet.getCell(`C${row}`).border = borderAll();
    summarySheet.getCell(`C${row}`).alignment = { horizontal: "right", indent: 1 };
    row++;

    summarySheet.getCell(`B${row}`).value = "Filtros aplicados";
    summarySheet.getCell(`B${row}`).font = normalBoldFont;
    summarySheet.getCell(`B${row}`).border = borderAll();
    summarySheet.getCell(`B${row}`).alignment = { vertical: "top", indent: 1 };

    summarySheet.mergeCells(`C${row}:D${row}`);
    summarySheet.getCell(`C${row}`).value = report.filterSummary.map(translateFilter).join(" | ") || "Sin filtros (Todos)";
    summarySheet.getCell(`C${row}`).border = borderAll();
    summarySheet.getCell(`C${row}`).alignment = { wrapText: true, vertical: "top", indent: 1 };
    summarySheet.getRow(row).height = report.filterSummary.length > 2 ? 30 : 20;
    row++;

    // Totals
    if (report.totals) {
      const t = report.totals;
      if (t.kind === "sales") {
        summarySheet.getCell(`B${row}`).value = "Total de ventas completadas";
        summarySheet.getCell(`B${row}`).border = borderAll();
        summarySheet.getCell(`B${row}`).alignment = { indent: 1 };
        summarySheet.mergeCells(`C${row}:D${row}`);
        summarySheet.getCell(`C${row}`).value = t.total;
        summarySheet.getCell(`C${row}`).numFmt = '"Q" #,##0.00';
        summarySheet.getCell(`C${row}`).border = borderAll();
        summarySheet.getCell(`C${row}`).font = metricValueFont;
        summarySheet.getCell(`C${row}`).alignment = { horizontal: "right", indent: 1 };
        row++;
      } else if (t.kind === "purchases") {
        summarySheet.getCell(`B${row}`).value = "Total de compras operativas";
        summarySheet.getCell(`B${row}`).border = borderAll();
        summarySheet.getCell(`B${row}`).alignment = { indent: 1 };
        summarySheet.mergeCells(`C${row}:D${row}`);
        summarySheet.getCell(`C${row}`).value = t.total;
        summarySheet.getCell(`C${row}`).numFmt = '"Q" #,##0.00';
        summarySheet.getCell(`C${row}`).border = borderAll();
        summarySheet.getCell(`C${row}`).font = metricValueFont;
        summarySheet.getCell(`C${row}`).alignment = { horizontal: "right", indent: 1 };
        row++;
      } else if (t.kind === "payments") {
        const totalAmount = t.byStatus.find(s => s.status === "completed" || s.status === "paid" || s.status === "succeeded")?.amount || t.byStatus.reduce((acc, curr) => acc + curr.amount, 0);
        summarySheet.getCell(`B${row}`).value = "Total de pagos";
        summarySheet.getCell(`B${row}`).border = borderAll();
        summarySheet.getCell(`B${row}`).alignment = { indent: 1 };
        summarySheet.mergeCells(`C${row}:D${row}`);
        summarySheet.getCell(`C${row}`).value = totalAmount;
        summarySheet.getCell(`C${row}`).numFmt = '"Q" #,##0.00';
        summarySheet.getCell(`C${row}`).border = borderAll();
        summarySheet.getCell(`C${row}`).font = metricValueFont;
        summarySheet.getCell(`C${row}`).alignment = { horizontal: "right", indent: 1 };
        row++;
      } else if (t.kind === "movements") {
        const totalAmount = t.byType.reduce((acc, curr) => acc + curr.quantity, 0);
        summarySheet.getCell(`B${row}`).value = "Total de unidades movidas";
        summarySheet.getCell(`B${row}`).border = borderAll();
        summarySheet.getCell(`B${row}`).alignment = { indent: 1 };
        summarySheet.mergeCells(`C${row}:D${row}`);
        summarySheet.getCell(`C${row}`).value = totalAmount;
        summarySheet.getCell(`C${row}`).numFmt = '#,##0';
        summarySheet.getCell(`C${row}`).border = borderAll();
        summarySheet.getCell(`C${row}`).font = metricValueFont;
        summarySheet.getCell(`C${row}`).alignment = { horizontal: "right", indent: 1 };
        row++;
      }
    }
    row += 2;
  }

  // --- Hojas de Datos ---
  for (const report of reports) {
    const ws = workbook.addWorksheet(sanitizeSheetName(report.sheetName), {
      views: [{ showGridLines: false }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    });

    ws.getColumn(1).width = 3; // Margen izquierdo

    let rRow = 2;
    ws.mergeCells(`B${rRow}:H${rRow}`);
    const rTitleCell = ws.getCell(`B${rRow}`);
    rTitleCell.value = `REPORTE DE ${report.sheetName.toUpperCase()}`;
    rTitleCell.font = titleFont;
    rTitleCell.alignment = { vertical: "middle", horizontal: "left" };
    rRow++;

    ws.mergeCells(`B${rRow}:H${rRow}`);
    const subtitleMap: Record<string, string> = {
      "Ventas": "Consolidado de ventas POS y en línea",
      "Compras": "Resumen de órdenes de compra",
      "Movimientos": "Detalle de entradas y salidas de inventario",
      "Pagos": "Resumen de transacciones registradas"
    };
    ws.getCell(`B${rRow}`).value = subtitleMap[report.sheetName] || `Detalle de ${report.sheetName.toLowerCase()}`;
    ws.getCell(`B${rRow}`).font = subtitleFont;
    rRow += 2;

    // Metadata band
    const mBandRow = rRow;
    ws.getCell(`B${mBandRow}`).value = "Fecha de generación:"; ws.getCell(`B${mBandRow}`).font = normalBoldFont;
    ws.getCell(`C${mBandRow}`).value = generationDate;

    ws.getCell(`E${mBandRow}`).value = "Período consultado:"; ws.getCell(`E${mBandRow}`).font = normalBoldFont;
    ws.getCell(`F${mBandRow}`).value = dateRange;
    rRow++;

    ws.getCell(`B${rRow}`).value = "Filtros aplicados:"; ws.getCell(`B${rRow}`).font = normalBoldFont;
    ws.getCell(`C${rRow}`).value = report.filterSummary.map(translateFilter).join(" | ") || "Ninguno";

    ws.getCell(`E${rRow}`).value = "Registros encontrados:"; ws.getCell(`E${rRow}`).font = normalBoldFont;
    ws.getCell(`F${rRow}`).value = report.recordCount;
    rRow += 2;

    // --- KPI Cards ---
    if (report.totals) {
      const totals = report.totals;
      const kRow = rRow;
      const addKPI = (col: string, title: string, value: string | number, isCurrency = false, isCount = false) => {
        const titleC = ws.getCell(`${col}${kRow}`);
        titleC.value = title;
        titleC.font = { bold: true, color: { argb: "FF6B7280" }, size: 10 }; // Gray 500
        titleC.fill = fillAccent;
        titleC.border = borderAll();
        titleC.alignment = { horizontal: "center", vertical: "middle" };

        const valC = ws.getCell(`${col}${kRow+1}`);
        valC.value = value;
        valC.font = normalBoldFont;
        valC.border = borderAll();
        valC.alignment = { horizontal: "center", vertical: "middle" };
        if (isCurrency) valC.numFmt = '"Q" #,##0.00';
        else if (isCount) valC.numFmt = '#,##0';
      };

      if (totals.kind === "sales") {
        addKPI("B", "Ventas completadas", totals.count, false, true);
        addKPI("C", "Ventas excluidas", totals.excludedCount, false, true);
        addKPI("D", "Total completado", totals.total, true);
        addKPI("E", "Descuentos", totals.discountTotal, true);
        addKPI("F", "Impuestos", totals.taxTotal, true);

        if (totals.byChannel && totals.byChannel.length > 0) {
          let colIndex = 7; // G
          for (const bc of totals.byChannel) {
            const col = String.fromCharCode(64 + colIndex);
            addKPI(col, bc.channel === "En línea" ? "En línea" : "POS", bc.total, true);
            colIndex++;
          }
        }
      } else if (totals.kind === "purchases") {
        addKPI("B", "Órdenes operativas", totals.count, false, true);
        addKPI("C", "Órdenes excluidas", totals.excludedCount, false, true);
        addKPI("D", "Total de compras", totals.total, true);
      } else if (totals.kind === "movements") {
        let colIndex = 2; // B
        let totalUnidades = 0;
        for (const bt of totals.byType) {
          const col = String.fromCharCode(64 + colIndex);
          addKPI(col, getMovementTypeLabel(bt.type), bt.quantity, false, true);
          totalUnidades += bt.quantity;
          colIndex++;
        }
        const col = String.fromCharCode(64 + colIndex);
        addKPI(col, "Total de unidades", totalUnidades, false, true);
      } else if (totals.kind === "payments") {
        addKPI("B", "Cantidad de pagos", totals.count, false, true);

        const totalAmount = totals.byStatus.find(s => s.status === "completed" || s.status === "paid" || s.status === "succeeded")?.amount || totals.byStatus.reduce((acc, curr) => acc + curr.amount, 0);
        addKPI("C", "Total pagado", totalAmount, true);

        let colIndex = 4; // D
        for (const bm of totals.byMethod) {
          const col = String.fromCharCode(64 + colIndex);
          addKPI(col, getPaymentMethodLabel(bm.method), bm.amount, true);
          colIndex++;
        }
      }
      ws.getRow(kRow).height = 18;
      ws.getRow(kRow+1).height = 24;
      rRow += 4;
    }

    // Tabla de Datos
    if (report.data.rows.length === 0) {
      ws.getCell(`B${rRow}`).value = "No se encontraron registros con los filtros seleccionados.";
      ws.getCell(`B${rRow}`).font = { italic: true, color: { argb: "FF6B7280" } };
    } else {
      // Configurar freeze pane exactly above table
      ws.views = [{ state: "frozen", ySplit: rRow, xSplit: 0, showGridLines: false }];

      const tableHeaders = report.data.headers;

      // Ajustar anchos
      const widths = tableHeaders.map((header, columnIndex) => getColumnWidth(header, report.data.rows, columnIndex));

      ws.columns = [
        { width: 3 }, // Columna A margen
        ...tableHeaders.map((header, i) => ({ width: widths[i] }))
      ];

      // Cabecera de la tabla
      const headerRow = ws.getRow(rRow);
      tableHeaders.forEach((th, i) => {
        const cell = headerRow.getCell(i + 2);
        cell.value = th;
        cell.font = headerFont;
        cell.fill = fillPrimary;
        cell.border = borderAll();
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
      headerRow.height = 25;

      ws.autoFilter = {
        from: { row: rRow, column: 2 },
        to: { row: rRow, column: tableHeaders.length + 1 }
      };
      rRow++;

      // Variables para los totales al final
      const sumColumns: Record<number, number> = {};

      // Datos
      for (let rowIndex = 0; rowIndex < report.data.rows.length; rowIndex++) {
        const dataRow = report.data.rows[rowIndex];
        const rowObj = ws.getRow(rRow);

        // Alternating fill (Zebra)
        const rowFill = rowIndex % 2 === 0 ? undefined : fillAlternate;

        dataRow.forEach((val, i) => {
          const cell = rowObj.getCell(i + 2);

          let displayVal = val;
          // Format specific dates correctly
          if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
            const [y, m, d] = val.split("-");
            cell.value = new Date(parseInt(y), parseInt(m) - 1, parseInt(d), 12, 0, 0);
            cell.numFmt = "dd/mm/yyyy";
            cell.alignment = { vertical: "middle", horizontal: "center" };
          } else {
            // Apply translations where necessary based on headers
            const header = tableHeaders[i];
            if (header === "Tipo") displayVal = getMovementTypeLabel(String(val));
            else if (header === "Método") displayVal = getPaymentMethodLabel(String(val));
            else if (header === "Estado") displayVal = getReportStatusLabel(String(val));

            cell.value = displayVal;
            cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
          }

          if (rowFill) cell.fill = rowFill;
          cell.border = borderAll();

          if (typeof val === "number") {
            const header = tableHeaders[i];
            if (header === "Subtotal" || header === "Descuento" || header === "Impuesto" || header === "Total" || header === "Monto") {
              cell.numFmt = '"Q" #,##0.00';
              cell.alignment = { vertical: "middle", horizontal: "right" };

              if (report.totals?.kind !== "movements") {
                sumColumns[i] = (sumColumns[i] || 0) + val;
              }
            } else if (header === "Cantidad") {
              cell.numFmt = '#,##0';
              cell.alignment = { vertical: "middle", horizontal: "right" };
            }
          }
        });
        rRow++;
      }

      // Fila de totales para finanzas
      if (report.totals?.kind === "sales" || report.totals?.kind === "purchases" || report.totals?.kind === "payments") {
        const totalRow = ws.getRow(rRow);

        // La etiqueta "Total" va en la primera columna o donde empiece la tabla
        const firstCell = totalRow.getCell(2);
        firstCell.value = "Total";
        firstCell.font = normalBoldFont;
        firstCell.alignment = { horizontal: "right", vertical: "middle" };

        tableHeaders.forEach((th, i) => {
          const cell = totalRow.getCell(i + 2);
          cell.border = { top: { style: "medium", color: { argb: "FF9CA3AF" } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } }, left: { style: "thin", color: { argb: BORDER_COLOR } }, right: { style: "thin", color: { argb: BORDER_COLOR } } };
          cell.fill = fillAccent;

          if (sumColumns[i] !== undefined) {
            cell.value = sumColumns[i];
            cell.numFmt = '"Q" #,##0.00';
            cell.font = normalBoldFont;
            cell.alignment = { vertical: "middle", horizontal: "right" };
          }
        });
        totalRow.height = 24;
      }
    }
  }

  await saveWorkbook(workbook, filename);
}

function formatDateString(val: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split("-");
    return `${d}/${m}/${y}`;
  }
  return val;
}

function translateFilter(filterStr: string): string {
  // Ejemplos: "Estado: completed", "Tipo: in"
  const parts = filterStr.split(": ");
  if (parts.length === 2) {
    const [key, val] = parts;
    if (key === "Estado") return `${key}: ${getReportStatusLabel(val)}`;
    if (key === "Tipo") return `${key}: ${getMovementTypeLabel(val)}`;
    if (key === "Método") return `${key}: ${getPaymentMethodLabel(val)}`;
    if (key === "Desde" || key === "Hasta") return `${key}: ${formatDateString(val)}`;
  }
  return filterStr;
}

async function saveWorkbook(workbook: Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getColumnWidth(
  header: string,
  rows: Array<Array<string | number>>,
  columnIndex: number,
): number {
  const longestValue = rows.reduce((max, row) => {
    const cell = row[columnIndex];
    const length = cell === undefined ? 0 : String(cell).length;
    return Math.max(max, length);
  }, header.length);
  return Math.min(Math.max(longestValue + 4, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
}

function borderAll() {
  const style = { style: "thin" as const, color: { argb: BORDER_COLOR } };
  return { top: style, bottom: style, left: style, right: style };
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/*?:\[\]]/g, " ").slice(0, 31);
}
