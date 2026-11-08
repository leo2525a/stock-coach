/**
 * §C.5 — price targets, ratings distribution, ratings trend, and recent actions.
 *
 * The single most important thing this panel gets right: the **price line is
 * real history and the target band is a current level**. Yahoo keeps no
 * historical target series (RECON-PHASE3 §1), so the band is drawn once, across
 * today, with `pf.rat.band.note` saying so in both languages. A chart that
 * implied a time series of targets would be a fabrication, and it is the kind
 * that looks most convincing.
 *
 * The span switch (MTD…10Y) therefore applies to the *price history only*.
 */
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useStore, selectHistory } from '../store';
import { CountBar, DataTable, NoData, Section, Segmented, dirClass, useMoney, type Column } from '../analyst/ui';
import { PriceSeriesChart } from './PriceSeriesChart';
import { useRefColors } from '../chart/theme';
import { AnimatedNumber } from '../analyst/ui';
import { formatNumber, formatPercent, formatPrice, humanAge } from '../../shared/format';
import { recommendationLabel } from '../../shared/i18n/terminology';
import { SPANS, SPAN_INTERVAL, spanRange, type Span } from '../../shared/fx';
import { useLang } from '../i18n';

const SPAN_LABELS: Record<Span, string> = {
  mtd: 'MTD',
  '1m': '1M',
  qtd: 'QTD',
  '3m': '3M',
  '6m': '6M',
  ytd: 'YTD',
  '1y': '1Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

/** Bucket period token → a translated month label. */
function bucketLabel(t: ReturnType<typeof useT>, period: string): string {
  // Provider tokens are `0m` (current) and `-1m`, `-2m`, `-3m` (months back).
  const m = /^(-?\d+)m$/.exec(period);
  if (!m) return period;
  const n = Number(m[1]);
  if (n === 0) return t('pf.rat.bucket');
  return `${t('pf.rat.bucket')} ${n}`;
}

export function RatingsSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT();
  const ratings = useStore((s) => s.ratings);
  const load = useStore((s) => s.analystLoad);

  return (
    <Section id="ratings" title={t('pf.tab.ratings')} open={open} onToggle={onToggle}>
      {!ratings ? (
        <p className="pf-empty">{load.status === 'loading' ? t('pf.section.loading') : t('pf.empty.panel')}</p>
      ) : ratings.ratings.buckets.length === 0 && ratings.ratings.targetMean === null ? (
        <p className="pf-empty" data-testid="pf-rat-none">{t('pf.rat.none')}</p>
      ) : (
        <>
          <TargetBand />
          <Distribution />
          <Actions />
        </>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------- target band --- */

/** §C.5 — target stats, return potential, and the band against real price. */
function TargetBand() {
  const t = useT();
  const ratings = useStore((s) => s.ratings);
  const symbol = useStore((s) => s.symbol);
  const displayCurrency = useStore((s) => s.displayCurrency);
  const [span, setSpan] = useState<Span>('1y');
  const interval = SPAN_INTERVAL[span];
  const candles = useStore(selectHistory(symbol, spanRange(span), interval));
  const loadHistory = useStore((s) => s.loadHistory);
  const { toDisplay } = useMoney();
  // Theme-aware reference-line colours (Phase 5 QA N1): resolved at runtime so
  // the target-mean line clears contrast on white in light mode. Declared before
  // any early return, per the rules of hooks.
  const ref = useRefColors();

  useEffect(() => {
    void loadHistory(spanRange(span), interval);
  }, [loadHistory, span, interval, symbol]);

  if (!ratings) return null;

  const target = ratings.target;
  const cur = ratings.currency;
  // Convert the band with the same helper the tables use, so a converted target
  // and a converted price cannot disagree.
  const money = (v: number | null) => {
    const c = toDisplay(v, cur);
    return c.amount === null ? null : formatPrice(c.amount, c.currency);
  };

  const priceNow = toDisplay(ratings.price, cur).amount;
  const low = toDisplay(target.low, cur).amount;
  const high = toDisplay(target.high, cur).amount;
  const inside =
    priceNow === null || low === null || high === null
      ? null
      : priceNow > high
        ? 'pf.rat.band.above'
        : priceNow < low
          ? 'pf.rat.band.below'
          : 'pf.rat.band.inside';

  // Only real levels become price lines; a missing target contributes none.
  const lines = [
    { value: toDisplay(target.low, cur).amount, color: ref.low, title: t('pf.rat.low'), dashed: true },
    { value: toDisplay(target.mean, cur).amount, color: ref.mean, title: t('pf.rat.mean') },
    { value: toDisplay(target.high, cur).amount, color: ref.high, title: t('pf.rat.high'), dashed: true },
  ];

  return (
    <div className="pf-band" data-testid="pf-band">
      <h4 className="pf-subtitle">{t('pf.rat.band.title')}</h4>
      <div className="pf-meta-row">
        <span className="pf-hint">{t('pf.rat.band.span')}</span>
        <Segmented
          options={SPANS.map((s) => ({ id: s, label: SPAN_LABELS[s] }))}
          value={span}
          onChange={setSpan}
          ariaLabel={t('pf.rat.band.span')}
          testId="pf-band-span"
          size="sm"
        />
      </div>

      {candles === null ? (
        <p className="pf-hint" data-testid="pf-band-nohistory">{t('pf.rat.band.noHistory')}</p>
      ) : (
        <PriceSeriesChart candles={candles} lines={lines} height={170} testId="pf-band-chart" />
      )}
      <div className="pf-legend" aria-hidden="true">
        <span>{t('pf.rat.band.legendPrice')}</span>
        <span>{t('pf.rat.band.legendTarget')}</span>
      </div>
      <p className="pf-hint" data-testid="pf-band-note">{t('pf.rat.band.note')}</p>

      <div className="pf-facts" data-testid="pf-band-facts">
        <Fact k={t('pf.rat.low')} v={money(target.low)} />
        <Fact k={t('pf.rat.mean')} v={money(target.mean)} />
        <Fact k={t('pf.rat.median')} v={money(target.median)} />
        <Fact k={t('pf.rat.high')} v={money(target.high)} />
        <Fact k={t('pf.rat.currentPrice')} v={money(ratings.price)} />
        <Fact
          k={t('pf.rat.upside')}
          v={target.upsidePct === null ? null : formatPercent(target.upsidePct * 100)}
          dirValue={target.upsidePct}
        />
        <Fact k={t('pf.rat.oneYear')} v={ratings.oneYearReturn === null ? null : formatPercent(ratings.oneYearReturn * 100)} dirValue={ratings.oneYearReturn} />
        <Fact k={t('pf.rat.analysts')} v={target.analysts === null ? null : formatNumber(target.analysts, 0)} />
        <Fact k={t('pf.rat.score')} v={ratings.ratings.recommendationMean === null ? null : formatNumber(ratings.ratings.recommendationMean, 2)} hint={t('pf.rat.scoreHint')} />
        <Fact k={t('pf.currency.switch')} v={displayCurrency} />
      </div>
      {inside ? <p className="pf-hint" data-testid="pf-band-position">{t(inside)}</p> : null}
    </div>
  );
}

/** A label/value pair that can be missing, with an optional signed colour. */
function Fact({
  k,
  v,
  hint,
  dirValue,
}: {
  k: string;
  v: string | null;
  hint?: string;
  dirValue?: number | null;
}) {
  const cls = dirClass(dirValue);
  return (
    <div className="pf-fact">
      <dt>{k}</dt>
      <dd title={hint} className={cls || undefined}>
        {v === null ? <NoData /> : v}
      </dd>
    </div>
  );
}

/* --------------------------------------------------------- distribution --- */

/** §C.5 — the buy/hold/sell counts, the composite score and the month trend. */
function Distribution() {
  const t = useT();
  const lang = useLang();
  const ratings = useStore((s) => s.ratings);
  if (!ratings) return null;

  const buckets = ratings.ratings.buckets;
  const current = buckets.find((b) => b.period === '0m') ?? buckets[0] ?? null;
  const rowOf = (b: typeof current) =>
    b === null ? [] : [
      b.strongBuy ?? 0,
      b.buy ?? 0,
      b.hold ?? 0,
      b.sell ?? 0,
      b.strongSell ?? 0,
    ];
  const counts = rowOf(current);
  const max = counts.length ? Math.max(...counts) : 0;

  const keys = ['pf.rat.strongBuy', 'pf.rat.buy', 'pf.rat.hold', 'pf.rat.sell', 'pf.rat.strongSell'] as const;

  return (
    <div className="pf-dist" data-testid="pf-dist">
      <h4 className="pf-subtitle">{t('pf.rat.distribution')}</h4>
      {/* The bar is the visual; the number is the fact. Both are rendered, and
          the count is real text so it is announced. */}
      <ul className="pf-dist-list">
        {keys.map((k, i) => (
          <li key={k}>
            <span className="pf-dist-label">{t(k)}</span>
            <CountBar value={current === null ? null : counts[i]} max={max} per={`${counts[i] ?? 0}`} />
          </li>
        ))}
      </ul>

      <div className="pf-facts">
        <div className="pf-fact">
          <dt>{t('pf.rat.score')}</dt>
          <dd title={t('pf.rat.scoreHint')} data-testid="pf-rec-mean">
            <AnimatedNumber value={ratings.ratings.recommendationMean} format={(v) => formatNumber(v, 2)} />
            {ratings.ratings.recommendationKey ? (
              <span className="pf-tag soft" data-testid="pf-rec-key">
                {recommendationLabel(ratings.ratings.recommendationKey, lang)}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="pf-fact">
          <dt>{t('pf.rat.analysts')}</dt>
          <dd>
            <AnimatedNumber value={ratings.ratings.numberOfAnalystOpinions} format={(v) => formatNumber(v, 0)} />
          </dd>
        </div>
      </div>

      {buckets.length > 1 ? (
        <>
          <h4 className="pf-subtitle">{t('pf.rat.trend')}</h4>
          <DataTable
            dense
            testId="pf-rat-trend"
            columns={[
              { key: 'b', label: t('pf.rat.bucket') },
              { key: 'sb', label: t('pf.rat.strongBuy'), align: 'right' },
              { key: 'b2', label: t('pf.rat.buy'), align: 'right' },
              { key: 'h', label: t('pf.rat.hold'), align: 'right' },
              { key: 's', label: t('pf.rat.sell'), align: 'right' },
              { key: 'ss', label: t('pf.rat.strongSell'), align: 'right' },
            ]}
            rows={buckets.map((b) => [
              bucketLabel(t, b.period),
              numCell(b.strongBuy),
              numCell(b.buy),
              numCell(b.hold),
              numCell(b.sell),
              numCell(b.strongSell),
            ])}
          />
        </>
      ) : null}
    </div>
  );
}

function numCell(v: number | null): React.ReactNode {
  return v === null ? <NoData /> : formatNumber(v, 0);
}

/* -------------------------------------------------------------- actions --- */

/** §C.5 — the recent firm actions, newest first, capped server-side. */
function Actions() {
  const t = useT();
  const ratings = useStore((s) => s.ratings);
  if (!ratings) return null;

  const cols: Column[] = [
    { key: 'd', label: t('pf.rat.date') },
    { key: 'f', label: t('pf.rat.firm') },
    { key: 'from', label: t('pf.rat.from') },
    { key: 'to', label: t('pf.rat.to') },
    { key: 'a', label: t('pf.rat.action') },
    { key: 't', label: t('pf.rat.currentTarget'), align: 'right' },
  ];

  return (
    <div className="pf-actions-list" data-testid="pf-rat-actions">
      <h4 className="pf-subtitle">{t('pf.rat.actions')}</h4>
      {ratings.actions.length === 0 ? (
        <p className="pf-hint" data-testid="pf-rat-actions-none">{t('pf.rat.actions.none')}</p>
      ) : (
        <DataTable
          dense
          testId="pf-rat-actions-table"
          columns={cols}
          rows={ratings.actions.map((a) => [
            a.dateLabel !== null ? (
              <span key="d" title={a.at === null ? undefined : humanAge(Math.max(0, Math.floor(Date.now() / 1000) - a.at), t)}>
                {a.dateLabel}
              </span>
            ) : (
              <NoData key="d" />
            ),
            a.firm ?? <NoData key="f" />,
            a.fromGrade ?? <NoData key="fr" />,
            a.toGrade ?? <NoData key="to" />,
            a.action ?? <NoData key="a" />,
            a.currentPriceTarget === null ? <NoData key="t" /> : formatPrice(a.currentPriceTarget),
          ])}
        />
      )}
    </div>
  );
}
