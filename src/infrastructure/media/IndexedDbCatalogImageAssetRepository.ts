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

export interface ClearCatalogImageAssetsOptions {
  /** Otra pestana mantiene la base abierta: el borrado sigue pendiente hasta que la cierre. */
  onBlocked?: () => void;
}

/**
 * Borra por completo la base local de imagenes del catalogo (reinicio de la demo publica).
 * La promesa refleja la finalizacion REAL del borrado: `deleteDatabase` no se puede cancelar y,
 * si otra pestana lo bloquea, el navegador lo completa cuando esa pestana cierra su conexion. Por
 * eso `blocked` no rechaza: avisa via `onBlocked` (para mostrar un estado de espera) y la promesa
 * sigue pendiente hasta `success` (o `error`). Asi nunca se informa un fallo de una operacion que
 * el navegador terminara despues, ni un exito antes de que los datos se hayan eliminado.
 */
export function clearCatalogImageAssets(options: ClearCatalogImageAssetsOptions = {}): Promise<void> {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("No se pudo borrar IndexedDB."));
    request.onblocked = () => options.onBlocked?.();
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
    request.onsuccess = () => {
      const database = request.result;
      // Si otra pestana borra la base (reinicio de la demo), cerrar esta conexion para no bloquearla.
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB."));
  });
}

function requestToPromise<T = IDBValidKey>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Fallo la operacion de IndexedDB."));
  });
}
