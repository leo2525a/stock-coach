/**
 * Find "dead" controls: click every interactive element at a phone viewport and
 * report which produce NO observable change (screen, theme, lang, drawer,
 * inputs, aria-pressed, visible text). A control listed here is a candidate for
 * the owner's "個 button 冇作用" bug.
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snap = () =>
  (() => {
    const s = document.querySelector('.app');
    return JSON.stringify({
      html: document.documentElement.dataset.theme,
      title: document.title,
      body: document.body.className,
      sidebar: document.querySelector('.sidebar')?.className,
      screens: [...document.querySelectorAll('[data-testid$="-screen"]')].map((e) => e.getAttribute('data-testid')),
      active: document.querySelector('nav.side-nav .side-item.active')?.getAttribute('data-screen') || null,
      pressed: [...document.querySelectorAll('[aria-pressed="true"]')].map((e) => e.textContent?.trim()).join(','),
      txtlen: s ? s.innerText.length : 0,
      txthash: s ? [...s.innerText].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) : 0,
      inputs: [...document.querySelectorAll('input')].map((i) => i.value).join('|'),
    });
  })();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dashboard-screen"]', { timeout: 25000 });
await sleep(1500);

// Inventory every interactive element (with a stable index).
const inv = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button, a[href], [role="button"], input, select')];
  return els.map((el, i) => ({
    i,
    tag: el.tagName.toLowerCase(),
    cls: (el.className || '').toString().slice(0, 60),
    testid: el.getAttribute('data-testid'),
    screen: el.getAttribute('data-screen'),
    label: (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 28),
    vis: !!(el.offsetWidth || el.offsetHeight),
  })).filter((e) => e.vis);
});

console.log(`interactive elements: ${inv.length}`);
const dead = [];
const changed = [];
for (const e of inv) {
  // Reopen a clean, closed context each time so a toggle is measured from the same start.
  await page.evaluate(() => {
    document.querySelectorAll('input').forEach((i) => (i.value = ''));
  });
  const before = await page.evaluate(snap);
  const sel = e.testid
    ? `[data-testid="${e.testid}"]`
    : e.screen
      ? `[data-screen="${e.screen}"]`
      : null;
  let clicked = false;
  try {
    if (sel) {
      await page.locator(sel).first().click({ force: true, timeout: 3000 });
      clicked = true;
    } else {
      const box = await page.evaluate((i) => {
        const el = [...document.querySelectorAll('button, a[href], [role="button"], input, select')].filter((x) => x.offsetWidth || x.offsetHeight)[i];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, e.i);
      if (box) {
        await page.mouse.click(box.x, box.y);
        clicked = true;
      }
    }
  } catch (err) {
    console.log(`  click-fail  #${e.i} <${e.tag}> "${e.label}" — ${err.message.split('\n')[0]}`);
  }
  await sleep(350);
  const after = await page.evaluate(snap);
  const diff = before !== after;
  const tag = `${e.testid ? `[${e.testid}]` : e.screen ? `[nav:${e.screen}]` : `#${e.i}`} <${e.tag}> "${e.label}"`;
  if (!clicked || !diff) {
    dead.push(tag);
    console.log(`DEAD   ${tag}`);
  } else {
    changed.push(tag);
    console.log(`ok     ${tag}`);
  }
  // reset any opened drawer so the next element is reachable
  await page.evaluate(() => {
    const sc = document.querySelector('.scrim.open');
    if (sc) sc.click();
  });
  await sleep(150);
}

console.log(`\n=== ${dead.length} dead of ${inv.length} ===`);
dead.forEach((d) => console.log('  ' + d));
console.log('console errors:', errs.length);
await browser.close();
