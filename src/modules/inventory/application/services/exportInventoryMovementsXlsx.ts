import type {
  InventoryMovementKpis,
  InventoryMovementRow,
} from "@/modules/inventory/application/dto/InventoryMovementsDto";

export interface ExportInventoryMovementsXlsxInput {
  rows: InventoryMovementRow[];
  kpis: InventoryMovementKpis;
  periodLabel: string;
  typeLabel: string;
  branchLabel: string;
}

const TABLE_HEADER_ROW = 8;
const TABLE_FIRST_DATA_ROW = TABLE_HEADER_ROW + 1;
const COLUMN_COUNT = 12;
const NUMBER_FORMAT = "+0.########;-0.########;0";
const QUANTITY_FORMAT = "0.########";

const COLORS = {
  structure: "3E668F",
  title: "315D8C",
  text: "23364D",
  muted: "7488A6",
  border: "D7E1EC",
  primarySoft: "EEF4FC",
  stripe: "F7FAFD",
  success: "16845B",
  successSoft: "EAF7F1",
  danger: "C43D4D",
  dangerSoft: "FDEFF1",
  warning: "A96F08",
  warningSoft: "FFF7E5",
  white: "FFFFFF",
} as const;

const TABLE_COLUMNS = [
  "Fecha y hora",
  "Producto",
  "SKU",
  "Tipo",
  "Referencia",
  "Cantidad anterior",
  "Cambio",
  "Cantidad resultante",
  "Sucursal",
  "Ubicación",
  "Usuario",
  "Motivo",
] as const;

export async function exportInventoryMovementsXlsx(input: ExportInventoryMovementsXlsxInput) {
  const generatedAt = new Date();
  const workbook = await createInventoryMovementsWorkbook(input, generatedAt);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `historial-movimientos-${formatFileDate(generatedAt)}.xlsx`;
  link.click();
  window.URL.revokeObjectURL(url);
}

export async function createInventoryMovementsWorkbook(
  { rows, kpis, periodLabel, typeLabel, branchLabel }: ExportInventoryMovementsXlsxInput,
  generatedAt = new Date(),
) {
  const ExcelJS = await import("exceljs");
  const Workbook = ExcelJS.Workbook ?? ExcelJS.default.Workbook;
  const workbook = new Workbook();
  workbook.creator = "OmniRetail";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.subject = "Historial de movimientos de inventario";

  const worksheet = workbook.addWorksheet("Historial de movimientos", {
    properties: { defaultRowHeight: 20 },
    views: [
      {
        state: "frozen",
        ySplit: TABLE_HEADER_ROW,
        topLeftCell: `A${TABLE_FIRST_DATA_ROW}`,
        activeCell: `A${TABLE_FIRST_DATA_ROW}`,
        showGridLines: false,
      },
    ],
  });

  setColumnLayout(worksheet);
  addReportHeader(worksheet, generatedAt);
  addFilterBlock(worksheet, { periodLabel, typeLabel, branchLabel, generatedAt });
  addKpiCards(worksheet, kpis);
  addSectionHeader(worksheet);
  addMovementTable(worksheet, rows);

  const lastTableRow = TABLE_HEADER_ROW + rows.length;
  const contentLastRow = rows.length === 0 ? addEmptyState(worksheet) : lastTableRow;
  const footerRow = contentLastRow + 2;
  addDocumentFooter(worksheet, footerRow, generatedAt);
  configurePrint(worksheet, footerRow, generatedAt);

  return workbook;
}

function setColumnLayout(worksheet: import("exceljs").Worksheet) {
  worksheet.columns = [
    { key: "createdAt", width: 20 },
    { key: "productName", width: 28 },
    { key: "sku", width: 17 },
    { key: "typeLabel", width: 23 },
    { key: "referenceLabel", width: 22 },
    { key: "quantityBefore", width: 16 },
    { key: "signedQuantity", width: 13 },
    { key: "quantityAfter", width: 16 },
    { key: "branchName", width: 21 },
    { key: "locationLabel", width: 27 },
    { key: "userLabel", width: 21 },
    { key: "reason", width: 38 },
  ];
}

function addReportHeader(worksheet: import("exceljs").Worksheet, generatedAt: Date) {
  worksheet.mergeCells("A1:L1");
  worksheet.mergeCells("A2:H2");
  worksheet.mergeCells("I2:L2");
  styleRange(worksheet, "A1:L2", {
    fill: solidFill(COLORS.structure),
    font: { color: argb(COLORS.white), name: "Aptos" },
  });

  const title = worksheet.getCell("A1");
  title.value = "HISTORIAL DE MOVIMIENTOS";
  title.font = { bold: true, color: argb(COLORS.white), name: "Aptos Display", size: 18 };
  title.alignment = { vertical: "middle", horizontal: "left" };

  const subtitle = worksheet.getCell("A2");
  subtitle.value = "Reporte de inventario  |  OmniRetail";
  subtitle.font = { color: argb("EAF1F8"), name: "Aptos", size: 10 };
  subtitle.alignment = { vertical: "middle", horizontal: "left" };

  const date = worksheet.getCell("I2");
  date.value = generatedAt;
  date.numFmt = "dd mmm yyyy  hh:mm";
  date.font = { color: argb(COLORS.white), name: "Aptos", size: 10 };
  date.alignment = { vertical: "middle", horizontal: "right" };

  worksheet.getRow(1).height = 34;
  worksheet.getRow(2).height = 23;
}

function addFilterBlock(
  worksheet: import("exceljs").Worksheet,
  values: {
    periodLabel: string;
    typeLabel: string;
    branchLabel: string;
    generatedAt: Date;
  },
) {
  const blocks = [
    { start: "A", end: "C", label: "PERÍODO", value: values.periodLabel },
    { start: "D", end: "F", label: "TIPO", value: values.typeLabel },
    { start: "G", end: "I", label: "SUCURSAL", value: values.branchLabel },
    { start: "J", end: "L", label: "GENERADO", value: values.generatedAt },
  ];

  blocks.forEach(({ start, end, label, value }) => {
    worksheet.mergeCells(`${start}3:${end}3`);
    worksheet.mergeCells(`${start}4:${end}4`);
    const labelCell = worksheet.getCell(`${start}3`);
    const valueCell = worksheet.getCell(`${start}4`);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.fill = solidFill(COLORS.primarySoft);
    labelCell.font = { bold: true, color: argb(COLORS.muted), name: "Aptos", size: 9 };
    valueCell.fill = solidFill(COLORS.white);
    valueCell.font = { bold: true, color: argb(COLORS.text), name: "Aptos", size: 10 };
    labelCell.alignment = { vertical: "middle", horizontal: "left" };
    valueCell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    applyBlockBorder(worksheet, `${start}3:${end}4`);
    if (value instanceof Date) valueCell.numFmt = "dd mmm yyyy  hh:mm";
  });

  worksheet.getRow(3).height = 20;
  worksheet.getRow(4).height = 26;
}

function addKpiCards(worksheet: import("exceljs").Worksheet, kpis: InventoryMovementKpis) {
  const netIsNegative = kpis.net < 0;
  const cards = [
    {
      start: "A",
      end: "D",
      label: "ENTRADAS",
      value: kpis.incoming,
      fill: COLORS.successSoft,
      color: COLORS.success,
    },
    {
      start: "E",
      end: "H",
      label: "SALIDAS",
      value: -Math.abs(kpis.outgoing),
      fill: COLORS.dangerSoft,
      color: COLORS.danger,
    },
    {
      start: "I",
      end: "L",
      label: "MOVIMIENTO NETO",
      value: kpis.net,
      fill: netIsNegative ? COLORS.warningSoft : COLORS.primarySoft,
      color: netIsNegative ? COLORS.warning : COLORS.title,
    },
  ];

  cards.forEach(({ start, end, label, value, fill, color }) => {
    worksheet.mergeCells(`${start}5:${end}5`);
    worksheet.mergeCells(`${start}6:${end}6`);
    const labelCell = worksheet.getCell(`${start}5`);
    const valueCell = worksheet.getCell(`${start}6`);
    labelCell.value = label;
    valueCell.value = value;
    styleRange(worksheet, `${start}5:${end}6`, { fill: solidFill(fill) });
    labelCell.font = { bold: true, color: argb(color), name: "Aptos", size: 9 };
    valueCell.font = { bold: true, color: argb(color), name: "Aptos Display", size: 17 };
    labelCell.alignment = { vertical: "middle", horizontal: "center" };
    valueCell.alignment = { vertical: "middle", horizontal: "center" };
    valueCell.numFmt = NUMBER_FORMAT;
    applyBlockBorder(worksheet, `${start}5:${end}6`, color);
  });

  worksheet.getRow(5).height = 20;
  worksheet.getRow(6).height = 31;
}

function addSectionHeader(worksheet: import("exceljs").Worksheet) {
  worksheet.mergeCells("A7:L7");
  const cell = worksheet.getCell("A7");
  cell.value = "DETALLE DE MOVIMIENTOS";
  cell.fill = solidFill(COLORS.white);
  cell.font = { bold: true, color: argb(COLORS.title), name: "Aptos", size: 10 };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.border = { bottom: border("medium", COLORS.structure) };
  worksheet.getRow(7).height = 25;
}

function addMovementTable(worksheet: import("exceljs").Worksheet, rows: InventoryMovementRow[]) {
  const tableRows = rows.map((row) => [
    new Date(row.createdAt),
    row.productName,
    row.sku,
    row.typeLabel,
    row.referenceLabel === "-" ? "" : row.referenceLabel,
    row.quantityBefore ?? null,
    row.signedQuantity,
    row.quantityAfter ?? null,
    row.branchName,
    row.locationLabel === "-" ? "" : row.locationLabel,
    row.userLabel === "-" ? "" : row.userLabel,
    row.reason,
  ]);

  if (rows.length > 0) {
    worksheet.addTable({
      name: "MovementHistoryTable",
      ref: `A${TABLE_HEADER_ROW}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: "TableStyleLight9", showRowStripes: true },
      columns: TABLE_COLUMNS.map((name) => ({ name, filterButton: true })),
      rows: tableRows,
    });
  } else {
    worksheet.getRow(TABLE_HEADER_ROW).values = [...TABLE_COLUMNS];
    worksheet.autoFilter = `A${TABLE_HEADER_ROW}:L${TABLE_HEADER_ROW}`;
  }

  styleTableHeader(worksheet);
  styleMovementRows(worksheet, rows);
}

function styleTableHeader(worksheet: import("exceljs").Worksheet) {
  const header = worksheet.getRow(TABLE_HEADER_ROW);
  header.height = 29;
  header.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    if (columnNumber > COLUMN_COUNT) return;
    cell.fill = solidFill(COLORS.structure);
    cell.font = { bold: true, color: argb(COLORS.white), name: "Aptos", size: 9 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: border("medium", COLORS.title) };
  });
}

function styleMovementRows(worksheet: import("exceljs").Worksheet, rows: InventoryMovementRow[]) {
  const lastRow = TABLE_HEADER_ROW + rows.length;
  rows.forEach((movement, index) => {
    const row = worksheet.getRow(TABLE_FIRST_DATA_ROW + index);
    const rowFill = index % 2 === 0 ? COLORS.white : COLORS.stripe;
    row.height = movement.reason.length > 70 || movement.productName.length > 45 ? 34 : 21;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (columnNumber > COLUMN_COUNT) return;
      cell.fill = solidFill(rowFill);
      cell.font = { color: argb(COLORS.text), name: "Aptos", size: 9 };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = { bottom: border("hair", COLORS.border) };
    });

    row.getCell(1).numFmt = "dd mmm yyyy hh:mm";
    row.getCell(1).alignment = { vertical: "middle", horizontal: "center" };
    [6, 7, 8].forEach((column) => {
      row.getCell(column).alignment = { vertical: "middle", horizontal: "right" };
    });
    row.getCell(6).numFmt = QUANTITY_FORMAT;
    row.getCell(7).numFmt = NUMBER_FORMAT;
    row.getCell(8).numFmt = QUANTITY_FORMAT;
    row.getCell(12).alignment = { vertical: "top", horizontal: "left", wrapText: true };
    applyMovementTypeStyle(row.getCell(4), movement.typeTone);
  });

  if (rows.length === 0) return;
  worksheet.addConditionalFormatting({
    ref: `G${TABLE_FIRST_DATA_ROW}:G${lastRow}`,
    rules: [
      {
        type: "cellIs",
        operator: "greaterThan",
        formulae: [0],
        priority: 1,
        style: { font: { color: argb(COLORS.success), bold: true } },
      },
      {
        type: "cellIs",
        operator: "lessThan",
        formulae: [0],
        priority: 2,
        style: { font: { color: argb(COLORS.danger), bold: true } },
      },
    ],
  });
}

function applyMovementTypeStyle(
  cell: import("exceljs").Cell,
  tone: InventoryMovementRow["typeTone"],
) {
  const styles = {
    success: { fill: COLORS.successSoft, color: COLORS.success },
    danger: { fill: COLORS.dangerSoft, color: COLORS.danger },
    warning: { fill: COLORS.warningSoft, color: COLORS.warning },
    info: { fill: COLORS.primarySoft, color: COLORS.title },
  } as const;
  const style = styles[tone];
  cell.fill = solidFill(style.fill);
  cell.font = { bold: true, color: argb(style.color), name: "Aptos", size: 9 };
}

function addEmptyState(worksheet: import("exceljs").Worksheet) {
  worksheet.mergeCells("A10:L11");
  const cell = worksheet.getCell("A10");
  cell.value = "No se encontraron movimientos para los filtros seleccionados.";
  cell.fill = solidFill(COLORS.stripe);
  cell.font = { italic: true, color: argb(COLORS.muted), name: "Aptos", size: 10 };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  applyBlockBorder(worksheet, "A10:L11");
  worksheet.getRow(10).height = 22;
  worksheet.getRow(11).height = 22;
  return 11;
}

function addDocumentFooter(
  worksheet: import("exceljs").Worksheet,
  rowNumber: number,
  generatedAt: Date,
) {
  worksheet.mergeCells(`A${rowNumber}:L${rowNumber}`);
  const cell = worksheet.getCell(`A${rowNumber}`);
  cell.value = {
    richText: [
      { text: "Documento generado por OmniRetail", font: { bold: true } },
      { text: `  |  ${formatDisplayDate(generatedAt)}` },
    ],
  };
  cell.font = { color: argb(COLORS.muted), name: "Aptos", size: 8 };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.border = { top: border("thin", COLORS.border) };
  worksheet.getRow(rowNumber).height = 20;
}

function configurePrint(
  worksheet: import("exceljs").Worksheet,
  footerRow: number,
  generatedAt: Date,
) {
  worksheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    showGridLines: false,
    printArea: `A1:L${footerRow}`,
    printTitlesRow: `${TABLE_HEADER_ROW}:${TABLE_HEADER_ROW}`,
    margins: {
      left: 0.3,
      right: 0.3,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    },
  };
  worksheet.headerFooter = {
    oddFooter: `&LDocumento generado por OmniRetail&C${formatDisplayDate(generatedAt)}&RPágina &P de &N`,
  };
}

function styleRange(
  worksheet: import("exceljs").Worksheet,
  range: string,
  style: Partial<Pick<import("exceljs").Style, "fill" | "font">>,
) {
  const [start, end] = range.split(":");
  const startCell = worksheet.getCell(start);
  const endCell = worksheet.getCell(end);
  for (let row = startCell.row; row <= endCell.row; row += 1) {
    for (let column = startCell.col; column <= endCell.col; column += 1) {
      const cell = worksheet.getCell(row, column);
      if (style.fill) cell.fill = style.fill;
      if (style.font) cell.font = style.font;
    }
  }
}

function applyBlockBorder(
  worksheet: import("exceljs").Worksheet,
  range: string,
  color: string = COLORS.border,
) {
  const [start, end] = range.split(":");
  const startCell = worksheet.getCell(start);
  const endCell = worksheet.getCell(end);
  for (let row = startCell.row; row <= endCell.row; row += 1) {
    for (let column = startCell.col; column <= endCell.col; column += 1) {
      const cell = worksheet.getCell(row, column);
      cell.border = {
        top: row === startCell.row ? border("thin", color) : undefined,
        bottom: row === endCell.row ? border("thin", color) : undefined,
        left: column === startCell.col ? border("thin", color) : undefined,
        right: column === endCell.col ? border("thin", color) : undefined,
      };
    }
  }
}

function solidFill(color: string) {
  return {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: argb(color),
  };
}

function border(style: import("exceljs").BorderStyle, color: string) {
  return { style, color: argb(color) };
}

function argb(color: string) {
  return { argb: `FF${color}` };
}

function formatFileDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDisplayDate(value: Date) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
