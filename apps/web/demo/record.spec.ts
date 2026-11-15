/**
 * Records the demo clips (docs/demo-script.md): two phones (Android left, iPhone right) playing
 * through every feature. Writes raw videos plus <run>.json (start/end seconds per clip) to DEMO_OUT.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

const OUT = process.env.DEMO_OUT ?? 'demo-out';
const SCALE = 1; // Playwright records at CSS size; larger sizes just pad the frame.

type Device = (typeof devices)[string];
const noBrowser = (d: Device): Device => {
  const { defaultBrowserType: _ignored, ...rest } = d;
  return rest as Device;
};
const pixel = devices['Pixel 7']!;
const android: Device = { ...pixel, userAgent: pixel.userAgent.replace('Pixel 7', 'Pixel 10') };
const androidLandscape: Device = {
  ...devices['Pixel 7 landscape']!,
  userAgent: android.userAgent,
};
const iphone = noBrowser(devices['iPhone 15 Pro']!);
const iphoneLandscape = noBrowser(devices['iPhone 15 Pro landscape']!);

async function phone(browser: Browser, d: Device, dir: string): Promise<Page> {
  const { width, height } = d.viewport;
  // SHOTS=1: sharp stills for the gallery (3x), no video.
  const ctx = await browser.newContext(
    SHOTS
      ? { ...d, deviceScaleFactor: 3 }
      : {
          ...d,
          deviceScaleFactor: SCALE,
          recordVideo: { dir, size: { width: width * SCALE, height: height * SCALE } },
        },
  );
  // Mock servers have no fiat rate; show a realistic one for the stake picker.
  await ctx.route('**/api/rate', (r) => r.fulfill({ json: { usd: 64_600 } }));
  return ctx.newPage();
}

function clips(run: string) {
  const t0 = Date.now();
  const list: { name: string; start: number; end: number }[] = [];
  let open: { name: string; start: number } | null = null;
  const now = () => (Date.now() - t0) / 1000;
  const end = () => {
    if (open) list.push({ ...open, end: now() });
    open = null;
  };
  return {
    start(name: string) {
      end();
      open = { name, start: now() };
    },
    async save(a: Page, b: Page) {
      end();
      writeFileSync(join(OUT, `${run}.json`), JSON.stringify(list, null, 2));
      await a.context().close();
      await b.context().close();
      if (SHOTS) return;
      const [va, vb] = await Promise.all([a.video()!.path(), b.video()!.path()]);
      writeFileSync(join(OUT, `${run}.videos.json`), JSON.stringify({ a: va, b: vb }));
    },
  };
}

const SHOTS = Boolean(process.env.SHOTS);

/** Gallery stills (SHOTS=1 only): one PNG per phone. */
async function snap(name: string, a: Page, b?: Page) {
  if (!SHOTS) return;
  mkdirSync(join(OUT, 'shots'), { recursive: true });
  await a.screenshot({ path: join(OUT, 'shots', `${name}-a.png`) });
  if (b) await b.screenshot({ path: join(OUT, 'shots', `${name}-b.png`) });
}

const pause = (p: Page, ms = 1200) => p.waitForTimeout(ms);
const resultHeading = (p: Page) => p.getByRole('heading', { name: /^(You won!|.+ won|Draw)$/ });

async function signUp(p: Page, nickname: string) {
  await p.goto('/');
  await p.getByLabel('Nickname').fill(nickname);
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByLabel('Your wallet')).toContainText('10,000 sats');
}

async function whoseTurn(players: Page[]): Promise<Page | null> {
  for (let i = 0; i < 80; i++) {
    for (const p of players) {
      if (await resultHeading(p).isVisible()) return null;
      if (await p.getByText('Your turn', { exact: true }).isVisible()) return p;
    }
    await players[0]!.waitForTimeout(250);
  }
  return null;
}

async function drop(players: Page[], column: number): Promise<boolean> {
  const p = await whoseTurn(players);
  if (!p) return false;
  await pause(p, 450);
  await p.getByRole('button', { name: `Drop in column ${column}` }).click();
  await pause(p, 600);
  return true;
}

async function playCell(players: Page[], cells: number[]): Promise<boolean> {
  const p = await whoseTurn(players);
  if (!p) return false;
  await pause(p, 600);
  for (const cell of cells) {
    const target = p.getByRole('gridcell', {
      name: `Row ${Math.floor(cell / 3) + 1}, column ${(cell % 3) + 1}: empty`,
    });
    if (await target.isEnabled().catch(() => false)) {
      await target.click();
      await pause(p, 500);
      return true;
    }
  }
  return false;
}

async function goHome(p: Page) {
  await p.goto('/');
  await expect(p.getByLabel('Your wallet')).toBeVisible();
}

/** Direct challenge from `from` to friend `toName`; `to` opens it from "Waiting on you". */
async function challenge(from: Page, to: Page, toName: string, game: RegExp, stake: string) {
  await from.getByRole('link', { name: /New challenge/ }).click();
  await pause(from, 500);
  await from.getByRole('radio', { name: toName }).click();
  await from.getByRole('button', { name: game }).click();
  const input = from.getByLabel('Stake in sats');
  await input.fill('');
  await input.pressSequentially(stake, { delay: 120 });
  await pause(from, 700);
  await from.getByRole('button', { name: `Challenge ${toName}` }).click();
  const waiting = to.getByRole('region', { name: 'Waiting on you' });
  await expect(waiting).toBeVisible();
  await pause(to, 1500);
  await waiting.getByRole('link').first().click();
}

async function payBoth(a: Page, b: Page, stake: string) {
  await expect(a.getByRole('button', { name: `Pay ${stake} from wallet` })).toBeVisible();
  await pause(a, 1000);
  await a.getByRole('button', { name: `Pay ${stake} from wallet` }).click();
  await pause(b, 600);
  await b.getByRole('button', { name: `Pay ${stake} from wallet` }).click();
}

test('story', async ({ browser }) => {
  const dir = join(OUT, 'story');
  mkdirSync(dir, { recursive: true });
  const maya = await phone(browser, android, dir);
  const theo = await phone(browser, iphone, dir);
  const c = clips('story');

  if (SHOTS) {
    await maya.goto('/');
    await theo.goto('/practice');
    await pause(maya, 800);
    await snap('signup', maya, theo);
  }
  await Promise.all([signUp(maya, 'Maya'), signUp(theo, 'Theo')]);

  // New challenge with the dollar hint.
  c.start('02-new-challenge');
  await pause(maya);
  await maya.getByRole('link', { name: /New challenge/ }).click();
  await pause(maya, 900);
  await maya.getByRole('button', { name: 'Connect 4' }).click();
  await pause(maya, 700);
  const stake = maya.getByLabel('Stake in sats');
  await stake.fill('');
  await stake.pressSequentially('1000', { delay: 250 });
  await pause(maya, 1500);
  await snap('stake', maya, theo);
  await maya.getByRole('button', { name: 'Create challenge' }).click();

  // Invite screen: QR + 6-digit code; Theo joins by typing the code.
  c.start('03-invite-join');
  await expect(maya.getByTestId('join-code')).toBeVisible();
  const code = ((await maya.getByTestId('join-code').textContent()) ?? '').replace(/\D/g, '');
  await pause(maya, 1500);
  await theo.getByRole('link', { name: 'Join with code' }).click();
  await theo.getByLabel(/6-digit code/).pressSequentially(code, { delay: 180 });
  await theo.getByRole('button', { name: 'Find challenge' }).click();
  await expect(theo.getByRole('button', { name: 'Accept 1,000' })).toBeVisible();
  await pause(theo, 1200);
  await snap('invite', maya, theo);

  // Negotiate: Theo counters 500, Maya takes the lower.
  c.start('05-negotiate');
  await theo.getByRole('button', { name: 'Counter' }).click();
  const counter = theo.getByLabel('Counter in sats');
  await counter.fill('');
  await counter.pressSequentially('500', { delay: 200 });
  await pause(theo, 600);
  await theo.getByRole('button', { name: 'Send counter' }).click();
  await expect(maya.getByText('Lower of the last two is 500')).toBeVisible();
  await pause(maya, 1500);
  await snap('negotiate', maya, theo);
  await maya.getByRole('button', { name: 'Take the lower' }).click();

  // Pay into escrow; the board appears on both.
  c.start('06-pay-stake');
  if (SHOTS) {
    await maya.getByRole('button', { name: 'Pay 500 from wallet' }).click();
    await pause(maya, 1500);
    await snap('pay', maya, theo);
    await theo.getByRole('button', { name: 'Pay 500 from wallet' }).click();
  } else await payBoth(maya, theo, '500');
  await expect(theo.getByRole('grid', { name: 'Connect 4 board' })).toBeVisible();
  await pause(theo, 1500);

  // Connect 4, turn by turn: the first mover builds column 4, the other plays beside it.
  c.start('07-connect4');
  const cols = [4, 3, 4, 3, 4, 2, 4, 2, 5, 1, 6, 1, 7, 7, 5];
  for (const [i, col] of cols.entries()) {
    if (!(await drop([maya, theo], col))) break;
    if (i === 5) {
      await pause(maya, 1200);
      await snap('connect4', maya, theo);
    }
  }
  for (let i = 0; i < 25 && !(await resultHeading(maya).isVisible()); i++) {
    await drop([maya, theo], (i % 7) + 1).catch(() => false);
  }

  c.start('12-result');
  await expect(resultHeading(maya)).toBeVisible({ timeout: 20_000 });
  await pause(maya, 2500);
  const mayaWon = await maya.getByRole('heading', { name: 'You won!' }).isVisible();
  const loser = mayaWon ? theo : maya;
  const winner = mayaWon ? maya : theo;
  await loser.getByRole('button', { name: /Rematch/ }).click();
  await expect(winner.getByText(/wants a rematch!/)).toBeVisible();
  await pause(winner, 2500);
  await snap('result', winner, loser);

  // Home on both, with the friend tile and balance.
  c.start('01-home');
  await Promise.all([goHome(maya), goHome(theo)]);
  await pause(maya, 3000);
  await snap('home', maya, theo);

  // Wallet history + friend page.
  c.start('13-wallet-friends');
  for (const p of [maya, theo]) await p.getByRole('link', { name: 'Wallet' }).click();
  await pause(maya, 1500);
  await maya.mouse.wheel(0, 350);
  await pause(maya, 800);
  await snap('wallet', maya);
  await maya.mouse.wheel(0, 600);
  await theo.mouse.wheel(0, 600);
  await pause(maya, 2500);
  await Promise.all([goHome(maya), goHome(theo)]);
  await maya.locator('.friend-tile').first().click();
  await theo.locator('.friend-tile').first().click();
  await pause(maya, 3000);
  await snap('friend', maya, theo);

  // Direct challenge: RPS lands on Theo's Home live.
  c.start('04-direct-challenge');
  await Promise.all([goHome(maya), goHome(theo)]);
  await pause(maya, 800);
  await challenge(maya, theo, 'Theo', /Rock Paper Scissors/, '1000');
  await theo.getByRole('button', { name: 'Accept 1,000' }).click();
  await payBoth(maya, theo, '1,000');

  // RPS: first to 3, simultaneous picks.
  c.start('08-rps');
  await expect(theo.getByRole('group', { name: 'Rock Paper Scissors board' })).toBeVisible();
  const picks: [string, string][] = [
    ['Rock', 'Scissors'],
    ['Paper', 'Paper'],
    ['Scissors', 'Paper'],
    ['Paper', 'Scissors'],
    ['Paper', 'Rock'],
    ['Rock', 'Scissors'],
  ];
  for (const [a, b] of picks) {
    const btn = maya.getByRole('button', { name: a, exact: true, disabled: false });
    const over = maya.getByText('Match over');
    await expect(btn.or(resultHeading(maya)).or(over).first()).toBeVisible({ timeout: 15_000 });
    if ((await resultHeading(maya).isVisible()) || (await over.isVisible())) break;
    await pause(maya, 900);
    await btn.click();
    await pause(theo, 900);
    await theo.getByRole('button', { name: b, exact: true }).click();
    await pause(maya, 2600);
    if (a === 'Rock') await snap('rps', maya, theo);
  }
  await expect(resultHeading(maya)).toBeVisible({ timeout: 20_000 });
  await pause(maya, 2000);

  // Trivia (Theo challenges back).
  c.start('09-trivia');
  await Promise.all([goHome(maya), goHome(theo)]);
  await challenge(theo, maya, 'Maya', /Trivia/, '1000');
  await maya.getByRole('button', { name: 'Accept 1,000' }).click();
  await payBoth(theo, maya, '1,000');
  for (let q = 0; q < 8; q++) {
    let any = false;
    for (const [p, letter] of [
      [maya, 'A'],
      [theo, 'B'],
    ] as const) {
      const opt = p.getByRole('button', {
        name: new RegExp(`^Answer ${letter}:`),
        disabled: false,
      });
      await expect(opt.or(resultHeading(p)).first()).toBeVisible({ timeout: 30_000 });
      if (await resultHeading(p).isVisible()) continue;
      await pause(p, 1300);
      await opt.click();
      any = true;
    }
    if (!any) break;
  }
  await expect(resultHeading(maya)).toBeVisible({ timeout: 30_000 });
  await pause(maya, 1500);

  // Tic-tac-toe with the turn timer.
  c.start('11-tictactoe');
  await Promise.all([goHome(maya), goHome(theo)]);
  await challenge(maya, theo, 'Theo', /Tic-tac-toe/, '1000');
  await theo.getByRole('button', { name: 'Accept 1,000' }).click();
  await payBoth(maya, theo, '1,000');
  const order = [4, 0, 2, 6, 3, 5, 1, 7, 8];
  for (let i = 0; i < 9; i++) if (!(await playCell([maya, theo], order))) break;
  await expect(resultHeading(maya)).toBeVisible({ timeout: 20_000 });
  await pause(maya, 1500);

  // Escrow page.
  c.start('14-escrow');
  await maya.goto('/escrow');
  await theo.goto('/escrow');
  await pause(maya, 4500);
  await snap('escrow', maya, theo);

  // Practice (iPhone) and Settings (Android).
  c.start('15-practice');
  await theo.goto('/practice');
  await maya.goto('/settings');
  await pause(theo, 1500);
  await theo.getByRole('link', { name: 'Connect 4' }).click();
  for (const col of [4, 3, 5, 4]) {
    const mine = theo.getByText('Your turn', { exact: true });
    await expect(mine.or(theo.getByText('Game over'))).toBeVisible({ timeout: 10_000 });
    if (await theo.getByText('Game over').isVisible()) break;
    await pause(theo, 600);
    await theo.getByRole('button', { name: `Drop in column ${col}` }).click();
  }
  await pause(theo, 1500);
  c.start('16-settings');
  await maya.mouse.wheel(0, 500);
  await pause(maya, 3000);

  await c.save(maya, theo);
});

async function poolShooter(players: Page[]): Promise<Page | null> {
  for (let i = 0; i < 60; i++) {
    for (const p of players) {
      if (await resultHeading(p).isVisible()) return null;
      const cue = p.getByRole('slider', { name: /Power cue/ });
      if ((await cue.count()) && (await cue.getAttribute('aria-disabled')) === 'false') return p;
    }
    await players[0]!.waitForTimeout(250);
  }
  return null;
}

test('pool', async ({ browser }) => {
  const dir = join(OUT, 'pool');
  mkdirSync(dir, { recursive: true });
  const maya = await phone(browser, androidLandscape, dir);
  const theo = await phone(browser, iphoneLandscape, dir);
  const c = clips('pool');

  await Promise.all([signUp(maya, 'Maya'), signUp(theo, 'Theo')]);
  await maya.getByRole('link', { name: /New challenge/ }).click();
  await maya.getByRole('button', { name: /Pool/ }).click();
  await maya.getByLabel('Stake in sats').fill('1000');
  await maya.getByRole('button', { name: 'Create challenge' }).click();
  const code = ((await maya.getByTestId('join-code').textContent()) ?? '').replace(/\D/g, '');
  await theo.getByRole('link', { name: 'Join with code' }).click();
  await theo.getByLabel(/6-digit code/).fill(code);
  await theo.getByRole('button', { name: 'Find challenge' }).click();
  await theo.getByRole('button', { name: 'Accept 1,000' }).click();
  await payBoth(maya, theo, '1,000');
  for (const p of [maya, theo]) {
    await expect(p.getByRole('img', { name: 'Pool table' })).toBeVisible();
  }

  c.start('10-pool');
  await pause(maya, 1500);
  for (let shot = 0; shot < 4; shot++) {
    const shooter = await poolShooter([maya, theo]);
    if (!shooter) break;
    const felt = shooter.getByRole('img', { name: 'Pool table' });
    const box = (await felt.boundingBox())!;
    // Aim: drag on the felt (toward the rack on the break).
    const tx = box.x + box.width * (shot === 0 ? 0.75 : 0.35 + 0.12 * shot);
    const ty = box.y + box.height * (shot === 0 ? 0.5 : shot % 2 ? 0.65 : 0.35);
    await shooter.mouse.move(tx - 60, ty + 20);
    await shooter.mouse.down();
    await shooter.mouse.move(tx, ty, { steps: 15 });
    await shooter.mouse.up();
    await pause(shooter, 800);
    if (shot === 0) await snap('pool-aim', shooter);
    // Power: pull the cue down, then release.
    const cue = shooter.getByRole('slider', { name: /Power cue/ });
    const cb = (await cue.boundingBox())!;
    await shooter.mouse.move(cb.x + cb.width / 2, cb.y + 8);
    await shooter.mouse.down();
    const pull = shot === 0 ? 0.75 : 0.45;
    await shooter.mouse.move(cb.x + cb.width / 2, cb.y + cb.height * pull, { steps: 20 });
    await pause(shooter, 400);
    if (shot === 0) await snap('pool-power', shooter);
    await shooter.mouse.up();
    await pause(shooter, shot === 0 ? 900 : 5500);
    if (shot === 0) {
      await snap('pool-roll', maya, theo);
      await pause(shooter, 4600);
    }
  }
  await c.save(maya, theo);
});
