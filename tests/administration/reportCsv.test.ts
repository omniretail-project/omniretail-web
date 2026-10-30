import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadReportCsv, REPORT_CSV_MIME, toCsv } from "@/modules/administration/application/reportCsv";
import { getReportTableData } from "@/modules/administration/hooks/useReports";
import type { SalesReportRow } from "@/modules/administration/application/dto/ReportDto";

const BOM = "﻿";

/** El Blob de jsdom no implementa `.text()`. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function lines(csv: string) {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(BOM.length, -2).split("\r\n");
}

function firstCell(value: string) {
  return lines(toCsv({ headers: ["Referencia"], rows: [[value]] }))[1];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toCsv", () => {
  it("escribe encabezados y filas en el mismo orden, separados por comas y CRLF, con BOM UTF-8", () => {
    const csv = toCsv({
      headers: ["Fecha", "Producto", "Cantidad"],
      rows: [
        ["2026-10-01", "Taladro percutor", 3],
        ["2026-10-02", "Martillo de uña", 1.5],
      ],
    });

    expect(lines(csv)).toEqual([
      '"Fecha","Producto","Cantidad"',
      '"2026-10-01","Taladro percutor",3',
      '"2026-10-02","Martillo de uña",1.5',
    ]);
  });

  it("entrecomilla todo texto y escapa comillas, comas y saltos de linea (RFC 4180)", () => {
    const csv = toCsv({
      headers: ["Motivo"],
      rows: [["Ajuste, conteo"], ['Caja "rota"'], ["Linea 1\nLinea 2"], ["Retorno\rcarro"]],
    });

    expect(lines(csv)).toEqual([
      '"Motivo"',
      '"Ajuste, conteo"',
      '"Caja ""rota"""',
      '"Linea 1\nLinea 2"',
      '"Retorno\rcarro"',
    ]);
  });

  it.each([
    ["=SUMA(A1:A9)", `"'=SUMA(A1:A9)"`],
    ["+50", `"'+50"`],
    ["-10", `"'-10"`],
    ["@cmd", `"'@cmd"`],
    ["\tcmd", `"'\tcmd"`],
    ["=1,2", `"'=1,2"`],
  ])("neutraliza la inyeccion de formulas en texto: %j", (input, expected) => {
    expect(firstCell(input)).toBe(expected);
  });

  it.each([
    ['Ajuste;=HYPERLINK("http://x")', `"Ajuste;=HYPERLINK(""http://x"")"`],
    ["Ajuste\t=1+1", `"Ajuste\t=1+1"`],
  ])(
    "entrecomilla el texto con ; o tab para que un Excel con otro separador no lo parta en celdas: %j",
    (input, expected) => {
      expect(firstCell(input)).toBe(expected);
    },
  );

  it("deja los numeros, incluidos los negativos, como numeros sin comillas", () => {
    expect(lines(toCsv({ headers: ["Cantidad"], rows: [[-10], [0], [1250.75]] })).slice(1)).toEqual([
      "-10",
      "0",
      "1250.75",
    ]);
  });

  it("exporta solo los encabezados cuando el reporte no tiene filas", () => {
    expect(lines(toCsv({ headers: ["Fecha", "Total"], rows: [] }))).toEqual(['"Fecha","Total"']);
  });

  it("usa las mismas columnas que el Excel para el reporte de ventas, incluidos los pedidos ecommerce", () => {
    const row = {
      channel: "Ecommerce",
      origin: "Tienda en linea",
      number: "WEB-0082",
      date: "2026-10-05T15:00:00",
      branchName: "Central",
      status: "confirmed",
      subtotal: 490.5,
      discountTotal: 0,
      taxTotal: 0,
      total: 490.5,
    } as unknown as SalesReportRow;

    const [header, record] = lines(toCsv(getReportTableData("sales", [row])));

    expect(header).toBe(
      '"Canal","Origen","Número","Fecha","Sucursal","Estado","Subtotal","Descuento","Impuesto","Total"',
    );
    expect(record).toMatch(
      /^"Ecommerce","Tienda en linea","WEB-0082","2026-10-05","Central","[^"]+",490\.5,0,0,490\.5$/,
    );
  });
});

describe("downloadReportCsv", () => {
  it("descarga un archivo text/csv con el nombre pedido", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:reporte");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadReportCsv("Reporte_Ventas_2026-10-30.csv", { headers: ["Total"], rows: [[10]] });

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe(REPORT_CSV_MIME);
    // FileReader.readAsText descarta el BOM al decodificar UTF-8; el BOM ya se verifica en toCsv.
    expect(await readBlob(blob)).toMatch(/^﻿?"Total"\r\n10\r\n$/);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("Reporte_Ventas_2026-10-30.csv");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:reporte");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
