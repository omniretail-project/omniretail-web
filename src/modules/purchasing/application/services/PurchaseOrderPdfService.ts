import type { PurchaseOrder, ReceiptIncidentEvidence, ReceiptLine } from "@/core/entities";
import { PurchaseOrderStatus, ReceiptStatus } from "@/core/enums";
import { RECEIPT_INCIDENT_TYPE_LABELS } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanReadPurchaseOrders,
  ensurePurchaseOrderBelongsToTenant,
  resolvePurchasingContext,
} from "@/modules/purchasing/application/services/serviceHelpers";

type PdfKind = "purchase-order" | "receiving-report";
type PdfDocument = Awaited<ReturnType<typeof createDocument>>;

interface PdfLine {
  productId: string;
  productName: string;
  sku: string;
  supplierSku: string;
  unitLabel: string;
  quantity: number;
  unitCost: number;
  subtotal: number;
  receivedQuantity?: number;
}

interface PdfReceiptLine {
  productName: string;
  unitLabel: string;
  orderedQuantity: number;
  acceptedQuantity: number;
  incidentQuantity: number;
  pendingAfter: number;
}

interface PdfIncident {
  productName: string;
  typeName: string;
  quantity: number;
  description: string;
  receiptNumber: string;
  createdAt: string;
  responsibleName: string;
  evidence: ReceiptIncidentEvidence[];
}

interface PdfReceipt {
  number: string;
  receivedAt: string;
  responsibleName: string;
  statusLabel: string;
  acceptedQuantity: number;
  incidentQuantity: number;
  pendingAfter: number;
  lines: PdfReceiptLine[];
}

interface PdfData {
  order: PurchaseOrder;
  tenantName: string;
  supplierName: string;
  supplierLegalName: string;
  supplierTaxId: string;
  supplierContact: string;
  supplierEmail: string;
  branchName: string;
  branchAddress: string;
  lines: PdfLine[];
  receipts: PdfReceipt[];
  incidents: PdfIncident[];
}

const PAGE_WIDTH = 216;
const PAGE_HEIGHT = 279;
const MARGIN = 14;
const CONTENT_WIDTH = 188;
const BOTTOM_LIMIT = 261;
const NAVY: [number, number, number] = [20, 49, 88];
const BLUE: [number, number, number] = [46, 105, 160];
const INK: [number, number, number] = [33, 37, 41];
const MUTED: [number, number, number] = [95, 108, 125];
const PALE: [number, number, number] = [241, 245, 250];
const BORDER: [number, number, number] = [211, 220, 235];

export class PurchaseOrderPdfService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async downloadPurchaseOrder(orderId: string) {
    const data = await this.getPdfData(orderId);
    await generatePurchaseOrderPdf(data, true);
  }

  async downloadReceivingReport(orderId: string, options?: { branchName?: string }) {
    const data =
      this.repositories.purchaseOrdersDataSource === "api"
        ? await this.getApiReceivingPdfData(orderId, options)
        : await this.getPdfData(orderId);
    await generateReceivingReportPdf(data, true);
  }

  /** API: recepciones confirmadas e incidencias canonicas (paginas acotadas, sin fetch-all). */
  private async getApiReceivingPdfData(
    orderId: string,
    options?: { branchName?: string },
  ): Promise<PdfData> {
    const { tenantId, user, permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    const order = ensurePurchaseOrderBelongsToTenant(
      await this.repositories.purchaseOrders.getByIdScoped(tenantId, orderId),
      tenantId,
    );
    const confirmedPage = await this.repositories.receipts.getPageScoped(tenantId, {
      branchId: order.branchId,
      purchaseOrderId: order.id,
      status: "confirmed",
      page: 1,
      pageSize: 100,
    });
    if (confirmedPage.page < confirmedPage.totalPages) {
      throw new Error("El historial de recepciones es demasiado extenso para generar el reporte.");
    }
    if (confirmedPage.items.length === 0) {
      throw new Error("La orden no tiene recepciones confirmadas.");
    }
    const records = [...confirmedPage.items].sort(
      (left, right) =>
        new Date(left.receipt.receivedAt ?? left.receipt.updatedAt).getTime() -
        new Date(right.receipt.receivedAt ?? right.receipt.updatedAt).getTime(),
    );
    const incidentPages = await Promise.all(
      records.map((record) =>
        this.repositories.receipts.listIncidentsScoped(tenantId, record.receipt.id, {
          page: 1,
          pageSize: 100,
        }),
      ),
    );
    // Unica fuente humana operacional: el usuario de la sesion; el resto queda "No disponible".
    const userNameById = new Map([[user.id, user.name]]);
    const responsible = (userId?: string) =>
      (userId && userNameById.get(userId)) || "No disponible";
    const orderItemById = new Map((order.items ?? []).map((item) => [item.id, item]));
    const orderedTotal = (order.items ?? []).reduce((sum, item) => sum + item.quantity, 0);
    const acceptedByProductId = new Map<string, number>();
    let acceptedAccumulated = 0;
    const pdfIncidents: PdfIncident[] = [];

    const receiptRows: PdfReceipt[] = records.map((record, index) => {
      const incidents = incidentPages[index]?.items ?? [];
      const acceptedQuantity = record.items.reduce((sum, item) => sum + item.line.receivedQuantity, 0);
      acceptedAccumulated += acceptedQuantity;
      incidents.forEach((incident) => {
        const item = record.items.find((candidate) => candidate.line.id === incident.goodsReceiptItemId);
        pdfIncidents.push({
          productName: item?.productNameSnapshot ?? "Incidencia general",
          typeName: RECEIPT_INCIDENT_TYPE_LABELS[incident.incidentType],
          quantity: incident.quantityAffected ?? 0,
          description: incident.notes,
          receiptNumber: record.receipt.number,
          createdAt: incident.createdAt,
          responsibleName: responsible(incident.createdByUserId),
          evidence: [],
        });
      });
      return {
        number: record.receipt.number,
        receivedAt: record.receipt.receivedAt ?? record.receipt.updatedAt,
        responsibleName: responsible(record.receipt.receivedByUserId),
        statusLabel: acceptedAccumulated >= orderedTotal ? "Recibida" : "Parcial",
        acceptedQuantity,
        incidentQuantity: incidents
          .filter((incident) => incident.status === "open")
          .reduce((sum, incident) => sum + (incident.quantityAffected ?? 0), 0),
        pendingAfter: Math.max(0, orderedTotal - acceptedAccumulated),
        lines: record.items.map((item) => {
          const orderItem = item.purchaseOrderItemId
            ? orderItemById.get(item.purchaseOrderItemId)
            : undefined;
          const previousAccepted = acceptedByProductId.get(item.line.productId) ?? 0;
          const orderedQuantity = orderItem?.quantity ?? 0;
          acceptedByProductId.set(item.line.productId, previousAccepted + item.line.receivedQuantity);
          return {
            productName: item.productNameSnapshot ?? "Producto no disponible",
            unitLabel: item.unitSymbolSnapshot ?? "Unidad",
            orderedQuantity,
            acceptedQuantity: item.line.receivedQuantity,
            incidentQuantity: incidents
              .filter(
                (incident) =>
                  incident.status === "open" && incident.goodsReceiptItemId === item.line.id,
              )
              .reduce((sum, incident) => sum + (incident.quantityAffected ?? 0), 0),
            pendingAfter: Math.max(
              0,
              orderedQuantity - previousAccepted - item.line.receivedQuantity,
            ),
          };
        }),
      };
    });

    const base = toApiPurchaseOrderPdfData(order);
    return {
      ...base,
      branchName: options?.branchName ?? base.branchName,
      lines: base.lines.map((line) => ({
        ...line,
        receivedQuantity: acceptedByProductId.get(line.productId) ?? 0,
      })),
      receipts: receiptRows,
      incidents: pdfIncidents,
    };
  }

  private async getPdfData(orderId: string): Promise<PdfData> {
    const { tenantId, permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    const order = ensurePurchaseOrderBelongsToTenant(
      await this.repositories.purchaseOrders.getByIdScoped(tenantId, orderId),
      tenantId,
    );
    if (this.repositories.purchaseOrdersDataSource === "api") {
      return toApiPurchaseOrderPdfData(order);
    }
    const [
      tenant,
      supplier,
      branch,
      products,
      units,
      supplierProducts,
      allReceipts,
      allIncidents,
      incidentTypes,
      users,
    ] = await Promise.all([
      this.repositories.tenants.getById(order.tenantId),
      this.repositories.suppliers.getById(order.supplierId),
      this.repositories.branches.getById(order.branchId),
      this.repositories.products.getAll(),
      this.repositories.units.getAll(),
      this.repositories.supplierProducts.getBySupplier(order.supplierId),
      this.repositories.receipts.listByTenant(tenantId),
      this.repositories.receipts.getIncidents(),
      this.repositories.incidentTypes.getAll(),
      this.repositories.users.getAll(),
    ]);
    const receipts = allReceipts
      .filter(
        (receipt) =>
          receipt.purchaseOrderId === order.id &&
          receipt.tenantId === order.tenantId &&
          receipt.branchId === order.branchId &&
          (receipt.status === ReceiptStatus.partial || receipt.status === ReceiptStatus.received),
      )
      .sort(
        (left, right) =>
          new Date(left.receivedAt ?? left.updatedAt).getTime() -
          new Date(right.receivedAt ?? right.updatedAt).getTime(),
      );
    const receiptLinesById = new Map<string, ReceiptLine[]>();
    await Promise.all(
      receipts.map(async (receipt) => {
        receiptLinesById.set(
          receipt.id,
          await this.repositories.receipts.getLinesByReceipt(receipt.id),
        );
      }),
    );
    const productById = new Map(products.map((product) => [product.id, product]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const userNameById = new Map(users.map((user) => [user.id, user.name]));
    const incidentTypeById = new Map(incidentTypes.map((type) => [type.id, type.name]));
    const supplierProductByProductId = new Map(
      supplierProducts.map((item) => [item.productId, item]),
    );
    const orderItemByProductId = new Map((order.items ?? []).map((item) => [item.productId, item]));
    const confirmedReceiptIds = new Set(receipts.map((receipt) => receipt.id));
    const incidents = allIncidents.filter((incident) =>
      confirmedReceiptIds.has(incident.receiptId),
    );
    const receiptLineById = new Map(
      [...receiptLinesById.values()].flat().map((line) => [line.id, line]),
    );
    const acceptedByProductId = new Map<string, number>();
    let acceptedAccumulated = 0;
    const orderedTotal = (order.items ?? []).reduce((sum, item) => sum + item.quantity, 0);

    const receiptRows: PdfReceipt[] = receipts.map((receipt) => {
      const receiptLines = receiptLinesById.get(receipt.id) ?? [];
      const receiptIncidents = incidents.filter((incident) => incident.receiptId === receipt.id);
      const acceptedQuantity = receiptLines.reduce((sum, line) => sum + line.receivedQuantity, 0);
      acceptedAccumulated += acceptedQuantity;
      return {
        number: receipt.number,
        receivedAt: receipt.receivedAt ?? receipt.updatedAt,
        responsibleName:
          (receipt.receivedByUserId && userNameById.get(receipt.receivedByUserId)) ??
          receipt.receivedByUserId ??
          "No disponible",
        statusLabel: receipt.status === ReceiptStatus.received ? "Recibida" : "Parcial",
        acceptedQuantity,
        incidentQuantity: receiptIncidents.reduce(
          (sum, incident) => sum + (incident.quantityAffected ?? 0),
          0,
        ),
        pendingAfter: Math.max(0, orderedTotal - acceptedAccumulated),
        lines: receiptLines.map((line) => {
          const orderItem = orderItemByProductId.get(line.productId);
          const previousAccepted = acceptedByProductId.get(line.productId) ?? 0;
          const orderedQuantity = line.orderedQuantity ?? orderItem?.quantity ?? 0;
          const incidentQuantity = receiptIncidents
            .filter((incident) => incident.receiptLineId === line.id)
            .reduce((sum, incident) => sum + (incident.quantityAffected ?? 0), 0);
          acceptedByProductId.set(line.productId, previousAccepted + line.receivedQuantity);
          return {
            productName: productById.get(line.productId)?.name ?? "Producto no disponible",
            unitLabel:
              (orderItem &&
                (unitById.get(orderItem.unitId)?.symbol ?? unitById.get(orderItem.unitId)?.name)) ??
              "Unidad",
            orderedQuantity,
            acceptedQuantity: line.receivedQuantity,
            incidentQuantity,
            pendingAfter: Math.max(0, orderedQuantity - previousAccepted - line.receivedQuantity),
          };
        }),
      };
    });

    return {
      order,
      tenantName: tenant?.legalName ?? tenant?.name ?? "OmniRetail",
      supplierName: supplier?.name ?? "Proveedor no disponible",
      supplierLegalName: supplier?.legalName ?? "-",
      supplierTaxId: supplier?.taxId ?? "-",
      supplierContact: supplier?.phone ?? "-",
      supplierEmail: supplier?.email ?? "-",
      branchName: branch?.name ?? "Sucursal no disponible",
      branchAddress: branch?.address ?? "-",
      lines: (order.items ?? []).map((item) => {
        const product = productById.get(item.productId);
        const supplierProduct = supplierProductByProductId.get(item.productId);
        return {
          productId: item.productId,
          productName: product?.name ?? "Producto no disponible",
          sku: product?.sku ?? item.productId,
          supplierSku: supplierProduct?.supplierSku ?? "-",
          unitLabel:
            unitById.get(item.unitId)?.symbol ?? unitById.get(item.unitId)?.name ?? item.unitId,
          quantity: item.quantity,
          unitCost: item.unitCost,
          subtotal: item.subtotal,
          receivedQuantity: acceptedByProductId.get(item.productId) ?? 0,
        };
      }),
      receipts: receiptRows,
      incidents: incidents.map((incident) => {
        const line = incident.receiptLineId
          ? receiptLineById.get(incident.receiptLineId)
          : undefined;
        const receipt = receipts.find((item) => item.id === incident.receiptId);
        return {
          productName: line
            ? (productById.get(line.productId)?.name ?? "Producto no disponible")
            : "Producto no disponible",
          typeName: incidentTypeById.get(incident.incidentTypeId) ?? "Tipo archivado",
          quantity: incident.quantityAffected ?? 0,
          description: incident.description,
          receiptNumber: receipt?.number ?? incident.receiptId,
          createdAt: incident.createdAt,
          responsibleName: userNameById.get(incident.createdByUserId) ?? incident.createdByUserId,
          evidence: incident.evidence ?? [],
        };
      }),
    };
  }
}

function toApiPurchaseOrderPdfData(order: PurchaseOrder): PdfData {
  return {
    order,
    tenantName: "OmniRetail",
    supplierName: order.supplierNameSnapshot ?? "Proveedor no disponible",
    supplierLegalName: "-",
    supplierTaxId: "-",
    supplierContact: "No incluido en la orden",
    supplierEmail: "-",
    branchName: "Sucursal no disponible",
    branchAddress: "-",
    lines: (order.items ?? []).map((item) => ({
      productId: item.productId,
      productName: item.productNameSnapshot ?? "Producto no disponible",
      sku: item.productSkuSnapshot ?? item.productId,
      supplierSku: item.supplierSkuSnapshot ?? "-",
      unitLabel: item.unitSymbolSnapshot ?? item.unitId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      subtotal: item.subtotal,
    })),
    receipts: [],
    incidents: [],
  };
}

export function getPurchaseOrderPdfKind(status: PurchaseOrderStatus): PdfKind | null {
  if (status === PurchaseOrderStatus.approved || status === PurchaseOrderStatus.sent) {
    return "purchase-order";
  }
  if (
    status === PurchaseOrderStatus.partially_received ||
    status === PurchaseOrderStatus.received
  ) {
    return "receiving-report";
  }
  return null;
}

export async function generatePurchaseOrderPdf(data: PdfData, download: boolean) {
  const doc = await createDocument();
  let y = addDocumentHeader(doc, data, "ORDEN DE COMPRA", getOrderStatusLabel(data.order.status));
  y = addTwoColumnPanels(doc, y, [
    {
      title: "PROVEEDOR",
      entries: [
        ["Proveedor", data.supplierName],
        ["Razon social", data.supplierLegalName],
        ["NIT", data.supplierTaxId],
        ["Contacto", data.supplierContact],
        ["Correo", data.supplierEmail],
        ["Condicion de pago", "No definida"],
      ],
    },
    {
      title: "ENTREGA",
      entries: [
        ["Sucursal destino", data.branchName],
        ["Direccion", data.branchAddress],
        ["Fecha esperada", formatDate(data.order.expectedDate)],
        ["Fecha de orden", formatDate(data.order.createdAt)],
      ],
    },
  ]);
  y = addSectionHeading(doc, y + 5, "PRODUCTOS");
  const noteLines = data.order.notes ? (doc.splitTextToSize(data.order.notes, 88) as string[]) : [];
  const closingHeight = Math.max(34, 14 + noteLines.length * 4);
  y = drawTable(
    doc,
    y,
    [
      { label: "Producto", width: 48 },
      { label: "SKU / proveedor", width: 38 },
      { label: "Unidad", width: 22 },
      { label: "Cantidad", width: 22, align: "right" },
      { label: "Costo unit.", width: 28, align: "right" },
      { label: "Subtotal", width: 30, align: "right" },
    ],
    data.lines.map((line) => [
      line.productName,
      `${line.sku} / ${line.supplierSku}`,
      line.unitLabel,
      formatNumber(line.quantity),
      formatCurrency(line.unitCost),
      formatCurrency(line.subtotal),
    ]),
    "PRODUCTOS",
    { keepLastRows: 2, reserveAfter: closingHeight + 6 },
  );
  y = ensureSpace(doc, y + 6, closingHeight, "ORDEN DE COMPRA", data.order.number);
  const discount = Math.max(0, data.order.subtotal - data.order.total);
  drawSummaryBox(doc, y, "RESUMEN", [
    ["Subtotal", formatCurrency(data.order.subtotal)],
    ["Descuentos / ahorros", discount > 0 ? formatCurrency(discount) : "-"],
    ["TOTAL FINAL", formatCurrency(data.order.total)],
  ]);
  if (data.order.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...NAVY);
    doc.text("NOTAS", MARGIN, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(noteLines, MARGIN, y + 14);
  }
  addPageFooters(doc);
  const filename = `${sanitizeFileName(data.order.number)}-orden-compra.pdf`;
  if (download) doc.save(filename);
  return { filename, arrayBuffer: download ? undefined : doc.output("arraybuffer") };
}

export async function generateReceivingReportPdf(data: PdfData, download: boolean) {
  const doc = await createDocument();
  const ordered = data.lines.reduce((sum, line) => sum + line.quantity, 0);
  const accepted = data.lines.reduce((sum, line) => sum + (line.receivedQuantity ?? 0), 0);
  const pending = Math.max(0, ordered - accepted);
  const incidentQuantity = data.incidents.reduce((sum, incident) => sum + incident.quantity, 0);
  const progress = ordered > 0 ? Math.min(100, Math.round((accepted / ordered) * 100)) : 0;
  const statusLabel = getOrderStatusLabel(data.order.status);
  let y = addDocumentHeader(doc, data, "REPORTE DE RECEPCION DE ORDEN", statusLabel);
  y = addInfoGrid(doc, y, [
    ["Proveedor", data.supplierName],
    ["Sucursal", data.branchName],
    ["Estado actual", statusLabel],
    ["Creacion", formatDate(data.order.createdAt)],
    ["Fecha reporte", formatDateTime(new Date().toISOString())],
    ["Total monetario", formatCurrency(data.order.total)],
  ]);
  y = ensureSpace(doc, y + 5, 38, "REPORTE DE RECEPCION", data.order.number);
  drawMetricCards(doc, y, [
    ["SOLICITADO", formatNumber(ordered)],
    ["ACEPTADO", formatNumber(accepted)],
    ["PENDIENTE", formatNumber(pending)],
    ["PROGRESO", `${progress}%`],
  ]);
  y += 34;
  y = addSectionHeading(doc, y, "HISTORIAL DE RECEPCIONES");
  if (data.receipts.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("No existen recepciones confirmadas para esta orden.", MARGIN, y);
    y += 10;
  }
  for (const [index, receipt] of data.receipts.entries()) {
    y = ensureSpace(doc, y + 3, 34, "HISTORIAL DE RECEPCIONES", data.order.number);
    doc.setFillColor(...PALE);
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 25, 2, 2, "F");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(`Recepcion ${index + 1} · ${receipt.number}`, MARGIN + 4, y + 6);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(
      `${formatDateTime(receipt.receivedAt)} · ${receipt.responsibleName}`,
      MARGIN + 4,
      y + 12,
    );
    doc.text(`Estado: ${receipt.statusLabel}`, MARGIN + 4, y + 18);
    doc.setTextColor(...INK);
    doc.text(`Aceptado: ${formatNumber(receipt.acceptedQuantity)}`, 112, y + 7);
    doc.text(`Incidencias: ${formatNumber(receipt.incidentQuantity)}`, 112, y + 13);
    doc.text(`Pendiente despues: ${formatNumber(receipt.pendingAfter)}`, 112, y + 19);
    y += 31;
    y = drawTable(
      doc,
      y,
      [
        { label: "Producto", width: 58 },
        { label: "Unidad", width: 24 },
        { label: "Pedido", width: 25, align: "right" },
        { label: "Aceptado", width: 27, align: "right" },
        { label: "Incidencia", width: 27, align: "right" },
        { label: "Pendiente", width: 27, align: "right" },
      ],
      receipt.lines.map((line) => [
        line.productName,
        line.unitLabel,
        formatNumber(line.orderedQuantity),
        formatNumber(line.acceptedQuantity),
        formatNumber(line.incidentQuantity),
        formatNumber(line.pendingAfter),
      ]),
      `RECEPCION ${index + 1} · ${receipt.number}`,
    );
  }
  y = ensureSpace(doc, y + 7, 22, "INCIDENCIAS REGISTRADAS", data.order.number);
  y = addSectionHeading(doc, y, `INCIDENCIAS REGISTRADAS (${data.incidents.length})`);
  if (data.incidents.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("No se registraron incidencias.", MARGIN, y);
    y += 10;
  }
  for (const incident of data.incidents) {
    const allDescriptionLines = doc.splitTextToSize(
      incident.description,
      CONTENT_WIDTH - 8,
    ) as string[];
    const descriptionLines =
      allDescriptionLines.length > 32
        ? [...allDescriptionLines.slice(0, 31), `${allDescriptionLines[31]}...`]
        : allDescriptionLines;
    const hasEvidence = incident.evidence.some((item) => item.previewUrl);
    const height = 18 + descriptionLines.length * 4 + (hasEvidence ? 20 : 0);
    y = ensureSpace(doc, y + 2, height, "INCIDENCIAS REGISTRADAS", data.order.number);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, height, 2, 2, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY);
    doc.text(`${incident.productName} · ${incident.typeName}`, MARGIN + 4, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      `${incident.receiptNumber} · ${formatDateTime(incident.createdAt)} · ${incident.responsibleName}`,
      MARGIN + 4,
      y + 11,
    );
    doc.text(
      `Cantidad: ${formatNumber(incident.quantity)} · Evidencias: ${incident.evidence.length}`,
      PAGE_WIDTH - MARGIN - 4,
      y + 6,
      { align: "right" },
    );
    doc.setTextColor(...INK);
    doc.text(descriptionLines, MARGIN + 4, y + 17);
    if (hasEvidence) {
      addEvidenceThumbnails(
        doc,
        incident.evidence,
        MARGIN + 4,
        y + 19 + descriptionLines.length * 4,
      );
    }
    y += height + 3;
  }
  y = ensureSpace(doc, y + 5, 55, "ESTADO ACTUAL", data.order.number);
  drawSummaryBox(doc, y, "ESTADO ACTUAL DE LA ORDEN", [
    ["Solicitado", formatNumber(ordered)],
    ["Aceptado", formatNumber(accepted)],
    ["Pendiente", formatNumber(pending)],
    ["Unidades con incidencia", formatNumber(incidentQuantity)],
    ["Progreso", `${progress}%`],
    ["Estado", statusLabel],
  ]);
  addPageFooters(doc);
  const filename = `${sanitizeFileName(data.order.number)}-${
    data.order.status === PurchaseOrderStatus.received ? "recepcion-final" : "recepcion-parcial"
  }.pdf`;
  if (download) doc.save(filename);
  return { filename, arrayBuffer: download ? undefined : doc.output("arraybuffer") };
}

async function createDocument() {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  doc.setFont("helvetica", "normal");
  return doc;
}

function addDocumentHeader(doc: PdfDocument, data: PdfData, title: string, status: string) {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_WIDTH, 38, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(data.tenantName.toUpperCase(), MARGIN, 10);
  doc.setFontSize(17);
  doc.text(title, MARGIN, 20);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Orden ${data.order.number} · ${status}`, MARGIN, 28);
  doc.setFontSize(8);
  doc.text(formatDateTime(new Date().toISOString()), PAGE_WIDTH - MARGIN, 12, { align: "right" });
  doc.text(formatCurrency(data.order.total), PAGE_WIDTH - MARGIN, 25, { align: "right" });
  return 47;
}

function addTwoColumnPanels(
  doc: PdfDocument,
  y: number,
  panels: Array<{ title: string; entries: Array<[string, string]> }>,
) {
  const gap = 5;
  const width = (CONTENT_WIDTH - gap) / 2;
  const height = Math.max(...panels.map((panel) => Math.ceil(panel.entries.length / 2))) * 12 + 13;
  panels.forEach((panel, panelIndex) => {
    const x = MARGIN + panelIndex * (width + gap);
    doc.setDrawColor(...BORDER);
    doc.setFillColor(252, 251, 247);
    doc.roundedRect(x, y, width, height, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY);
    doc.text(panel.title, x + 4, y + 7);
    panel.entries.forEach(([label, value], index) => {
      const entryWidth = (width - 8) / 2;
      const entryX = x + 4 + (index % 2) * entryWidth;
      const rowY = y + 14 + Math.floor(index / 2) * 12;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(label.toUpperCase(), entryX, rowY);
      doc.setFontSize(8);
      doc.setTextColor(...INK);
      doc.text(truncate(value, 20), entryX, rowY + 4);
    });
  });
  return y + height;
}

function addInfoGrid(doc: PdfDocument, y: number, entries: Array<[string, string]>) {
  const width = CONTENT_WIDTH / 3;
  entries.forEach(([label, value], index) => {
    const x = MARGIN + (index % 3) * width;
    const rowY = y + Math.floor(index / 3) * 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, rowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK);
    doc.text(truncate(value, 32), x, rowY + 5);
  });
  return y + Math.ceil(entries.length / 3) * 14;
}

function drawMetricCards(doc: PdfDocument, y: number, entries: Array<[string, string]>) {
  const gap = 4;
  const width = (CONTENT_WIDTH - gap * (entries.length - 1)) / entries.length;
  entries.forEach(([label, value], index) => {
    const x = MARGIN + index * (width + gap);
    doc.setFillColor(...PALE);
    doc.setDrawColor(...BORDER);
    doc.roundedRect(x, y, width, 25, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(label, x + 4, y + 7);
    doc.setFontSize(14);
    doc.setTextColor(...NAVY);
    doc.text(value, x + 4, y + 18);
  });
}

function addSectionHeading(doc: PdfDocument, y: number, title: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...NAVY);
  doc.text(title, MARGIN, y);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y + 2, PAGE_WIDTH - MARGIN, y + 2);
  return y + 8;
}

interface TableColumn {
  label: string;
  width: number;
  align?: "left" | "right";
}

function drawTable(
  doc: PdfDocument,
  startY: number,
  columns: TableColumn[],
  rows: string[][],
  continuedTitle: string,
  options?: { keepLastRows: number; reserveAfter: number },
) {
  let y = drawTableHeader(doc, startY, columns);
  const preparedRows = rows.map((row) => {
    const wrapped = row.map(
      (value, index) => doc.splitTextToSize(value, columns[index].width - 4) as string[],
    );
    const rowHeight = Math.max(8, Math.max(...wrapped.map((value) => value.length)) * 3.8 + 4);
    return { wrapped, rowHeight };
  });
  for (const [rowIndex, prepared] of preparedRows.entries()) {
    const { wrapped, rowHeight } = prepared;
    const shouldKeepClosingBlock =
      options &&
      rows.length > options.keepLastRows &&
      rowIndex === rows.length - options.keepLastRows &&
      y +
        preparedRows.slice(rowIndex).reduce((sum, item) => sum + item.rowHeight, 0) +
        options.reserveAfter >
        BOTTOM_LIMIT;
    if (shouldKeepClosingBlock) {
      doc.addPage();
      addContinuationHeader(doc, continuedTitle);
      y = drawTableHeader(doc, 20, columns);
    }
    if (y + rowHeight > BOTTOM_LIMIT) {
      doc.addPage();
      addContinuationHeader(doc, continuedTitle);
      y = drawTableHeader(doc, 20, columns);
    }
    let x = MARGIN;
    doc.setDrawColor(...BORDER);
    doc.setFillColor(255, 255, 255);
    doc.rect(x, y, CONTENT_WIDTH, rowHeight, "FD");
    columns.forEach((column, index) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...INK);
      const textX = column.align === "right" ? x + column.width - 2 : x + 2;
      doc.text(wrapped[index], textX, y + 4.5, { align: column.align ?? "left" });
      x += column.width;
    });
    y += rowHeight;
  }
  return y;
}

function drawTableHeader(doc: PdfDocument, y: number, columns: TableColumn[]) {
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN, y, CONTENT_WIDTH, 9, "F");
  let x = MARGIN;
  columns.forEach((column) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(255, 255, 255);
    const textX = column.align === "right" ? x + column.width - 2 : x + 2;
    doc.text(column.label.toUpperCase(), textX, y + 5.7, { align: column.align ?? "left" });
    x += column.width;
  });
  return y + 9;
}

function drawSummaryBox(
  doc: PdfDocument,
  y: number,
  title: string,
  entries: Array<[string, string]>,
) {
  const width = 88;
  const x = PAGE_WIDTH - MARGIN - width;
  const height = 10 + entries.length * 7;
  doc.setFillColor(...PALE);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text(title, x + 4, y + 7);
  entries.forEach(([label, value], index) => {
    const rowY = y + 14 + index * 7;
    doc.setFont("helvetica", index === entries.length - 1 ? "bold" : "normal");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text(label, x + 4, rowY);
    doc.text(value, x + width - 4, rowY, { align: "right" });
  });
}

function ensureSpace(
  doc: PdfDocument,
  y: number,
  height: number,
  title: string,
  reference: string,
) {
  if (y + height <= BOTTOM_LIMIT) return y;
  doc.addPage();
  addContinuationHeader(doc, `${title} · ${reference}`);
  return 20;
}

function addContinuationHeader(doc: PdfDocument, title: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...NAVY);
  doc.text(title, MARGIN, 10);
  doc.setDrawColor(...BORDER);
  doc.line(MARGIN, 13, PAGE_WIDTH - MARGIN, 13);
}

function addEvidenceThumbnails(
  doc: PdfDocument,
  evidence: ReceiptIncidentEvidence[],
  x: number,
  y: number,
) {
  let offset = 0;
  for (const item of evidence.filter((entry) => entry.previewUrl).slice(0, 4)) {
    try {
      const properties = doc.getImageProperties(item.previewUrl!);
      const ratio = Math.min(24 / properties.width, 16 / properties.height);
      doc.addImage(
        item.previewUrl!,
        getImageFormat(item.type),
        x + offset,
        y,
        properties.width * ratio,
        properties.height * ratio,
      );
      offset += 28;
    } catch {
      // La evidencia sigue contabilizada aunque una imagen simulada no pueda decodificarse.
    }
  }
}

function addPageFooters(doc: PdfDocument) {
  const pageCount = doc.getNumberOfPages();
  const generatedAt = formatDateTime(new Date().toISOString());
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...BORDER);
    doc.line(MARGIN, PAGE_HEIGHT - 13, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Documento generado por OmniRetail · ${generatedAt}`,
      MARGIN,
      PAGE_HEIGHT - 8,
    );
    doc.text(`Pagina ${page} / ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8, {
      align: "right",
    });
  }
}

function getImageFormat(type: string) {
  if (type.includes("png")) return "PNG";
  if (type.includes("webp")) return "WEBP";
  return "JPEG";
}

function getOrderStatusLabel(status: PurchaseOrderStatus) {
  const labels: Record<PurchaseOrderStatus, string> = {
    draft: "Borrador",
    pending_approval: "Pendiente de aprobacion",
    approved: "Aprobada",
    sent: "Enviada",
    partially_received: "Recepcion parcial",
    received: "Recibida",
    cancelled: "Cancelada",
  };
  return labels[status];
}

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(value);
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}
