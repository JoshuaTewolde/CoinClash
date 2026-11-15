import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { connectMongo } from './db/mongo.js';

const config = loadConfig();

async function main() {
  let deps = {};
  let shutdownDb = async () => {};
  if (config.MONGODB_URI !== 'memory') {
    const mongo = await connectMongo(config.MONGODB_URI, config.MONGODB_DB);
    deps = { matches: mongo.matches, users: mongo.users };
    shutdownDb = () => mongo.client.close();
    console.info(`[coinclash] connected to MongoDB (db=${config.MONGODB_DB})`);
  } else {
    console.warn('[coinclash] MONGODB_URI=memory: data is lost on restart');
  }
  if (config.NETWORK !== 'mock') {
    console.warn(
      '[coinclash] Breez signature verification lands in Phase 5; logins are rejected until then',
    );
  }

  const app = createApp(config, deps);
  const resumed = await app.service.reconcile();
  console.info(`[coinclash] reconciled ${resumed} unfinished match(es)`);

  app.http.listen(config.PORT, () => {
    console.info(`[coinclash] server listening on :${config.PORT} (network=${config.NETWORK})`);
  });

  const shutdown = async () => {
    await app.close();
    await shutdownDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[coinclash] failed to start', err);
  process.exit(1);
});
