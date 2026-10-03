/**
 * IndexedDB store for per-scan media: a ≤480 px JPEG thumbnail (or, for
 * YouCam's public sample faces, the sample URL) and the copied masks.
 * Everything is wrapped so private browsing or a blocked IndexedDB degrades to
 * "no images", never to a crash.
 */
import type { MaskMap } from './scanMedia.ts';

const DB_NAME = 'unstack-media';
const DB_VERSION = 1;
const STORE = 'scans';

export interface ScanMedia {
  id: string;
  /** data: URL of the thumbnail, or the https URL of a YouCam sample image. */
  thumb: string | null;
  masks: MaskMap;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function putScanMedia(media: ScanMedia): Promise<boolean> {
  const r = await run('readwrite', (s) => s.put(media));
  return r !== null;
}

export async function getScanMedia(id: string): Promise<ScanMedia | null> {
  const r = await run<ScanMedia | undefined>('readonly', (s) => s.get(id) as IDBRequest<ScanMedia | undefined>);
  return r ?? null;
}

export async function deleteScanMedia(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

/** Delete the whole database (used by "Delete everything on this device"). */
export async function clearAllMedia(): Promise<boolean> {
  const db = await openDb();
  db?.close();
  dbPromise = null;
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(true);
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
