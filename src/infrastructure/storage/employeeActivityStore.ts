import { EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";

/**
 * Marca de la ultima actividad del empleado compartida entre pestañas (localStorage). Solo guarda
 * un numero (epoch ms). Todo acceso va en try/catch: sin localStorage (modo privado, cuota, SSR)
 * las lecturas devuelven null y las escrituras se ignoran, y el cierre por inactividad sigue
 * funcionando en memoria dentro de la pestaña.
 */
export const employeeActivityStore = {
  read(): number | null {
    try {
      const raw = window.localStorage.getItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY);
      return parseTimestamp(raw);
    } catch {
      return null;
    }
  },

  write(timestamp: number): void {
    try {
      window.localStorage.setItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY, String(timestamp));
    } catch {
      // Sin almacenamiento disponible: la pestaña sigue contando en memoria.
    }
  },

  /** Al borrarla, las demas pestañas reciben `null` y cierran su sesion. */
  clear(): void {
    try {
      window.localStorage.removeItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY);
    } catch {
      // Sin almacenamiento disponible: nada que borrar.
    }
  },

  /**
   * Cambios hechos por OTRA pestaña (el evento `storage` no llega a la pestaña que escribio):
   * recibe la nueva marca, o `null` si se borro. Un valor que no es una marca valida se ignora.
   * Devuelve la funcion que cancela la suscripcion.
   */
  subscribe(listener: (timestamp: number | null) => void): () => void {
    const onStorage = (event: StorageEvent) => {
      // `key` null: otra pestaña hizo localStorage.clear(), que tambien borra la marca.
      if (event.key !== null && event.key !== EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY) return;
      if (event.newValue === null) {
        listener(null);
        return;
      }
      const timestamp = parseTimestamp(event.newValue);
      if (timestamp !== null) listener(timestamp);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
};

function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null;
  const timestamp = Number(raw);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}
