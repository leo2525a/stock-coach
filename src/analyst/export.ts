/**
 * Analyst-workspace plumbing that is not React and not domain maths:
 * CSV/JSON export and the persistent "which sections are open" state.
 *
 * Kept in `src/` (not `shared/`) because it touches the DOM (downloads) and
 * `localStorage`. The *domain* halves — what numbers exist, how they are
 * labelled — stay in `shared/`, which is what keeps them testable without a
 * browser.
 */
import { formatHKTDate } from '../../shared/format';

/* ------------------------------------------------------------------ export */

export interface ExportCell {
  label: string;
  /** Period column header, empty for a label-only row. */
  period?: string;
  value: string;
}

/**
 * A table ready to be written out: a title, the column headers, and the rows.
 *
 * The rows are already *formatted strings*, dashes included, so the exported
 * file says exactly what the screen says. Re-formatting at export time would
 * let the two drift.
 */
export interface ExportTable {
  title: string;
  columns: string[];
  rows: string[][];
}

/** RFC 4180 quoting: wrap in quotes and double any embedded quote. */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** One table → CSV text (CRLF line endings, header row first). */
export function tableToCsv(table: ExportTable): string {
  const lines: string[] = [];
  lines.push([table.title, ...table.columns.slice(1)].map(csvCell).join(','));
  if (table.columns.length > 1) lines.push(table.columns.map(csvCell).join(','));
  for (const row of table.rows) lines.push(row.map(csvCell).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Several tables → one CSV document, separated by a blank line. */
export function tablesToCsv(tables: readonly ExportTable[]): string {
  return tables.map(tableToCsv).join('\r\n');
}

/**
 * A JSON payload that records *when* it was taken — a stale export is misleading.
 *
 * `note` is passed in rather than written here: the export document is
 * user-facing copy, so it comes from the dictionary like every other string.
 */
export function exportJson(
  symbol: string,
  sections: Record<string, unknown>,
  now: number,
  note: string,
): string {
  return `${JSON.stringify(
    {
      symbol,
      exportedAt: new Date(now * 1000).toISOString(),
      note,
      sections,
    },
    null,
    2,
  )}\n`;
}

/**
 * Trigger a client-side download.
 *
 * Uses a Blob + object URL so nothing needs a server round-trip; the URL is
 * revoked on the next tick (revoking immediately can cancel the download in
 * some browsers). A failure is swallowed — an export that does not start is
 * not worth throwing out of a React event handler.
 */
export function downloadText(filename: string, text: string, mime: string): boolean {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

/** `AAPL-analysts-2026-11-06.csv` — the date makes two exports distinguishable. */
export function exportFilename(symbol: string, kind: string, ext: 'csv' | 'json', now: number): string {
  const date = formatHKTDate(now).replace(/[/:]/g, '-');
  return `${symbol}-${kind}-${date}.${ext}`;
}

/* ------------------------------------------------------------- collapse state */

/** Which §C sections are expanded. Closed sections are simply not rendered. */
export type SectionId = 'overview' | 'statements' | 'estimates' | 'ratings';

export const DEFAULT_SECTIONS: Record<SectionId, boolean> = {
  overview: true,
  statements: true,
  estimates: true,
  ratings: true,
};

const SECTIONS_KEY = 'stockcoach.pf.sections';

/** Read the persisted section state; anything corrupt degrades to the default. */
export function readSections(fallback: Record<SectionId, boolean> = DEFAULT_SECTIONS): Record<SectionId, boolean> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const out = { ...fallback };
    for (const id of Object.keys(fallback) as SectionId[]) {
      const v = (parsed as Record<string, unknown>)[id];
      if (typeof v === 'boolean') out[id] = v;
    }
    return out;
  } catch {
    return fallback;
  }
}

export function persistSections(state: Record<SectionId, boolean>): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(state));
  } catch {
    /* a preference is not worth crashing over */
  }
}
