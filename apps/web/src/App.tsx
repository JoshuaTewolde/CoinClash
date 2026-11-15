import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Button, ErrorText, Loading, Logo, BottomNav } from './design/components';
import { Store } from './lib/store';
import { StoreProvider, useSnapshot, useStoreApi } from './lib/StoreContext';
import { Friend } from './screens/Friend';
import { Home } from './screens/Home';
import { Invite } from './screens/Invite';
import { JoinCode } from './screens/JoinCode';
import { Match } from './screens/match/Match';
import { NewChallenge } from './screens/NewChallenge';
import { Onboarding } from './screens/Onboarding';
import { Practice } from './screens/Practice';
import { Escrow } from './screens/Escrow';
import { Settings } from './screens/Settings';
import { Wallet } from './screens/Wallet';
import './design/ui.css';

const TABS = new Set(['/', '/wallet', '/settings']);

function Shell() {
  const { phase, error, toast, networkBlocked } = useSnapshot();
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
  } else if (pathname === '/escrow') {
    body = <Escrow />;
  } else if (pathname.startsWith('/practice')) {
    // Practice needs no account or wallet (ADR 0017).
    body = (
      <Routes>
        <Route path="/practice" element={<Practice />} />
        <Route path="/practice/:gameId" element={<Practice />} />
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
        <Route path="/join" element={<JoinCode />} />
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
      {networkBlocked && (
        <div className="net-banner" role="alert">
          <span>
            <strong>Your network is blocking a payment server.</strong> Switch to mobile data, use a
            VPN, or set your DNS to 1.1.1.1, then reload.
          </span>
          <button
            type="button"
            className="btn btn--icon"
            aria-label="Dismiss"
            onClick={() => store.dismissNetworkWarning()}
          >
            ✕
          </button>
        </div>
      )}
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
