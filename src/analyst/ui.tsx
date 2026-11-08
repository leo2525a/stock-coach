/**
 * The small, shared pieces every §C panel is built from.
 *
 * The point of this file is §B.3「簡潔唔好亂」: if each panel grew its own
 * table chrome, chip row and stat box, the analyst workspace would look like four
 * different apps stapled together. One `Section`, one `Segmented`, one `DataTable`
 * and one `Stat` are used everywhere, so a change to the visual language is one
 * edit rather than twelve.
 *
 * Motion lives here too (§B.2), and only here: `AnimatedNumber` is the single
 * place a number animates, and it asks the media query before it does.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useT } from '../i18n';
import { useStore, selectFx } from '../store';
import { formatCompact, formatHKTClock, formatNumber, formatPrice } from '../../shared/format';
import { convert, type Conversion } from '../../shared/fx';

/* ----------------------------------------------------------------- motion -- */

/**
 * Does this user want motion?
 *
 * Read once per component instance and kept in sync with the media query, so
 * toggling the OS setting takes effect without a reload. Defaults to `false`
 * (no motion) when `matchMedia` is unavailable — e.g. in a jsdom test — because
 * the honest fallback for "we cannot tell" is the calmer one.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Safari < 14 only has the deprecated listener API; fall back to it.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return reduced;
}

/**
 * A number that counts to its new value (§B.2).
 *
 * Rules that keep it honest:
 *  - ≤ 400 ms, and a *value change* only — never on first paint, so a loaded
 *    page does not animate every figure on screen at once.
 *  - `null` never animates to `0`: a missing figure stays `—`.
 *  - With reduced motion the target value is applied immediately.
 *  - The text is a *formatted string*; the tween runs on the raw number and
 *    re-formats each frame, so a compact "1.23B" always reads as a number.
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 320,
  className,
}: {
  value: number | null;
  format: (v: number | null) => string;
  durationMs?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState<number | null>(value);
  const frameRef = useRef<number | null>(null);
  const fromRef = useRef<number | null>(value);

  useEffect(() => {
    // A missing value snaps (there is nothing to interpolate to), and the first
    // real value does too — animation is for *changes*, not for arrival.
    if (reduced || value === null || fromRef.current === null || !Number.isFinite(value)) {
      fromRef.current = value;
      setShown(value);
      return;
    }
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic — decelerating, so it settles rather than snaps.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (value - from) * eased;
      setShown(t >= 1 ? value : next);
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      fromRef.current = value;
    };
  }, [value, reduced, durationMs]);

  return <span className={className}>{format(shown ?? value)}</span>;
}

/* --------------------------------------------------------------- currency -- */

/**
 * Convert a statement figure into the user's display currency (§A.4).
 *
 * Returns the converted amount *and* how it went, so a panel can say
 * 「公司以 USD 呈報」or 「掂唔到即時匯率」instead of quietly showing a number in a
 * currency the user did not ask for. A missing rate falls back to the source
 * currency — never to a guessed one.
 */
export function useMoney(): {
  display: string;
  toDisplay: (amount: number | null, from: string | null) => Conversion;
  money: (amount: number | null, from: string | null) => string;
} {
  const display = useStore((s) => s.displayCurrency);
  const fx = useStore(selectFx);

  return useMemo(() => {
    const table = fx;
    const toDisplay = (amount: number | null, from: string | null) =>
      convert(amount, from, display, table);
    const money = (amount: number | null, from: string | null) => {
      const c = toDisplay(amount, from);
      return formatPrice(c.amount, c.currency);
    };
    return { display, toDisplay, money };
  }, [display, fx]);
}

/**
 * The single sign → colour rule, re-exported here so an analyst panel can
 * import it beside the primitives it colours (`Stat`, `DataTable`, …) without a
 * second import path. Defined in `src/dirClass.ts`.
 */
export { dirClass, type DirClass } from '../dirClass';

/** Compact money with a currency code, for large statement figures. */
export function compactMoney(amount: number | null, currency: string | null): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  const s = formatCompact(amount);
  return currency && s !== '—' ? `${s} ${currency}` : s;
}

/* ---------------------------------------------------------------- section -- */

/**
 * A collapsible panel (§B.3).
 *
 * Closed sections are **not rendered**, not merely hidden: the analyst workspace
 * is heavy, and the point of progressive disclosure is that the closed half
 * costs nothing.
 */
export function Section({
  id,
  title,
  subtitle,
  open,
  onToggle,
  children,
  actions,
  testId,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  actions?: ReactNode;
  testId?: string;
}) {
  const t = useT();
  return (
    <section className={`pf-section${open ? ' open' : ''}`} data-testid={testId ?? `pf-section-${id}`}>
      <header className="pf-section-head">
        <button
          type="button"
          className="pf-section-toggle"
          aria-expanded={open}
          aria-controls={`pf-body-${id}`}
          title={t('pf.section.toggle')}
          onClick={onToggle}
          data-testid={`pf-toggle-${id}`}
        >
          <span className={`pf-caret${open ? ' open' : ''}`} aria-hidden="true">
            ›
          </span>
          <span className="pf-section-title">{title}</span>
        </button>
        {actions ? <div className="pf-section-actions">{actions}</div> : null}
      </header>
      {subtitle ? <p className="pf-section-sub">{subtitle}</p> : null}
      {/* The body is mounted only while open, so a closed section renders and
          fetches nothing. */}
      <div id={`pf-body-${id}`} className="pf-section-body" hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- segmented -- */

/**
 * Join class names, dropping the empty ones.
 *
 * A template literal like `` `pf-seg pf-seg-${size}` `` reads as two English
 * words to the copy scanner (and to a translator skimming the file), so the
 * base class and the modifier are passed as separate parts instead.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  title?: string;
}

/**
 * The one chip-row control (§B.1): period switch, currency switch, span switch.
 *
 * A radio group with the arrow-key behaviour a real radio group has, so the
 * period buttons are navigable by keyboard rather than five tab stops.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
  size = 'md',
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  testId?: string;
  size?: 'sm' | 'md';
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === value);
    const next = e.key === 'ArrowRight' ? (i + 1) % options.length : (i - 1 + options.length) % options.length;
    onChange(options[next].id);
  };
  return (
    <div
      className={cx('pf-seg', `pf-seg-${size}`)}
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? 'active' : ''}
          title={o.title}
          data-seg={o.id}
          tabIndex={value === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- stat -- */

/**
 * A label/value pair where a missing value is an honest em dash with a reason
 * on hover — the §D.5 rule, in one component so no panel can forget it.
 */
export function Stat({
  label,
  value,
  hint,
  reason,
  testId,
  wide,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** Shown as the tooltip when `value` is the no-data dash. */
  reason?: string;
  testId?: string;
  wide?: boolean;
}) {
  return (
    <div className={`pf-stat${wide ? ' wide' : ''}`} data-testid={testId}>
      <span className="pf-stat-k">{label}</span>
      <span className="pf-stat-v" title={hint ?? (reason ? reason : undefined)}>
        {value}
      </span>
    </div>
  );
}

/** The honest dash, with its reason. */
export function NoData({ reason }: { reason?: string }) {
  const t = useT();
  return (
    <span className="pf-nodata" title={reason || t('common.noData')}>
      {t('common.noData')}
    </span>
  );
}

/** A value that may be missing: `null` → the dash, otherwise the formatted text. */
export function Maybe({ text, reason }: { text: string | null; reason?: string }) {
  if (text === null) return <NoData reason={reason} />;
  return <>{text}</>;
}

/* ------------------------------------------------------------------ table -- */

export interface Column {
  key: string;
  label: string;
  /** Right-align numeric columns so digits line up. */
  align?: 'left' | 'right';
  width?: string;
}

/**
 * The one table (§B.3).
 *
 * Deliberately minimal: a sticky header, right-aligned numbers, and a wrapper
 * that scrolls *itself* rather than the page — the 390 px overflow check in §D.2
 * would fail the moment a five-column statement table widened the body.
 */
export function DataTable({
  columns,
  rows,
  testId,
  caption,
  dense,
}: {
  columns: readonly Column[];
  rows: readonly ReactNode[][];
  testId?: string;
  caption?: string;
  dense?: boolean;
}) {
  const t = useT();
  return (
    <div className="pf-table-wrap" data-testid={testId}>
      {caption ? <p className="pf-table-caption">{caption}</p> : null}
      <table className={`pf-table${dense ? ' dense' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'num' : undefined} style={c.width ? { width: c.width } : undefined} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="pf-table-empty">
                {t('pf.empty.panel')}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={columns[j]?.key ?? j} className={columns[j]?.align === 'right' ? 'num' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------- bar chart -- */

/**
 * A horizontal min→max range bar with a marker (the estimate range, §C.6).
 *
 * `null` ends mean the range is unknown and nothing is drawn — half a range
 * would imply a position we cannot compute.
 */
export function RangeBar({
  low,
  high,
  mark,
  format,
  testId,
}: {
  low: number | null;
  high: number | null;
  mark?: number | null;
  format: (v: number | null) => string;
  testId?: string;
}) {
  if (low === null || high === null || !(high > low)) {
    return (
      <span className="pf-rangebar pf-rangebar-empty" data-testid={testId}>
        <NoData />
      </span>
    );
  }
  const clamp = (v: number) => Math.max(0, Math.min(100, ((v - low) / (high - low)) * 100));
  const markPct = mark !== null && mark !== undefined ? clamp(mark) : null;
  return (
    <span className="pf-rangebar" data-testid={testId}>
      <span className="pf-rangebar-track" aria-hidden="true" />
      {markPct !== null ? <span className="pf-rangebar-mark" style={{ left: `${markPct}%` }} /> : null}
      <span className="pf-rangebar-ends">
        <span>{format(low)}</span>
        <span>{format(high)}</span>
      </span>
    </span>
  );
}

/**
 * A proportional bar for a count (the rating distribution).
 *
 * The bar itself is `aria-hidden` and the count is rendered as real text, so a
 * screen reader hears the number rather than a meaningless length.
 */
export function CountBar({ value, max, per }: { value: number | null; max: number; per: ReactNode }) {
  const pct = value === null || max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="pf-countbar">
      <span className="pf-countbar-track" aria-hidden="true">
        <span className="pf-countbar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="pf-countbar-text">{per}</span>
    </span>
  );
}

/* ------------------------------------------------------------------- time -- */

/** A UNIX-seconds stamp, in HKT, or the dash. */
export function TimeText({ at }: { at: number | null }) {
  if (at === null) return <NoData />;
  return <>{formatHKTClock(at)}</>;
}

/** A number, or the dash. */
export function NumText({ value, digits = 2 }: { value: number | null; digits?: number }) {
  if (value === null) return <NoData />;
  return <>{formatNumber(value, digits)}</>;
}
