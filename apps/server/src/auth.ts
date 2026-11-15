/**
 * Passwordless auth (spec §7): the client signs a server-issued nonce with its wallet; the server
 * verifies the signature and issues a short-lived HMAC session token. App identity = wallet pubkey.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { signedMessages, type SignatureVerifier } from '@coinclash/rail';
import type { LoginRequest } from '@coinclash/shared';
import type { UserDoc, UserRepo } from './db/repos.js';

export class AuthError extends Error {
  override readonly name = 'AuthError';
}

const NONCE_TTL_MS = 5 * 60_000;

export interface AuthDeps {
  readonly secret: string;
  readonly ttlSeconds: number;
  readonly verifier: SignatureVerifier;
  readonly users: UserRepo;
  readonly clock?: () => number;
}

export class Auth {
  /** Single-instance nonce store; fine for one server process (ADR 0004). */
  private readonly nonces = new Map<string, number>();
  private readonly clock: () => number;

  constructor(private readonly deps: AuthDeps) {
    this.clock = deps.clock ?? Date.now;
  }

  issueNonce(): string {
    const now = this.clock();
    for (const [n, exp] of this.nonces) if (exp <= now) this.nonces.delete(n);
    const nonce = randomBytes(24).toString('base64url');
    this.nonces.set(nonce, now + NONCE_TTL_MS);
    return nonce;
  }

  async login(req: LoginRequest): Promise<{ token: string; user: UserDoc }> {
    const exp = this.nonces.get(req.nonce);
    // Single use: delete before any await so a nonce can't be raced twice.
    this.nonces.delete(req.nonce);
    if (exp === undefined || exp <= this.clock()) throw new AuthError('Login expired, try again');
    if (req.signed.message !== signedMessages.login(req.nonce))
      throw new AuthError('Wrong message signed');
    if (!(await this.deps.verifier.verify(req.signed))) throw new AuthError('Invalid signature');

    const id = req.signed.pubkey;
    const existing = await this.deps.users.get(id);
    if (!existing && !req.nickname) throw new AuthError('Pick a nickname first');
    const now = this.clock();
    const user: UserDoc = {
      _id: id,
      nickname: req.nickname ?? existing!.nickname,
      sparkAddress: req.sparkAddress,
      createdAt: existing?.createdAt ?? now,
      lastLoginAt: now,
      bonusPaidAt: existing?.bonusPaidAt ?? null,
    };
    await this.deps.users.upsert(user);
    return { token: this.sign(id), user };
  }

  sign(userId: string): string {
    const payload = Buffer.from(
      JSON.stringify({ sub: userId, exp: this.clock() + this.deps.ttlSeconds * 1000 }),
    ).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** Returns the user id for a valid, unexpired token. */
  verifyToken(token: unknown): string {
    if (typeof token !== 'string') throw new AuthError('Not signed in');
    const [payload, mac] = token.split('.');
    if (!payload || !mac) throw new AuthError('Bad token');
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw new AuthError('Bad token');
    let parsed: { sub?: unknown; exp?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new AuthError('Bad token');
    }
    if (typeof parsed.sub !== 'string' || typeof parsed.exp !== 'number')
      throw new AuthError('Bad token');
    if (parsed.exp <= this.clock()) throw new AuthError('Session expired');
    return parsed.sub;
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.deps.secret).update(payload).digest('base64url');
  }
}
