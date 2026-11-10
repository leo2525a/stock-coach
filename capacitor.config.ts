import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wrapper config — Phase 2 native iOS shell around the same web app.
 *
 * The native build is copied verbatim into the native project, so the app on
 * TestFlight is the *exact* Phase-5-verified UI; the only native code is
 * Capacitor's thin bridge. `server.url` is intentionally NOT set: the shell
 * loads the bundled assets, not a dev server.
 *
 * `webDir` points at `dist-native`, not the repo's `dist`. A bundled native page
 * has the origin `capacitor://localhost`, so a relative `/api` resolves to
 * `capacitor://localhost/api` — an origin with no server behind it — and every
 * screen silently shows no data. `npm run native:build` therefore injects an
 * absolute `VITE_API_BASE` into its own output directory, leaving the repo
 * `dist/` relative for the web build that is served same-origin.
 */
const config: CapacitorConfig = {
  appId: 'com.stockcoach.app',
  appName: 'Stock Coach',
  webDir: 'dist-native',
  ios: {
    contentInset: 'never',
    backgroundColor: '#0d1117',
  },
};

export default config;
