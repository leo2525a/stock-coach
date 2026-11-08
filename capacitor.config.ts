import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wrapper config — Phase 2 native iOS shell around the same web app.
 *
 * The web build (Vite `dist/`) is copied verbatim into the native project, so
 * the app on TestFlight is the *exact* Phase-5-verified UI; the only native code
 * is Capacitor's thin bridge. `server.url` is intentionally NOT set: the shell
 * loads the bundled assets, not a dev server.
 */
const config: CapacitorConfig = {
  appId: 'com.stockcoach.app',
  appName: 'Stock Coach',
  webDir: 'dist',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0d1117',
  },
};

export default config;
