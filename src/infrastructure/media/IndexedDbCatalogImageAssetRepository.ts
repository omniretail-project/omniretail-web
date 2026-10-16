import type { CatalogImageAsset, StoredCatalogImageAsset } from "@/core/entities";
import type { CatalogImageAssetRepository } from "@/core/repositories";

const DATABASE_NAME = "omniretail.catalog.assets.v1";
const STORE_NAME = "images";

interface AssetRecord extends CatalogImageAsset {
  blob: Blob;
}

export class IndexedDbCatalogImageAssetRepository implements CatalogImageAssetRepository {
  async put(metadata: CatalogImageAsset, blob: Blob): Promise<void> {
    if (metadata.byteSize !== blob.size || metadata.mimeType !== blob.type) {
      throw new Error("La metadata del asset no coincide con el archivo procesado.");
    }
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestToPromise<AssetRecord | undefined>(store.get(metadata.id));
    if (existing && existing.tenantId !== metadata.tenantId) {
      transaction.abort();
      database.close();
      throw new Error("Asset multimedia fuera del tenant actual.");
    }
    await requestToPromise(store.put({ ...metadata, blob } satisfies AssetRecord));
    database.close();
  }

  async get(tenantId: string, assetId: string): Promise<StoredCatalogImageAsset | null> {
    const database = await openDatabase();
    const record = await requestToPromise<AssetRecord | undefined>(
      database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(assetId),
    );
    database.close();
    if (!record) return null;
    if (record.tenantId !== tenantId) throw new Error("Asset multimedia fuera del tenant actual.");
    const { blob, ...metadata } = record;
    return { metadata, blob };
  }

  async remove(tenantId: string, assetId: string): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestToPromise<AssetRecord | undefined>(store.get(assetId));
    if (record && record.tenantId !== tenantId) {
      database.close();
      throw new Error("Asset multimedia fuera del tenant actual.");
    }
    if (record) await requestToPromise(store.delete(assetId));
    database.close();
  }
}

/** El borrado quedo bloqueado por otra pestana con la base abierta: el reinicio no debe darse por exitoso. */
export class CatalogAssetsResetBlockedError extends Error {
  readonly code = "CATALOG_ASSETS_RESET_BLOCKED";

  constructor() {
    super("El borrado de imagenes del catalogo esta bloqueado por otra pestana.");
    this.name = "CatalogAssetsResetBlockedError";
  }
}

/**
 * Borra por completo la base local de imagenes del catalogo (reinicio de la demo publica).
 * Decision: `blocked` rechaza de inmediato con `CatalogAssetsResetBlockedError` (sin timeout de
 * espera) para que el caller aborte antes de tocar datos. Nota: el navegador mantiene la solicitud
 * de borrado pendiente y se completa sola cuando las otras pestanas cierren su conexion.
 */
export function clearCatalogImageAssets(): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("No se pudo borrar IndexedDB."));
    request.onblocked = () => reject(new CatalogAssetsResetBlockedError());
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB no esta disponible en este entorno."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

function requestToPromise<T = IDBValidKey>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Fallo la operacion de IndexedDB."));
  });
}
