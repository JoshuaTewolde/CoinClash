import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button, ErrorText, Loading, Logo, BottomNav } from './design/components';
import { Store } from './lib/store';
import { StoreProvider, useSnapshot, useStoreApi } from './lib/StoreContext';
import { Friend } from './screens/Friend';
import { Home } from './screens/Home';
import { Invite } from './screens/Invite';
import { Match } from './screens/match/Match';
import { NewChallenge } from './screens/NewChallenge';
import { Onboarding } from './screens/Onboarding';
import { Settings } from './screens/Settings';
import { Wallet } from './screens/Wallet';
import './design/ui.css';

const TABS = new Set(['/', '/wallet', '/settings']);

function Shell() {
  const { phase, error, toast } = useSnapshot();
  const store = useStoreApi();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  let body;
  if (pathname.startsWith('/i/')) {
    body = (
      <Routes>
        <Route path="/i/:code" element={<Invite />} />
      </Routes>
    );
  } else if (phase === 'loading') {
    body = <Loading />;
  } else if (phase === 'error') {
    body = (
      <main className="screen">
        <Logo />
        <ErrorText>{error ?? 'Could not reach CoinClash.'}</ErrorText>
        <Button variant="accent" onClick={() => void store.init()}>
          Try again
        </Button>
      </main>
    );
  } else if (phase === 'signedOut') {
    body = <Onboarding />;
  } else {
    body = (
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/new" element={<NewChallenge />} />
        <Route path="/m/:id" element={<Match />} />
        <Route path="/wallet" element={<Wallet />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/friends/:id" element={<Friend />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      {body}
      {phase === 'ready' && TABS.has(pathname) && <BottomNav />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

export function App({ store: given }: { store?: Store }) {
  const [store] = useState(() => given ?? new Store());
  useEffect(() => {
    if (!given) void store.init();
  }, [store, given]);
  return (
    <StoreProvider store={store}>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </StoreProvider>
  );
}
