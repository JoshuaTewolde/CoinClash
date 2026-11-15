/**
 * Two phones play a full trivia match: both answer every question at once (simultaneous model).
 * Alice always picks option A, Bob option B, until the result screen appears.
 * Runs against NETWORK=mock, so the money moves on the server's in-memory Spark network.
 */
import { expect, test, type Page } from '@playwright/test';

async function signUp(page: Page, nickname: string) {
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Create account' }).click();
}

const resultHeading = (p: Page) => p.getByRole('heading', { name: /^(You won!|.+ won|Draw)$/ });

/** Answer the open question with `letter`, or return false once the result screen is up. */
async function answerNext(p: Page, letter: 'A' | 'B'): Promise<boolean> {
  // Enabled only while this player still owes an answer (the reveal of the last one hides them).
  const option = p.getByRole('button', { name: new RegExp(`^Answer ${letter}:`), disabled: false });
  await expect(option.or(resultHeading(p)).first()).toBeVisible({ timeout: 30_000 });
  if (await resultHeading(p).isVisible()) return false;
  await option.click();
  return true;
}

test('full trivia match between two phones', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();

  await alice.goto('/');
  await signUp(alice, 'Alice');
  await expect(alice.getByLabel('Your wallet')).toContainText('10,000 sats');

  // New challenge: Trivia, stake 1,000.
  await alice.getByRole('link', { name: /New challenge/ }).click();
  await alice.getByRole('button', { name: /Trivia/ }).click();
  await expect(alice.getByRole('button', { name: /Trivia/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await alice.getByLabel('Stake in sats').fill('1000');
  await alice.getByRole('button', { name: 'Create challenge' }).click();
  const link = (await alice.getByTestId('invite-link').textContent())!.trim();

  await bob.goto(new URL(link).pathname);
  await expect(bob.getByText(/Alice wants a game of/)).toBeVisible();
  await signUp(bob, 'Bob');
  await bob.getByRole('button', { name: 'Accept 1,000' }).click();

  for (const p of [alice, bob]) {
    await p.getByRole('button', { name: 'Lock 1,000 from wallet' }).click();
  }
  for (const p of [alice, bob]) {
    await expect(p.getByRole('group', { name: 'Answer options' })).toBeVisible();
    await expect(p.getByText('Q 1/5')).toBeVisible();
  }

  // 5 questions plus up to 3 sudden-death questions.
  for (let q = 0; q < 8; q++) {
    const a = await answerNext(alice, 'A');
    const b = await answerNext(bob, 'B');
    if (!a && !b) break;
  }

  await expect(resultHeading(alice)).toBeVisible();
  await expect(resultHeading(bob)).toBeVisible();
  const aliceTitle = await resultHeading(alice).textContent();
  const bobTitle = await resultHeading(bob).textContent();
  if (aliceTitle === 'Draw') expect(bobTitle).toBe('Draw');
  else if (aliceTitle === 'You won!') expect(bobTitle).toBe('Alice won');
  else {
    expect(aliceTitle).toBe('Bob won');
    expect(bobTitle).toBe('You won!');
  }
});
