import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  callBackend,
  forwardAuthBackendResponse,
  getBackendBaseUrl,
  sameOriginOrForbidden,
  serviceUnavailable,
} from "@/app/api/_lib/backend";
import { readBodyWithLimit } from "@/app/api/_lib/limited-body";
import {
  informationRequestSchema,
  toFieldErrors,
} from "@/modules/information-request/validation/informationRequest.schema";

/** Una solicitud comercial legitima pesa pocos KB (comentarios de hasta 1,000 caracteres). */
const MAX_BODY_BYTES = 16 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_ID_PATTERN = IDEMPOTENCY_KEY_PATTERN;

/**
 * Puente de servidor de la solicitud comercial publica (landing). Sin sesion ni cookies: nunca
 * reenvia credenciales de usuario. Solo reenvia el contrato validado por `informationRequestSchema`
 * (el texto original del navegador no pasa) y el `Idempotency-Key`. En la demo publica o sin
 * backend configurado responde 503 antes de cualquier otra cosa: la demo nunca llega al backend.
 *
 * Dependencia de integracion: la IP del cliente para el limite de tasa del backend sale de
 * `callBackend` (primera entrada de X-Forwarded-For que fija Caddy). Caddy debe SOBRESCRIBIR esa
 * cabecera con la IP real; si pasa la del navegador, el limite por IP seria falsificable.
 */
export async function POST(request: Request) {
  if (!getBackendBaseUrl()) return serviceUnavailable();

  const forbidden = sameOriginOrForbidden(request);
  if (forbidden) return forbidden;

  const idempotencyKey = request.headers.get("Idempotency-Key") ?? "";
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return apiErrorResponse(
      request,
      400,
      "Bad Request",
      "IDEMPOTENCY_KEY_REQUIRED",
      "Falta una clave de solicitud válida.",
    );
  }

  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return apiErrorResponse(
      request,
      415,
      "Unsupported Media Type",
      "UNSUPPORTED_MEDIA_TYPE",
      "Tipo de contenido no soportado.",
    );
  }

  const read = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (read.status === "too-large") {
    return apiErrorResponse(request, 413, "Payload Too Large", "PAYLOAD_TOO_LARGE", "La solicitud es demasiado grande.");
  }
  if (read.status === "read-error" || !read.body) {
    return apiErrorResponse(request, 400, "Bad Request", "REQUEST_ERROR", "No se pudo leer la solicitud.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(read.body));
  } catch {
    return apiErrorResponse(request, 400, "Bad Request", "REQUEST_ERROR", "No se pudo leer la solicitud.");
  }

  const result = informationRequestSchema.safeParse(parsed);
  if (!result.success) {
    return NextResponse.json(
      {
        status: 400,
        error: "Bad Request",
        code: "VALIDATION_ERROR",
        message: "Revisa los datos ingresados e inténtalo nuevamente.",
        fields: toFieldErrors(result.error),
      },
      { status: 400 },
    );
  }

  const response = await callBackend("/public/contact-requests", {
    method: "POST",
    body: JSON.stringify(result.data),
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (!response) return serviceUnavailable();

  if (response.status === 202) {
    // Solo se confirma al navegador una aceptacion con identificador valido.
    let accepted: unknown;
    try {
      accepted = await response.json();
    } catch {
      accepted = null;
    }
    const body = accepted as { requestId?: unknown; status?: unknown } | null;
    if (
      body &&
      typeof body.requestId === "string" &&
      REQUEST_ID_PATTERN.test(body.requestId) &&
      body.status === "RECEIVED"
    ) {
      return NextResponse.json({ requestId: body.requestId, status: "RECEIVED" }, { status: 202 });
    }
    return apiErrorResponse(
      request,
      502,
      "Bad Gateway",
      "INVALID_BACKEND_RESPONSE",
      "El servicio respondió de forma inesperada.",
    );
  }

  const forwarded = await forwardAuthBackendResponse(response);
  const retryAfter = response.headers.get("Retry-After");
  if (response.status === 429 && retryAfter && /^\d+$/.test(retryAfter)) {
    forwarded.headers.set("Retry-After", retryAfter);
  }
  return forwarded;
}
