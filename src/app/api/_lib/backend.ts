import { cookies, headers as requestHeaders } from "next/headers";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { GENERIC_AUTH_ERROR_MESSAGE } from "@/config/auth-policy";
import { isPublicDemo } from "@/config/demo-mode";

/**
 * Utilidades SOLO de servidor para los Route Handlers de `app/api` (modo api). La carpeta
 * `_lib` es privada: Next no la expone como ruta.
 *
 * El JWT del backend vive unicamente en la cookie HttpOnly `omniretail_session`: ningun Route
 * Handler lo devuelve en el cuerpo de una respuesta.
 */
export const SESSION_COOKIE = "omniretail_session";

/** Mensaje generico: nunca se expone la URL, el error de red ni ningun detalle del backend. */
const SERVICE_UNAVAILABLE_BODY = {
  status: 503,
  error: "Service Unavailable",
  code: "SERVICE_UNAVAILABLE",
  message: "El servicio no está disponible en este momento. Intenta más tarde.",
};

/** Respuesta 503 con la misma forma que "no configurado", pero con codigo propio de la demo publica. */
const PUBLIC_DEMO_BACKEND_DISABLED_BODY = {
  ...SERVICE_UNAVAILABLE_BODY,
  code: "PUBLIC_DEMO_BACKEND_DISABLED",
  message: "El backend está deshabilitado en la demo pública.",
};

/**
 * Punto unico (chokepoint) que resuelve la URL base del backend para TODOS los Route Handlers.
 * Se evalua en cada request (nunca como constante de modulo). En la demo publica devuelve null
 * aunque `OMNIRETAIL_API_URL` este definida por error: ningun handler puede hablar con el backend
 * real. Cualquier handler nuevo debe obtener la URL de aqui y no leer la variable de entorno.
 */
export function getBackendBaseUrl(): string | null {
  if (isPublicDemo()) return null;
  return process.env.OMNIRETAIL_API_URL || null;
}

/** IPv4 o IPv6 (incluida la IPv4 embebida): solo hex, ":" y ".", maximo 45 caracteres. */
const CLIENT_IP_PATTERN = /^[0-9a-fA-F:.]{1,45}$/;

/**
 * IP del usuario para el rate limit por IP del backend: primera entrada del `X-Forwarded-For` que
 * pone Caddy (unico punto de entrada publico). Si no viene, no parece una IP o no hay request en
 * curso (`headers()` falla), devuelve null y la cabecera no se envia.
 */
async function clientIpFromRequest(): Promise<string | null> {
  try {
    const forwardedFor = (await requestHeaders()).get("x-forwarded-for");
    if (!forwardedFor) return null;
    const comma = forwardedFor.indexOf(",");
    const first = (comma === -1 ? forwardedFor : forwardedFor.slice(0, comma)).trim();
    return CLIENT_IP_PATTERN.test(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * Llama al backend. Devuelve null si `OMNIRETAIL_API_URL` no esta configurada o el backend no
 * responde (el caller responde 503 con `serviceUnavailable()`). Los headers extra van primero:
 * Content-Type y Authorization se asignan despues y nunca se pueden sobreescribir.
 */
export async function callBackend(
  path: string,
  init: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    token?: string;
    body?: BodyInit;
    contentType?: string;
    headers?: { "Idempotency-Key"?: string };
  },
): Promise<Response | null> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) return null;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.headers?.["Idempotency-Key"])
    headers["Idempotency-Key"] = init.headers["Idempotency-Key"];
  const clientIp = await clientIpFromRequest();
  if (clientIp) headers["X-Forwarded-For"] = clientIp;
  if (init.body !== undefined)
    headers["Content-Type"] = init.contentType ?? "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  try {
    return await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: init.method,
      headers,
      body: init.body,
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export function serviceUnavailable(): NextResponse {
  const body = isPublicDemo() ? PUBLIC_DEMO_BACKEND_DISABLED_BODY : SERVICE_UNAVAILABLE_BODY;
  return NextResponse.json(body, { status: 503 });
}

/**
 * Replica el ApiError INVALID_CREDENTIALS del backend (mismo status, codigo y mensaje), para que
 * un tipo de cuenta inesperado sea indistinguible de una contraseña incorrecta (R-A13/R-A14). No
 * incluye `path`: el del backend revelaria la ruta interna de la API.
 */
export function invalidCredentials(): NextResponse {
  return NextResponse.json(
    {
      status: 401,
      error: "Unauthorized",
      code: "INVALID_CREDENTIALS",
      message: GENERIC_AUTH_ERROR_MESSAGE,
      timestamp: new Date().toISOString(),
    },
    { status: 401 },
  );
}

/**
 * Reenvia al cliente el status y el cuerpo de error del backend tal cual. Lo usan los Route
 * Handlers publicos de la tienda (checkout, seguimiento); los de `/api/auth/**` usan
 * `forwardAuthBackendResponse`, que no deja pasar detalles internos.
 */
export async function forwardBackendError(response: Response): Promise<NextResponse> {
  const body = await response.text();
  return new NextResponse(body || null, {
    status: response.status,
    headers: body ? { "Content-Type": response.headers.get("Content-Type") ?? "application/json" } : undefined,
  });
}

/** Campos de un ApiError 4xx que la UI usa (mensaje de negocio, codigo y errores por campo). */
const FORWARDED_ERROR_FIELDS = ["status", "error", "code", "message", "timestamp"] as const;

const SERVER_ERROR_NAMES: Record<number, string> = {
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 5xx del backend: mismo status, cuerpo generico. Nunca llega la traza, la ruta ni la excepcion. */
function genericServerError(status: number): NextResponse {
  return NextResponse.json(
    {
      status,
      error: SERVER_ERROR_NAMES[status] ?? "Server Error",
      code: status === 500 ? "INTERNAL_ERROR" : "SERVICE_UNAVAILABLE",
      message: SERVICE_UNAVAILABLE_BODY.message,
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

/**
 * 4xx del backend reducido a la allowlist: `status`, `error`, `code`, `message`, `timestamp` y
 * `fields` (solo mensajes de texto). Se descartan `path`, `trace`, `exception` y cualquier otro
 * campo. Un cuerpo que no es un objeto JSON se reemplaza por un error generico con el mismo status.
 */
function sanitizedClientError(status: number, raw: string): NextResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!isRecord(parsed)) {
    return NextResponse.json(
      {
        status,
        error: "Request Error",
        code: "REQUEST_ERROR",
        message: "No se pudo completar la solicitud.",
        timestamp: new Date().toISOString(),
      },
      { status },
    );
  }
  const safe: Record<string, unknown> = {};
  for (const key of FORWARDED_ERROR_FIELDS) {
    const value = parsed[key];
    if (typeof value === "string" || typeof value === "number") safe[key] = value;
  }
  if (isRecord(parsed.fields)) {
    const fields = Object.fromEntries(
      Object.entries(parsed.fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    if (Object.keys(fields).length > 0) safe.fields = fields;
  }
  return NextResponse.json(safe, { status });
}

/**
 * Respuesta del backend hacia el navegador para los Route Handlers de `/api/auth/**`:
 * - 2xx/3xx: status y cuerpo tal cual (contratos de exito, que nunca traen tokens de sesion);
 * - 4xx: solo la allowlist de `sanitizedClientError` (un 401 sin cuerpo se reenvia vacio);
 * - 5xx: cuerpo generico con el mismo status.
 */
export async function forwardAuthBackendResponse(response: Response): Promise<NextResponse> {
  if (response.status >= 500) return genericServerError(response.status);
  const body = response.status === 204 ? "" : await response.text();
  if (response.ok) {
    return new NextResponse(body || null, {
      status: response.status,
      headers: body ? { "Content-Type": response.headers.get("Content-Type") ?? "application/json" } : undefined,
    });
  }
  if (!body) return new NextResponse(null, { status: response.status });
  return sanitizedClientError(response.status, body);
}

/** ApiError con la misma forma que el backend, para las respuestas que arma el propio Route Handler. */
export function apiErrorResponse(
  request: Request,
  status: number,
  error: string,
  code: string,
  message: string,
): NextResponse {
  return NextResponse.json(
    { status, error, code, message, path: new URL(request.url).pathname, timestamp: new Date().toISOString() },
    { status },
  );
}

/** Mismo chequeo que el puente `/api/backend` para los metodos que modifican. */
export function sameOriginOrForbidden(request: Request): NextResponse | null {
  if (request.headers.get("Origin") === new URL(request.url).origin) return null;
  return apiErrorResponse(request, 403, "Forbidden", "FORBIDDEN", "Origen no permitido.");
}

/** Un cuerpo JSON de `/api/auth/**` mas grande que esto no es una peticion legitima de la UI. */
const MAX_AUTH_BODY_BYTES = 16 * 1024;

const INVALID_AUTH_REQUEST_MESSAGE = "Revisa los datos ingresados e inténtalo nuevamente.";

/**
 * Primer filtro de TODOS los POST/PATCH de `/api/auth/**`. Sin backend configurado (o en la demo
 * publica) responde 503 antes que nada: ninguna peticion puede llegar a ningun lado. Con backend,
 * exige que `Origin` sea el del propio frontend (403 si no).
 */
export function guardAuthMutation(request: Request): NextResponse | null {
  if (!getBackendBaseUrl()) return serviceUnavailable();
  return sameOriginOrForbidden(request);
}

export type AuthJsonResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * Lee y valida el cuerpo JSON de un POST/PATCH de `/api/auth/**` ANTES de llamar al backend:
 * `guardAuthMutation`, `Content-Type: application/json` (415 si no), tamaño maximo y JSON legible
 * (400 REQUEST_ERROR) y el esquema zod de la ruta (400 VALIDATION_ERROR). El handler reenvia al
 * backend solo `data`, nunca el texto original. Nunca se registra el cuerpo: lleva contraseñas,
 * codigos y tokens.
 */
export async function readAuthJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<AuthJsonResult<z.output<S>>> {
  const blocked = guardAuthMutation(request);
  if (blocked) return { ok: false, response: blocked };

  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: apiErrorResponse(
        request,
        415,
        "Unsupported Media Type",
        "UNSUPPORTED_MEDIA_TYPE",
        "Tipo de contenido no soportado.",
      ),
    };
  }

  const raw = await request.text();
  let parsed: unknown;
  try {
    if (new TextEncoder().encode(raw).byteLength > MAX_AUTH_BODY_BYTES) throw new Error("too large");
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: apiErrorResponse(request, 400, "Bad Request", "REQUEST_ERROR", INVALID_AUTH_REQUEST_MESSAGE),
    };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      response: apiErrorResponse(request, 400, "Bad Request", "VALIDATION_ERROR", INVALID_AUTH_REQUEST_MESSAGE),
    };
  }
  return { ok: true, data: result.data };
}

/**
 * POST sin sesion a un endpoint publico de cuentas (registro, verificacion, recuperacion): nunca
 * envia token ni crea o toca la cookie. Recibe el cuerpo ya validado por `readAuthJson`.
 */
export async function relayPublicAuthPost(path: string, body: unknown): Promise<NextResponse> {
  const response = await callBackend(path, { method: "POST", body: JSON.stringify(body) });
  if (!response) return serviceUnavailable();
  return forwardAuthBackendResponse(response);
}

function sessionExpired(request: Request): NextResponse {
  return apiErrorResponse(
    request,
    401,
    "Unauthorized",
    "UNAUTHORIZED",
    "Tu sesión ya no es válida. Vuelve a iniciar sesión.",
  );
}

/**
 * Llamada con la sesion actual a un endpoint de `/auth/**` (el puente generico los bloquea). Usa el
 * token de la cookie HttpOnly (sin cookie: 401) y no toca la cookie.
 * - GET: sin cuerpo ni chequeo de Origin.
 * - POST con `schema`: pasa por `readAuthJson` (Origin, Content-Type, esquema) y reenvia solo el
 *   cuerpo validado.
 * - POST con `schema` null: endpoint sin cuerpo (p. ej. `/auth/mfa/code`); solo exige Origin.
 */
export async function relaySessionRequest(
  request: Request,
  path: string,
  method: "GET" | "POST",
  schema: z.ZodType | null = null,
): Promise<NextResponse> {
  let body: string | undefined;
  if (method === "POST") {
    if (schema) {
      const input = await readAuthJson(request, schema);
      if (!input.ok) return input.response;
      body = JSON.stringify(input.data);
    } else {
      const blocked = guardAuthMutation(request);
      if (blocked) return blocked;
    }
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return sessionExpired(request);
  const response = await callBackend(path, { method, token, body });
  if (!response) return serviceUnavailable();
  return forwardAuthBackendResponse(response);
}

/**
 * POST/PATCH con la sesion actual y cuerpo validado (cambio de contraseña, sucursal activa). Mismo
 * flujo que `relaySessionRequest` para metodos que no son POST.
 */
export async function relaySessionMutation(
  request: Request,
  path: string,
  method: "POST" | "PATCH",
  schema: z.ZodType,
): Promise<NextResponse> {
  const input = await readAuthJson(request, schema);
  if (!input.ok) return input.response;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return sessionExpired(request);
  const response = await callBackend(path, { method, token, body: JSON.stringify(input.data) });
  if (!response) return serviceUnavailable();
  return forwardAuthBackendResponse(response);
}

/** `expiresAt` del backend: fecha valida y futura, o null. */
function parseSessionExpiry(expiresAt: unknown): Date | null {
  if (typeof expiresAt !== "string") return null;
  const expires = new Date(expiresAt);
  return Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now() ? null : expires;
}

/**
 * Abre la sesion en el navegador con el JWT recien emitido por el backend: lee /auth/me, comprueba el
 * tipo de cuenta si se indica, guarda el JWT en la cookie HttpOnly y devuelve SOLO la sesion actual
 * (nunca el token). Si el token o su vencimiento no son validos, /auth/me falla o el tipo no
 * coincide, revoca la sesion y no crea la cookie; un tipo inesperado responde lo mismo que una
 * contraseña incorrecta. Es el UNICO lugar que crea la cookie de sesion.
 */
export async function openSessionResponse(
  token: unknown,
  expiresAt: unknown,
  expectedUserType?: string,
): Promise<NextResponse> {
  if (typeof token !== "string" || !token) return serviceUnavailable();
  const expires = parseSessionExpiry(expiresAt);
  if (!expires) {
    await callBackend("/auth/logout", { method: "POST", token });
    return serviceUnavailable();
  }

  const meResponse = await callBackend("/auth/me", { method: "GET", token });
  if (!meResponse || !meResponse.ok) {
    await callBackend("/auth/logout", { method: "POST", token });
    return meResponse ? forwardAuthBackendResponse(meResponse) : serviceUnavailable();
  }

  const current = (await meResponse.json()) as { user: { type: string } };
  if (expectedUserType && current.user.type !== expectedUserType) {
    await callBackend("/auth/logout", { method: "POST", token });
    return invalidCredentials();
  }

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    expires,
  });
  return NextResponse.json(current);
}
