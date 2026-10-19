import { NextRequest, NextResponse } from "next/server";
import { callBackend, forwardBackendError, serviceUnavailable } from "@/app/api/_lib/backend";

/** Puente de descarga: el PDF es el mismo que el adjunto que genera el backend. */
export async function GET(_request: NextRequest, context: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await context.params;
  const response = await callBackend(`/public/${encodeURIComponent(slug)}/receipt/${encodeURIComponent(token)}`);
  if (!response) return serviceUnavailable();
  if (!response.ok) return forwardBackendError(response);
  return new NextResponse(await response.arrayBuffer(), {
    headers: {
      "Content-Disposition": response.headers.get("Content-Disposition") ?? "attachment; filename=\"comprobante-pedido.pdf\"",
      "Content-Type": "application/pdf",
    },
  });
}
