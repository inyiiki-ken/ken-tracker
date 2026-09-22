import { format, parseISO, isValid } from 'date-fns';
import { DatabaseRowType } from '@/types';

// UAE offset in ms (UTC+4)
// Kept as the fallback default; the live value comes from the customer's
// Business settings via getTimezoneOffsetMs().
const UAE_OFFSET_MS = 4 * 60 * 60 * 1000;

/**
 * Format a date string for display, always in UAE timezone (UTC+4).
 *
 * Why: dateOfLive values from Google Sheets come in two flavours:
 *   1. Bare date "2026-04-09"  → parseISO treats as midnight UTC → correct in UAE
 *   2. ISO datetime "2026-04-09T20:00:00Z" → that's 00:00 UAE on Apr 10, but
 *      format() in UTC shows Apr 09. We shift to UAE before formatting.
 */
export function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    // Bare date-only string: anchor to noon UAE to avoid any day-boundary shift
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
      const d = parseISO(`${dateStr.trim()}T12:00:00+04:00`);
      if (!isValid(d)) return dateStr;
      return format(d, 'MMM dd, yyyy');
    }
    // M/D/YYYY or MM/DD/YYYY from Google Sheets — treat as a calendar date in UAE
    const mdyMatch = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdyMatch) {
      const d = parseISO(`${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}T12:00:00+04:00`);
      if (isValid(d)) return format(d, 'MMM dd, yyyy');
    }

    // Full datetime: parse then shift to UAE time before formatting
    const d = parseISO(dateStr);
    if (!isValid(d)) return dateStr;
    const uaeDate = new Date(d.getTime() + UAE_OFFSET_MS);
    return format(uaeDate, 'MMM dd, yyyy');
  } catch {
    return dateStr;
  }
}

export function formatDateObj(date: Date | null): string {
  if (!date || !isValid(date)) return '—';
  return format(date, 'MMM dd, yyyy');
}

export function formatCurrency(value: number, currency?: string): string {
  const curr = currency || 'AED';
  return `${curr} ${Math.round(value).toLocaleString()}`;
}

// miner -> all records (across all livers, for 1-client-1-box view)
export function groupByMiner(records: DatabaseRowType[]): Map<string, DatabaseRowType[]> {
  const map = new Map<string, DatabaseRowType[]>();
  for (const record of records) {
    const miner = record.minerName?.trim() || 'Unknown Client';
    if (!map.has(miner)) map.set(miner, []);
    map.get(miner)!.push(record);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// liver -> miner -> all records (merged across dates, for 1-client-1-box view)
export function groupByLiverMiner(records: DatabaseRowType[]): Map<string, Map<string, DatabaseRowType[]>> {
  const map = new Map<string, Map<string, DatabaseRowType[]>>();
  for (const record of records) {
    const liver = (record.liverName?.trim() || 'Unknown Liver').toUpperCase();
    const miner = record.minerName?.trim() || 'Unknown Client';
    if (!map.has(liver)) map.set(liver, new Map());
    const byLiver = map.get(liver)!;
    if (!byLiver.has(miner)) byLiver.set(miner, []);
    byLiver.get(miner)!.push(record);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

export function groupByMinerName(records: DatabaseRowType[]): Map<string, DatabaseRowType[]> {
  const map = new Map<string, DatabaseRowType[]>();
  for (const record of records) {
    const key = record.minerName?.trim() || 'Unknown Client';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(record);
  }
  return map;
}

// liver -> dateOfLive (raw) -> miner -> records
export function groupByLiverDateMiner(records: DatabaseRowType[], dateSort: 'asc' | 'desc' = 'desc'): Map<string, Map<string, Map<string, DatabaseRowType[]>>> {
  const map = new Map<string, Map<string, Map<string, DatabaseRowType[]>>>();
  for (const record of records) {
    const liver = (record.liverName?.trim() || 'Unknown Liver').toUpperCase();
    const date = record.dateOfLive || 'Unknown Date';
    const miner = record.minerName?.trim() || 'Unknown Client';
    if (!map.has(liver)) map.set(liver, new Map());
    const byLiver = map.get(liver)!;
    if (!byLiver.has(date)) byLiver.set(date, new Map());
    const byDate = byLiver.get(date)!;
    if (!byDate.has(miner)) byDate.set(miner, []);
    byDate.get(miner)!.push(record);
  }
  // Sort livers alphabetically; dates by requested direction
  const sortedLivers = new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  for (const [liver, dateMap] of sortedLivers) {
    sortedLivers.set(liver, new Map([...dateMap.entries()].sort((a, b) =>
      dateSort === 'asc' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])
    )));
  }
  return sortedLivers;
}

// location -> source -> liver -> dateOfLive (raw) -> miner -> records
export function groupByLocationSourceLiverDateMiner(
  records: DatabaseRowType[]
): Map<string, Map<string, Map<string, Map<string, Map<string, DatabaseRowType[]>>>>> {
  const grouped = new Map<string, Map<string, Map<string, Map<string, Map<string, DatabaseRowType[]>>>>>();
  for (const record of records) {
    const location = record.locationOfMiner?.trim() || 'Local';
    const source = record.source?.trim() || 'Main Store';
    const liver = (record.liverName?.trim() || 'Unknown Liver').toUpperCase();
    const date = record.dateOfLive || 'Unknown Date';
    const miner = record.minerName?.trim() || 'Unknown Client';

    if (!grouped.has(location)) grouped.set(location, new Map());
    const byLocation = grouped.get(location)!;
    if (!byLocation.has(source)) byLocation.set(source, new Map());
    const bySource = byLocation.get(source)!;
    if (!bySource.has(liver)) bySource.set(liver, new Map());
    const byLiver = bySource.get(liver)!;
    if (!byLiver.has(date)) byLiver.set(date, new Map());
    const byDate = byLiver.get(date)!;
    if (!byDate.has(miner)) byDate.set(miner, []);
    byDate.get(miner)!.push(record);
  }
  return grouped;
}

// page -> dateOfLive -> miner -> records (same hierarchy as Admin Pipeline)
export function groupByPageDateMiner(records: DatabaseRowType[]): Map<string, Map<string, Map<string, DatabaseRowType[]>>> {
  const map = new Map<string, Map<string, Map<string, DatabaseRowType[]>>>();
  for (const record of records) {
    let pageKey = (record.page || 'Other').trim();
    if (pageKey.toUpperCase().includes('MYK')) pageKey = 'MYK';
    else if (pageKey.toUpperCase().includes('EMPIRE')) pageKey = 'Empire Gold By ETG';
    else if (pageKey.toUpperCase().includes('ALIYAH')) pageKey = "Aliyah's Sterling Silver Collection";
    const date = record.dateOfLive || 'Unknown Date';
    const miner = record.minerName?.trim() || 'Unknown Client';
    if (!map.has(pageKey)) map.set(pageKey, new Map());
    const byPage = map.get(pageKey)!;
    if (!byPage.has(date)) byPage.set(date, new Map());
    const byDate = byPage.get(date)!;
    if (!byDate.has(miner)) byDate.set(miner, []);
    byDate.get(miner)!.push(record);
  }
  // Sort pages (MYK first, Empire second, rest alphabetical); dates newest first
  const sorted = new Map([...map.entries()].sort((a, b) => {
    if (a[0] === 'MYK') return -1; if (b[0] === 'MYK') return 1;
    if (a[0] === 'Empire Gold By ETG') return -1; if (b[0] === 'Empire Gold By ETG') return 1;
    if (a[0] === "Aliyah's Sterling Silver Collection") return -1; if (b[0] === "Aliyah's Sterling Silver Collection") return 1;
    return a[0].localeCompare(b[0]);
  }));
  for (const [page, dateMap] of sorted) {
    sorted.set(page, new Map([...dateMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))));
  }
  return sorted;
}

export function applySearch(records: DatabaseRowType[], searchQuery: string): DatabaseRowType[] {
  if (!searchQuery) return records;
  const lowerQuery = searchQuery.toLowerCase().trim();
  
  return records.filter(record => {
    return (
      (record.minerName && record.minerName.toLowerCase().includes(lowerQuery)) ||
      (record.itemDescription && record.itemDescription.toLowerCase().includes(lowerQuery)) ||
      (record.pureWeight && String(record.pureWeight).toLowerCase().includes(lowerQuery)) ||
      (record.customerId && record.customerId.toLowerCase().includes(lowerQuery)) ||
      (record.orderId && record.orderId.toLowerCase().includes(lowerQuery))
    );
  });
}

export const MOP_OPTIONS = [
  'Tabby', 'Tamara', 'COD', 'Bank Transfer AED', 'Bank Transfer PHP', 'Bank Transfer USD',
  'Western Union', 'Credit Card', 'GCash', 'Meet Up', 'Pick Up Shop',
];

// UAE regions → locationOfMiner stays 'Local'
// Pinas → locationOfMiner becomes 'Pinas'
// International regions → locationOfMiner becomes 'International'
export const REGION_OPTIONS = [
  'Dubai', 'Abu Dhabi', 'Al Ain', 'Sharjah', 'Ajman', 'Western Region', 'UAQ', 'RAK', 'Fujairah',
  'Pinas',
  'US', 'CAD', 'UK', 'NZ', 'EUROPE',
];

export const INTERNATIONAL_REGIONS = ['US', 'CAD', 'UK', 'NZ', 'EUROPE'];

export function getLocationFromRegion(region: string): string {
  if (region === 'Pinas') return 'Pinas';
  if (INTERNATIONAL_REGIONS.includes(region)) return 'International';
  return 'Local';
}

// ── Name normalization ────────────────────────────────────────────────────────
// Converts any miner/customer name to consistent Title Case with collapsed spaces.
// e.g. "ESTELLA ARRIBAY JIMENEZ" → "Estella Arribay Jimenez"
//      "estella   jimenez"       → "Estella Jimenez"
export function normalizeMinerName(val?: string): string {
  if (!val) return '';
  return val
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\b(De|Del|La|Las|Los|Van|Von|El|Al|Bin|Bint)\b/g, m => m.toLowerCase());
}

// ── Reseller normalization ────────────────────────────────────────────────────
// Catches all known typos/abbreviations and maps them to the canonical "Reseller".
const RESELLER_VARIANTS = [
  'reseller', 'reseler', 'resell', 'resel', 'reseler', 'rs', 'r/s',
  'resller', 'resseller', 'reselller', 'resseler', 're-seller', 're seller',
  'dealer', 'wholesale', 'wholesaler',
];

export function normalizeReseller(value: string): string {
  if (!value) return value;
  const lower = value.toLowerCase().trim();
  if (RESELLER_VARIANTS.includes(lower)) return 'Reseller';
  return value;
}

/**
 * Apply reseller normalization to any field that might hold a customer type,
 * mode of sale, or category label. Returns the canonical value or original.
 */
export function normalizeRecordReseller(record: { modeOfSale?: string; customerType?: string; source?: string }): {
  modeOfSale?: string;
  customerType?: string;
  source?: string;
} {
  return {
    modeOfSale: record.modeOfSale ? normalizeReseller(record.modeOfSale) : record.modeOfSale,
    customerType: record.customerType ? normalizeReseller(record.customerType) : record.customerType,
    source: record.source ? normalizeReseller(record.source) : record.source,
  };
}

/**
 * Status badge colours.
 *
 * These were fixed pastel shades (bg-amber-50 / text-amber-700), which rendered
 * as bright near-white chips scattered across the dark theme and ignored the
 * customer's brand entirely. Now expressed as tints of the semantic tokens, so
 * the same badge reads correctly in both light and dark mode while keeping the
 * meaning staff rely on: amber = waiting, green = done, red = cancelled.
 */
export const STATUS_COLORS: Record<string, string> = {
  'Pending': 'bg-warning/10 text-warning border-warning/30',
  'Waiting for Details': 'bg-info/10 text-info border-info/30',
  'Waiting for Downpayment': 'bg-warning/10 text-warning border-warning/30',
  'Layaway': 'bg-attention/10 text-attention border-attention/30',
  'Paid/DP but Item Hold': 'bg-hold/10 text-hold border-hold/30',
  'For Pullout': 'bg-warning/10 text-warning border-warning/30',
  'Dispatch': 'bg-warning/10 text-warning border-warning/30',
  'Dispatched': 'bg-warning/10 text-warning border-warning/30',
  'Delivered': 'bg-success/10 text-success border-success/30',
  'Cancelled': 'bg-destructive/10 text-destructive border-destructive/30',
  'Reseller': 'bg-success/10 text-success border-success/30',
  'Outsource': 'bg-success/10 text-success border-success/30',
  'Returned Item': 'bg-destructive/10 text-destructive border-destructive/30',
  'Given to Shop': 'bg-success/10 text-success border-success/30',
  'Payment for Verification': 'bg-info/10 text-info border-info/30',
};