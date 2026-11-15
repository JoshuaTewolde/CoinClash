/**
 * Web Push notifications (VAPID). Used for direct challenges and rematch offers so a friend
 * hears about it even with the app closed. Subscriptions live in the `push` collection; dead ones
 * (404/410 from the push service) are dropped automatically.
 */
import webpush from 'web-push';
import type { PushRepo } from './db/repos.js';

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  /** In-app path to open on tap, e.g. `/m/<id>`. */
  readonly url: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  readonly tag?: string;
}

export interface Notifier {
  notify(userId: string, msg: PushMessage): Promise<void>;
}

export const noopNotifier: Notifier = { notify: async () => undefined };

export interface WebPushOptions {
  readonly repo: PushRepo;
  readonly publicKey: string;
  readonly privateKey: string;
  /** `mailto:` or https URL identifying the sender to push services. */
  readonly subject: string;
  /** Injectable for tests. */
  readonly send?: typeof webpush.sendNotification;
}

export function webPushNotifier(opts: WebPushOptions): Notifier {
  const send = opts.send ?? webpush.sendNotification.bind(webpush);
  const vapidDetails = {
    subject: opts.subject,
    publicKey: opts.publicKey,
    privateKey: opts.privateKey,
  };
  return {
    async notify(userId, msg) {
      for (const sub of await opts.repo.listFor(userId)) {
        try {
          await send(sub, JSON.stringify(msg), { vapidDetails, TTL: 3600, urgency: 'high' });
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await opts.repo.remove(sub.endpoint);
          else console.warn('[push] send failed', code ?? err);
        }
      }
    },
  };
}
