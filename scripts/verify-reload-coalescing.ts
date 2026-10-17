import assert from "node:assert/strict";
import {
  ReorderSuggestionsLoader,
  type ReorderSuggestionsResult,
  type ReorderSuggestionsSnapshot,
} from "@/modules/purchasing/application/services/ReorderSuggestionsLoader";
import { createReloadCoalescer } from "@/shared/utils/reloadCoalescer";

/** Deja correr todos los microtasks y los callbacks encolados antes de continuar. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** `load` controlable: cada llamada queda pendiente hasta que el test la resuelve. */
function manualLoad<T = void>() {
  const pending: Array<(value: T) => void> = [];
  const calls: unknown[][] = [];
  return {
    calls,
    pending,
    load: (...args: unknown[]) => {
      calls.push(args);
      return new Promise<T>((resolve) => pending.push(resolve));
    },
    resolveNext(value: T) {
      const next = pending.shift();
      assert.ok(next, "debe haber una carga pendiente");
      next(value);
    },
  };
}

// --- Inventario: inventory.changed + stock.changed + reload explicito = UNA carga efectiva ---
async function verifyBurstSharesOneLoad() {
  const manual = manualLoad();
  const coalescer = createReloadCoalescer(() => manual.load() as Promise<void>);

  const versionBefore = coalescer.version();
  // La mutacion (POST) emite inventory.changed y stock.changed en el mismo burst.
  const first = coalescer.invalidate();
  const second = coalescer.invalidate();
  await flush();
  assert.equal(manual.calls.length, 1, "el burst comparte una unica carga");
  // El caller de la mutacion hace su reload explicito: espera la misma carga, no inicia otra.
  const explicit = coalescer.reloadAfter(versionBefore);
  await flush();
  assert.equal(manual.calls.length, 1, "el reload explicito no duplica la carga en vuelo");
  manual.resolveNext(undefined);
  await Promise.all([first, second, explicit]);
  await flush();
  assert.equal(manual.calls.length, 1, "una sola carga efectiva en total");
}

async function verifySingleTrailingDuringFlight() {
  const manual = manualLoad();
  const coalescer = createReloadCoalescer(() => manual.load() as Promise<void>);

  void coalescer.invalidate();
  await flush();
  assert.equal(manual.calls.length, 1);
  // Varias invalidaciones reales durante el vuelo se compactan en UNA sola recarga trailing.
  void coalescer.invalidate();
  void coalescer.invalidate();
  void coalescer.invalidate();
  await flush();
  assert.equal(manual.calls.length, 1, "no hay cargas paralelas mientras una esta en vuelo");
  manual.resolveNext(undefined);
  await flush();
  assert.equal(manual.calls.length, 2, "exactamente una trailing");
  manual.resolveNext(undefined);
  await flush();
  assert.equal(manual.calls.length, 2, "no quedan cargas extra");
}

async function verifyExplicitReloadWithoutEventsStillLoads() {
  const manual = manualLoad();
  const coalescer = createReloadCoalescer(() => manual.load() as Promise<void>);
  const reload = coalescer.reloadAfter(coalescer.version());
  await flush();
  assert.equal(manual.calls.length, 1, "sin eventos, el reload explicito fuerza una carga");
  manual.resolveNext(undefined);
  await reload;
}

async function verifyContextsAreIndependent() {
  const first = manualLoad();
  const second = manualLoad();
  const coalescerA = createReloadCoalescer(() => first.load() as Promise<void>, "branch-a");
  const coalescerB = createReloadCoalescer(() => second.load() as Promise<void>, "branch-b");
  void coalescerA.invalidate();
  await flush();
  // Otro contexto nunca se une a la carga en vuelo del primero.
  void coalescerB.invalidate();
  await flush();
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1, "otro contexto tiene su propia carga");
  first.resolveNext(undefined);
  second.resolveNext(undefined);
  await flush();
}

// --- Compras: sugerencias de reposicion perezosas, cache local tenant + sucursal ---
function createLoaderHarness() {
  const calls: string[] = [];
  const pending: Array<{ branchId: string; resolve: (result: ReorderSuggestionsResult) => void }> =
    [];
  const snapshots: ReorderSuggestionsSnapshot[] = [];
  const loader = new ReorderSuggestionsLoader(
    (branchId) => {
      calls.push(branchId);
      return new Promise<ReorderSuggestionsResult>((resolve) => pending.push({ branchId, resolve }));
    },
    (snapshot) => snapshots.push(snapshot),
  );
  const resolveNext = (suggestionCount = 0) => {
    const next = pending.shift();
    assert.ok(next, "debe haber una carga de sugerencias pendiente");
    next.resolve({
      suggestions: Array.from({ length: suggestionCount }, (_, index) => ({
        id: `reorder-${next.branchId}-${index}`,
        productId: `product-${index}`,
        branchId: next.branchId,
        productName: `Producto ${index}`,
        sku: `SKU-${index}`,
        currentStock: 0,
        minStock: 1,
        suggestedQuantity: 1,
        shortage: 1,
        preferredSupplierName: "Sin proveedor preferido",
        associatedSupplierCount: 0,
      })),
    });
  };
  return { calls, snapshots, loader, resolveNext };
}

async function verifyReorderSuggestionsLazyAndCached() {
  const { calls, snapshots, loader, resolveNext } = createLoaderHarness();
  loader.setContext("tenant|branch-1", "branch-1");
  await flush();
  assert.equal(calls.length, 0, "panel cerrado: ninguna carga de sugerencias");

  loader.setExpanded(true);
  assert.equal(calls.length, 1, "primer expand: carga");
  assert.equal(snapshots.at(-1)?.loading, true);
  resolveNext(2);
  await flush();
  assert.equal(snapshots.at(-1)?.loaded, true);
  assert.equal(snapshots.at(-1)?.suggestions.length, 2);

  loader.setExpanded(false);
  loader.setExpanded(true);
  assert.equal(calls.length, 1, "reabrir sin invalidacion reutiliza el resultado");
  assert.equal(snapshots.at(-1)?.suggestions.length, 2);

  // Panel cerrado + invalidacion: queda stale y espera al siguiente expand (sin cargar).
  loader.setExpanded(false);
  loader.invalidate();
  await flush();
  assert.equal(calls.length, 1, "cerrado: la invalidacion no dispara carga");
  loader.setExpanded(true);
  assert.equal(calls.length, 2, "el siguiente expand recarga lo stale");
  resolveNext(1);
  await flush();
  assert.equal(snapshots.at(-1)?.suggestions.length, 1);
}

async function verifyReorderSuggestionsInvalidationWhileOpen() {
  const { calls, loader, resolveNext } = createLoaderHarness();
  loader.setContext("tenant|branch-1", "branch-1");
  loader.setExpanded(true);
  resolveNext(1);
  await flush();
  assert.equal(calls.length, 1);

  // inventory.changed + stock.changed del mismo burst: UNA recarga.
  loader.invalidate();
  loader.invalidate();
  await flush();
  assert.equal(calls.length, 2, "el burst comparte una recarga");

  // Invalidaciones durante el vuelo: exactamente UNA trailing.
  loader.invalidate();
  loader.invalidate();
  await flush();
  assert.equal(calls.length, 2, "no se duplica la carga en vuelo");
  resolveNext(1);
  await flush();
  assert.equal(calls.length, 3, "una trailing");
  resolveNext(1);
  await flush();
  assert.equal(calls.length, 3);
}

async function verifyReorderSuggestionsDoNotMixBranches() {
  const { calls, snapshots, loader, resolveNext } = createLoaderHarness();
  loader.setContext("tenant|branch-1", "branch-1");
  loader.setExpanded(true);
  resolveNext(2);
  await flush();

  // Otra sucursal no reutiliza el cache de la primera.
  loader.setContext("tenant|branch-2", "branch-2");
  await flush();
  assert.deepEqual(calls, ["branch-1", "branch-2"]);
  assert.equal(snapshots.at(-1)?.key, "tenant|branch-2");
  assert.equal(snapshots.at(-1)?.suggestions.length, 0, "no muestra datos de la sucursal anterior");

  // Si el contexto vuelve a cambiar mientras carga, la respuesta tardia no se publica.
  loader.setContext("tenant|branch-3", "branch-3");
  await flush();
  resolveNext(5); // branch-2, ya obsoleta
  await flush();
  assert.notEqual(snapshots.at(-1)?.key, "tenant|branch-2");
  resolveNext(1); // branch-3
  await flush();
  assert.equal(snapshots.at(-1)?.key, "tenant|branch-3");
  assert.equal(snapshots.at(-1)?.suggestions.length, 1);
}

async function verifyReorderSuggestionsCachePerContext() {
  const { calls, snapshots, loader, resolveNext } = createLoaderHarness();
  // A primer expand -> carga A.
  loader.setContext("tenant|branch-a", "branch-a");
  loader.setExpanded(true);
  resolveNext(2);
  await flush();
  assert.deepEqual(calls, ["branch-a"]);

  // Cerrar/reabrir A -> 0 cargas.
  loader.setExpanded(false);
  loader.setExpanded(true);
  assert.deepEqual(calls, ["branch-a"], "reabrir A no recarga");

  // A -> B -> B carga de forma independiente (sin datos de A).
  loader.setContext("tenant|branch-b", "branch-b");
  await flush();
  assert.deepEqual(calls, ["branch-a", "branch-b"]);
  assert.equal(snapshots.at(-1)?.key, "tenant|branch-b");
  assert.equal(snapshots.at(-1)?.suggestions.length, 0, "B no muestra datos de A");
  resolveNext(1);
  await flush();
  assert.equal(snapshots.at(-1)?.suggestions.length, 1);

  // B -> A sin invalidacion de A -> reutiliza el cache de A (0 cargas nuevas).
  loader.setContext("tenant|branch-a", "branch-a");
  await flush();
  assert.deepEqual(calls, ["branch-a", "branch-b"], "A reutiliza su cache");
  assert.equal(snapshots.at(-1)?.key, "tenant|branch-a");
  assert.equal(snapshots.at(-1)?.suggestions.length, 2, "A conserva SUS sugerencias");

  // Un evento de datos (sin sucursal precisa) invalida todas las entradas, pero con el panel abierto
  // solo recarga el contexto ACTIVO (A); B queda stale sin cargarse en segundo plano.
  loader.invalidate();
  await flush();
  assert.deepEqual(calls, ["branch-a", "branch-b", "branch-a"], "A stale se recarga");
  resolveNext(3);
  await flush();
  assert.equal(calls.length, 3, "B no se carga en segundo plano");
  loader.setContext("tenant|branch-b", "branch-b");
  await flush();
  assert.deepEqual(
    calls,
    ["branch-a", "branch-b", "branch-a", "branch-b"],
    "B quedo stale por el evento y se recarga al volver a ser el contexto activo",
  );
  resolveNext(1);
  await flush();
}

// El evento ocurre con el panel cerrado y una sucursal distinta de la cacheada: A y B quedan stale.
async function verifyInvalidationMarksEveryCachedContextStale() {
  const { calls, loader, resolveNext } = createLoaderHarness();
  loader.setContext("tenant|branch-a", "branch-a");
  loader.setExpanded(true);
  resolveNext(1);
  await flush();
  loader.setExpanded(false);

  loader.setContext("tenant|branch-b", "branch-b");
  loader.setExpanded(true);
  resolveNext(1);
  await flush();
  loader.setExpanded(false);
  assert.deepEqual(calls, ["branch-a", "branch-b"]);

  // B es el contexto actual y el panel esta cerrado: ninguna carga, pero A y B quedan stale.
  loader.invalidate();
  await flush();
  assert.deepEqual(calls, ["branch-a", "branch-b"], "panel cerrado: cero cargas");

  loader.setContext("tenant|branch-a", "branch-a");
  loader.setExpanded(true);
  assert.deepEqual(calls, ["branch-a", "branch-b", "branch-a"], "A stale se recarga UNA vez");
  resolveNext(1);
  await flush();
  loader.setExpanded(false);

  loader.setContext("tenant|branch-b", "branch-b");
  loader.setExpanded(true);
  assert.deepEqual(
    calls,
    ["branch-a", "branch-b", "branch-a", "branch-b"],
    "B stale se recarga UNA vez",
  );
  resolveNext(1);
  await flush();
  assert.equal(calls.length, 4);
}

// Panel abierto en B: el burst recarga solo B; A queda stale sin request en segundo plano.
async function verifyOpenPanelBurstReloadsOnlyActiveContext() {
  const { calls, loader, resolveNext } = createLoaderHarness();
  loader.setContext("tenant|branch-a", "branch-a");
  loader.setExpanded(true);
  resolveNext(1);
  await flush();
  loader.setContext("tenant|branch-b", "branch-b");
  await flush();
  resolveNext(1);
  await flush();
  assert.deepEqual(calls, ["branch-a", "branch-b"]);

  loader.invalidate();
  loader.invalidate();
  loader.invalidate();
  await flush();
  assert.deepEqual(calls, ["branch-a", "branch-b", "branch-b"], "una sola recarga de B");
  resolveNext(1);
  await flush();
  assert.equal(calls.length, 3, "A no se carga en segundo plano");

  // Al volver a A (panel abierto) esta stale: se recarga.
  loader.setContext("tenant|branch-a", "branch-a");
  await flush();
  assert.deepEqual(calls, ["branch-a", "branch-b", "branch-b", "branch-a"]);
  resolveNext(1);
  await flush();
}

async function main() {
  await verifyBurstSharesOneLoad();
  console.log("1. inventory.changed + stock.changed + reload explicito = 1 carga: PASS");
  await verifySingleTrailingDuringFlight();
  console.log("2. invalidacion durante el vuelo = exactamente 1 trailing: PASS");
  await verifyExplicitReloadWithoutEventsStillLoads();
  console.log("3. reload explicito sin eventos sigue cargando: PASS");
  await verifyContextsAreIndependent();
  console.log("4. contextos distintos no comparten carga: PASS");
  await verifyReorderSuggestionsLazyAndCached();
  console.log("5. sugerencias: perezosas, cacheadas y stale al reabrir: PASS");
  await verifyReorderSuggestionsInvalidationWhileOpen();
  console.log("6. sugerencias: burst y trailing con el panel abierto: PASS");
  await verifyReorderSuggestionsDoNotMixBranches();
  console.log("7. sugerencias: otra sucursal no reutiliza cache ni mezcla respuestas: PASS");
  await verifyReorderSuggestionsCachePerContext();
  console.log("8. sugerencias: cache por contexto A -> B -> A: PASS");
  await verifyInvalidationMarksEveryCachedContextStale();
  console.log("9. sugerencias: un evento deja stale todo contexto cacheado (panel cerrado): PASS");
  await verifyOpenPanelBurstReloadsOnlyActiveContext();
  console.log("10. sugerencias: burst con panel abierto recarga solo el contexto activo: PASS");
}

void main();
