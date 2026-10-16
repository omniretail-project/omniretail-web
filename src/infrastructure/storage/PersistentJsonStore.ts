/**
 * Almacen JSON persistente y compartido entre pestanas del mismo origen.
 * Expone los fallos de acceso y los valores corruptos para que los flujos
 * idempotentes puedan bloquearse de forma conservadora.
 */
export class PersistentJsonStore {
  read<T>(key: string): PersistentJsonReadResult<T> {
    try {
      if (typeof window === "undefined") return { status: "unavailable" };
      const raw = window.localStorage.getItem(key);
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

  set<T>(key: string, value: T): boolean {
    try {
      if (typeof window === "undefined") return false;
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  remove(key: string): boolean {
    try {
      if (typeof window === "undefined") return false;
      window.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
}

export type PersistentJsonReadResult<T> =
  | { status: "empty" | "invalid" | "unavailable" }
  | { status: "value"; value: T };
