/**
 * Almacen JSON en `sessionStorage` (por pestana: sobrevive a una recarga, no a cerrar la pestana).
 * Nunca lanza. `read` distingue almacenamiento inaccesible y contenido corrupto;
 * `get` conserva el comportamiento historico de tratarlos como ausencia de valor.
 */
export class SessionJsonStore {
  read<T>(key: string): SessionJsonReadResult<T> {
    try {
      if (typeof window === "undefined") return { status: "unavailable" };
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return { status: "empty" };
      try {
        return { status: "value", value: JSON.parse(raw) as T };
      } catch {
        return { status: "invalid" };
      }
    } catch {
      return { status: "unavailable" };
    }
  }

  get<T>(key: string): T | null {
    const result = this.read<T>(key);
    if (result.status === "value") return result.value;
    if (result.status === "invalid") this.remove(key);
    return null;
  }

  /** `true` si el valor quedo guardado. */
  set<T>(key: string, value: T): boolean {
    try {
      if (typeof window === "undefined") return false;
      window.sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): void {
    try {
      if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
    } catch {
      // Sin almacenamiento disponible no hay nada que borrar.
    }
  }
}

export type SessionJsonReadResult<T> =
  | { status: "empty" | "invalid" | "unavailable" }
  | { status: "value"; value: T };
