import { mkdirSync } from 'node:fs';
import { createApp, type AppDeps } from './app.js';
import { WelcomeBonus } from './bonus.js';
import { breezEscrow, breezHouseWallet, breezVerifier, connectBreez } from './breez.js';
import { loadConfig } from './config.js';
import { connectMongo } from './db/mongo.js';
import { MemoryMatchRepo, MemoryUserRepo } from './db/repos.js';

const config = loadConfig();

async function main() {
  const deps: AppDeps = {};
  const closers: (() => Promise<unknown>)[] = [];

  if (config.MONGODB_URI !== 'memory') {
    const mongo = await connectMongo(config.MONGODB_URI, config.MONGODB_DB);
    deps.matches = mongo.matches;
    deps.users = mongo.users;
    closers.push(() => mongo.client.close());
    console.info(`[coinclash] connected to MongoDB (db=${config.MONGODB_DB})`);
  } else {
    deps.matches = new MemoryMatchRepo();
    deps.users = new MemoryUserRepo();
    console.warn('[coinclash] MONGODB_URI=memory: data is lost on restart');
  }

  if (config.NETWORK !== 'mock') {
    if (!config.BREEZ_API_KEY || !config.HOUSE_MNEMONIC) {
      throw new Error(`NETWORK=${config.NETWORK} needs BREEZ_API_KEY and HOUSE_MNEMONIC`);
    }
    mkdirSync(config.BREEZ_STORAGE_DIR, { recursive: true });
    const sdk = await connectBreez({
      network: config.NETWORK,
      apiKey: config.BREEZ_API_KEY,
      mnemonic: config.HOUSE_MNEMONIC,
      storageDir: config.BREEZ_STORAGE_DIR,
    });
    closers.push(() => sdk.disconnect());
    deps.verifier = breezVerifier(sdk);
    const house = breezHouseWallet(sdk);
    console.info(`[coinclash] house wallet connected (${await house.balance()} sats)`);
    if (config.ESCROW_MODE === 'escrow') {
      if (!config.ESCROW_MNEMONIC) throw new Error('ESCROW_MODE=escrow needs ESCROW_MNEMONIC');
      const escrowDir = `${config.BREEZ_STORAGE_DIR}-escrow`;
      mkdirSync(escrowDir, { recursive: true });
      const escrowSdk = await connectBreez({
        network: config.NETWORK,
        apiKey: config.BREEZ_API_KEY,
        mnemonic: config.ESCROW_MNEMONIC,
        storageDir: escrowDir,
      });
      closers.push(() => escrowSdk.disconnect());
      deps.escrow = breezEscrow(escrowSdk);
      const info = await escrowSdk.getInfo({ ensureSynced: true });
      console.info(`[coinclash] escrow wallet connected (${info.balanceSats} sats held)`);
    }
    if (config.NETWORK === 'regtest' && config.WELCOME_BONUS_ENABLED) {
      deps.bonus = new WelcomeBonus({
        users: deps.users,
        house,
        amount: config.WELCOME_BONUS_SATS,
        perIpPerHour: config.WELCOME_BONUS_RATE_LIMIT_PER_HOUR,
        log: (msg, err) => console.error(`[coinclash] ${msg}`, err),
      });
    }
  }

  const app = createApp(config, deps);
  const resumed = await app.service.reconcile();
  console.info(`[coinclash] reconciled ${resumed} unfinished match(es)`);

  app.http.listen(config.PORT, () => {
    console.info(`[coinclash] server listening on :${config.PORT} (network=${config.NETWORK})`);
  });

  const shutdown = async () => {
    await app.close();
    for (const close of closers) await close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[coinclash] failed to start', err);
  process.exit(1);
});
