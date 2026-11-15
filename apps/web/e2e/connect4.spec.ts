/**
 * Two players, two phones: Connect 4 challenge → accept → lock → play to a vertical win.
 * Runs against NETWORK=mock, so the money moves on the server's in-memory Spark network.
 */
import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, nickname: string) {
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** Whoever's turn it is drops a disc in `column` (1-based), landing on `row` (1-based, top = 1). */
async function drop(players: Page[], column: number, row: number) {
  await expect
    .poll(
      async () => {
        for (const p of players)
          if (await p.getByText('Your turn', { exact: true }).isVisible()) return true;
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  for (const p of players) {
    if (await p.getByText('Your turn', { exact: true }).isVisible()) {
      await p.getByRole('button', { name: `Drop in column ${column}` }).click();
      // The disc lands, or the game ends and the result screen replaces the board.
      await expect(
        p
          .getByRole('gridcell', { name: `Row ${row}, column ${column}: red` })
          .or(p.getByRole('gridcell', { name: `Row ${row}, column ${column}: yellow` }))
          .or(p.getByRole('heading', { name: 'You won!' })),
      ).toBeVisible();
      return p;
    }
  }
  throw new Error('nobody to move');
}

test('full Connect 4 match between two phones', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  await alice.goto('/');
  await signUp(alice, 'Alice');
  await expect(alice.getByLabel('Your wallet')).toContainText('10,000 sats');

  // New challenge: Connect 4, stake 1,000.
  await alice.getByRole('link', { name: /New challenge/ }).click();
  await alice.getByRole('button', { name: 'Connect 4' }).click();
  await expect(alice.getByRole('button', { name: 'Connect 4' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await alice.getByLabel('Stake in sats').fill('1000');
  await alice.getByRole('button', { name: 'Create challenge' }).click();
  const link = (await alice.getByTestId('invite-link').textContent())!.trim();

  // Bob opens the invite, signs up and accepts.
  await bob.goto(new URL(link).pathname);
  await expect(bob.getByText(/Alice wants a game of/)).toBeVisible();
  await signUp(bob, 'Bob');
  await bob.getByRole('button', { name: 'Accept 1,000' }).click();

  // Both lock 1,000; the game starts once each wallet sees the other's lock.
  for (const p of [alice, bob]) {
    await p.getByRole('button', { name: 'Pay 1,000 from wallet' }).click();
  }
  await expect(alice.getByRole('grid', { name: 'Connect 4 board' })).toBeVisible();
  await expect(bob.getByRole('grid', { name: 'Connect 4 board' })).toBeVisible();

  // First mover stacks four in column 1; the other player answers in column 2.
  const first = await drop([alice, bob], 1, 6);
  await drop([alice, bob], 2, 6);
  await drop([alice, bob], 1, 5);
  await drop([alice, bob], 2, 5);
  await drop([alice, bob], 1, 4);
  await drop([alice, bob], 2, 4);
  await drop([alice, bob], 1, 3);
  const second = first === alice ? bob : alice;

  await expect(first.getByRole('heading', { name: 'You won!' })).toBeVisible();
  await expect(first.getByTestId('payout-status')).toHaveText(/Paid \+2,000 sats/);
  await expect(second.getByRole('heading', { name: /won$/ })).toBeVisible();
});
