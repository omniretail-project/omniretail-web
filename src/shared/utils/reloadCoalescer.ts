/**
 * Coalescing LOCAL de recargas (sin dependencias, sin estado global). Cada instancia pertenece a UN
 * contexto (p. ej. sucursal + filtros): para otro contexto se crea otra instancia, asi nunca se
 * reutiliza una carga ajena.
 *
 * Semantica:
 * - Las invalidaciones del mismo burst sincrono (p. ej. inventory.changed + stock.changed) comparten
 *   UNA carga (se arranca en un microtask, despues de que todas llegaron).
 * - Una invalidacion durante una carga en vuelo genera exactamente UNA recarga "trailing"; varias se
 *   compactan en esa misma.
 * - Un reload explicito tras una mutacion espera la carga que ya cubre las invalidaciones de esa
 *   mutacion en lugar de lanzar otra; si la mutacion no emitio ninguna, fuerza una recarga.
 */
export interface ReloadCoalescer {
  readonly contextKey: string;
  /**
   * Asigna (o retira con `null`) la funcion de carga. Permite crear el coalescer durante el render
   * sin capturar nada mutable y enlazar la carga vigente desde un efecto; sin loader, una carga
   * pendiente se resuelve sin ejecutar nada (un coalescer retirado nunca carga otro contexto).
   */
  setLoader(next: (() => Promise<void>) | null): void;
  /** Marca una invalidacion y asegura una carga que la cubra. Resuelve cuando esa carga termina. */
  invalidate(): Promise<void>;
  /** Contador de invalidaciones; capturarlo ANTES de una mutacion y pasarlo a `reloadAfter`. */
  version(): number;
  /** Reload explicito posterior a una mutacion iniciada cuando `version()` valia `versionBefore`. */
  reloadAfter(versionBefore: number): Promise<void>;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function createReloadCoalescer(
  initialLoad: (() => Promise<void>) | null,
  contextKey = "",
  schedule: (callback: () => void) => void = (callback) => queueMicrotask(callback),
): ReloadCoalescer {
  let load = initialLoad;
  let version = 0;
  // Version cubierta por la ultima carga EXITOSA (-1 si la ultima fallo: se permite reintentar).
  let doneVersion = -1;
  let scheduled: Deferred | null = null;
  let inFlight: { version: number; promise: Promise<void> } | null = null;
  let trailing: Deferred | null = null;

  function start(waiter: Deferred) {
    const startedVersion = version;
    const promise = (load ? load() : Promise.resolve()).then(
      () => {
        doneVersion = startedVersion;
      },
      () => {
        // El error lo presenta `load`; aqui solo se evita dejar a los que esperan colgados.
        doneVersion = -1;
      },
    );
    inFlight = { version: startedVersion, promise };
    void promise.then(() => {
      inFlight = null;
      waiter.resolve();
      if (trailing) {
        const next = trailing;
        trailing = null;
        start(next);
      }
    });
  }

  function ensure(): Promise<void> {
    if (scheduled) return scheduled.promise;
    if (inFlight) {
      // Una carga en vuelo sin invalidaciones posteriores ya refleja el estado actual.
      if (inFlight.version === version) return inFlight.promise;
      trailing ??= createDeferred();
      return trailing.promise;
    }
    if (doneVersion === version) return Promise.resolve();
    const waiter = createDeferred();
    scheduled = waiter;
    schedule(() => {
      scheduled = null;
      start(waiter);
    });
    return waiter.promise;
  }

  return {
    contextKey,
    setLoader(next) {
      load = next;
    },
    invalidate() {
      version += 1;
      return ensure();
    },
    version: () => version,
    reloadAfter(versionBefore) {
      // Si la mutacion no emitio ninguna invalidacion, el reload explicito cuenta como una.
      if (version === versionBefore) version += 1;
      return ensure();
    },
  };
}
