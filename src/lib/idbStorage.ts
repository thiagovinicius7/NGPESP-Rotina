import { AppState } from "../types.js";

const DB_NAME = "ngpesp_local_db";
const DB_VERSION = 1;
const STORE_STATE = "app_state";
const STORE_SNAPSHOTS = "snapshots";

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_STATE)) {
          db.createObjectStore(STORE_STATE);
        }
        if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
          db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "id", autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

/**
 * Persists the complete, uncompressed state into IndexedDB (virtually unlimited quota)
 */
export async function saveStateToIndexedDB(state: AppState): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, "readwrite");
      const store = tx.objectStore(STORE_STATE);
      store.put(state, "current_state");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Could not save to IndexedDB:", err);
  }
}

/**
 * Loads the complete state from IndexedDB
 */
export async function loadStateFromIndexedDB(): Promise<AppState | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_STATE, "readonly");
      const store = tx.objectStore(STORE_STATE);
      const req = store.get("current_state");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Could not load from IndexedDB:", err);
    return null;
  }
}

export interface StateSnapshotRecord {
  id?: number;
  timestamp: number;
  dateFormatted: string;
  summary: string;
  state: AppState;
}

/**
 * Saves a snapshot to IndexedDB
 */
export async function saveSnapshotToIDB(snapshot: Omit<StateSnapshotRecord, "id">): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, "readwrite");
      const store = tx.objectStore(STORE_SNAPSHOTS);
      store.add(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Could not save snapshot to IndexedDB:", err);
  }
}

/**
 * Retrieves the latest snapshots from IndexedDB
 */
export async function getSnapshotsFromIDB(limit = 20): Promise<StateSnapshotRecord[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOTS, "readonly");
      const store = tx.objectStore(STORE_SNAPSHOTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const list: StateSnapshotRecord[] = req.result || [];
        list.sort((a, b) => b.timestamp - a.timestamp);
        resolve(list.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Could not get snapshots from IndexedDB:", err);
    return [];
  }
}

/**
 * Safe wrapper for localStorage.setItem that NEVER throws QuotaExceededError
 */
export function safeLocalStorageSet(key: string, value: string): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: any) {
    console.warn(`localStorage quota exceeded for key '${key}'. Cleaning up local cache...`, err);
    
    // Recovery Step 1: Remove heavy snapshot cache from localStorage (snapshots are now in IndexedDB)
    try {
      localStorage.removeItem("ngpesp_local_snapshots");
      localStorage.removeItem("ss_dep_img1");
      localStorage.removeItem("ss_dep_img2");
    } catch (_) {}

    // Retry after clearing non-essential keys
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (_) {}

    // Recovery Step 2: If still exceeding quota, try to save a pruned lightweight version into localStorage
    try {
      if (key === "ngpesp_local_state") {
        const parsed = JSON.parse(value);
        // Prune deep historic records or excessive queues in localStorage only (full copy remains in IndexedDB and Firestore)
        const pruned = {
          ...parsed,
          historico: (parsed.historico || []).slice(0, 100),
          servidores: (parsed.servidores || []).map((s: any) => ({
            matricula: s.matricula,
            nome: s.nome,
            lotacao: s.lotacao || s.codLotacao || "",
            cargo: s.cargo || s.denominacao || ""
          }))
        };
        localStorage.setItem(key, JSON.stringify(pruned));
        return true;
      }
    } catch (_) {}

    return false;
  }
}
