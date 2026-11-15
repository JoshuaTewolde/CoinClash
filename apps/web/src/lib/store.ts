/**
 * App store: session, wallet, socket, match cache. One instance per tab, read by React through
 * `useStore` (useSyncExternalStore). The server is the source of truth: this only caches the
 * latest `MatchView` per match and sends intents.
 */
import { signedMessages } from '@coinclash/rail';
import type {
  Ack,
  CodeRelease,
  FriendStats,
  MatchView,
  Network,
  PublicConfig,
} from '@coinclash/shared';
import { io, type Socket } from 'socket.io-client';
import { MatchAgent } from '../match/agent';
import { mockIdentity } from '../wallet/mockWallet';
import type { AppWallet, IdentityProvider } from '../wallet/types';
import { api, ApiError, type SessionUser } from './api';

export type Phase = 'loading' | 'signedOut' | 'ready' | 'error';

export interface Snapshot {
  readonly phase: Phase;
  readonly error: string | null;
  readonly config: PublicConfig | null;
  readonly user: SessionUser | null;
  readonly balance: number | null;
  readonly matches: Readonly<Record<string, MatchView>>;
  readonly friends: readonly FriendStats[];
  readonly connected: boolean;
  /** The player's network pick (ADR 0010). */
  readonly network: Network;
  readonly toast: string | null;
  /** Nickname of the last account on this device, for the "Welcome back · Unlock" screen. */
  readonly returning: string | null;
  /** True when this network can't reach a Spark operator (see lib/reachability.ts). */
  readonly networkBlocked: boolean;
}

const SESSION_KEY = 'cc.session';
const NETWORK_KEY = 'cc.network';

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: session lasts for this tab */
  }
}

async function identityFor(network: Network): Promise<IdentityProvider> {
  if (network === 'mock') return mockIdentity;
  // Loaded on demand: keeps the Breez WASM out of the first paint and out of unit tests.
  const { passkeyIdentity } = await import('../wallet/breezWallet');
  const env = import.meta.env;
  return passkeyIdentity({
    network,
    apiKey: env.VITE_BREEZ_API_KEY ?? '',
    rpId: env.VITE_PASSKEY_RP_ID || window.location.hostname,
    rpName: env.VITE_PASSKEY_RP_NAME || 'CoinClash',
  });
}

export class Store {
  private snap: Snapshot = {
    phase: 'loading',
    error: null,
    config: null,
    user: null,
    balance: null,
    matches: {},
    friends: [],
    connected: false,
    network: load<Network>(NETWORK_KEY) ?? 'regtest',
    toast: null,
    returning: null,
    networkBlocked: false,
  };
  private readonly listeners = new Set<() => void>();
  private token: string | null = null;
  private socket: Socket | null = null;
  private wallet: AppWallet | null = null;
  private agent: MatchAgent | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private unwatchWallet: (() => void) | null = null;
  private identityCache: { network: Network; provider: Promise<IdentityProvider> } | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  /** The wallet backend for the picked network (mock in tests/dev, Breez passkeys otherwise). */
  private identity(): Promise<IdentityProvider> {
    const network = this.snap.network;
    if (this.identityCache?.network !== network) {
      this.identityCache = { network, provider: identityFor(network) };
    }
    return this.identityCache.provider;
  }

  // ---------- lifecycle ----------

  async init(): Promise<void> {
    try {
      const config = await api.config();
      const picked = config.networks.includes(this.snap.network)
        ? this.snap.network
        : config.network;
      this.set({ config, network: picked });
      if (picked !== 'mock') void this.checkReachability();
      const saved = load<{ token: string; user: SessionUser }>(SESSION_KEY);
      const wallet = await (await this.identity()).restore();
      if (!wallet) return this.set({ phase: 'signedOut', returning: saved?.user.nickname ?? null });
      if (saved && saved.user.id === (await wallet.identity())) {
        try {
          await api.me(saved.token);
          return await this.start(wallet, saved.token, saved.user);
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 401) throw err;
        }
      }
      await this.login(wallet); // token expired: sign a fresh nonce
    } catch (err) {
      this.set({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** "Create account": new wallet + nickname. */
  async register(nickname: string): Promise<void> {
    const wallet = await (await this.identity()).register();
    await this.login(wallet, nickname);
  }

  /**
   * "Sign in": unlock this player's existing wallet. `nickname` is only needed if the server
   * has never seen this wallet (e.g. it signed up against another server).
   */
  async signIn(nickname?: string): Promise<void> {
    const wallet = await (await this.identity()).signIn();
    await this.login(wallet, nickname || undefined);
  }

  signOut(): void {
    this.stop();
    save(SESSION_KEY, null);
    void this.identity().then((i) => i.forget());
    void this.wallet?.disconnect?.();
    this.token = null;
    this.wallet = null;
    this.set({
      phase: 'signedOut',
      user: null,
      balance: null,
      matches: {},
      friends: [],
      returning: null,
    });
  }

  private async login(wallet: AppWallet, nickname?: string): Promise<void> {
    const { nonce } = await api.nonce();
    const signed = await wallet.signMessage(signedMessages.login(nonce));
    const { token, user, bonus } = await api.login({
      nonce,
      signed,
      nickname,
      sparkAddress: await wallet.sparkAddress(),
    });
    await this.start(wallet, token, user);
    if (bonus === 'sending') {
      const amount = (this.snap.config?.welcomeBonusSats ?? 10_000).toLocaleString('en-US');
      this.toast(`Welcome! ${amount} sats are on their way to your wallet.`);
    }
  }

  private async start(wallet: AppWallet, token: string, user: SessionUser): Promise<void> {
    this.stop();
    this.wallet = wallet;
    this.token = token;
    save(SESSION_KEY, { token, user });
    this.agent = new MatchAgent({
      wallet,
      send: (e, p) => this.emit(e, p),
      memory: typeof localStorage === 'undefined' ? undefined : localStorage,
      onError: (err) => console.warn('[coinclash] agent', err),
    });

    const socket = io({ auth: { token }, transports: ['websocket'] });
    this.socket = socket;
    socket.on('connect', () => {
      this.set({ connected: true });
      void this.refreshMatches();
    });
    socket.on('disconnect', () => this.set({ connected: false }));
    socket.on('connect_error', (err) => {
      if (/expired|token|signed in/i.test(err.message)) void this.login(wallet).catch(() => {});
    });
    socket.on('match:update', (v: MatchView) => this.upsert(v, true));
    socket.on('match:code', (c: CodeRelease) => {
      void this.agent?.onCode(c).then(() => this.refreshBalance());
    });

    this.unwatchWallet = wallet.onChange?.(() => void this.refreshBalance()) ?? null;
    this.poll = setInterval(() => this.tick(), 1500);
    this.set({ phase: 'ready', user, error: null });
    await Promise.all([this.refreshBalance(), this.refreshFriends()]);
  }

  private stop(): void {
    this.unwatchWallet?.();
    this.unwatchWallet = null;
    this.socket?.close();
    this.socket = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  private tick(): void {
    for (const v of Object.values(this.snap.matches)) {
      if (v.status === 'AWAITING_LOCKS') void this.agent?.sync(v);
    }
  }

  // ---------- data ----------

  private upsert(v: MatchView, live = false): void {
    const prev = this.snap.matches[v.id];
    this.set({ matches: { ...this.snap.matches, [v.id]: v } });
    // A brand-new challenge (or rematch) addressed to me, pushed live: tell me wherever I am.
    if (live && !prev && v.status === 'NEGOTIATING' && v.respondent === this.snap.user?.id) {
      const game = this.snap.config?.games.find((g) => g.id === v.gameId)?.name ?? 'a game';
      const verb = v.rematchOf ? 'wants a rematch of' : 'challenged you to';
      this.toast(`${v.challenger.nickname} ${verb} ${game}`);
    }
    if (v.status === 'AWAITING_LOCKS') void this.agent?.sync(v);
    if (prev && prev.status !== v.status) {
      void this.refreshBalance();
      if (v.status === 'SETTLING' || v.status === 'SETTLED') void this.refreshFriends();
    }
  }

  async refreshMatches(): Promise<void> {
    if (!this.token) return;
    const list = await api.matches(this.token);
    const matches = { ...this.snap.matches };
    for (const v of list) matches[v.id] = v;
    this.set({ matches });
    for (const v of list) if (v.status === 'AWAITING_LOCKS') void this.agent?.sync(v);
  }

  async refreshBalance(): Promise<void> {
    if (!this.wallet) return;
    try {
      this.set({ balance: await this.wallet.getBalance() });
    } catch (err) {
      console.warn('[coinclash] balance', err);
    }
  }

  async refreshFriends(): Promise<void> {
    if (!this.token) return;
    try {
      this.set({ friends: await api.friends(this.token) });
    } catch (err) {
      console.warn('[coinclash] friends', err);
    }
  }

  walletHistory() {
    return this.wallet?.history() ?? Promise.resolve([]);
  }

  async faucet(): Promise<void> {
    await this.wallet?.faucet?.();
    await this.refreshBalance();
  }

  get hasFaucet(): boolean {
    return Boolean(this.wallet?.faucet);
  }

  get hasDepositAddress(): boolean {
    return Boolean(this.wallet?.depositAddress);
  }

  get canSend(): boolean {
    return Boolean(this.wallet?.send);
  }

  async depositAddress(): Promise<string> {
    return (await this.wallet?.depositAddress?.()) ?? '';
  }

  async sendSats(destination: string, amount: number): Promise<void> {
    if (!this.wallet?.send) throw new Error('Sending isn’t available');
    await this.wallet.send(destination, amount);
    await this.refreshBalance();
  }

  async walletAddress(): Promise<string> {
    return (await this.wallet?.sparkAddress()) ?? '';
  }

  // ---------- intents ----------

  private async emit<T = MatchView>(event: string, payload: unknown): Promise<T> {
    const socket = this.socket;
    if (!socket) throw new Error('Not connected');
    const ack = (await socket.timeout(10_000).emitWithAck(event, payload)) as Ack<T>;
    if (!ack.ok) throw new Error(ack.error);
    return ack.data;
  }

  /** Send a match command; the returned view is cached immediately. */
  async send(event: string, payload: unknown): Promise<MatchView> {
    const v = await this.emit<MatchView>(event, payload);
    this.upsert(v);
    return v;
  }

  /** Escrow mode: pay my stake into escrow (one tap). */
  async payStake(view: MatchView): Promise<void> {
    if (!this.agent) throw new Error('Not signed in');
    await this.agent.payDeposit(view);
    await this.refreshBalance();
  }

  /** HTLC mode (dormant). */
  async lock(view: MatchView): Promise<void> {
    if (!this.agent) throw new Error('Not signed in');
    await this.agent.lock(view);
    await this.refreshBalance();
    void this.agent.sync(view);
  }

  hasLocked(matchId: string): boolean {
    return this.agent?.hasLocked(matchId) ?? false;
  }

  async checkReachability(): Promise<void> {
    const { unreachableSparkHosts } = await import('./reachability');
    const blocked = await unreachableSparkHosts();
    if (blocked.length) console.warn('[coinclash] unreachable Spark hosts', blocked);
    this.set({ networkBlocked: blocked.length > 0 });
  }

  dismissNetworkWarning(): void {
    this.set({ networkBlocked: false });
  }

  setNetwork(network: Network): void {
    if (!this.snap.config?.networks.includes(network)) return;
    save(NETWORK_KEY, network);
    this.set({ network });
  }

  toast(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: message });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), 3500);
  }
}
