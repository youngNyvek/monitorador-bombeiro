const DB_NAME = 'monitorador-bombeiro';
const DB_VERSION = 1;
const STORE_NAME = 'crops';

type CropRecord = {
  id: string;
  blob: Blob;
  createdAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

export function isIndexedDbSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function saveCropBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  await runRequest(db, STORE_NAME, 'readwrite', (store) => {
    const record: CropRecord = { id, blob, createdAt: Date.now() };
    store.put(record);
  });
}

export async function getCropBlob(id: string): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise<Blob | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const result = request.result as CropRecord | undefined;
      resolve(result?.blob ?? null);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('indexeddb-read-failed'));
    };
  });
}

export async function deleteCropBlob(id: string): Promise<void> {
  const db = await openDatabase();
  await runRequest(db, STORE_NAME, 'readwrite', (store) => {
    store.delete(id);
  });
}

export async function clearCropBlobs(): Promise<void> {
  const db = await openDatabase();
  await runRequest(db, STORE_NAME, 'readwrite', (store) => {
    store.clear();
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  if (!isIndexedDbSupported()) {
    throw new Error('indexeddb-unsupported');
  }

  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(request.error ?? new Error('indexeddb-open-failed'));
      };
    });
  }

  try {
    return await dbPromise;
  } catch (error) {
    dbPromise = null;
    throw error;
  }
}

function runRequest(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb-transaction-failed'));

    try {
      executor(store);
    } catch (error) {
      reject(error instanceof Error ? error : new Error('indexeddb-executor-failed'));
    }
  });
}
