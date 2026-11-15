/**
 * Can this browser hold a CoinClash passkey wallet? (ADR 0020) Checked up front on the sign-up
 * screen, so people see "open in Chrome" instead of a failed passkey prompt.
 */
export type BrowserSupport = 'ok' | 'unknown' | 'in-app' | 'no-passkeys' | 'no-prf';

/** In-app browsers (Instagram, Facebook, Messenger, TikTok, Snapchat, Line, Google app, Android webviews). */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|Line\/|GSA\/|; wv\)/i;

export async function browserSupport(
  ua: string = navigator.userAgent,
  w: Window = window,
): Promise<BrowserSupport> {
  if (IN_APP.test(ua)) return 'in-app';
  const PKC = (w as Window & { PublicKeyCredential?: unknown }).PublicKeyCredential as
    { getClientCapabilities?: () => Promise<Record<string, boolean | undefined>> } | undefined;
  if (!w.isSecureContext || !PKC) return 'no-passkeys';
  if (!PKC.getClientCapabilities) return 'unknown';
  try {
    const caps = await PKC.getClientCapabilities();
    if (caps['extension:prf'] === false) return 'no-prf';
    return caps['extension:prf'] ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function supportAdvice(s: BrowserSupport): string | null {
  switch (s) {
    case 'in-app':
      return 'You’re in an app’s built-in browser, which can’t create passkeys. Open this page in Chrome (or Safari on iPhone).';
    case 'no-passkeys':
    case 'no-prf':
      return 'This browser can’t unlock a passkey wallet. Open CoinClash in Chrome on Android or a computer, or Safari on iPhone (iOS 18+).';
    default:
      return null;
  }
}
