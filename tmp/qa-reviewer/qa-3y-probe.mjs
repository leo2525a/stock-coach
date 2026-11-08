#!/usr/bin/env node
/** Targeted probe: when the analyst "3Y" span is chosen, what does the app request? */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PORT = 8903;
const DB = `/tmp/qa-3y-${PORT}.db`;
if (existsSync(DB)) rmSync(DB);
const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Users/love21/Library/Caches/ms-playwright/chromium-1200/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium'].find((p) => existsSync(p));

const srv = spawn('npx', ['tsx', 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: DB, HOST: '127.0.0.1' }, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
const reqs = [];
page.on('request', (r) => { if (r.url().includes('/api/market')) reqs.push(r.url()); });
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const tab = page.locator('text=/analyst|分析/i').first();
if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(2000); }

// Find the ratings target-band span buttons and click "3Y".
const before = reqs.length;
const y3 = page.locator('button:has-text("3Y"), [role="button"]:has-text("3Y")').first();
let clicked = false;
if (await y3.count()) { await y3.click().catch(() => {}); clicked = true; await page.waitForTimeout(2500); }
const after = reqs.slice(before);
console.log('3Y button found:', clicked);
console.log('market requests triggered by the click:');
for (const u of after) console.log('  ', u.replace(`http://127.0.0.1:${PORT}`, ''));

// Also read the panel's own rendered numbers for sanity.
const txt = await page.evaluate(() => document.body.innerText);
const m = txt.match(/過去一年回報\s*\|?\s*([+-]?[\d.]+%|—)/) || txt.match(/1-YEAR RETURN\s*\|?\s*([+-]?[\d.]+%|—)/);
console.log('rendered 1Y return token:', m ? m[1] : '(not found)');

await browser.close();
srv.kill('SIGTERM');
