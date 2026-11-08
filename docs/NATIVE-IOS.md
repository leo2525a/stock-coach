# Native iOS build (Capacitor) → TestFlight

> Status 2026-11-08: **Xcode 27.2 is installed and the app builds, installs and
> runs in the iPhone 17 Simulator against the live API — verified working.**
> TestFlight upload still needs the Apple Developer Program ($99/yr) + an App
> Store Connect record; those are owner-only Apple-account actions.
> Everything below is real and verified unless marked otherwise.

This is **Phase 2** of the project (see `SPEC-PHASE2.md` §I/§2). Phase 1–5 shipped
one responsive PWA; this wraps that same web build in a real native iOS app so it
can be distributed on **TestFlight / the App Store**.

## Why a wrapper and not a rewrite

The iOS app is the *same, already-verified* Phase-5 web build (`dist/`) copied
into a Capacitor shell. The native layer is Capacitor's thin bridge plus the
Xcode project — no second UI codebase. So the app on TestFlight is byte-for-byte
the UI that passed the Phase-5 QA, with native packaging around it.

## Done (verified on this machine)

- `@capacitor/core@^8`, `@capacitor/cli@^8`, `@capacitor/ios@^8` installed.
- `capacitor.config.ts` — `appId com.stockcoach.app`, `appName "Stock Coach"`,
  `webDir dist`, no `server.url` (loads bundled assets, not a dev server).
- `npx cap add ios` → `ios/App/App.xcodeproj` (Swift Package Manager; **CocoaPods
  is not required** for Capacitor 8), `Info.plist`, `AppDelegate.swift`,
  `SceneDelegate.swift`, `Assets.xcassets` (app icon 512 + splash), and the web
  build copied into `ios/App/App/public/`.
- `npx cap sync ios` runs clean.
- Scripts: `npm run native:sync` (build + copy into iOS), `npm run native:open`
  (open the project in Xcode).
- **Gates still green with the native project present**: tsc 0 · lint 0 ·
  469 tests / 23 files · build 0. (`ios/**` is eslint-ignored — the copied
  `ios/App/App/public/` is minified build output, not source.)
- **Real bug found and fixed for the native context:** the old API base was the
  relative `'/api'`. Inside the shell the page origin is `capacitor://localhost`,
  so a relative URL resolves to nothing and every screen would silently show "no
  data". The base is now `import.meta.env.VITE_API_BASE || '/api'`, so the web
  build keeps same-origin `/api` and a native build points at an absolute API URL.

## Verified working — Simulator, live data (2026-11-08)

- `xcodebuild` → **BUILD SUCCEEDED** (`-sdk iphonesimulator`, ad-hoc
  "Sign to Run Locally"; no team/Apple ID needed for a simulator build).
- App installs + launches on booted **iPhone 17** simulator as `com.stockcoach.app`.
- **Real, live data renders** — the screen shows a watchlist (AAPL 342.37 USD
  −0.52%, TSM +6.33%, NVDA +2.77%, 0005.HK −2.55%, ULVR.L, MSFT) and the full
  timeframe row (1D/5D/1M/3M/6M/1Y/5Y). Proof: `artifacts/ios-simulator-working.png`.
- The simulator shares the Mac's network stack, so the backend at
  `http://127.0.0.1:8787/api` is reachable from the app (CORS `*` on `server/app.ts`).

### The exact loop (repeatable)

```bash
# 0. backend must be running (native build fetches a real API, not bundled data)
HOST=0.0.0.0 PORT=8787 npm run server &

# 1. build the web bundle pointed at the reachable API, and copy it into iOS
VITE_API_BASE="http://127.0.0.1:8787/api" npm run native:sync

# 2. Xcode build for the simulator (no signing needed)
npm run ios:build        # -> build/ios/Build/Products/Debug-iphonesimulator/App.app

# 3. install + launch on the booted simulator
npm run ios:run          # boots "iPhone 17", opens DeviceHub, installs, launches
```

> Xcode 27 note: `Simulator.app` was replaced by **DeviceHub** — the UI lives at
> `/Applications/Xcode.app/Contents/Applications/DeviceHub.app` (there is no
> `Simulator.app` under `Contents/Developer/Applications/` any more).
> `xcrun simctl io booted screenshot <file>` captures frames headlessly.

### Live walkthrough in Xcode (open → select → run)

A hands-on version if you want to drive Xcode yourself rather than the npm loop:

1. **Open the project** (not a workspace — Capacitor 8 uses Swift Package
   Manager, so there is no `.xcworkspace` and no CocoaPods step):

   ```bash
   npm run native:open      # = npx cap open ios
   ```

   This opens `ios/App/App.xcodeproj` in Xcode.

2. **Start the backend first** (the app shows real quotes only if the API is
   up — otherwise every screen honestly reports no data):

   ```bash
   VITE_API_BASE="http://127.0.0.1:8787/api" npm run native:sync
   ```

   `native:sync` runs `npm run build` and copies the fresh `dist/` into
   `ios/App/App/public/`, so the shell paints the current UI. The
   `VITE_API_BASE` is what makes the bundled app call `http://127.0.0.1:8787/api`
   instead of a relative path (which resolves to nothing inside
   `capacitor://localhost`).

3. **Pick the target**: in the Xcode toolbar, next to the scheme name **App**,
   choose the **iPhone 17** simulator from the device menu (Window ▸
   Devices and Simulators, or Xcode ▸ Open Developer Tool ▸ DeviceHub in
   Xcode 27, to see/start simulators).

4. **Run**: press **⌘R**. Xcode builds for the simulator (ad-hoc "Sign to Run
   Locally" — no Apple ID needed for a simulator run), installs, and launches
   `com.stockcoach.app`. The first build resolves the
   `capacitor-swift-pm` package over the network, so give it a moment.

5. **Watch the app**: the panel starts away and a discreet ☰ sits in the top
   left; tap it to slide out the sidebar — which carries the **logo**, the
   navigation (一頁睇晒 / K線圖 / 訊號 / 自選 / 分析師 / 股息 / 說明), the theme and
   language controls, and the watchlist. On the chart screen the toolbar is one
   horizontally-scrollable row of category capsules.

6. **Stop** with the ■ button (or ⌘.). To re-run after a web change just repeat
   step 2 then ⌘R — the native shell itself rarely needs rebuilding.

> If a run shows the splash then an empty dashboard, the backend is down or the
> build was made without `VITE_API_BASE`; re-run step 2 and ⌘R.

## TestFlight still blocked (owner-only Apple-account actions)

| # | Requirement | Why it is needed | Current state |
|---|---|---|---|
| 1 | **Full Xcode.app** (~10 GB) | Compiling and archiving an iOS app needs `xcodebuild` | ✅ installed (Xcode 27.2 / 27B52) — simulator builds + runs |
| 2 | **Apple Developer Program** ($99/year) | TestFlight and App Store distribution require a paid membership with a Team ID, signing certificate, and provisioning profile | ❌ `security find-identity -v -p codesigning` → 0 valid identities |
| 3 | Reachable API | A TestFlight build on someone else's phone needs a reachable (ideally HTTPS) API, not `127.0.0.1` | ⚠️ LAN-only today; `127.0.0.1` works for the *simulator* only |
| 4 | App Store Connect record | The app must exist in App Store Connect before a build can be uploaded to TestFlight | ❌ not created |

Steps 2 and 4 require signing in with an Apple Developer account — only the
owner can do them. Once they exist, the archive/upload path is the one below.

## The build path once 1–2 exist

```bash
# 1. point the app at a reachable API and build the web bundle for native
VITE_API_BASE="https://<your-api-host>/api" npm run native:sync

# 2a. build + archive in Xcode
npm run native:open         # opens ios/App/App.xcodeproj
#    → select your Team, set a unique bundle id if needed, Product ▸ Archive
#    → Organizer ▸ Distribute App ▸ App Store Connect ▸ Upload

# 2b. …or build/archive from the command line
xcodebuild -workspace ios/App/App.xcworkspace -scheme App \
  -configuration Release -archivePath build/App.xcarchive archive
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/
xcrun altool --upload-app -f build/App.ipa -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

# 3. App Store Connect ▸ TestFlight ▸ add testers
```

(Those commands require Xcode and a valid signing setup; they are documented here
for when the prerequisites exist.)

## Deciding between two delivery paths

| Path | Needs Xcode locally? | Needs paid Apple account? | Effect |
|---|---|---|---|
| **A. PWA install** (works today) | no | no | Add to Home Screen; standalone icon. Not "an App Store app". |
| **B. TestFlight / App Store** | yes | yes ($99/yr) | Real native app, installable via TestFlight. **This is what the owner asked for.** |

Path B is achievable on this machine **once Xcode is installed and the Apple
Developer membership exists**; there is no way around those two for TestFlight.
