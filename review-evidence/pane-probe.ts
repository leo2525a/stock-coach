/**
 * REVIEWER focused probe — does toggling a chart SUB-PANE blank the chart?
 *
 * The build effect in src/chart/StockChart.tsx rebuilds the whole chart when the
 * pane flags change, but the data-push effect does NOT depend on the pane flags.
 * If that is a real defect, the freshly-built chart will have no data until some
 * other dependency changes. We probe the canvas over several seconds to rule out
 * a transient "caught mid-rebuild" frame.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'review-evidence');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise<number>((res, rej) => { const s = createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => res(p)); }); });

async function canvasStats(page: import('playwright-core').Page) {
  return page.evaluate(() => {
    const src = document.querySelector('[data-testid="chart-canvas"] canvas') as HTMLCanvasElement | null;
    if (!src) return { missing: true } as any;
    const off = document.createElement('canvas'); off.width = src.width; off.height = src.height;
    const ctx = off.getContext('2d')!; ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 13) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return { distinct: seen.size, w: src.width, h: src.height };
  });
}

async function main() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dbPath = path.join(tmpdir(), `review-panes-${Date.now()}.db`);
  const srv: ChildProcess = spawn(path.join(ROOT, 'node_modules', '.bin', 'tsx'), [path.join(ROOT, 'review-evidence', 'live-server.ts')], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: dbPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr!.on('data', (d) => process.stdout.write(`[srv:err] ${d}`));
  for (let i = 0; i < 60; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} await sleep(300); }

  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)!;
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('nav.nav button', { hasText: /^Chart$/ }).first().click();
  await page.waitForSelector('[data-testid="chart-screen"]');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="chart-wrap"]')?.getAttribute('data-bar-count') || 0) > 0);
  await page.waitForTimeout(1500);

  const sample = async (label: string) => {
    const frames: number[] = [];
    for (let i = 0; i < 5; i += 1) { const s = await canvasStats(page); frames.push(s.distinct ?? -1); await sleep(400); }
    const barCount = await page.locator('[data-testid="chart-wrap"]').getAttribute('data-bar-count');
    console.log(`  ${label}: distinct colours over 2s = [${frames.join(', ')}], data-bar-count=${barCount}`);
    return frames;
  };

  console.log('baseline (volume pane on, from localStorage defaults):');
  await sample('baseline');

  console.log('\ntoggle RSI pane ON:');
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^RSI$/ }).first().click();
  const rsi = await sample('after RSI toggle');
  await page.screenshot({ path: path.join(OUT, 'r09-pane-rsi-toggle.png') });

  console.log('\ntoggle MACD pane ON:');
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^MACD$/ }).first().click();
  const macd = await sample('after MACD toggle');
  await page.screenshot({ path: path.join(OUT, 'r10-pane-macd-toggle.png') });

  console.log('\nnow toggle a NON-pane overlay (SMA 20) — does data come back?');
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^SMA 20$/ }).first().click();
  await sample('after SMA20 toggle');

  console.log('\nnow toggle volume pane OFF then ON:');
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^Volume$/ }).first().click();
  await sample('after volume OFF');
  await page.locator('[data-testid="chart-toolbar"] button', { hasText: /^Volume$/ }).first().click();
  await sample('after volume ON again');

  const verdict = (rsi.every((d) => d <= 2) || macd.every((d) => d <= 2)) ? 'BLANK (defect reproduced)' : 'rendered';
  console.log(`\nPANE-TOGGLE VERDICT: ${verdict}`);
  await browser.close();
  srv.kill('SIGTERM');
}
main().catch((e) => { console.error(e); process.exit(1); });
