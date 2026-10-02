import type { DatabaseRowType } from '@/types';

export type MetalKind = 'gold' | 'silver' | 'other';

/**
 * Gold, silver or something else (diamond, VCA…) for My Sales and Bossing. The
 * TOG column decides first (925 / 18K), then the category, item description or source.
 */
export function metalOf(r: DatabaseRowType): MetalKind {
  const tog = String(r.tog ?? '');
  const text = `${r.category ?? ''} ${r.itemDescription ?? ''} ${r.source ?? ''}`.toLowerCase();
  if (/925|silver/i.test(tog)) return 'silver';
  if (/\d{2}\s*K/i.test(tog)) return 'gold';
  if (text.includes('silver')) return 'silver';
  if (text.includes('gold')) return 'gold';
  return 'other';
}
