import type { ReportXlsxData } from "@/modules/administration/application/reportXlsx";
import { downloadBlob } from "@/modules/administration/application/reportDownload";

/**
 * CSV estructurado de un reporte (RFC 4180): una fila de encabezados con el mismo orden de columnas
 * que el Excel, separador `,` y fin de linea CRLF. Las fechas quedan en ISO 8601 (`YYYY-MM-DD`) y los
 * montos con punto decimal, para que el archivo no dependa del idioma de quien lo abra.
 *
 * Todo texto va SIEMPRE entre comillas: un Excel configurado con `;` (comun en español) o tab como
 * separador partiria un texto sin comillas como `Ajuste;=HYPERLINK(...)` en dos celdas, y la segunda
 * empezaria con `=` sin la proteccion de abajo. Entre comillas, el campo nunca se divide.
 */
export const REPORT_CSV_MIME = "text/csv;charset=utf-8";

/** Excel solo detecta UTF-8 (acentos, ñ) si el archivo empieza con BOM. */
const UTF8_BOM = "﻿";
/**
 * Inyeccion de formulas (OWASP "CSV Injection"): una celda de texto que empieza con estos caracteres
 * se ejecutaria como formula al abrirla en una hoja de calculo. Los numeros no pasan por aqui, asi que
 * un monto negativo sigue siendo numero.
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

function toCsvCell(value: string | number): string {
  if (typeof value === "number") return String(value);
  return `"${value.replace(FORMULA_TRIGGER, "'$&").replaceAll('"', '""')}"`;
}

export function toCsv(data: ReportXlsxData): string {
  const lines = [data.headers, ...data.rows].map((row) => row.map(toCsvCell).join(","));
  return `${UTF8_BOM}${lines.join("\r\n")}\r\n`;
}

export function downloadReportCsv(filename: string, data: ReportXlsxData): void {
  downloadBlob(new Blob([toCsv(data)], { type: REPORT_CSV_MIME }), filename);
}
