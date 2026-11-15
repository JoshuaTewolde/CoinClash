import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Snapshot, Store } from './store';

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ store, children }: { store: Store; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStoreApi(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('StoreProvider missing');
  return store;
}

export function useSnapshot(): Snapshot {
  const store = useStoreApi();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
