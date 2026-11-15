import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_AGE_MS,
  alwaysAskPasskey,
  clearVault,
  loadFromVault,
  saveToVault,
  setAlwaysAskPasskey,
} from '../src/wallet/vault';

const seed = { type: 'entropy', 0: 1, 1: 2 };

describe('device vault (stay signed in)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearVault();
  });

  it('round-trips the seed for the same network within the time limit', async () => {
    await saveToVault(seed, 'regtest', 1_000);
    expect(await loadFromVault('regtest', 2_000)).toEqual({
      seed,
      network: 'regtest',
      savedAt: 1_000,
    });
    expect(await loadFromVault('mainnet', 2_000)).toBeNull(); // wrong network → wiped
    expect(await loadFromVault('regtest', 2_000)).toBeNull();
  });

  it('expires old entries', async () => {
    await saveToVault(seed, 'regtest', 0);
    expect(await loadFromVault('regtest', MAX_AGE_MS + 1)).toBeNull();
  });

  it('"ask every time" wipes the vault and stops saving', async () => {
    await saveToVault(seed, 'regtest', 1);
    await setAlwaysAskPasskey(true);
    expect(alwaysAskPasskey()).toBe(true);
    expect(await loadFromVault('regtest', 2)).toBeNull();
    await saveToVault(seed, 'regtest', 3);
    await setAlwaysAskPasskey(false);
    expect(await loadFromVault('regtest', 4)).toBeNull(); // nothing was saved while it was on
  });
});
