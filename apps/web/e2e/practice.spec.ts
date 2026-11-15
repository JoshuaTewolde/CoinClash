/** Practice (ADR 0017): a signed-out visitor plays CoinBot at Tic-tac-toe, free, to the end. */
import { expect, test } from '@playwright/test';

test('signed-out practice game against the bot', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try a free practice game first' }).click();
  await page.getByRole('link', { name: 'Tic-tac-toe' }).click();
  await expect(page.getByText('Free · no sats')).toBeVisible();

  for (let i = 0; i < 9; i++) {
    const over = page.getByText('Game over');
    const mine = page.getByText('Your turn', { exact: true });
    await expect(over.or(mine)).toBeVisible({ timeout: 10_000 });
    if (await over.isVisible()) break;
    await page.locator('.ttt__cell:enabled').first().click();
  }
  await expect(page.getByText('Game over')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
});
