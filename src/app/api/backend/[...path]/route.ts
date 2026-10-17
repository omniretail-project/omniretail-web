import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { callBackend, serviceUnavailable, SESSION_COOKIE } from "@/app/api/_lib/backend";
import {
  JSON_BODY_MAX_BYTES,
  MULTIPART_BODY_MAX_BYTES,
  readBodyWithLimit,
} from "@/app/api/_lib/limited-body";

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

function apiError(
  request: NextRequest,
  status: 400 | 403 | 404 | 413 | 415,
  error: string,
  code: string,
  message: string,
) {
  return NextResponse.json(
    {
      status,
      error,
      code,
      message,
      path: request.nextUrl.pathname,
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

function notFound(request: NextRequest) {
  return apiError(request, 404, "Not Found", "NOT_FOUND", "Recurso no encontrado.");
}

/**
 * El primer segmento decide si la ruta cae en `/auth/**`. Se rechaza si trae `;` (matrix params:
 * el backend podria normalizar `auth;x` a `auth`), `%` (una codificacion que sobrevivio al decode de
 * Next, p. ej. `%61uth`) o espacios; y se compara sin lo que sigue a `;`, sin espacios y en
 * minusculas. Solo aplica al PRIMER segmento: los demas pueden llevar ids o codigos codificados.
 */
function isBlockedFirstSegment(segment: string): boolean {
  if (/[;%\s]/.test(segment)) return true;
  return segment.split(";", 1)[0].trim().toLowerCase() === "auth";
}

/** Ruta del backend ya codificada, o null si algun segmento no es valido o apunta a `/auth/**`. */
function backendPath(segments: string[], search: string): string | null {
  if (segments.length === 0) return null;
  const invalid = segments.some(
    (segment) => segment === "" || segment === "." || segment === ".." || /[/\\]/.test(segment),
  );
  if (invalid || isBlockedFirstSegment(segments[0])) return null;
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
      const result = await readBodyWithLimit(request, JSON_BODY_MAX_BYTES);
      if (result.status === "too-large") {
        return apiError(
          request,
          413,
          "Payload Too Large",
          "PAYLOAD_TOO_LARGE",
          "El cuerpo JSON excede el limite permitido.",
        );
      }
      if (result.status === "read-error") {
        return apiError(
          request,
          400,
          "Bad Request",
          "INVALID_REQUEST_BODY",
          "No fue posible leer el cuerpo de la solicitud.",
        );
      }
      body = result.body;
      contentType = body === undefined ? undefined : incomingContentType;
    } else if (
      mediaType === "multipart/form-data" &&
      /(?:^|;)\s*boundary=/i.test(incomingContentType)
    ) {
      const result = await readBodyWithLimit(request, MULTIPART_BODY_MAX_BYTES);
      if (result.status === "too-large") {
        return apiError(
          request,
          413,
          "Payload Too Large",
          "PAYLOAD_TOO_LARGE",
          "El cuerpo multipart excede el limite permitido.",
        );
      }
      if (result.status === "read-error") {
        return apiError(
          request,
          400,
          "Bad Request",
          "INVALID_REQUEST_BODY",
          "No fue posible leer el cuerpo de la solicitud.",
        );
      }
      body = result.body;
      // El boundary del navegador se preserva literalmente; nunca se reconstruye FormData.
      contentType = body === undefined ? undefined : incomingContentType;
    } else {
      return apiError(
        request,
        415,
        "Unsupported Media Type",
        "UNSUPPORTED_MEDIA_TYPE",
        "Tipo de contenido no soportado.",
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
  const responseContentType = response.headers.get("Content-Type");
  const responseBody =
    response.status === 204 || response.status === 205 || response.status === 304
      ? null
      : response.body;
  return new NextResponse(responseBody, {
    status: response.status,
    headers: responseContentType ? { "Content-Type": responseContentType } : undefined,
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
