/**
 * Two players, two phones: challenge → negotiate → lock → play → winner collects → rematch.
 * Runs against NETWORK=mock, so the money moves on the server's in-memory Spark network.
 */
import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, nickname: string) {
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Create account' }).click();
}

/** Whoever's turn it is plays the next cell. */
async function playCell(players: Page[], cell: number) {
  const row = Math.floor(cell / 3) + 1;
  const col = (cell % 3) + 1;
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
      await p.getByRole('gridcell', { name: `Row ${row}, column ${col}: empty` }).click();
      // The mark appears, or the game ends and the result screen replaces the board.
      await expect(
        p
          .getByRole('gridcell', { name: new RegExp(`Row ${row}, column ${col}: [XO]`) })
          .or(p.getByRole('heading', { name: 'You won!' })),
      ).toBeVisible();
      return p;
    }
  }
  throw new Error('nobody to move');
}

test('full tic-tac-toe match between two phones', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  // Alice signs up and gets the welcome sats.
  await alice.goto('/');
  await signUp(alice, 'Alice');
  await expect(alice.getByLabel('Your wallet')).toContainText('10,000 sats');
  await expect(alice.getByRole('button', { name: /TEST SATS/ })).toBeVisible();

  // New challenge: tic-tac-toe, typed stake 2,000.
  await alice.getByRole('link', { name: /New challenge/ }).click();
  await alice.getByLabel('Stake in sats').fill('2000');
  await alice.getByRole('button', { name: 'Create challenge' }).click();
  const link = (await alice.getByTestId('invite-link').textContent())!.trim();
  expect(link).toMatch(/\/i\/[\w-]+$/);

  // Bob opens the invite, sees the challenge before signing up, then joins.
  await bob.goto(new URL(link).pathname);
  await expect(bob.getByText(/Alice wants a game of/)).toBeVisible();
  await signUp(bob, 'Bob');
  await expect(bob.getByRole('button', { name: 'Accept 2,000' })).toBeVisible();

  // Bob counters with 1,000; Alice takes the lower.
  await bob.getByRole('button', { name: 'Counter' }).click();
  await bob.getByLabel('Counter in sats').fill('1000');
  await bob.getByRole('button', { name: 'Send counter' }).click();
  await expect(bob.getByText('Waiting for Alice to answer…')).toBeVisible();
  await expect(alice.getByText('Lower of the last two is 1,000')).toBeVisible();
  await alice.getByRole('button', { name: 'Take the lower' }).click();

  // Both pay 1,000 into escrow; the game starts once the escrow has both stakes.
  for (const p of [alice, bob]) {
    await p.getByRole('button', { name: 'Pay 1,000 from wallet' }).click();
  }
  await expect(alice.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible();
  await expect(bob.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible();

  // First mover wins on the top row: 0, (3), 1, (4), 2.
  const first = await playCell([alice, bob], 0);
  await playCell([alice, bob], 3);
  await playCell([alice, bob], 1);
  await playCell([alice, bob], 4);
  await playCell([alice, bob], 2);
  const second = first === alice ? bob : alice;

  await expect(first.getByRole('heading', { name: 'You won!' })).toBeVisible();
  await expect(first.getByTestId('payout-status')).toHaveText(/Paid \+2,000 sats/);
  await expect(second.getByRole('heading', { name: /won$/ })).toBeVisible();

  // The loser offers a rematch; the winner sees it on the result screen right away.
  await second.getByRole('button', { name: /Rematch/ }).click();
  await expect(second.getByText(/Waiting for .* to answer/)).toBeVisible();
  await expect(first.getByText(/wants a rematch!/)).toBeVisible();
  await expect(first.getByRole('button', { name: /Answer .*'s rematch/ })).toBeVisible();

  // Balances: the winner got the whole 2,000 pot instantly; the loser is down 1,000.
  await first.getByRole('link', { name: 'Home' }).click();
  await expect(first.getByLabel('Your wallet')).toContainText('11,000 sats');
  await expect(first.getByText('1-day streak')).toBeVisible();
  await second.getByRole('link', { name: 'Back home' }).click();
  await expect(second.getByLabel('Your wallet')).toContainText('9,000 sats');

  // Now they're friends: the winner challenges the loser directly (no link). It shows up on the
  // loser's Home under "Waiting on you" without opening anything.
  const loserName = second === alice ? 'Alice' : 'Bob';
  const winnerName = first === alice ? 'Alice' : 'Bob';
  await first.getByRole('link', { name: /New challenge/ }).click();
  await first.getByRole('radio', { name: loserName }).click();
  await first.getByRole('button', { name: /Connect 4/ }).click();
  await first.getByRole('button', { name: `Challenge ${loserName}` }).click();
  await expect(first.getByText(`Waiting for ${loserName} to answer…`)).toBeVisible();
  await expect(second.getByText(`${winnerName} challenged you to Connect 4`)).toBeVisible();
  const waiting = second.getByRole('region', { name: 'Waiting on you' });
  await expect(waiting.getByRole('link', { name: /Connect 4 vs/ })).toBeVisible();
});

test('join an open challenge with the 6-digit code', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto('/');
  await signUp(host, 'Hana');
  await host.getByRole('link', { name: /New challenge/ }).click();
  await host.getByRole('button', { name: 'Create challenge' }).click();
  const code = ((await host.getByTestId('join-code').textContent()) ?? '').replace(/\D/g, '');
  expect(code).toMatch(/^\d{6}$/);
  await expect(host.getByRole('img', { name: 'QR code for the invite link' })).toBeVisible();

  await guest.goto('/');
  await signUp(guest, 'Gus');
  await guest.getByRole('link', { name: 'Join with code' }).click();
  await guest.getByLabel(/6-digit code/).fill(code);
  await guest.getByRole('button', { name: 'Find challenge' }).click();
  await expect(guest.getByRole('button', { name: 'Accept 2,000' })).toBeVisible();
});

test('the network picker offers real money as coming soon', async ({ page }) => {
  await page.goto('/');
  await signUp(page, 'Cleo');
  await page.getByRole('button', { name: /TEST SATS/ }).click();
  await expect(page.getByRole('menuitemradio', { name: /Real money/ })).toBeDisabled();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('menuitemradio', { name: /Test sats/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});
