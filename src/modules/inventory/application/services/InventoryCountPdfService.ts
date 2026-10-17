import type { InventoryCountLotResult, InventoryCountResult } from "@/core/repositories";
import { formatCountReference } from "@/modules/inventory/application/services/formatInventoryReference";

const PAGE_WIDTH = 216;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FIRST_PAGE_TOP = 46;
const NEXT_PAGE_TOP = 28;
const BOTTOM_LIMIT = 266;
const NAVY: [number, number, number] = [20, 49, 88];
const INK: [number, number, number] = [33, 37, 41];
const MUTED: [number, number, number] = [95, 108, 125];
const PALE: [number, number, number] = [241, 245, 250];
const BORDER: [number, number, number] = [211, 220, 235];
const SOFT_RED: [number, number, number] = [253, 241, 240];
const DIFF_TEXT: [number, number, number] = [150, 45, 45];

type PdfDocument = Awaited<ReturnType<typeof createDocument>>;

/** Comprobante del conteo fisico: toda la evidencia sale de la respuesta del backend. */
export async function downloadInventoryCountPdf(result: InventoryCountResult) {
  const doc = await createDocument();
  const reference = formatCountReference(result.countId);
  const header: PageHeader = {
    reference,
    productLine: `${result.productName} · ${result.sku}`,
  };

  drawFirstPageHeader(doc, reference, result.createdAt);
  let y = FIRST_PAGE_TOP;

  y = drawSection(doc, y, "INFORMACIÓN DEL CONTEO");
  y = drawInfoRows(doc, y, [
    ["Sucursal", result.branchName || "No disponible"],
    ["Ubicación", result.locationName || "No disponible"],
    ["Producto", result.productName],
    ["SKU", result.sku],
    ["Responsable", result.performedByName || "No disponible"],
  ]);

  y = drawSection(doc, y + 4, "RESUMEN DEL CONTEO");
  y = drawSummaryBoxes(doc, y, result);

  y = drawSection(doc, y + 6, "DETALLE POR LOTE");
  y = drawLotsTable(doc, y, result.lots, header);

  const serialLots = result.lots.filter(
    (lot) =>
      lot.foundSerialNumbers.length > 0 ||
      lot.missingSerialNumbers.length > 0 ||
      lot.addedSerialNumbers.length > 0,
  );
  if (serialLots.length > 0) {
    y = ensureSpace(doc, y + 6, 24, header);
    y = drawSection(doc, y, "DETALLE DE SERIALES");
    for (const lot of serialLots) {
      y = drawSerialBlock(doc, y, lot, header);
    }
  }

  drawFooters(doc);
  doc.save(`conteo-fisico-${reference}.pdf`);
}

interface PageHeader {
  reference: string;
  productLine: string;
}

function drawFirstPageHeader(doc: PdfDocument, reference: string, createdAt: string) {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_WIDTH, 34, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("CONTEO FÍSICO DE INVENTARIO", MARGIN, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Referencia: ${reference}`, MARGIN, 24);
  doc.text(`Fecha: ${formatDateTime(createdAt)}`, MARGIN, 29.5);
}

function drawContinuationHeader(doc: PdfDocument, header: PageHeader) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text(`Conteo físico · ${header.reference}`, MARGIN, 14);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(header.productLine, MARGIN, 19);
  doc.setDrawColor(...BORDER);
  doc.line(MARGIN, 22, PAGE_WIDTH - MARGIN, 22);
}

function drawSection(doc: PdfDocument, y: number, title: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text(title, MARGIN, y);
  doc.setDrawColor(...BORDER);
  doc.line(MARGIN, y + 1.8, PAGE_WIDTH - MARGIN, y + 1.8);
  return y + 8;
}

function drawInfoRows(doc: PdfDocument, startY: number, rows: Array<[string, string]>) {
  let y = startY;
  doc.setFontSize(9);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(label, MARGIN, y);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(value, MARGIN + 34, y);
    y += 6;
  }
  return y;
}

function drawSummaryBoxes(doc: PdfDocument, y: number, result: InventoryCountResult) {
  const boxes: Array<[string, string, boolean]> = [
    ["Registrado antes", fmt(result.quantityBefore), false],
    ["Encontrado", fmt(result.countedQuantity), false],
    ["Existencia después", fmt(result.quantityAfter), false],
    ["Diferencia", signed(result.delta), result.delta < 0],
  ];
  const gap = 4;
  const width = (CONTENT_WIDTH - gap * 3) / 4;
  boxes.forEach(([label, value, negative], index) => {
    const x = MARGIN + index * (width + gap);
    doc.setFillColor(...(negative ? SOFT_RED : PALE));
    doc.setDrawColor(...BORDER);
    doc.roundedRect(x, y, width, 17, 1.5, 1.5, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x + 3, y + 6);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...(negative ? DIFF_TEXT : NAVY));
    doc.text(value, x + 3, y + 13.5);
  });
  return y + 17;
}

const LOT_COLUMNS: Array<{ label: string; width: number; align: "left" | "right" }> = [
  { label: "Lote", width: 54, align: "left" },
  { label: "Vencimiento", width: 30, align: "left" },
  { label: "Registrado", width: 25, align: "right" },
  { label: "Encontrado", width: 25, align: "right" },
  { label: "Faltante", width: 25, align: "right" },
  { label: "Agregado", width: 25, align: "right" },
];

function drawLotsTable(
  doc: PdfDocument,
  startY: number,
  lots: InventoryCountLotResult[],
  header: PageHeader,
) {
  let y = ensureSpace(doc, startY, 20, header);
  y = drawTableHeader(doc, y);
  doc.setFontSize(8.5);
  for (const lot of lots) {
    if (y + 7 > BOTTOM_LIMIT) {
      y = newPage(doc, header);
      y = drawTableHeader(doc, y);
    }
    const { missing, added } = getLotCounts(lot);
    const cells = [
      lot.lotNumber || "Series sin lote",
      lot.expirationDate ? formatDate(lot.expirationDate) : "-",
      fmt(lot.quantityBefore),
      fmt(lot.countedQuantity),
      fmt(missing),
      fmt(added),
    ];
    let x = MARGIN;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    LOT_COLUMNS.forEach((column, index) => {
      const text = truncate(doc, cells[index] ?? "", column.width - 4);
      if (column.align === "right") doc.text(text, x + column.width - 2, y + 4.6, { align: "right" });
      else doc.text(text, x + 2, y + 4.6);
      x += column.width;
    });
    doc.setDrawColor(...BORDER);
    doc.line(MARGIN, y + 6.5, PAGE_WIDTH - MARGIN, y + 6.5);
    y += 6.5;
  }
  return y;
}

function drawTableHeader(doc: PdfDocument, y: number) {
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN, y, CONTENT_WIDTH, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  let x = MARGIN;
  for (const column of LOT_COLUMNS) {
    if (column.align === "right") doc.text(column.label.toUpperCase(), x + column.width - 2, y + 4.7, { align: "right" });
    else doc.text(column.label.toUpperCase(), x + 2, y + 4.7);
    x += column.width;
  }
  return y + 7;
}

function drawSerialBlock(
  doc: PdfDocument,
  startY: number,
  lot: InventoryCountLotResult,
  header: PageHeader,
) {
  const { found, missing, added } = {
    found: lot.foundSerialNumbers,
    missing: lot.missingSerialNumbers,
    added: lot.addedSerialNumbers,
  };
  // El titulo del lote nunca queda solo al final de una pagina: se reserva espacio para su contenido.
  let y = ensureSpace(doc, startY, 22, header);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  doc.text(lot.lotNumber ? `Lote ${lot.lotNumber}` : "Series sin lote", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(
    `Encontrados: ${found.length}   No encontrados: ${missing.length}${added.length > 0 ? `   Agregados: ${added.length}` : ""}`,
    MARGIN + 52,
    y,
  );
  y += 5;
  if (missing.length === 0 && added.length === 0) {
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text("Todos los seriales registrados fueron encontrados.", MARGIN, y);
    return y + 8;
  }
  y = writeSerialGroup(doc, y, "NO ENCONTRADOS", missing, header);
  y = writeSerialGroup(doc, y, "AGREGADOS", added, header);
  y = writeSerialGroup(doc, y, "ENCONTRADOS", found, header);
  return y + 4;
}

function writeSerialGroup(
  doc: PdfDocument,
  startY: number,
  title: string,
  serials: string[],
  header: PageHeader,
) {
  if (serials.length === 0) return startY;
  let y = ensureSpace(doc, startY, 12, header);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(`${title} (${serials.length})`, MARGIN, y);
  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK);
  // Texto pequeno en lineas envueltas: nunca una sola cadena interminable.
  const lines = doc.splitTextToSize(serials.join(",  "), CONTENT_WIDTH) as string[];
  for (const line of lines) {
    y = ensureSpace(doc, y, 4, header);
    doc.text(line, MARGIN, y);
    y += 3.8;
  }
  return y + 2;
}

function drawFooters(doc: PdfDocument) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.setDrawColor(...BORDER);
    doc.line(MARGIN, 270, PAGE_WIDTH - MARGIN, 270);
    doc.text(`Página ${page} de ${total}`, PAGE_WIDTH - MARGIN, 275, { align: "right" });
  }
}

function ensureSpace(doc: PdfDocument, y: number, needed: number, header: PageHeader) {
  return y + needed <= BOTTOM_LIMIT ? y : newPage(doc, header);
}

function newPage(doc: PdfDocument, header: PageHeader) {
  doc.addPage();
  drawContinuationHeader(doc, header);
  return NEXT_PAGE_TOP;
}

/** Con series, faltante/agregado salen de las listas del backend; sin series, del delta del lote. */
function getLotCounts(lot: InventoryCountLotResult) {
  const hasSerials =
    lot.foundSerialNumbers.length > 0 ||
    lot.missingSerialNumbers.length > 0 ||
    lot.addedSerialNumbers.length > 0;
  if (hasSerials) {
    return { missing: lot.missingSerialNumbers.length, added: lot.addedSerialNumbers.length };
  }
  return {
    missing: Math.max(0, -lot.delta),
    added: lot.quantityBefore === 0 ? Math.max(0, lot.delta) : 0,
  };
}

function truncate(doc: PdfDocument, text: string, maxWidth: number) {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && doc.getTextWidth(`${value}…`) > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

async function createDocument() {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  doc.setFont("helvetica", "normal");
  return doc;
}

function clean(value: string) {
  return value.replace(/[  ]/g, " ");
}

function fmt(value: number) {
  return clean(new Intl.NumberFormat("es-BO", { maximumFractionDigits: 3 }).format(value));
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${fmt(value)}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return clean(
    date
      .toLocaleString("es-BO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
      .replace(",", ""),
  );
}
