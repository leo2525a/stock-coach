# Stock Coach

A local-first stock dashboard: dashboard, chart with indicators, watchlist,
signals, and an offline-capable PWA shell — plus a Capacitor wrapper for iOS.

All market data comes from a small local API server with a SQLite cache; the
app never talks to a third party directly.

## Layout

```
src/            React app (Vite + TypeScript)
  components/   screens + shared controls (Sidebar, TopBar, Controls, …)
  styles.css    design tokens + component styles
server/         Express API + SQLite cache
shared/         i18n strings and shared types
tests/          Vitest unit/component tests
scripts/        browser-evidence harnesses (phase3/4/5, chart, colour, runtime)
evidence/       generated gate reports (JSON tracked, images regenerated)
review-evidence/ coordinator + reviewer evidence, incl. the UI verifiers
ios/            Capacitor iOS project
docs/           design and install notes
```

## Quick start

```bash
npm install
npm run dev            # API + web dev servers
# or, against the production build:
npm run build
HOST=0.0.0.0 PORT=8787 npm run server   # serves dist/ + /api on :8787
```

Health check: `curl http://127.0.0.1:8787/api/health`.

## Gates

Every change is expected to keep these green:

```bash
npm run lint                 # eslint, zero warnings
npx tsc --noEmit             # zero TS errors
npm test                     # vitest
npm run build                # production build
npm run verify:runtime       # runtime contract checks
npm run evidence:phase3      # browser evidence: boot/nav/responsive
npm run evidence:phase4      # browser evidence: data flows
npm run evidence:phase5      # browser evidence: a11y/touch/console
npm run evidence:chart       # browser evidence: chart + toolbar
npm run evidence:colour      # browser evidence: theming
```

The evidence harnesses drive the **production build** in real Chrome
(playwright-core). They require a running API on `:8787` and assert zero console
errors and zero failed requests.

### Independent UI verification

The UI work is checked by harnesses under `review-evidence/coordinator-ui/`:

```bash
node review-evidence/coordinator-ui/verify-ui2.mjs           # 21 checks
node review-evidence/coordinator-ui/verify-ui2.mutation.mjs  # counter-proof
```

`verify-ui2.mutation.mjs` deliberately breaks the built CSS and asserts the
verifier catches each break, so a green run is not a vacuous one.

## UI notes

- Navigation lives entirely in the **sidebar**; there is no top/logo bar.
- Collapsing the sidebar (`c`, the rail button, or the floating handle) puts it
  away in one move and leaves a corner handle to bring it straight back. On
  desktop the choice is session-only and is not persisted.
- Global controls (theme, language, refresh) live at the top of the sidebar.
- The chart toolbar is grouped into rounded capsules — one per concern
  (range / interval / overlays / panes) — instead of a wall of loose buttons.
- Minimum touch target is **40px** everywhere, down to a 320px viewport.

## iOS

```bash
npm run build
npm run native:sync      # copy dist/ into the Capacitor project
npm run native:open      # open in Xcode
```

The iOS shell loads the bundled assets; point it at a reachable API base
(HTTPS in production) — see `docs/`.
