import type { Lang } from './index';

/**
 * Finance terminology, English → 繁體中文.
 *
 * Yahoo returns sector / industry / exchange **in English** even for Hong Kong
 * listings. A Chinese-localised app that prints "Communication Services" next to
 * 分區 chips is exactly the "半中半英" feel we are trying to avoid, so the
 * categories go through this table too.
 *
 * Pure data + two pure lookups, so it is trivially unit-testable and never
 * depends on the network. When a term is genuinely unknown we return the English
 * original — never a guess at a translation.
 */

/** Yahoo `assetProfile.sector` values. */
export const SECTORS_ZH: Record<string, string> = {
  Technology: '資訊科技',
  'Communication Services': '通訊服務',
  'Financial Services': '金融服務',
  Financials: '金融',
  Healthcare: '醫療保健',
  'Health Care': '醫療保健',
  'Consumer Cyclical': '非必需消費品',
  'Consumer Discretionary': '非必需消費品',
  'Consumer Defensive': '必需消費品',
  'Consumer Staples': '必需消費品',
  Industrials: '工業',
  Energy: '能源',
  Utilities: '公用事業',
  'Basic Materials': '原材料',
  Materials: '原材料',
  'Real Estate': '房地產',
};

/** Yahoo `quotes[].industry` values we have seen on the four seeded tickers. */
export const INDUSTRIES_ZH: Record<string, string> = {
  'Consumer Electronics': '消費電子',
  'Software—Infrastructure': '軟件（基礎設施）',
  'Software—Application': '軟件（應用）',
  Semiconductors: '半導體',
  'Semiconductor Equipment & Materials': '半導體設備與材料',
  'Internet Content & Information': '互聯網內容與資訊',
  'Banks—Diversified': '多元化銀行',
  'Banks—Regional': '地區銀行',
  'Insurance—Diversified': '多元化保險',
  'Asset Management': '資產管理',
  'Capital Markets': '資本市場',
  'Credit Services': '信貸服務',
  'Financial Conglomerates': '金融集團',
  'Drug Manufacturers—General': '製藥（綜合）',
  'Medical Devices': '醫療器械',
  'Auto Manufacturers': '汽車製造',
  'Aerospace & Defense': '航空航天與國防',
  'Oil & Gas Integrated': '綜合石油及天然氣',
  'Oil & Gas E&P': '石油及天然氣勘探與生產',
  'Utilities—Regulated Electric': '受監管電力公用事業',
  'Telecom Services': '電訊服務',
  'Entertainment': '娛樂',
  'Grocery Stores': '雜貨零售',
  'Beverages—Non-Alcoholic': '非酒精飲料',
  'Restaurants': '餐飲',
  'Apparel Retail': '服裝零售',
  'Specialty Retail': '專門零售',
  'REIT—Retail': '零售房地產信託',
  'Packaged Foods': '包裝食品',
  'Specialty Industrial Machinery': '專用工業機械',
  'Information Technology Services': '資訊科技服務',
};

/**
 * Yahoo `quotes[].exchDisp` / chart `exchangeName` values.
 *
 * `exchDisp` is the human label the provider already gives us ("NASDAQ",
 * "Hong Kong"); the raw `exchangeName` codes are mapped too because the chart
 * endpoint only supplies those.
 */
export const EXCHANGES_ZH: Record<string, string> = {
  NASDAQ: '納斯達克',
  NasdaqGS: '納斯達克',
  NasdaqGM: '納斯達克',
  NasdaqCM: '納斯達克',
  NYSE: '紐約證券交易所',
  'NYSE Arca': '紐約證券交易所（Arca）',
  NYSEArca: '紐約證券交易所（Arca）',
  'Hong Kong': '香港交易所',
  HKSE: '香港交易所',
  HKEX: '香港交易所',
  'Hong Kong Stock Exchange': '香港交易所',
  LSE: '倫敦證券交易所',
  London: '倫敦證券交易所',
  TSE: '東京證券交易所',
  Tokyo: '東京證券交易所',
  SSE: '上海證券交易所',
  SZSE: '深圳證券交易所',
  TSX: '多倫多證券交易所',
  ASX: '澳洲證券交易所',
  'SIX Swiss': '瑞士證券交易所',
  XETRA: '德國證券交易所',
};

/**
 * Yahoo `assetProfile.country` values.
 *
 * The dashboard's profile panel prints the country in Chinese (「美國」), but the
 * category chips used to print the provider's own English string next to them.
 * Both panels now resolve through this table, so the two never disagree in
 * appearance. Unknown countries fall through unchanged — a wrong translation is
 * worse than an honest English name.
 */
export const COUNTRIES_ZH: Record<string, string> = {
  'United States': '美國',
  'United Kingdom': '英國',
  Canada: '加拿大',
  China: '中國',
  'Hong Kong': '香港',
  Taiwan: '台灣',
  Japan: '日本',
  'South Korea': '南韓',
  Korea: '南韓',
  Singapore: '新加坡',
  India: '印度',
  Australia: '澳洲',
  Germany: '德國',
  France: '法國',
  Netherlands: '荷蘭',
  Switzerland: '瑞士',
  Sweden: '瑞典',
  Spain: '西班牙',
  Italy: '意大利',
  Ireland: '愛爾蘭',
  Brazil: '巴西',
  Mexico: '墨西哥',
};

/** Quote types → the two buckets SPEC §D asks for. */
export const QUOTE_TYPES_ZH: Record<string, string> = {
  EQUITY: '股票',
  ETF: '交易所買賣基金 (ETF)',
  MUTUALFUND: '互惠基金',
  MUTUAL_FUND: '互惠基金',
  INDEX: '指數',
  CURRENCY: '貨幣',
  CRYPTOCURRENCY: '加密貨幣',
};

/** Analyst recommendation keys from Yahoo `financialData.recommendationKey`. */
export const RECOMMENDATION_ZH: Record<string, string> = {
  strong_buy: '強力買入',
  buy: '買入',
  hold: '持有',
  underperform: '表現落後',
  sell: '賣出',
  none: '未評級',
};

/** Translate an English term to the target language, or return it unchanged. */
export function term(table: Record<string, string>, value: string | null | undefined, lang: Lang): string {
  if (!value) return '';
  if (lang === 'en') return value;
  return table[value] ?? value;
}

export function sectorLabel(value: string | null | undefined, lang: Lang): string {
  return term(SECTORS_ZH, value, lang);
}

export function industryLabel(value: string | null | undefined, lang: Lang): string {
  return term(INDUSTRIES_ZH, value, lang);
}

export function exchangeLabel(value: string | null | undefined, lang: Lang): string {
  return term(EXCHANGES_ZH, value, lang);
}

export function countryLabel(value: string | null | undefined, lang: Lang): string {
  // A 2-letter ISO code is what some providers send; the table is keyed by the
  // full country name Yahoo actually returns, so an unmapped code is shown
  // verbatim rather than guessed at.
  return term(COUNTRIES_ZH, value, lang);
}

export function quoteTypeLabel(value: string | null | undefined, lang: Lang): string {
  return term(QUOTE_TYPES_ZH, value, lang);
}

export function recommendationLabel(value: string | null | undefined, lang: Lang): string {
  return term(RECOMMENDATION_ZH, value, lang);
}
