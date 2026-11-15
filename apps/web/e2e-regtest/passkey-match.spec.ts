/**
 * Two phones on real Spark regtest: passkey sign-up (virtual authenticator with PRF), welcome
 * bonus from the house wallet, challenge → accept → both pay real stakes into the escrow → play →
 * the escrow pays the winner the whole pot. Balances are checked from each player's own wallet.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

async function phone(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.warn(`[page] ${m.text()}`);
  });
  return page;
}

async function signUp(page: Page, nickname: string) {
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByLabel('Your wallet')).toBeVisible();
}

async function walletSats(page: Page): Promise<number> {
  const text = (await page.getByLabel('Your wallet').textContent()) ?? '';
  return Number(text.replace(/[^0-9]/g, ''));
}

async function playCell(players: Page[], cell: number) {
  const row = Math.floor(cell / 3) + 1;
  const col = (cell % 3) + 1;
  for (let i = 0; i < 120; i++) {
    for (const p of players) {
      if (await p.getByText('Your turn', { exact: true }).isVisible()) {
        await p.getByRole('gridcell', { name: `Row ${row}, column ${col}: empty` }).click();
        await expect(
          p
            .getByRole('gridcell', { name: new RegExp(`Row ${row}, column ${col}: [XO]`) })
            .or(p.getByRole('heading', { name: 'You won!' })),
        ).toBeVisible();
        return p;
      }
    }
    await players[0]!.waitForTimeout(500);
  }
  throw new Error('nobody to move');
}

test('passkey wallets play a staked match on regtest', async ({ browser }) => {
  const alice = await phone(await browser.newContext());
  const bob = await phone(await browser.newContext());

  await alice.goto('/');
  await signUp(alice, 'Alice');
  await expect.poll(() => walletSats(alice), { timeout: 180_000 }).toBeGreaterThanOrEqual(10_000);

  await alice.getByRole('link', { name: /New challenge/ }).click();
  await alice.getByLabel('Stake in sats').fill('500');
  await alice.getByRole('button', { name: 'Create challenge' }).click();
  const link = (await alice.getByTestId('invite-link').textContent())!.trim();

  await bob.goto(new URL(link).pathname);
  await signUp(bob, 'Bob');
  await expect(bob.getByRole('button', { name: 'Accept 500' })).toBeVisible();
  await bob.goto('/');
  await expect.poll(() => walletSats(bob), { timeout: 180_000 }).toBeGreaterThanOrEqual(10_000);
  const [a0, b0] = [await walletSats(alice), await walletSats(bob)];

  await bob.goto(new URL(link).pathname);
  await bob.getByRole('button', { name: 'Accept 500' }).click();

  for (const p of [alice, bob]) {
    await p.getByRole('button', { name: 'Pay 500 from wallet' }).click();
  }
  await expect(alice.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible({
    timeout: 180_000,
  });
  await expect(bob.getByRole('grid', { name: 'Tic-tac-toe board' })).toBeVisible();

  const first = await playCell([alice, bob], 0);
  for (const c of [3, 1, 4, 2]) await playCell([alice, bob], c);
  const second = first === alice ? bob : alice;

  await expect(first.getByRole('heading', { name: 'You won!' })).toBeVisible();
  await expect(first.getByTestId('payout-status')).toHaveText(/Paid \+1,000 sats/, {
    timeout: 180_000,
  });

  // Escrow (ADR 0013): the winner gets the whole 1,000 pot instantly (+500 net). Loser: −500.
  const [w0, l0] = first === alice ? [a0, b0] : [b0, a0];
  await first.getByRole('link', { name: 'Home' }).click();
  await second.getByRole('link', { name: 'Home' }).click();
  await expect.poll(() => walletSats(first), { timeout: 120_000 }).toBe(w0 + 500);
  await expect.poll(() => walletSats(second), { timeout: 120_000 }).toBe(l0 - 500);
});
