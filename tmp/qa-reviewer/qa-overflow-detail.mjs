#!/usr/bin/env node
/** Focused probe: what exactly spills at 390px, and is it reachable? */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PORT = 8902;
const DB = `/tmp/qa-ovf-${PORT}.db`;
if (existsSync(DB)) rmSync(DB);
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Users/love21/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium'].find((p) => existsSync(p));

const srv = spawn('npx', ['tsx', 'server/index.ts'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB, HOST: '127.0.0.1' }, stdio: 'ignore',
});
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const tab = page.locator('text=/analyst|分析/i').first();
if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(1500); }

const detail = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;
    // walk ancestors, record overflow-x chain
    const chain = [];
    let p = el.parentElement;
    let reachable = false;
    while (p) {
      const ov = getComputedStyle(p).overflowX;
      chain.push(`${p.tagName}.${String(p.className).slice(0, 30)}:${ov}`);
      if (ov === 'auto' || ov === 'scroll') { reachable = true; break; }
      p = p.parentElement;
    }
    out.push({
      tag: el.tagName,
      cls: String(el.className).slice(0, 50),
      right: Math.round(r.right),
      width: Math.round(r.width),
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      ownOverflowX: getComputedStyle(el).overflowX,
      reachableViaScroller: reachable,
      chain: chain.slice(0, 6),
    });
  }
  // also: is there any element with horizontal scroll capability?
  const scrollers = [...document.querySelectorAll('*')]
    .filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1)
    .map((e) => `${e.tagName}.${String(e.className).slice(0, 40)} scrollW=${e.scrollWidth} clientW=${e.clientWidth}`);
  return { vw, count: out.length, scrollers, sample: out.filter((o) => !o.reachableViaScroller).slice(0, 12) };
});
console.log(JSON.stringify(detail, null, 2));
await browser.close();
srv.kill('SIGTERM');
