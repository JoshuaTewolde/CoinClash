import { describe, expect, it } from 'vitest';
import { browserSupport, supportAdvice } from '../src/lib/browserSupport';

const CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const win = (pkc: unknown, secure = true) =>
  ({ isSecureContext: secure, PublicKeyCredential: pkc }) as unknown as Window;
const caps = (c: Record<string, boolean>) => ({ getClientCapabilities: async () => c });

describe('browserSupport', () => {
  it('flags in-app browsers', async () => {
    expect(await browserSupport(`${CHROME} Instagram 300.0`, win(caps({})))).toBe('in-app');
    expect(await browserSupport('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit', win({}))).toBe(
      'in-app',
    );
  });

  it('needs passkeys in a secure context', async () => {
    expect(await browserSupport(CHROME, win(undefined))).toBe('no-passkeys');
    expect(await browserSupport(CHROME, win(caps({}), false))).toBe('no-passkeys');
  });

  it('reads PRF support from client capabilities when available', async () => {
    expect(await browserSupport(CHROME, win(caps({ 'extension:prf': true })))).toBe('ok');
    expect(await browserSupport(CHROME, win(caps({ 'extension:prf': false })))).toBe('no-prf');
    expect(await browserSupport(CHROME, win(caps({})))).toBe('unknown');
    expect(await browserSupport(CHROME, win({}))).toBe('unknown');
    const throws = { getClientCapabilities: () => Promise.reject(new Error('x')) };
    expect(await browserSupport(CHROME, win(throws))).toBe('unknown');
  });

  it('gives advice only when something is wrong', () => {
    expect(supportAdvice('ok')).toBeNull();
    expect(supportAdvice('unknown')).toBeNull();
    expect(supportAdvice('in-app')).toMatch(/built-in browser/);
    expect(supportAdvice('no-prf')).toMatch(/Chrome/);
  });
});
