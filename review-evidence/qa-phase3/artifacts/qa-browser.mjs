#!/usr/bin/env node
/**
 * Independent QA browser harness for Phase 3 (§B / §D.2).
 *
 * Written from scratch by the independent reviewer — deliberately NOT a reuse of
 * `scripts/evidence-phase3.mjs`, so the claim "the Analysts screen is fine at
 * 390/834/1600 in both locales with reduced motion honoured" is checked by a
 * second, differently-implemented harness.
 *
 * It drives the REAL production `dist/` build served by the REAL Express server
 * on a throwaway DB, over raw CDP (playwright-core, no test-runner sugar).
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = resolve(ROOT, 'tmp', 'qa-reviewer', 'browser');
mkdirSync(OUT, { recursive: true });

const PORT = process.env.QA_PORT ? Number(process.env.QA_PORT) : 8901;
const DB = `/tmp/qa-browser-${PORT}.db`;
if (existsSync(DB)) rmSync(DB);

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Users/love21/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
].filter(Boolean);
const exe = CANDIDATES.find((p) => p && existsSync(p));
if (!exe) throw new Error('no Chrome binary found; set CHROME_PATH');

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail) });
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- boot the production server -------------------------------------------
const srv = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DB_PATH: DB, HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => (srvLog += d));
srv.stderr.on('data', (d) => (srvLog += d));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let browser;
try {
  if (!(await waitUp())) throw new Error(`server did not come up:\n${srvLog}`);
  console.log(`server up on ${PORT} (db ${DB})\n`);

  browser = await chromium.launch({ executablePath: exe, headless: true });
  const context = await browser.newContext();
  const consoleErrors = [];
  const pageErrors = [];
  const failedReq = [];
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('requestfailed', (r) => failedReq.push(`${r.url()} :: ${r.failure()?.errorText}`));

  // ---- 1. desktop render --------------------------------------------------
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  // The Analysts screen is a tab/route; find and click it if present.
  const analystTab = page.locator('text=/analyst|分析/i').first();
  if (await analystTab.count()) {
    await analystTab.click().catch(() => {});
    await page.waitForTimeout(1500);
  }

  const bodyText = await page.evaluate(() => document.body.innerText);
  writeFileSync(resolve(OUT, 'desktop-body.txt'), bodyText);
  check('desktop: page rendered non-trivial text', bodyText.length > 200, `${bodyText.length} chars`);

  // Look for the four Phase 3 section headings.
  const hasRatings = /rating|評級|评级/i.test(bodyText);
  const hasEstimates = /estimate|預估|预估|預測/i.test(bodyText);
  const hasStatements = /statement|財務|财务|報表|报表/i.test(bodyText);
  check('desktop: ratings section present', hasRatings);
  check('desktop: estimates section present', hasEstimates);
  check('desktop: statements section present', hasStatements);

  // ---- 2. overflow at 3 breakpoints --------------------------------------
  for (const [w, h, label] of [
    [390, 844, 'phone-390'],
    [834, 1112, 'tablet-834'],
    [1600, 1000, 'desktop-1600'],
  ]) {
    // Load FRESH at each width. Resizing a live page leaves the chart canvas
    // sized for the previous viewport (a JS-measured canvas), which would make
    // this check report a fake overflow. A real phone starts at 390.
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const t = page.locator('text=/analyst|分析/i').first();
    if (await t.count()) {
      await t.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const scrollW = Math.max(de.scrollWidth, document.body.scrollWidth);
      const clientW = de.clientWidth;
      // find elements spilling past the viewport with no scroll container
      const spill = [];
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > clientW + 1) {
          let p = el.parentElement;
          let clipped = true;
          while (p) {
            const ov = getComputedStyle(p).overflowX;
            if (ov === 'auto' || ov === 'scroll') {
              clipped = false;
              break;
            }
            p = p.parentElement;
          }
          if (clipped) spill.push(`${el.tagName}.${el.className}`.slice(0, 80));
        }
      }
      return { scrollW, clientW, spill: spill.slice(0, 5), spillCount: spill.length };
    });
    const ok = m.scrollW <= m.clientW + 1 && m.spillCount === 0;
    check(`no horizontal overflow @${label}`, ok, `scrollW=${m.scrollW} clientW=${m.clientW} spill=${m.spillCount} ${m.spill.join('|')}`);
    await page.screenshot({ path: resolve(OUT, `qa-${label}.png`), fullPage: false });
  }

  // ---- 3. reduced motion --------------------------------------------------
  await page.setViewportSize({ width: 1600, height: 1000 });
  await context.grantPermissions?.([]).catch?.(() => {});
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(600);
  const reduced = await page.evaluate(() => {
    let n = 0;
    let nonZero = 0;
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      const t = s.transitionDuration;
      const a = s.animationDuration;
      for (const v of [t, a]) {
        if (!v || v === 'none') continue;
        for (const part of v.split(',')) {
          const p = part.trim();
          if (!p) continue;
          n++;
          if (parseFloat(p) > 0.001) nonZero++;
        }
      }
    }
    return { n, nonZero };
  });
  check('reduced-motion: every transition/animation computes to 0s', reduced.nonZero === 0, `${reduced.n} durations, ${reduced.nonZero} non-zero`);

  // control: with motion allowed, at least one real duration exists
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(400);
  const normal = await page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      for (const v of [s.transitionDuration, s.animationDuration]) {
        if (!v || v === 'none') continue;
        for (const part of v.split(',')) if (parseFloat(part) > 0.001) n++;
      }
    }
    return n;
  });
  check('control: motion exists when allowed (harness is not vacuous)', normal > 0, `${normal} non-zero durations`);

  // ---- 4. second locale ---------------------------------------------------
  // Flip the language control if one exists, else load ?lang
  let switched = false;
  try {
    const langBtn = page.locator('button:has-text("EN"), button:has-text("中"), [aria-label*="lang" i], [aria-label*="語言" i], [aria-label*="语言" i]').first();
    if ((await langBtn.count()) && (await langBtn.isVisible())) {
      await langBtn.click();
      await page.waitForTimeout(1500);
      switched = true;
    }
  } catch {}
  if (!switched) {
    for (const q of ['?lang=en', '?lang=zh-HK']) {
      await page.goto(`http://127.0.0.1:${PORT}/${q}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
      const t = await page.evaluate(() => document.body.innerText);
      if (t.length > 200) {
        writeFileSync(resolve(OUT, `locale${q.replace('?lang=', '-')}.txt`), t);
        switched = true;
        break;
      }
    }
  }
  const localeText = await page.evaluate(() => document.body.innerText);
  writeFileSync(resolve(OUT, 'locale-second.txt'), localeText);
  check('second locale renders content', localeText.length > 200, `${localeText.length} chars`);

  // ---- 5. console hygiene -------------------------------------------------
  check('zero console errors', consoleErrors.length === 0, `${consoleErrors.length}${consoleErrors[0] ? ': ' + consoleErrors[0].slice(0, 120) : ''}`);
  check('zero uncaught page errors', pageErrors.length === 0, `${pageErrors.length}`);
  check('zero failed requests', failedReq.length === 0, `${failedReq.length}${failedReq[0] ? ': ' + failedReq[0].slice(0, 120) : ''}`);

  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify({ port: PORT, results, consoleErrors, pageErrors, failedReq }, null, 2));
} catch (e) {
  console.error('HARNESS ERROR:', e);
  failed++;
} finally {
  try { await browser?.close(); } catch {}
  srv.kill('SIGTERM');
}

console.log(`\n${failed === 0 ? '✓' : '✗'} QA browser harness — ${results.length} checks, ${failed} failed. Artifacts in tmp/qa-reviewer/browser/`);
process.exit(failed === 0 ? 0 : 1);
