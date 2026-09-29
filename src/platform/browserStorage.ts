/** Version 1 uses a single key/value store. Add future migrations by oldVersion. */
export function browserStorage(onFailure: () => void) {
  const memory = new Map<string, unknown>();
  let failed = false;
  let database: Promise<IDBDatabase> | undefined;
  const fallback = () => {
    if (!failed) onFailure();
    failed = true;
  };
  function open() {
    return database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('matcap-maker', 1);
      request.onupgradeneeded = (event) => {
        if (event.oldVersion < 1) request.result.createObjectStore('kv');
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Storage upgrade blocked'));
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); fallback(); };
        resolve(request.result);
      };
    });
  }
  return {
    async get<T>(key: string): Promise<T | undefined> {
      if (!failed) {
        try {
          const db = await open();
          const value = await new Promise<T | undefined>((resolve, reject) => {
            const tx = db.transaction('kv');
            const request = tx.objectStore('kv').get(key);
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () => reject(tx.error);
            tx.onerror = () => reject(tx.error);
          });
          if (value !== undefined) memory.set(key, value);
          return value;
        } catch { fallback(); }
      }
      return memory.get(key) as T | undefined;
    },
    async setMany(entries: [string, unknown][]) {
      for (const [key, value] of entries) {
        if (value === undefined) memory.delete(key);
        else memory.set(key, value);
      }
      if (failed) return;
      try {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('kv', 'readwrite');
          for (const [key, value] of entries) {
            if (value === undefined) tx.objectStore('kv').delete(key);
            else tx.objectStore('kv').put(value, key);
          }
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
          tx.onerror = () => reject(tx.error);
        });
      } catch { fallback(); }
    },
  };
}
