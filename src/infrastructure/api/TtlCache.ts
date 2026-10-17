/** Vigencia por defecto de las listas maestras cacheadas en memoria. */
export const MASTER_DATA_CACHE_TTL_MS = 30_000;

/**
 * Cache en memoria con TTL y deduplicacion de promesas en vuelo para una sola lectura. Mismo
 * patron que `CurrentSessionClient`: llamadas concurrentes comparten un unico round-trip y las
 * posteriores dentro del TTL no tocan la red. Solo se cachean lecturas exitosas.
 */
export class TtlCache<T> {
  private cached: { value: T; at: number } | null = null;
  private inFlight: Promise<T> | null = null;
  private generation = 0;

  constructor(private readonly ttlMs: number = MASTER_DATA_CACHE_TTL_MS) {}

  async get(load: () => Promise<T>): Promise<T> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.value;
    if (!this.inFlight) {
      const generation = this.generation;
      const request = load()
        .then((value) => {
          // Si se invalido mientras la peticion volaba, el resultado puede ser obsoleto.
          if (generation === this.generation) this.cached = { value, at: Date.now() };
          return value;
        })
        .finally(() => {
          if (this.inFlight === request) this.inFlight = null;
        });
      this.inFlight = request;
    }
    return this.inFlight;
  }

  invalidate(): void {
    this.generation += 1;
    this.cached = null;
    this.inFlight = null;
  }
}
