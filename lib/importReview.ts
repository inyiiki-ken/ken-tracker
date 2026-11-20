import type { ParsedMasterlistRow } from './masterlistImport';
import { calcItemPrice, getQty, isPerPiece, roundPrice, parseDateRobust } from './calculations';
import { isUnitMode } from './businessConfig';
import type { DatabaseRowType } from '@/types';

export function reviewImportRow(row: ParsedMasterlistRow) {
  const record = { ...row, id: 0 } as unknown as DatabaseRowType;
  const rate = Number(row.clientRate);
  const grams = Number(row.grams);
  const quantity = isUnitMode() || isPerPiece(record) ? getQty(record) : grams > 0 ? grams : 1;
  const amount = calcItemPrice(record);
  const errors: string[] = [];
  if (!String(row.orderId ?? '').trim() || row.orderId === '?') errors.push('Type the code — the sheet has none for this row.');
  if (!row.minerName.trim()) errors.push('Enter the customer name.');
  if (!row.itemDescription.trim()) errors.push('Enter the item description.');
  if (!row.dateOfLive || !parseDateRobust(row.dateOfLive)) errors.push('Enter a valid Date of Live.');
  if (!Number.isFinite(rate) || rate <= 0) errors.push('Enter a selling rate greater than zero.');
  if (!Number.isFinite(grams) || grams < 0) errors.push('Weight must be zero or a positive number.');
  if (!Number.isFinite(Number(row.qty)) || Number(row.qty) <= 0) errors.push('Quantity must be greater than zero.');
  if (!Number.isFinite(Number(row.mc)) || Number(row.mc) < 0) errors.push('MC must be zero or a positive number.');
  if (!Number.isFinite(Number(row.goldRate)) || Number(row.goldRate) < 0) errors.push('Gold rate must be zero or a positive number.');
  const source = row.sourceAmount;
  const mismatch = source !== undefined && source > 0 && Math.abs(roundPrice(source) - amount) > 1;
  return { errors, amount, quantity, mismatch,
    explanation: `${rate || 0} × ${quantity} = ${(rate * quantity).toFixed(2)}; item total ${amount}`,
  };
}

// A confirmation belongs to the exact values reviewed, never to a row position alone.
export function importReviewKey(row: ParsedMasterlistRow, context: unknown): string {
  return JSON.stringify([row, context]);
}
