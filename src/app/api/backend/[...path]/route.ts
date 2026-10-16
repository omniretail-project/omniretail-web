import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { callBackend, serviceUnavailable, SESSION_COOKIE } from "@/app/api/_lib/backend";

/**
 * Puente generico del modo api: `/api/backend/<ruta>` -> `${OMNIRETAIL_API_URL}/<ruta>`.
 *
 * - El unico token que se envia es el de la cookie HttpOnly; nunca se reenvian Authorization ni
 *   Cookie del navegador. Sin cookie se llama sin token (endpoints `/public/**`).
 * - `/auth/**` esta bloqueado: `/auth/login` devuelve el JWT en el cuerpo y nunca debe llegar al
 *   navegador. Login, logout y sesion actual van solo por `app/api/auth/*`.
 * - Encabezados reenviados (lista cerrada): `Idempotency-Key`. Content-Type se valida y controla
 *   internamente para JSON o multipart; Authorization/Cookie nunca vienen del caller.
 * - Los metodos que modifican exigen `Origin` igual al del propio frontend.
 */

type RouteContext = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * La imagen permitida ocupa hasta 5 MiB. Se reserva un margen fijo para boundary y encabezados del
 * multipart, manteniendo el cuerpo total estrictamente acotado antes de acumularlo en memoria.
 */
const MAX_MULTIPART_BYTES = 5 * 1024 * 1024 + 64 * 1024;

class MultipartTooLargeError extends Error {}

function apiError(request: NextRequest, status: 403 | 404, error: string, code: string, message: string) {
  return NextResponse.json(
    { status, error, code, message, path: request.nextUrl.pathname, timestamp: new Date().toISOString() },
    { status },
  );
}

function notFound(request: NextRequest) {
  return apiError(request, 404, "Not Found", "NOT_FOUND", "Recurso no encontrado.");
}

function payloadTooLarge(request: NextRequest) {
  return NextResponse.json(
    {
      status: 413,
      error: "Payload Too Large",
      code: "PAYLOAD_TOO_LARGE",
      message: "El archivo supera el tamaño máximo permitido de 5 MB.",
      path: request.nextUrl.pathname,
      timestamp: new Date().toISOString(),
    },
    { status: 413 },
  );
}

/**
 * Lee multipart con un tope estricto. Content-Length permite rechazar antes de leer, pero no se
 * considera autoridad: las solicitudes sin longitud o con una longitud falsa se cuentan por bytes.
 */
async function readMultipartBody(request: NextRequest): Promise<Blob | undefined> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_MULTIPART_BYTES) {
    throw new MultipartTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return undefined;

  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_MULTIPART_BYTES) {
        await reader.cancel();
        throw new MultipartTooLargeError();
      }
      // Convierte un posible SharedArrayBuffer en un ArrayBuffer transferible que Blob acepta.
      chunks.push(Uint8Array.from(value).buffer);
    }
  } finally {
    reader.releaseLock();
  }

  return totalBytes > 0 ? new Blob(chunks) : undefined;
}

/** Ruta del backend ya codificada, o null si algun segmento no es valido o apunta a `/auth/**`. */
function backendPath(segments: string[], search: string): string | null {
  if (segments.length === 0) return null;
  const invalid = segments.some(
    (segment) => segment === "" || segment === "." || segment === ".." || /[/\\]/.test(segment),
  );
  if (invalid || segments[0].toLowerCase() === "auth") return null;
  return `/${segments.map(encodeURIComponent).join("/")}${search}`;
}

async function proxy(request: NextRequest, context: RouteContext, method: Method) {
  const path = backendPath((await context.params).path, request.nextUrl.search);
  if (!path) return notFound(request);

  if (method !== "GET" && request.headers.get("Origin") !== request.nextUrl.origin) {
    return apiError(request, 403, "Forbidden", "FORBIDDEN", "Origen no permitido.");
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const idempotencyKey = request.headers.get("Idempotency-Key");
  const incomingContentType = request.headers.get("Content-Type");
  const mediaType = incomingContentType?.split(";", 1)[0]?.trim().toLowerCase();
  let body: BodyInit | undefined;
  let contentType: string | undefined;

  if (method !== "GET" && incomingContentType) {
    if (mediaType === "application/json") {
      const text = await request.text();
      body = text || undefined;
      contentType = body === undefined ? undefined : incomingContentType;
    } else if (mediaType === "multipart/form-data" && /(?:^|;)\s*boundary=/i.test(incomingContentType)) {
      try {
        body = await readMultipartBody(request);
      } catch (error) {
        if (error instanceof MultipartTooLargeError) return payloadTooLarge(request);
        throw error;
      }
      // El boundary del navegador se preserva literalmente; nunca se reconstruye FormData.
      contentType = body === undefined ? undefined : incomingContentType;
    } else {
      return NextResponse.json(
        {
          status: 415,
          error: "Unsupported Media Type",
          code: "UNSUPPORTED_MEDIA_TYPE",
          message: "Tipo de contenido no soportado.",
          path: request.nextUrl.pathname,
          timestamp: new Date().toISOString(),
        },
        { status: 415 },
      );
    }
  }

  const response = await callBackend(path, {
    method,
    token,
    body,
    contentType,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
  });
  if (!response) return serviceUnavailable();
  if (response.status === 401 && token) cookieStore.delete(SESSION_COOKIE);

  // Solo status, cuerpo y Content-Type: nunca Set-Cookie ni otros headers del backend.
  const payload = response.status === 204 ? null : await response.arrayBuffer();
  const responseContentType = response.headers.get("Content-Type");
  return new NextResponse(payload && payload.byteLength > 0 ? payload : null, {
    status: response.status,
    headers:
      payload && payload.byteLength > 0 && responseContentType
        ? { "Content-Type": responseContentType }
        : undefined,
  });
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "GET");
}
export function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "POST");
}
export function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PUT");
}
export function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "PATCH");
}
export function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context, "DELETE");
}
