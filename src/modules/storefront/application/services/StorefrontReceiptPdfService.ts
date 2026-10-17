import type { StorefrontCheckoutResultDto } from "@/modules/storefront/application/dto/StorefrontCheckoutDto";

type ReceiptInput = {
  storeName: string;
  result: StorefrontCheckoutResultDto;
};

const PAGE_WIDTH = 216;
const PAGE_HEIGHT = 279;
const MARGIN = 18;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export async function downloadStorefrontReceiptPdf({ storeName, result }: ReceiptInput) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "letter" });
  let page = 1;
  let y = 20;
  const money = (value: number) => `Q${value.toFixed(2)}`;
  const ensureSpace = (height: number) => {
    if (y + height <= PAGE_HEIGHT - 18) return;
    doc.addPage();
    page += 1;
    y = 20;
    drawHeader(true);
  };
  const text = (
    value: string,
    x: number,
    position: number,
    options?: { align?: "left" | "center" | "right" },
  ) => doc.text(value, x, position, options);
  const drawHeader = (continued = false) => {
    doc.setFillColor(22, 74, 135);
    doc.rect(0, 0, PAGE_WIDTH, 13, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    text(storeName.toUpperCase(), MARGIN, 8.5);
    doc.setTextColor(20, 36, 58);
    doc.setFontSize(20);
    text(continued ? "Comprobante de pedido (continuación)" : "Comprobante de pedido", MARGIN, 22);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    text(`Pedido: ${result.orderNumber}`, MARGIN, 29);
    text(`Fecha: ${new Date().toLocaleDateString("es-GT")}`, PAGE_WIDTH - MARGIN, 29, {
      align: "right",
    });
    text(
      `Estado: ${result.paymentStatus === "approved" ? "Pago confirmado" : "Pago pendiente"}`,
      MARGIN,
      34,
    );
    y = 43;
  };
  const drawFooter = () => {
    doc.setDrawColor(205, 215, 228);
    doc.line(MARGIN, PAGE_HEIGHT - 13, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(91, 108, 130);
    text("Comprobante de pedido · No es una factura fiscal", MARGIN, PAGE_HEIGHT - 8);
    text(`Página ${page}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 8, { align: "right" });
  };

  drawHeader();
  const address = result.deliveryAddress;
  const columnWidth = CONTENT_WIDTH / 2 - 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const deliveryLines = doc.splitTextToSize(
    [
      address.recipientName,
      `${address.line1}${address.line2 ? `, ${address.line2}` : ""}`,
      `${address.city}${address.department ? `, ${address.department}` : ""}`,
    ].join("\n"),
    columnWidth,
  ) as string[];
  const paymentLines = doc.splitTextToSize(
    "Tarjeta de crédito o débito\nInformación de pago confirmada · datos protegidos",
    columnWidth,
  ) as string[];
  const deliveryBoxHeight = Math.max(30, 16 + Math.max(deliveryLines.length, paymentLines.length) * 4.2);
  doc.setFillColor(244, 247, 251);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, deliveryBoxHeight, 2, 2, "F");
  doc.setTextColor(20, 36, 58);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  text("ENTREGA A", MARGIN + 4, y + 7);
  text("MÉTODO DE PAGO", MARGIN + CONTENT_WIDTH / 2 + 4, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(deliveryLines, MARGIN + 4, y + 13);
  doc.text(paymentLines, MARGIN + CONTENT_WIDTH / 2 + 4, y + 13);
  y += deliveryBoxHeight + 8;

  const drawTableHeader = () => {
    ensureSpace(12);
    doc.setFillColor(14, 142, 205);
    doc.rect(MARGIN, y, CONTENT_WIDTH, 9, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    text("DESCRIPCIÓN", MARGIN + 3, y + 5.7);
    text("CANT.", 132, y + 5.7, { align: "right" });
    text("P. UNIT.", 162, y + 5.7, { align: "right" });
    text("IMPORTE", PAGE_WIDTH - MARGIN - 3, y + 5.7, { align: "right" });
    y += 9;
  };
  drawTableHeader();
  result.items.forEach((item) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const nameLines = doc.splitTextToSize(item.name, 92) as string[];
    const height = Math.max(9, nameLines.length * 4.2 + 4);
    if (y + height > PAGE_HEIGHT - 30) {
      doc.addPage();
      page += 1;
      y = 20;
      drawHeader(true);
      drawTableHeader();
    }
    doc.setTextColor(28, 43, 63);
    doc.text(nameLines, MARGIN + 3, y + 5);
    text(String(item.quantity), 132, y + 5, { align: "right" });
    text(money(item.unitPrice), 162, y + 5, { align: "right" });
    doc.setFont("helvetica", "bold");
    text(money(item.subtotal), PAGE_WIDTH - MARGIN - 3, y + 5, { align: "right" });
    doc.setDrawColor(220, 228, 237);
    doc.line(MARGIN, y + height, PAGE_WIDTH - MARGIN, y + height);
    y += height;
  });
  ensureSpace(38);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(42, 57, 77);
  text("Subtotal", 150, y, { align: "right" });
  text(money(result.total), PAGE_WIDTH - MARGIN, y, { align: "right" });
  y += 7;
  text("Envío", 150, y, { align: "right" });
  text("Q0.00", PAGE_WIDTH - MARGIN, y, { align: "right" });
  y += 8;
  doc.setDrawColor(14, 142, 205);
  doc.line(140, y - 4, PAGE_WIDTH - MARGIN, y - 4);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(15, 35, 63);
  text("TOTAL", 150, y + 3, { align: "right" });
  text(money(result.total), PAGE_WIDTH - MARGIN, y + 3, { align: "right" });
  drawFooter();
  doc.save(`comprobante-${result.orderNumber}.pdf`);
}
