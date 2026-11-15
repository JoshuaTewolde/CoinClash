/**
 * Rock Paper Scissors between two phones: challenge → accept → lock → simultaneous rounds →
 * winner collects. Runs against NETWORK=mock.
 */
import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, nickname: string) {
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Create account' }).click();
}

const roundChips = (p: Page) => p.getByRole('list', { name: 'Rounds' }).getByRole('listitem');

test('full rock paper scissors match between two phones', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  await alice.goto('/');
  await signUp(alice, 'Alice');
  await expect(alice.getByLabel('Your wallet')).toContainText('10,000 sats');

  // New challenge: pick the Rock Paper Scissors tile, stake 1,000.
  await alice.getByRole('link', { name: /New challenge/ }).click();
  await alice.getByRole('button', { name: /Rock Paper Scissors/ }).click();
  await expect(alice.getByRole('button', { name: /Rock Paper Scissors/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await alice.getByLabel('Stake in sats').fill('1000');
  await alice.getByRole('button', { name: 'Create challenge' }).click();
  const link = (await alice.getByTestId('invite-link').textContent())!.trim();

  await bob.goto(new URL(link).pathname);
  await signUp(bob, 'Bob');
  await bob.getByRole('button', { name: 'Accept 1,000' }).click();

  for (const p of [alice, bob]) {
    await p.getByRole('button', { name: 'Pay 1,000 from wallet' }).click();
  }
  for (const p of [alice, bob]) {
    await expect(p.getByRole('group', { name: 'Rock Paper Scissors board' })).toBeVisible();
    await expect(p.getByText('Your turn', { exact: true })).toBeVisible();
  }

  // Alice always throws rock, Bob always scissors: Alice wins 3-0 (first to 3).
  for (let round = 1; round <= 3; round++) {
    await alice.getByRole('button', { name: 'Rock', exact: true }).click();
    await expect(alice.getByText('Waiting for opponent…')).toBeVisible();
    // Bob sees that Alice has picked, but not what.
    await expect(bob.getByText('They’ve picked. Your move!')).toBeVisible();
    await bob.getByRole('button', { name: 'Scissors', exact: true }).click();
    // Every round's result shows, the last one too, before the result screen.
    for (const p of [alice, bob]) await expect(roundChips(p)).toHaveCount(round);
    await expect(alice.getByText('You win the round!')).toBeVisible();
    await expect(bob.getByText('They win the round')).toBeVisible();
    await expect(alice.getByLabel(`Score: you ${round}, them 0`)).toBeVisible();
  }

  await expect(alice.getByRole('heading', { name: 'You won!' })).toBeVisible();
  await expect(alice.getByTestId('payout-status')).toHaveText(/Paid \+2,000 sats/);
  await expect(bob.getByRole('heading', { name: /won$/ })).toBeVisible();
});
