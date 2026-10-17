import type { ReorderSuggestionReadModel } from "@/modules/purchasing/application/dto/PurchaseOrderReadModel";

export interface ReorderSuggestionsResult {
  suggestions: ReorderSuggestionReadModel[];
  notice?: string;
}

/** Lo que ve la UI. `key` identifica el contexto (tenant + sucursal) al que pertenece. */
export interface ReorderSuggestionsSnapshot extends ReorderSuggestionsResult {
  key: string;
  /** Hubo al menos un resultado para este contexto (un refresh en curso conserva los datos viejos). */
  loaded: boolean;
  loading: boolean;
  error?: string;
}

interface CacheEntry {
  result: ReorderSuggestionsResult;
  stale: boolean;
}

/**
 * Carga perezosa y cache LOCAL de las sugerencias de reposicion (sin estado global).
 *
 * - Panel cerrado: ninguna peticion.
 * - Cache por contexto `key` (tenant + sucursal), una entrada por key: A -> B -> A reutiliza A si
 *   no fue invalidado. Nunca se reutilizan datos entre contextos.
 * - Las invalidaciones (eventos de datos) marcan stale TODAS las entradas guardadas (el evento no
 *   identifica la sucursal); con el panel abierto solo se refresca el contexto ACTIVO, con el panel
 *   cerrado no hay ninguna carga y cada contexto espera a su siguiente expand.
 * - Invalidaciones del mismo burst comparten una recarga; una durante el vuelo genera UNA trailing
 *   por contexto. Una carga en vuelo del mismo contexto nunca se duplica.
 * - La respuesta tardia de otro contexto no se publica en el panel actual (solo alimenta el cache
 *   de SU contexto).
 */
export class ReorderSuggestionsLoader {
  private key = "";
  private branchId: string | undefined;
  private expanded = false;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly snapshots = new Map<string, ReorderSuggestionsSnapshot>();
  private readonly inFlight = new Set<string>();
  private readonly versions = new Map<string, number>();
  private refreshScheduled = false;

  constructor(
    private readonly load: (branchId: string) => Promise<ReorderSuggestionsResult>,
    private readonly onChange: (snapshot: ReorderSuggestionsSnapshot) => void,
    private readonly schedule: (callback: () => void) => void = (callback) =>
      queueMicrotask(callback),
  ) {}

  /** Tenant + sucursal activos. Con el panel abierto, un contexto nuevo se carga por separado. */
  setContext(key: string, branchId: string | undefined) {
    if (this.key === key && this.branchId === branchId) return;
    this.key = key;
    this.branchId = branchId;
    if (this.expanded) this.schedule(() => this.request());
  }

  setExpanded(expanded: boolean) {
    this.expanded = expanded;
    if (expanded) this.request();
  }

  /** Un evento de datos relevante (orden, recepcion, inventario, proveedor, producto...). */
  invalidate() {
    // Los eventos no traen una sucursal precisa: cualquier entrada ya guardada (o en vuelo) pudo
    // quedar obsoleta, asi que TODAS se marcan stale. Solo se refresca el contexto activo; los
    // inactivos se recargan unicamente cuando vuelven a ser el contexto visible y se expande.
    const affectedKeys = new Set<string>([this.key, ...this.cache.keys(), ...this.inFlight]);
    for (const key of affectedKeys) {
      this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
      const cached = this.cache.get(key);
      if (cached) cached.stale = true;
    }
    if (!this.expanded || this.refreshScheduled) return;
    // Eventos del mismo burst (p. ej. inventory.changed + stock.changed) comparten una recarga.
    this.refreshScheduled = true;
    this.schedule(() => {
      this.refreshScheduled = false;
      if (this.expanded) this.request();
    });
  }

  private publish(snapshot: ReorderSuggestionsSnapshot) {
    this.snapshots.set(snapshot.key, snapshot);
    this.onChange(snapshot);
  }

  private request() {
    const key = this.key;
    const branchId = this.branchId;
    if (!branchId) return;
    const cached = this.cache.get(key);
    if (cached && !cached.stale) {
      this.publish({ key, ...cached.result, loaded: true, loading: false });
      return;
    }
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    const version = this.versions.get(key) ?? 0;
    const previous = this.snapshots.get(key);
    this.publish({
      key,
      suggestions: previous?.suggestions ?? [],
      notice: previous?.notice,
      loaded: previous?.loaded ?? false,
      loading: true,
    });
    void this.load(branchId).then(
      (result) => {
        this.inFlight.delete(key);
        // Una invalidacion ocurrida durante el vuelo deja el resultado como stale.
        const stale = (this.versions.get(key) ?? 0) !== version;
        this.cache.set(key, { result, stale });
        // El contexto cambio mientras cargaba: se guarda para SU contexto, pero no se publica.
        if (this.key !== key) return;
        this.publish({ key, ...result, loaded: true, loading: false });
        // Varias invalidaciones durante el vuelo se compactan en UNA recarga trailing.
        if (stale && this.expanded) this.request();
      },
      (error: unknown) => {
        this.inFlight.delete(key);
        if (this.key !== key) return;
        this.publish({
          key,
          suggestions: [],
          loaded: false,
          loading: false,
          error: error instanceof Error ? error.message : "No se pudieron cargar las sugerencias.",
        });
      },
    );
  }
}
