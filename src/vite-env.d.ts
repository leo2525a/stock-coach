/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build-time env injected by Vite. */
interface ImportMetaEnv {
  /**
   * Absolute API origin for the native shell (e.g. `https://api.example.com`).
   * Unset on the web, where the app and API are same-origin and `/api` works.
   * See docs/NATIVE-IOS.md.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
