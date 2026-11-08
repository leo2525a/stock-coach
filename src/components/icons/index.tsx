/**
 * The app's icon set.
 *
 * Geometry comes from CityPulso/PulsoIcon (ISC licence, built on Tabler/Lucide
 * shapes) — see ATTRIBUTION at the bottom. The shapes are reused; the package's
 * animated runtime is deliberately NOT a dependency: importing `pulsoicon-react`
 * pulls framer-motion in wholesale, which measured +54 kB gzip for eleven 17px
 * icons (+28% on a 194 kB bundle). Navigation glyphs that used to be bare
 * characters (◧ ▲ ◎ ★ ? ⊞ ≣) were the actual problem — they do not read as
 * "dashboard", "chart", "signals". These are the same shapes without the
 * animation runtime, so the cost is the path data and nothing else.
 *
 * One component name per file, all drawn on a 24x24 grid with a 1.75 default
 * stroke, so they line up at any size. They inherit `currentColor` and set
 * `fill="none"` unless a node says otherwise, which is what the source shapes
 * assume.
 */
import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Square size in px. Default 18. */
  size?: number;
  /** Stroke width on the 24x24 grid. Default 1.75. */
  strokeWidth?: number;
}

/** PulsoIcon `layout-dashboard` (exported upstream as `LayoutDashboard`). */
export function LayoutDashboard({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </svg>
  );
}

/** PulsoIcon `chart-candlestick` (exported upstream as `ChartCandlestick`). */
export function CandlestickChart({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M9 5v4" />
      <rect width="4" height="6" x="7" y="9" rx="1" />
      <path d="M9 15v2" />
      <path d="M17 3v2" />
      <rect width="4" height="8" x="15" y="5" rx="1" />
      <path d="M17 13v3" />
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    </svg>
  );
}

/** PulsoIcon `radar-2` (exported upstream as `Radar2`). */
export function Radar({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M15.51 15.56a5 5 0 1 0 -3.51 1.44" />
      <path d="M18.832 17.86a9 9 0 1 0 -6.832 3.14" />
      <path d="M12 12v9" />
    </svg>
  );
}

/** PulsoIcon `star` (exported upstream as `Star`). */
export function Star({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

/** PulsoIcon `circle-question-mark` (exported upstream as `CircleQuestionMark`). */
export function CircleHelp({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <circle cx="12" cy="12" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** PulsoIcon `users-four` (exported upstream as `UsersFour`). */
export function Users({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <circle cx="7" cy="4.5" />
      <path d="M3 11.0a6 6 0 0 1 8 0" />
      <circle cx="17" cy="4.5" />
      <path d="M13 11.0a6 6 0 0 1 8 0" />
      <circle cx="7" cy="14" />
      <path d="M3 20.5a6 6 0 0 1 8 0" />
      <circle cx="17" cy="14" />
      <path d="M13 20.5a6 6 0 0 1 8 0" />
    </svg>
  );
}

/** PulsoIcon `receipt-2` (exported upstream as `Receipt2`). */
export function Receipt({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16l-3 -2l-2 2l-2 -2l-2 2l-2 -2l-3 2" />
      <path d="M14 8h-2.5a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-2.5m2 0v1.5m0 -9v1.5" />
    </svg>
  );
}

/** PulsoIcon `moon` (exported upstream as `Moon`). */
export function Moon({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    </svg>
  );
}

/** PulsoIcon `sun` (exported upstream as `Sun`). */
export function Sun({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <circle cx="12" cy="12" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

/** PulsoIcon `refresh-cw` (exported upstream as `RefreshCw`). */
export function RefreshCw({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

/** PulsoIcon `triangle-alert` (exported upstream as `TriangleAlert`). */
export function TriangleAlert({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * ATTRIBUTION
 *
 * Icon geometry from PulsoIcon (https://github.com/CityPulso/PulsoIcon),
 * ISC License, Copyright (c) 2026 CityPulso. Those shapes in turn build on
 * Tabler Icons and Lucide, both MIT licensed:
 *   - Tabler Icons, Copyright (c) 2020-2026 Paweł Kuna
 *   - Lucide, ISC License
 * The animated runtime of PulsoIcon is not used; only the static SVG geometry
 * was copied, with the upstream per-node motion hints (r/a/o) removed.
 */
