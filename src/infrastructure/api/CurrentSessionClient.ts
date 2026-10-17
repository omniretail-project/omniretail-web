import type { ApiCurrentSession } from "@/infrastructure/api/apiCurrentSession";

/** Vigencia de la cache: evita repetir /api/auth/me en cada lectura de una misma revalidacion. */
const CACHE_TTL_MS = 5_000;

/**
 * Lee la sesion actual desde `/api/auth/me` (same-origin; la cookie HttpOnly viaja sola). Cache
 * corta y compartida por los adaptadores de modo api; se invalida en login y logout. Solo guarda
 * la respuesta de /auth/me, que nunca contiene el token.
 */
export class CurrentSessionClient {
  private cached: { value: ApiCurrentSession | null; at: number } | null = null;
  private inFlight: Promise<ApiCurrentSession | null> | null = null;

  /** null si no hay sesion (401). Cualquier otro error se propaga. */
  async get(): Promise<ApiCurrentSession | null> {
    if (this.cached && Date.now() - this.cached.at < CACHE_TTL_MS) return this.cached.value;
    if (!this.inFlight) {
      this.inFlight = this.fetchCurrent().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /** Tras un login exitoso el Route Handler ya devolvio la sesion: se reutiliza sin otra llamada. */
  prime(value: ApiCurrentSession): void {
    this.cached = { value, at: Date.now() };
  }

  invalidate(): void {
    this.cached = null;
  }

  private async fetchCurrent(): Promise<ApiCurrentSession | null> {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
      this.cached = { value: null, at: Date.now() };
      return null;
    }
    if (!response.ok) throw new Error("No se pudo cargar la sesion actual.");
    const value = (await response.json()) as ApiCurrentSession;
    this.cached = { value, at: Date.now() };
    return value;
  }
}
