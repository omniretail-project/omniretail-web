/**
 * Cache ligera en memoria: deduplicacion de lecturas en vuelo + cache opcional de valores con TTL.
 *
 * - Una misma key que ya esta cargando comparte su Promise (el loader corre una sola vez).
 * - El valor solo se guarda si `ttlMs > 0` y la carga termino bien; los errores nunca se cachean.
 * - Las entradas expiradas se eliminan al acceder.
 * - La key es responsabilidad del llamador y SIEMPRE debe incluir el tenant (y la sucursal si aplica).
 *
 * Solo para datos de referencia (categorias, unidades, proveedores, ubicaciones). No usar para
 * existencias, promociones, permisos, sesion, recepciones ni ordenes.
 */
export interface RequestCache {
  getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T>;
  invalidate(key: string): void;
  invalidatePrefix(prefix: string): void;
  clear(): void;
}

export function createRequestCache(now: () => number = Date.now): RequestCache {
  const values = new Map<string, { value: unknown; expiresAt: number }>();
  const inFlight = new Map<string, Promise<unknown>>();

  function getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = values.get(key);
    if (cached) {
      if (cached.expiresAt > now()) return Promise.resolve(cached.value as T);
      values.delete(key);
    }

    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const request: Promise<T> = Promise.resolve()
      .then(loader)
      .then(
        (value) => {
          // Si la key se invalido (o reemplazo) durante la carga, el resultado ya no es confiable.
          if (ttlMs > 0 && inFlight.get(key) === request) {
            values.set(key, { value, expiresAt: now() + ttlMs });
          }
          return value;
        },
      )
      .finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  }

  function invalidate(key: string) {
    values.delete(key);
    inFlight.delete(key);
  }

  function invalidatePrefix(prefix: string) {
    for (const key of [...values.keys()]) if (key.startsWith(prefix)) values.delete(key);
    for (const key of [...inFlight.keys()]) if (key.startsWith(prefix)) inFlight.delete(key);
  }

  function clear() {
    values.clear();
    inFlight.clear();
  }

  return { getOrLoad, invalidate, invalidatePrefix, clear };
}

const referenceDataCaches = new WeakMap<object, RequestCache>();

/**
 * Cache de datos de referencia compartida por todos los servicios que usan el mismo registro de
 * repositorios (el del RepositoryProvider). Atarla al registro evita mezclar datos entre
 * proveedores/sesiones distintas y permite descartarla junto con el.
 */
export function getReferenceDataCache(owner: object): RequestCache {
  let cache = referenceDataCaches.get(owner);
  if (!cache) {
    cache = createRequestCache();
    referenceDataCaches.set(owner, cache);
  }
  return cache;
}

export const REFERENCE_DATA_TTL_MS = 60_000;

export const referenceDataKeys = {
  categories: (tenantId: string) => `categories:${tenantId}`,
  units: (tenantId: string) => `units:${tenantId}`,
  activeSuppliers: (tenantId: string) => `suppliers:active:${tenantId}`,
  locations: (tenantId: string, branchId: string) => `locations:${tenantId}:${branchId}`,
} as const;

export const referenceDataPrefixes = {
  categories: "categories:",
  units: "units:",
  suppliers: "suppliers:",
  locations: "locations:",
} as const;
