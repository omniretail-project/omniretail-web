export class BrowserExclusiveLockUnavailableError extends Error {}

/**
 * Exclusión mutua entre contextos del mismo origen mediante Web Locks.
 * `ifAvailable` evita esperas invisibles: si otra pestaña posee el recurso,
 * la operación se rechaza antes de ejecutar cualquier efecto.
 */
export class BrowserExclusiveLock {
  async runIfAvailable<T>(name: string, operation: () => Promise<T>): Promise<T> {
    if (typeof navigator === "undefined" || !navigator.locks?.request) {
      throw new BrowserExclusiveLockUnavailableError(
        "El navegador no ofrece coordinación segura entre pestañas. No se enviará la confirmación.",
      );
    }
    return navigator.locks.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          throw new BrowserExclusiveLockUnavailableError(
            "Otra pestaña está confirmando este traslado. Espera a que termine antes de reintentar.",
          );
        }
        return operation();
      },
    );
  }
}
