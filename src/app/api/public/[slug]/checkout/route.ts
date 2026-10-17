import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  callBackend,
  forwardBackendError,
  sameOriginOrForbidden,
  serviceUnavailable,
  SESSION_COOKIE,
} from "@/app/api/_lib/backend";
import { isPublicDemo } from "@/config/demo-mode";

/**
 * Puente de servidor para el checkout real. El navegador nunca conoce la URL
 * interna del backend ni el JWT almacenado en la cookie HttpOnly.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  // La demo nunca llega al backend real; conserva su 503 controlado incluso sin Origin de navegador.
  if (isPublicDemo()) return serviceUnavailable();

  const forbidden = sameOriginOrForbidden(request);
  if (forbidden) return forbidden;

  const { slug } = await context.params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const idempotencyKey = request.headers.get("Idempotency-Key");
  const response = await callBackend(`/public/${encodeURIComponent(slug)}/checkout`, {
    method: "POST",
    token,
    body: await request.text(),
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
  if (!response) return serviceUnavailable();
  if (!response.ok) return forwardBackendError(response);
  return new NextResponse(await response.text(), {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}
