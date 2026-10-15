import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";

/**
 * El catálogo del POS se vuelve a consultar al entrar a la terminal. Mantenerlo durante un
 * minuto por contexto evita repetir esa carga costosa al volver a la pantalla, sin mantener
 * datos indefinidamente. Los eventos de catálogo, promociones e inventario lo invalidan antes.
 */
export const POS_PRODUCTS_CACHE_TTL_MS = 60_000;

interface PosProductsCacheEntry {
  expiresAt: number;
  products?: PosProductDto[];
  pending?: Promise<PosProductDto[]>;
}

const cacheByRepository = new WeakMap<RepositoryRegistry, Map<string, PosProductsCacheEntry>>();

function cacheFor(repositories: RepositoryRegistry) {
  let cache = cacheByRepository.get(repositories);
  if (!cache) {
    cache = new Map();
    cacheByRepository.set(repositories, cache);
  }
  return cache;
}

export function invalidatePosProductsCache(repositories: RepositoryRegistry, contextKey: string) {
  cacheFor(repositories).delete(contextKey);
}

export async function getCachedPosProducts(
  repositories: RepositoryRegistry,
  contextKey: string,
  load: () => Promise<PosProductDto[]>,
): Promise<PosProductDto[]> {
  const cache = cacheFor(repositories);
  const existing = cache.get(contextKey);

  if (existing?.products && existing.expiresAt > Date.now()) return existing.products;
  if (existing?.pending) return existing.pending;

  const pending = load();
  cache.set(contextKey, { expiresAt: 0, pending });

  try {
    const products = await pending;
    cache.set(contextKey, { products, expiresAt: Date.now() + POS_PRODUCTS_CACHE_TTL_MS });
    return products;
  } catch (error) {
    if (cache.get(contextKey)?.pending === pending) cache.delete(contextKey);
    throw error;
  }
}
