/**
 * Two phones play Pool: challenge → accept → lock → a few shots with the slider controls →
 * one player resigns and the other wins. Runs against NETWORK=mock.
 */
import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, nickname: string) {
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Create account' }).click();
}

const shots = async (p: Page) => Number(await p.locator('.pool').getAttribute('data-shots'));

const isOver = async (players: Page[]) => {
  for (const p of players)
    if (await p.getByRole('heading', { name: /won/ }).isVisible()) return true;
  return false;
};

/** Whoever's turn it is aims with the sliders and shoots; waits until the server applied it. */
async function shoot(players: Page[], angleDeg: number, power: number): Promise<Page | null> {
  let shooter: Page | null = null;
  await expect
    .poll(
      async () => {
        if (await isOver(players)) return true;
        for (const p of players) {
          const button = p.getByRole('button', { name: 'Shoot' });
          if ((await button.isVisible()) && (await button.isEnabled())) {
            shooter = p;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  if (!shooter) return null;
  const p: Page = shooter;
  const before = await shots(p);
  await p.getByLabel('Aim angle').fill(String(angleDeg));
  await p.getByLabel('Power').fill(String(power));
  await p.getByRole('button', { name: 'Shoot' }).click();
  // The shot counter ticks up, or the game ended and the result screen replaced the board.
  await expect
    .poll(async () => (await isOver(players)) || (await shots(p)) > before, { timeout: 15_000 })
    .toBe(true);
  return p;
}

test('pool match between two phones, ended by a resignation', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  await alice.goto('/');
  await signUp(alice, 'Alice');
  await expect(alice.getByLabel('Your wallet')).toContainText('10,000 sats');

  // New challenge: Pool for 1,000.
  await alice.getByRole('link', { name: /New challenge/ }).click();
  await alice.getByRole('button', { name: /Pool/ }).click();
  await expect(alice.getByRole('button', { name: /Pool/ })).toHaveAttribute('aria-pressed', 'true');
  await alice.getByLabel('Stake in sats').fill('1000');
  await alice.getByRole('button', { name: 'Create challenge' }).click();
  const link = (await alice.getByTestId('invite-link').textContent())!.trim();

  await bob.goto(new URL(link).pathname);
  await expect(bob.getByText(/Alice wants a game of/)).toBeVisible();
  await signUp(bob, 'Bob');
  await bob.getByRole('button', { name: 'Accept 1,000' }).click();

  for (const p of [alice, bob]) {
    await p.getByRole('button', { name: 'Pay 1,000 from wallet' }).click();
  }
  for (const p of [alice, bob]) {
    await expect(p.getByRole('img', { name: 'Pool table' })).toBeVisible();
    await expect(p.getByText(/Pool vs/)).toBeVisible();
  }

  // Break, then a couple more shots from whoever is up.
  const players = [alice, bob];
  await shoot(players, 0, 100);
  await shoot(players, 180, 40);
  await shoot(players, 90, 30);

  if (await isOver(players)) {
    // Someone sank (or scratched on) the 8 early: the game is decided already.
    const won = async () =>
      (await alice.getByRole('heading', { name: 'You won!' }).isVisible()) ||
      (await bob.getByRole('heading', { name: 'You won!' }).isVisible());
    await expect.poll(won).toBe(true);
    return;
  }

  // Alice resigns; Bob wins.
  await alice.getByRole('button', { name: 'Resign' }).click();
  await alice.getByRole('button', { name: 'Yes, resign' }).click();
  await expect(bob.getByRole('heading', { name: 'You won!' })).toBeVisible();
  await expect(alice.getByRole('heading', { name: /won$/ })).toBeVisible();
});
