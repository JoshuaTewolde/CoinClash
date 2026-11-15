/// <reference types="vite/client" />

/** Public build-time settings (baked into the bundle; see .env.example). */
interface ImportMetaEnv {
  readonly VITE_BREEZ_API_KEY?: string;
  readonly VITE_PASSKEY_RP_ID?: string;
  readonly VITE_PASSKEY_RP_NAME?: string;
  readonly VITE_REGTEST_FAUCET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
