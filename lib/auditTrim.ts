/**
 * Keep the change history short (Google caps a cell at 50,000 characters) but
 * never drop the newest line that recorded a STATUS change — status deadlines
 * (For COD 3 days, Reseller 3 weeks…) count from that line.
 */
const STATUS_LINE = /\bstatus\b/i;

export function trimAudit(lines: string[], max = 20): string[] {
  const clean = lines.filter(Boolean);
  if (clean.length <= max) return clean;
  const kept = clean.slice(-max);
  if (kept.some((l) => STATUS_LINE.test(l))) return kept;
  for (let i = clean.length - max - 1; i >= 0; i--) {
    if (STATUS_LINE.test(clean[i])) return [clean[i], ...clean.slice(-(max - 1))];
  }
  return kept;
}
