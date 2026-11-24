export interface KeyPolicy {
  sensitive?: boolean;
  revision?: string;
}

/** Compare the revision inside the write transaction so a stale dialog cannot edit a replacement key. */
export async function editStoredKey(
  db: IDBDatabase,
  id: string,
  revision: string | undefined,
  sensitive: boolean | 'remove',
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      const request = store.get(id);
      request.onsuccess = () => {
        const value = request.result as KeyPolicy | undefined;
        if (!value || value.revision !== revision) tx.abort();
        else if (sensitive === 'remove') store.delete(id);
        else store.put({ ...value, sensitive, revision: crypto.randomUUID() }, id);
      };
      tx.oncomplete = () => {
        resolve();
      };
      tx.onabort = () => {
        reject(new Error('Key changed or storage failed. Reopen the key manager and try again.'));
      };
    });
  } finally {
    db.close();
  }
}
