/**
 * @vitest-environment jsdom
 *
 * Phase 3 — the button/nav design system and its motion (§B, §D.1, §D.2).
 *
 * §B claims three things: one button scale, motion that is *subtle*, and a
 * reduced-motion user who sees none of it. Each of those is checkable, so this
 * file checks them — component behaviour in jsdom, and the stylesheet by
 * parsing it. Asserting "the CSS file is big" would prove nothing; the
 * assertions below are the ones that fail when the claim stops being true:
 *
 *  - a transition longer than the 400 ms budget → fails (motion stops being subtle);
 *  - a keyframes name that is not defined → fails (silently dead animation);
 *  - the reduced-motion override removed → fails (accessibility regression);
 *  - a collapsed section that still renders its body → fails (§B.3, "簡潔");
 *  - a null figure printed as `0` instead of `—` → fails (§A.3 honesty).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readStylesheet } from './css-source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useT } from '../src/i18n';
import { Segmented, Section, DataTable, NumText, AnimatedNumber, usePrefersReducedMotion } from '../src/analyst/ui';

if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = resolve(__dirname, '..');
// `src/styles.css` is an entry point that imports the modules in `src/styles/`,
// so read the resolved graph: the assertions below are about the rules.
const CSS = readStylesheet(resolve(ROOT, 'src/styles.css'));

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.restoreAllMocks();
});

function mount(ui: React.ReactElement) {
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
}

/** Render a component that needs the i18n context, without the store. */
function mountI18n(ui: React.ReactElement) {
  // `useT` falls back to the key itself when no provider is above it, which is
  // exactly what we want here: the test asserts structure, not copy.
  void useT;
  mount(ui);
}

/* ==================================================================== §B.1 */

describe('§B.1 — one button scale, so no two controls disagree about geometry', () => {
  it('defines the shared button base and its variants', () => {
    // The base selector is the contract: every control hangs off one of these,
    // so no two buttons can disagree about radius / padding / focus ring.
    expect(CSS).toMatch(/\.pf-act-btn\b/);
    expect(CSS, 'the segmented chip row is part of the same control family').toContain('.pf-seg');
    expect(CSS, 'the affirmative variant hangs off the base').toMatch(/\.pf-act-btn\.primary/);
    expect(CSS, 'the on/off variant hangs off the base').toMatch(/\.pf-act-btn\.on/);
    expect(CSS, 'a focus ring must be shared, not per-button').toMatch(/:focus-visible/);
  });

  it('never declares a stray pixel radius on a Phase 3 control instead of the token', () => {
    // A single `border-radius: 9px` is how a design system drifts. The allowed
    // set is deliberate: the radius tokens, pills (999px), circles (50%), a
    // reset (0) and the 2px hairline used by the nav rail and bar tracks.
    const block = phase3Block();
    const radii = [...block.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
    const allowed = /^(var\(--radius(-[a-z]+)?\)|999px|50%|0|2px)$/;
    const bad = radii.filter((r) => !allowed.test(r));
    expect(bad, `un-tokened radii found: ${bad.join(', ')}`).toEqual([]);
  });
});

/* ==================================================================== §B.2 */

/** The Phase 3 slice of the stylesheet (from its banner to end of file). */
function phase3Block(): string {
  const start = CSS.indexOf('Phase 3 — analyst workspace');
  expect(start, 'the Phase 3 CSS banner must exist').toBeGreaterThan(-1);
  return CSS.slice(start);
}

describe('§B.2 — motion is subtle, bounded and never dead', () => {
  it('keeps every transition under the 400 ms budget', () => {
    const block = phase3Block();
    const durations = [
      ...[...block.matchAll(/transition(?:-duration)?:\s*([^;]+);/g)].map((m) => m[1]),
      ...[...block.matchAll(/animation(?:-duration)?:\s*([^;]+);/g)].map((m) => m[1]),
    ];
    expect(durations.length, 'the Phase 3 layer must actually define motion').toBeGreaterThan(0);

    for (const decl of durations) {
      for (const m of decl.matchAll(/([\d.]+)\s*(ms|s)\b/g)) {
        const ms = m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]);
        expect(ms, `"${decl}" exceeds the 400 ms subtle-motion budget`).toBeLessThanOrEqual(400);
      }
    }
  });

  it('every referenced keyframes animation is actually defined', () => {
    const block = phase3Block();
    const defined = new Set([...block.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
    const used = [...block.matchAll(/animation(?:-name)?:\s*([^;]+);/g)]
      .flatMap((m) => m[1].split(/\s+/))
      .filter((tok) => /^[a-z][\w-]*$/i.test(tok) && !/^\d/.test(tok) && !['none', 'infinite', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'alternate', 'forwards', 'both', 'forwards'].includes(tok));

    for (const name of used) {
      // A bare word in an animation shorthand can only be a keyframes name.
      if (!defined.has(name)) {
        // Durations/timing words were filtered; anything left must be defined.
        expect(defined, `animation "${name}" has no @keyframes definition`).toContain(name);
      }
    }
  });

  it('the global reduced-motion override is present and uses !important', () => {
    expect(CSS).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    const block = CSS.slice(CSS.indexOf('prefers-reduced-motion: reduce'));
    expect(block).toMatch(/transition:\s*none\s*!important/);
    expect(block).toMatch(/animation:\s*none\s*!important/);
  });

  it('usePrefersReducedMotion follows the media query and defaults to no motion', () => {
    const listeners: Array<(e: { matches: boolean }) => void> = [];
    const mq = {
      matches: true,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', vi.fn(() => mq));

    function Probe() {
      return <span data-testid="rm">{String(usePrefersReducedMotion())}</span>;
    }
    mountI18n(<Probe />);
    expect(container.querySelector('[data-testid="rm"]')!.textContent).toBe('true');

    // A live change to "no preference" must be picked up.
    act(() => {
      for (const cb of listeners) cb({ matches: false });
    });
    expect(container.querySelector('[data-testid="rm"]')!.textContent).toBe('false');
  });
});

describe('§B.2 — AnimatedNumber counts only on a value change, never on first paint', () => {
  it('renders the value immediately on mount and does not schedule an animation', () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    mountI18n(<AnimatedNumber value={123.456} format={(n) => (n ?? 0).toFixed(2)} />);
    // First paint shows the real number, not 0.
    expect(container.textContent).toContain('123.46');
    expect(raf, 'first paint must not animate from a fabricated 0').not.toHaveBeenCalled();
  });

  it('respects reduced motion by snapping straight to the new value', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    mountI18n(<AnimatedNumber value={10} format={(n) => (n ?? 0).toFixed(0)} />);
    act(() => {
      root!.render(<AnimatedNumber value={20} format={(n) => (n ?? 0).toFixed(0)} />);
    });
    expect(container.textContent).toContain('20');
  });
});

/* ==================================================================== §B.3 */

describe('§B.3 — sections unmount their body when collapsed (簡潔, not 亂)', () => {
  it('a closed section renders no body content', () => {
    mountI18n(
      <Section id="estimates" title="Estimates" open={false} onToggle={() => {}}>
        <p data-testid="body">deep content</p>
      </Section>,
    );
    expect(container.querySelector('[data-testid="body"]')).toBeNull();
    expect(container.querySelector('.pf-section')!.className).not.toMatch(/\bopen\b/);
  });

  it('an open section renders its body and marks the caret', () => {
    mountI18n(
      <Section id="estimates" title="Estimates" open onToggle={() => {}}>
        <p data-testid="body">deep content</p>
      </Section>,
    );
    expect(container.querySelector('[data-testid="body"]')).not.toBeNull();
    const sec = container.querySelector('.pf-section')!;
    expect(sec.className).toMatch(/\bopen\b/);
    expect(sec.querySelector('.pf-caret')!.className).toMatch(/\bopen\b/);
  });

  it('toggling calls back exactly once per click', () => {
    const onToggle = vi.fn();
    mountI18n(
      <Section id="estimates" title="Estimates" open={false} onToggle={onToggle}>
        <p>x</p>
      </Section>,
    );
    act(() => {
      (container.querySelector('.pf-section-toggle') as HTMLElement).click();
    });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

/* ==================================================================== §B.1 */

describe('§B.1 — Segmented is one control everywhere', () => {
  const options = [
    { id: 'ltm' as const, label: 'LTM' },
    { id: 'quarter' as const, label: 'Quarterly' },
    { id: 'annual' as const, label: 'Annual' },
  ];

  it('marks exactly one option active and fires onChange with its id', () => {
    const onChange = vi.fn();
    mountI18n(<Segmented options={options} value="quarter" onChange={onChange} ariaLabel="Period" />);
    const active = container.querySelectorAll('.pf-seg button.active');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toBe('Quarterly');

    act(() => {
      (container.querySelectorAll('.pf-seg button')[2] as HTMLElement).click();
    });
    expect(onChange).toHaveBeenCalledWith('annual');
  });

  it('renders the accessible checked state for a screen reader', () => {
    mountI18n(<Segmented options={options} value="ltm" onChange={() => {}} ariaLabel="Period" />);
    const group = container.querySelector('.pf-seg')!;
    expect(group.getAttribute('role')).toBe('radiogroup');
    expect(group.getAttribute('aria-label')).toBe('Period');
    const buttons = [...container.querySelectorAll('.pf-seg button')] as HTMLButtonElement[];
    expect(buttons[0].getAttribute('aria-checked')).toBe('true');
    expect(buttons[1].getAttribute('aria-checked')).toBe('false');
    // Roving tabindex: only the active chip is reachable by Tab.
    expect(buttons[0].tabIndex).toBe(0);
    expect(buttons[1].tabIndex).toBe(-1);
  });
});

/* ==================================================================== §A.3 */

describe('§A.3 — the table prints an em dash for a null, never a zero', () => {
  it('renders every null cell as the placeholder', () => {
    const cols = [
      { key: 'eps', label: 'EPS' },
      { key: 'rev', label: 'Revenue', align: 'right' as const },
    ];
    // Cells are ReactNode, so a null goes through NumText — the single place
    // that decides what a missing number looks like.
    const rows = [[<NumText key="a" value={null} />, <NumText key="b" value={null} />]];
    mountI18n(<DataTable columns={cols} rows={rows} />);
    const text = container.textContent ?? '';
    expect(text).toContain('—');
    // A fabricated zero would look exactly like real data — forbid it.
    expect(text).not.toMatch(/\b0(\.0+)?\b/);
  });

  it('NumText shows the dash for null and the digits for a number', () => {
    mountI18n(
      <div>
        <NumText value={null} />
        <NumText value={3.14159} digits={2} />
      </div>,
    );
    expect(container.textContent).toContain('—');
    expect(container.textContent).toContain('3.14');
  });
});

/* ==================================================================== §D.2 */

describe('§D.2 — the stylesheet carries the responsive rules the browser evidence checks', () => {
  it('defines the narrow-width media queries the screen reflows at', () => {
    // The screen reflows at 900 / 560; the *evidence* pass then measures 390 /
    // 834 / 1600 px viewports against it. Both halves must be true, so assert
    // the query here and let the browser pass (scripts/evidence-phase3.mjs)
    // assert the measured widths.
    const block = phase3Block();
    expect(block, 'the tablet reflow query must exist').toMatch(/@media\s*\(max-width:\s*900px\)/);
    expect(block, 'the phone reflow query must exist').toMatch(/@media\s*\(max-width:\s*560px\)/);
  });

  it('guards against horizontal overflow on the smallest width', () => {
    const block = phase3Block();
    expect(CSS, 'wide tables must scroll inside their own box').toMatch(/\.pf-table-wrap[\s\S]{0,200}overflow-x:\s*auto/);
    expect(block, 'grid children must be allowed to shrink').toMatch(/min-width:\s*0/);
    // No fixed width may exceed the 390 px viewport.
    const widths = [...block.matchAll(/(?<!max-|min-)width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(widths.filter((w) => w > 390), 'a fixed width wider than the phone viewport forces overflow').toEqual([]);
  });

  it('the nav rail class the Sidebar renders is defined', () => {
    expect(CSS).toContain('.side-item');
    expect(CSS).toContain('.side-rail');
  });
});

/* ============================================================== sanity guard */

describe('phase 3 test fixture', () => {
  it('the stylesheet is the real file, not a stub', () => {
    expect(existsSync(resolve(ROOT, 'src/styles.css'))).toBe(true);
    expect(CSS.length).toBeGreaterThan(20_000);
    expect(CSS).toContain('--radius-sm');
  });
});
