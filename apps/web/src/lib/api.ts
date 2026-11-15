/** HTTP client for the CoinClash server. Same origin (Vite proxies /api in dev; Caddy in prod). */
import type {
  ActivityItem,
  FriendStats,
  InvitePreview,
  LoginRequest,
  MatchView,
  PublicConfig,
} from '@coinclash/shared';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface SessionUser {
  readonly id: string;
  readonly nickname: string;
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const res = await fetch(path, { ...init, headers });
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  config: () => request<PublicConfig>('/api/config'),
  nonce: () => request<{ nonce: string }>('/api/auth/nonce', { method: 'POST' }),
  login: (body: LoginRequest) =>
    request<{ token: string; user: SessionUser; bonus?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: (token: string) => request<SessionUser>('/api/me', { token }),
  matches: (token: string) => request<MatchView[]>('/api/matches', { token }),
  friends: (token: string) =>
    request<FriendStats[]>(`/api/friends?tzOffset=${new Date().getTimezoneOffset()}`, { token }),
  invite: (code: string) => request<InvitePreview>(`/api/invites/${encodeURIComponent(code)}`),
  joinCode: (digits: string) =>
    request<{ inviteCode: string }>(`/api/join/${encodeURIComponent(digits)}`),
  activity: (token: string) => request<ActivityItem[]>('/api/activity', { token }),
};
