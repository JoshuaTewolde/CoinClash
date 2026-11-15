import { createHmac } from 'node:crypto';
import { signedMessages } from '@coinclash/rail';
import { MockNetwork, mockVerifier } from '@coinclash/rail/mock';
import { describe, expect, it } from 'vitest';
import { Auth } from '../src/auth.js';
import { MemoryUserRepo } from '../src/db/repos.js';

function setup() {
  let now = 1_000_000;
  const users = new MemoryUserRepo();
  const auth = new Auth({
    secret: 's'.repeat(40),
    ttlSeconds: 60,
    verifier: mockVerifier,
    users,
    clock: () => now,
  });
  const wallet = new MockNetwork().wallet('alice-pubkey');
  return { auth, users, wallet, advance: (ms: number) => (now += ms) };
}

describe('signed-nonce login', () => {
  it('logs in with a wallet signature over a fresh nonce and issues a token', async () => {
    const { auth, wallet } = setup();
    const nonce = auth.issueNonce();
    const signed = await wallet.signMessage(signedMessages.login(nonce));
    const { token, user } = await auth.login({
      nonce,
      signed,
      nickname: 'Alice',
      sparkAddress: 'sp1',
    });
    expect(user).toMatchObject({ _id: 'alice-pubkey', nickname: 'Alice', sparkAddress: 'sp1' });
    expect(auth.verifyToken(token)).toBe('alice-pubkey');
  });

  it('nonces are single-use and expire', async () => {
    const { auth, wallet, advance } = setup();
    const nonce = auth.issueNonce();
    const signed = await wallet.signMessage(signedMessages.login(nonce));
    await auth.login({ nonce, signed, nickname: 'Alice', sparkAddress: 'sp1' });
    await expect(auth.login({ nonce, signed, sparkAddress: 'sp1' })).rejects.toThrow(/expired/);
    const old = auth.issueNonce();
    advance(5 * 60_000 + 1);
    auth.issueNonce(); // prunes
    const s2 = await wallet.signMessage(signedMessages.login(old));
    await expect(auth.login({ nonce: old, signed: s2, sparkAddress: 'sp1' })).rejects.toThrow(
      /expired/,
    );
  });

  it('rejects wrong messages, bad signatures and missing nicknames', async () => {
    const { auth, wallet } = setup();
    let nonce = auth.issueNonce();
    await expect(
      auth.login({
        nonce,
        signed: await wallet.signMessage('hello'),
        nickname: 'A1',
        sparkAddress: 's',
      }),
    ).rejects.toThrow(/Wrong message/);
    nonce = auth.issueNonce();
    await expect(
      auth.login({
        nonce,
        signed: {
          message: signedMessages.login(nonce),
          pubkey: 'alice-pubkey',
          signature: 'forged',
        },
        nickname: 'A1',
        sparkAddress: 's',
      }),
    ).rejects.toThrow(/Invalid signature/);
    nonce = auth.issueNonce();
    await expect(
      auth.login({
        nonce,
        signed: await wallet.signMessage(signedMessages.login(nonce)),
        sparkAddress: 's',
      }),
    ).rejects.toThrow(/nickname/);
  });

  it('returning users keep their nickname and history', async () => {
    const { auth, wallet, users } = setup();
    let nonce = auth.issueNonce();
    await auth.login({
      nonce,
      signed: await wallet.signMessage(signedMessages.login(nonce)),
      nickname: 'Alice',
      sparkAddress: 's1',
    });
    nonce = auth.issueNonce();
    const { user } = await auth.login({
      nonce,
      signed: await wallet.signMessage(signedMessages.login(nonce)),
      sparkAddress: 's2',
    });
    expect(user.nickname).toBe('Alice');
    expect((await users.get('alice-pubkey'))?.sparkAddress).toBe('s2');
  });

  it('rejects tampered, malformed and expired tokens', () => {
    const { auth, advance } = setup();
    const token = auth.sign('alice');
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'mallory', exp: 9e15 })).toString('base64url');
    expect(() => auth.verifyToken(`${forged}.${mac}`)).toThrow(/Bad token/);
    expect(() => auth.verifyToken(`${payload}.x`)).toThrow(/Bad token/);
    expect(() => auth.verifyToken('nodot')).toThrow(/Bad token/);
    expect(() => auth.verifyToken(undefined)).toThrow(/Not signed in/);
    // Correctly MACed but malformed payloads.
    const macOf = (p: string) => createHmac('sha256', 's'.repeat(40)).update(p).digest('base64url');
    const junk = Buffer.from('not json').toString('base64url');
    expect(() => auth.verifyToken(`${junk}.${macOf(junk)}`)).toThrow(/Bad token/);
    const noSub = Buffer.from(JSON.stringify({ exp: 9e15 })).toString('base64url');
    expect(() => auth.verifyToken(`${noSub}.${macOf(noSub)}`)).toThrow(/Bad token/);
    advance(61_000);
    expect(() => auth.verifyToken(token)).toThrow(/expired/);
  });
});
