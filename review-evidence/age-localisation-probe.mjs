import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
const PORT = 8831;
const server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: '/tmp/b1probe/d.db' },
  stdio: 'ignore',
});
async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { await new Promise((res, rej) => { const r = http.get(`http://127.0.0.1:${PORT}/api/health`, (x) => { x.resume(); res(); }); r.on('error', rej); }); return true; } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return false;
}
const up = await waitUp();
console.log('server up:', up);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="news-list"]', { timeout: 30000 });
await page.waitForTimeout(1200);
const metas = await page.locator('[data-testid="news-list"] .news-meta').allInnerTexts();
console.log('--- news meta (zh-HK) ---');
for (const m of metas.slice(0, 5)) console.log(JSON.stringify(m.replace(/\s+/g, ' ').trim()));
const english = metas.filter(m => /\b(just now|min ago|h ago|d ago|Updated)\b/.test(m));
console.log('metas with English time words:', english.length);
await page.locator('[data-testid="lang-switch"] button[data-lang="en"]').click();
await page.waitForTimeout(500);
const metasEn = await page.locator('[data-testid="news-list"] .news-meta').allInnerTexts();
console.log('--- news meta (en) ---');
for (const m of metasEn.slice(0, 3)) console.log(JSON.stringify(m.replace(/\s+/g, ' ').trim()));
const zhLeak = metasEn.filter(m => /[\u3400-\u9fff]/.test(m));
console.log('en metas containing CJK:', zhLeak.length);
await browser.close();
server.kill();
process.exit(0);
