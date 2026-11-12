import type { DatabaseRowType } from '@/types';

export type MetalKind = 'gold' | 'silver' | 'other';

/**
 * Material for My Sales and Bossing. T.O.G takes precedence. Legacy silver
 * labels still count as silver, and unclassified records default to gold.
 */
export function metalOf(r: DatabaseRowType): MetalKind {
  const tog = String(r.tog ?? '').trim();
  const text = `${r.category ?? ''} ${r.itemDescription ?? ''} ${r.source ?? ''}`.toLowerCase();
  if (/^other$/i.test(tog)) return 'other';
  if (/925|silver/i.test(tog)) return 'silver';
  if (/\d{2}\s*K|^gold$/i.test(tog)) return 'gold';
  if (text.includes('silver')) return 'silver';
  return 'gold';
}
