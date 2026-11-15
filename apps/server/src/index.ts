import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { http } = createApp(config);

http.listen(config.PORT, () => {
  console.info(`[coinclash] server listening on :${config.PORT} (network=${config.NETWORK})`);
});
