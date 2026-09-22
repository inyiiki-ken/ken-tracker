"use client";

import { useState, useEffect, useRef } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatabaseRowType } from '@/types';
import { getRatesForDate } from '@/lib/ratesStore';

interface Props {
  items: DatabaseRowType[];
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}

/** Infer the payment currency from Mode of Payment — this determines how the stored amount is interpreted by calcTotalPaid */
function inferDpCurrency(mop?: string): string {
  const m = (mop || '').toLowerCase().trim();
  if (m === 'gcash' || m === 'bank transfer php') return 'PHP';
  if (m.includes('usd') || m.includes('western union (us)')) return 'USD';
  // Credit card, COD, AED bank transfer, Tabby, Tamara, Pick Up, Meet Up → AED
  return 'AED';
}

function extractDpAmount(v: string): string {
  if (v.toUpperCase().startsWith('CHARGE:')) {
    return v.split(':')[2] || '';
  }
  return v;
}

function getPrimaryDP(items: DatabaseRowType[]): { item: DatabaseRowType | null; amount: string } {
  for (const r of items) {
    const v = String(r.downpayment || '').trim();
    if (v && v !== 'acknowledged') {
      const num = extractDpAmount(v);
      if (num && !isNaN(parseFloat(num))) {
        return { item: r, amount: num };
      }
    }
  }
  return { item: null, amount: '' };
}

function hasSavedDP(items: DatabaseRowType[]): boolean {
  return getPrimaryDP(items).amount !== '';
}

export default function GroupDownpaymentSection({ items, onUpdate }: Props) {
  const { amount: initialAmount } = getPrimaryDP(items);
  const inferredCurrency = inferDpCurrency(items[0]?.modeOfPayment);

  const isEidSet = (its: DatabaseRowType[]) =>
    its.some((r) => String(r.downpayment || '').trim().toUpperCase() === 'EID');

  const [checked, setChecked] = useState(() => hasSavedDP(items));
  const [eidChecked, setEidChecked] = useState(() => isEidSet(items));
  const [amount, setAmount] = useState(initialAmount);
  const [dpCurrency, setDpCurrency] = useState(inferredCurrency);
  const [saving, setSaving] = useState(false);
  const userActed = useRef(false);

  // Sync from external record updates
  useEffect(() => {
    const { amount: ext } = getPrimaryDP(items);
    const eid = isEidSet(items);
    if (ext) {
      setAmount(ext);
      setChecked(true);
      setEidChecked(false);
    } else if (eid) {
      setChecked(false);
      setAmount('');
      setEidChecked(true);
    } else if (!userActed.current) {
      setChecked(false);
      setAmount('');
      setEidChecked(false);
    }
    // Update inferred currency if MOP changes
    setDpCurrency(inferDpCurrency(items[0]?.modeOfPayment));
    userActed.current = false;
  }, [items]);

  // EID provided — an alternative to a downpayment. Mutually exclusive with DP.
  const handleEid = async (on: boolean) => {
    userActed.current = true;
    setEidChecked(on);
    if (on) { setChecked(false); setAmount(''); }
    setSaving(true);
    for (const r of items) {
      await onUpdate(r.id, { downpayment: on ? 'EID' : '' });
      await new Promise((res) => setTimeout(res, 80));
    }
    setSaving(false);
  };

  /** C3 FIX: Store original currency using billing modifier format to avoid losing currency info */
  const resolveAmountToSave = (val: string, selectedCurrency: string): string => {
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return val;
    // Store in CHARGE format to preserve original currency
    return `CHARGE:${selectedCurrency}:${num}:Downpayment`;
  };

  /** Display the converted hint when currency differs from inferred */
  const getConversionHint = (): string | null => {
    if (dpCurrency === inferredCurrency) return null;
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return null;
    const converted = resolveAmountToSave(amount, dpCurrency);
    const convNum = parseFloat(converted);
    if (isNaN(convNum)) return null;
    return `Saves as ${inferredCurrency} ${convNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const conversionHint = getConversionHint();

  const saveGroupDP = useDebouncedCallback(async (val: string, currency: string) => {
    if (!val || isNaN(parseFloat(val))) return;
    const valueToSave = resolveAmountToSave(val, currency);
    setSaving(true);
    for (let i = 0; i < items.length; i++) {
      const dpVal = i === 0 ? valueToSave : 'acknowledged';
      await onUpdate(items[i].id, { downpayment: dpVal });
      await new Promise(res => setTimeout(res, 80));
    }
    setSaving(false);
  }, 600);

  const handleCheck = async (on: boolean) => {
    userActed.current = true;
    setChecked(on);
    if (on) {
      // Turning DP on cancels any "EID provided" marker (they're either/or).
      if (eidChecked) {
        setEidChecked(false);
        setSaving(true);
        for (const r of items) {
          if (String(r.downpayment || '').trim().toUpperCase() === 'EID') {
            await onUpdate(r.id, { downpayment: '' });
            await new Promise(res => setTimeout(res, 80));
          }
        }
        setSaving(false);
      }
    } else {
      setAmount('');
      setSaving(true);
      for (const r of items) {
        await onUpdate(r.id, { downpayment: '' });
        await new Promise(res => setTimeout(res, 80));
      }
      setSaving(false);
    }
  };

  const handleAmount = (val: string) => {
    userActed.current = true;
    setAmount(val);
    saveGroupDP(val, dpCurrency);
  };

  const handleCurrencyChange = (newCurrency: string) => {
    setDpCurrency(newCurrency);
    if (amount) saveGroupDP(amount, newCurrency);
  };

  const invoiceNo = items.find(r => r.pureWeight)?.pureWeight;

  return (
    <div className="mx-1 mb-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Checkbox
          id={`group-dp-${items[0]?.id}`}
          checked={checked}
          disabled={saving}
          onCheckedChange={(v) => handleCheck(!!v)}
        />
        <Label htmlFor={`group-dp-${items[0]?.id}`} className="text-xs cursor-pointer font-semibold">
          Downpayment
          <span className="text-muted-foreground font-normal ml-1">
            (applies to all {items.length} item{items.length !== 1 ? 's' : ''}{invoiceNo ? ` · Invoice ${invoiceNo}` : ''})
          </span>
        </Label>
        {checked && amount && !conversionHint && (
          <span className="text-xs text-primary font-bold ml-auto">
            {dpCurrency} {parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      {/* EID provided — alternative to a downpayment (either/or) */}
      <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-primary/10">
        <Checkbox
          id={`group-eid-${items[0]?.id}`}
          checked={eidChecked}
          disabled={saving}
          onCheckedChange={(v) => handleEid(!!v)}
        />
        <Label htmlFor={`group-eid-${items[0]?.id}`} className="text-xs cursor-pointer font-semibold">
          EID provided
          <span className="text-muted-foreground font-normal ml-1">(instead of a downpayment)</span>
        </Label>
        {eidChecked && <span className="text-xs text-success font-bold ml-auto">✓ EID on file</span>}
      </div>

      {checked && (
        <div className="mt-2 space-y-1.5">
          <div className="flex gap-1.5">
            {/* Currency selector */}
            <Select value={dpCurrency} onValueChange={handleCurrencyChange}>
              <SelectTrigger className="h-8 w-20 text-xs bg-background border-border shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="AED" className="text-xs">
                  AED
                </SelectItem>
                <SelectItem value="PHP" className="text-xs">
                  PHP
                </SelectItem>
                <SelectItem value="USD" className="text-xs">
                  USD
                </SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={amount}
              onChange={e => handleAmount(e.target.value)}
              className="h-8 text-xs bg-background border-border flex-1"
              placeholder={`Enter ${dpCurrency} downpayment...`}
              disabled={saving}
              autoFocus
            />
          </div>
          {conversionHint && (
            <p className="text-[10px] text-warning flex items-center gap-1">
              ↳ {conversionHint} (converted from {dpCurrency} to match {inferredCurrency} payment method)
            </p>
          )}
        </div>
      )}
    </div>
  );
}
