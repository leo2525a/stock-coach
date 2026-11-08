# Independent QA evidence — Stock App v1 Phase 2 (reviewer-owned)

All files here were produced by `debug-reviewer`, NOT the builder.
`./review-evidence/browser-check.ts` is BUILD-OWNED (de-Anglicised by the
builder) and was deliberately not used as evidence.

## Reproduce

```bash
# 1. boot the real app on a throwaway DB (independent server)
PORT=8797 HOST=127.0.0.1 DB_PATH="$PWD/review-evidence/qa-phase2-1435/tmp/qa.db" \
  nohup ./node_modules/.bin/tsx review-evidence/qa-phase2-1435/qa-server.ts > qa-server.log 2>&1 &

# 2. independent browser checks (defaults, i18n leak sweep, responsive,
#    keyboard, chart controls, grouping, dashboard, news, data honesty)
BASE=http://127.0.0.1:8797 ./node_modules/.bin/tsx review-evidence/qa-phase2-1435/qa-browser.ts

# 3. clean console/network probe
BASE=http://127.0.0.1:8797 ./node_modules/.bin/tsx review-evidence/qa-phase2-1435/qa-console.ts
```

## Key artefacts
- `QA-REPORT.md` — verdict + findings + criteria table.
- `qa-browser-report.json`, `qa-browser.log` — browser run.
- `qa-console-report.json` — clean console probe (all empty = clean).
- `build.log`/`build.exit`, `test.log`, `lint.log`/`lint.exit`,
  `verify-runtime.log`/`.exit`, `evidence-chart.log`/`.exit` — gate re-runs.

## Headline finding (see QA-REPORT §2)
`humanAge()` in `shared/format.ts` returns hard-coded English bucketed relative
time, rendered raw in zh-HK ("快取 · 7 min ago", "1 h ago前更新"). SPEC-PHASE2
§A.6/§B/§F.
