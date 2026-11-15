import { describe, expect, it, vi } from 'vitest';
import { WelcomeBonus } from '../src/bonus.js';
import { MemoryUserRepo } from '../src/db/repos.js';

async function setup(pay = vi.fn(async () => 'pay-1')) {
  const users = new MemoryUserRepo();
  for (const id of ['u1', 'u2', 'u3']) {
    await users.upsert({
      _id: id,
      nickname: id,
      sparkAddress: `sp-${id}`,
      createdAt: 0,
      lastLoginAt: 0,
      bonusPaidAt: null,
    });
  }
  const bonus = new WelcomeBonus({
    users,
    house: { pay, balance: async () => 1e6 },
    amount: 10_000,
    perIpPerHour: 2,
    clock: () => 1_000,
    log: () => undefined,
  });
  return { users, bonus, pay };
}

describe('WelcomeBonus', () => {
  it('pays once per identity with a stable idempotency key', async () => {
    const { bonus, pay, users } = await setup();
    const first = await bonus.grant('u1', 'ip');
    expect(first.outcome).toBe('sending');
    await first.settled;
    expect(pay).toHaveBeenCalledWith('sp-u1', 10_000, 'bonus:u1');
    expect((await users.get('u1'))?.bonusPaidAt).toBe(1_000);
    expect((await bonus.grant('u1', 'ip')).outcome).toBe('already-paid');
    expect(pay).toHaveBeenCalledTimes(1);
  });

  it('rate-limits per IP and ignores unknown users', async () => {
    const { bonus } = await setup();
    expect((await bonus.grant('u1', 'ip')).outcome).toBe('sending');
    expect((await bonus.grant('u2', 'ip')).outcome).toBe('sending');
    expect((await bonus.grant('u3', 'ip')).outcome).toBe('rate-limited');
    expect((await bonus.grant('u3', 'other-ip')).outcome).toBe('sending');
    expect((await bonus.grant('nobody', 'ip')).outcome).toBe('unknown-user');
  });

  it('clears the mark when the payment fails so a later login can retry', async () => {
    const pay = vi.fn(async () => {
      throw new Error('house is broke');
    });
    const { bonus, users } = await setup(pay);
    const r = await bonus.grant('u1', 'ip');
    await r.settled;
    expect((await users.get('u1'))?.bonusPaidAt).toBeNull();
  });
});
