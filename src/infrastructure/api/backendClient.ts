/**
 * Cliente del modo api para los Api*Repository: llama al puente same-origin `/api/backend/*`, que
 * agrega el JWT de la cookie HttpOnly en el servidor. Este cliente nunca ve el token ni la URL del
 * backend. `/auth/**` esta bloqueado en el puente: la sesion va por ApiAuthRepository.
 *
 * @example
 * ```ts
 * export class ApiProductRepository {
 *   // La tienda sale del JWT en el backend; nunca se envia tenantId desde el navegador.
 *   async list(page = 1): Promise<PaginatedResult<Product>> {
 *     const result = await backendFetch<PaginatedResult<ApiProduct>>("/catalog/products", {
 *       query: { page, size: 20 },
 *     });
 *     return { ...result, items: result.items.map(toProduct) };
 *   }
 *
 *   async create(input: CreateProductInput, idempotencyKey: string): Promise<Product> {
 *     const created = await backendFetch<ApiProduct>("/catalog/products", {
 *       method: "POST",
 *       body: toCreateProductRequest(input),
 *       headers: { "Idempotency-Key": idempotencyKey },
 *     });
 *     return toProduct(created);
 *   }
 * }
 * ```
 * Errores: `BackendRequestError` con `status`, `code` y `fields` del ApiError del backend.
 */

const GENERIC_ERROR_MESSAGE = "No fue posible completar la solicitud. Intenta más tarde.";

export type BackendQuery = Record<string, string | number | boolean | undefined>;

export interface BackendFetchInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Los objetos se serializan a JSON; FormData se envia sin alterar para preservar su boundary. */
  body?: unknown;
  /** Las claves con valor `undefined` se omiten. */
  query?: BackendQuery;
  /** Unico encabezado que el puente reenvia al backend. */
  headers?: { "Idempotency-Key"?: string };
}

/** Error normalizado a partir del ApiError del backend ({ status, error, code, message, fields }). */
export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "BackendRequestError";
  }
}

function toQueryString(query: BackendQuery | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.append(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}

async function toRequestError(response: Response): Promise<BackendRequestError> {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown; fields?: unknown };
    return new BackendRequestError(
      typeof body.message === "string" && body.message ? body.message : GENERIC_ERROR_MESSAGE,
      response.status,
      typeof body.code === "string" ? body.code : undefined,
      body.fields && typeof body.fields === "object" ? (body.fields as Record<string, string>) : undefined,
    );
  } catch {
    return new BackendRequestError(GENERIC_ERROR_MESSAGE, response.status);
  }
}

/**
 * `path` es la ruta del backend sin `/api/v1` (p. ej. `/catalog/products`). Devuelve el JSON
 * tipado, o `undefined` si el backend responde 204.
 */
export async function backendFetch<T>(path: string, init: BackendFetchInit = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const isMultipart =
    hasBody && typeof FormData !== "undefined" && init.body instanceof FormData;
  const requestBody: BodyInit | undefined = !hasBody
    ? undefined
    : isMultipart
      ? (init.body as FormData)
      : JSON.stringify(init.body);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hasBody && !isMultipart) headers["Content-Type"] = "application/json";
  if (init.headers?.["Idempotency-Key"]) headers["Idempotency-Key"] = init.headers["Idempotency-Key"];

  let response: Response;
  try {
    response = await fetch(`/api/backend${path}${toQueryString(init.query)}`, {
      method: init.method ?? "GET",
      headers,
      body: requestBody,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new BackendRequestError(GENERIC_ERROR_MESSAGE, 0);
  }

  if (!response.ok) throw await toRequestError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
