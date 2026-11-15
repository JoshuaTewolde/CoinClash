/**
 * Device vault: "stay signed in" without a passkey tap on every open (ADR 0015).
 *
 * After a passkey unlock, the wallet seed is encrypted with an AES-GCM key that is generated in
 * this browser as **non-extractable** and kept in IndexedDB. The raw key bytes can never be read
 * back, even by our own code, so a copied disk image or synced storage doesn't reveal the seed.
 * Code running on this origin can still *use* the key, which is the same trust the open app has.
 *
 * Off switch: Settings → "Ask for my passkey every time" wipes the vault and stops saving.
 * Signing out wipes it too. Entries expire after `MAX_AGE_MS`.
 */
const DB = 'coinclash-vault';
const STORE = 'kv';
const KEY_ID = 'aes-key';
const ENTRY_ID = 'wallet';
const PREF = 'cc.alwaysAskPasskey';
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export interface VaultEntry<Seed> {
  readonly seed: Seed;
  readonly network: string;
  readonly savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function aesKey(): Promise<CryptoKey> {
  const existing = await tx<CryptoKey | undefined>('readonly', (s) => s.get(KEY_ID));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await tx('readwrite', (s) => s.put(key, KEY_ID));
  return key;
}

/** True when the player chose to unlock with a passkey on every open. */
export function alwaysAskPasskey(): boolean {
  try {
    return localStorage.getItem(PREF) === '1';
  } catch {
    return true; // storage blocked: don't try to persist anything
  }
}

export async function setAlwaysAskPasskey(on: boolean): Promise<void> {
  try {
    if (on) localStorage.setItem(PREF, '1');
    else localStorage.removeItem(PREF);
  } catch {
    /* ignore */
  }
  if (on) await clearVault();
}

export async function saveToVault<Seed>(
  seed: Seed,
  network: string,
  now = Date.now(),
): Promise<void> {
  if (alwaysAskPasskey() || typeof indexedDB === 'undefined') return;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ seed, network, savedAt: now }));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), plain);
    await tx('readwrite', (s) => s.put({ iv, data }, ENTRY_ID));
  } catch (err) {
    console.warn('[coinclash] could not remember this device', err);
  }
}

export async function loadFromVault<Seed>(
  network: string,
  now = Date.now(),
): Promise<VaultEntry<Seed> | null> {
  if (alwaysAskPasskey() || typeof indexedDB === 'undefined') return null;
  try {
    const box = await tx<{ iv: Uint8Array; data: ArrayBuffer } | undefined>('readonly', (s) =>
      s.get(ENTRY_ID),
    );
    if (!box) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: box.iv },
      await aesKey(),
      box.data,
    );
    const entry = JSON.parse(new TextDecoder().decode(plain)) as VaultEntry<Seed>;
    if (entry.network !== network || now - entry.savedAt > MAX_AGE_MS) {
      await clearVault();
      return null;
    }
    return entry;
  } catch {
    await clearVault().catch(() => undefined);
    return null;
  }
}

export async function clearVault(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    await tx('readwrite', (s) => s.delete(ENTRY_ID));
  } catch {
    /* ignore */
  }
}
