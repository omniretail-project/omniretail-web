import { NextResponse } from "next/server";
import { callBackend, forwardBackendError, serviceUnavailable } from "@/app/api/_lib/backend";

/** Puente público del seguimiento; no requiere ni expone una sesión. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; token: string }> },
) {
  const { slug, token } = await context.params;
  const response = await callBackend(
    `/public/${encodeURIComponent(slug)}/tracking/${encodeURIComponent(token)}`,
    { method: "GET" },
  );
  if (!response) return serviceUnavailable();
  if (!response.ok) return forwardBackendError(response);
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}
