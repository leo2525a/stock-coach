/**
 * REVIEWER focused probe #2 — scope of the pane-toggle blanking defect.
 *   - Does it also affect the Dashboard chart?
 *   - Does changing the timeframe (which changes `interval`) recover the chart?
 *   - Does a full page reload recover it?
 * Prints canvas-distinct-colour counts as the objective signal.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });

const stats = (page: Page) => page.evaluate(() => {
  const src = document.querySelector('[data-testid="chart-canvas"] canvas') as HTMLCanvasElement | null;
  if (!src) return -1;
  const off = document.createElement('canvas'); off.width = src.width; off.height = src.height;
  const ctx = off.getContext('2d')!; ctx.drawImage(src, 0, 0);
  const { data } = ctx.getImageData(0, 0, off.width, off.height);
  const seen = new Set<number>();
  for (let i = 0; i < data.length; i += 4 * 13) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  return seen.size;
});
const hit = async (page: Page, label: RegExp) => { await page.locator(`[data-testid="chart-toolbar"] button`, { hasText: label }).first().click(); await page.waitForTimeout(900); };
const nav = async (page: Page, l: string) => { await page.locator('nav.nav button', { hasText: new RegExp(`^${l}$`) }).first().click(); await page.waitForTimeout(500); };

async function main() {
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const srv: ChildProcess = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(ROOT, 'review-evidence', 'live-server.ts')], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(tmpdir(), `rv-dash-${Date.now()}.db`) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr!.on('data', (d) => process.stdout.write(`[srv:err] ${d}`));
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(300); }

  const browser = await chromium.launch({ executablePath: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)!, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  // Start from clean localStorage so defaults apply.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dashboard-screen"]');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0, null, { timeout: 25000 });
  await page.waitForTimeout(1500);

  console.log('=== DASHBOARD chart ===');
  console.log('  baseline distinct colours:', await stats(page));
  await hit(page, /^RSI$/);
  console.log('  after toggling RSI pane ON :', await stats(page), '(data-bar-count=' + await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count') + ')');
  await hit(page, /^SMA 20$/);
  console.log('  after toggling SMA 20 overlay:', await stats(page), '(recovery expected)');
  await hit(page, /^MACD$/);
  console.log('  after toggling MACD pane ON:', await stats(page));

  console.log('\n=== CHART screen: does a timeframe change recover it? ===');
  await nav(page, 'Chart');
  await page.waitForSelector('[data-testid="chart-screen"]');
  await page.waitForTimeout(1200);
  console.log('  chart-screen baseline       :', await stats(page));
  // leave it blank deliberately
  await hit(page, /^RSI$/);
  console.log('  after pane toggle (blank?)  :', await stats(page));
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^1M$/ }).first().click();
  await page.waitForTimeout(2500);
  console.log('  after timeframe -> 1M       :', await stats(page));
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^1Y$/ }).first().click();
  await page.waitForTimeout(2500);
  console.log('  after timeframe -> 1Y       :', await stats(page));

  console.log('\n=== full reload (localStorage now has RSI pane ON) ===');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dashboard-screen"]');
  await page.waitForTimeout(4000);
  console.log('  after reload (dashboard)    :', await stats(page));

  await browser.close(); srv.kill('SIGTERM');
}
main().catch((e) => { console.error(e); process.exit(1); });
