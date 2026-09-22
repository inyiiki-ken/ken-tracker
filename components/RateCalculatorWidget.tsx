"use client";

import { useState } from 'react';
import { Calculator, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getRatesForDate, getRateMetal } from '@/lib/ratesStore';

function todayKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

type Category = 'silver' | 'silver_branded' | 'gold';

export default function RateCalculatorWidget() {
  const [open, setOpen] = useState(false);
  const [grams, setGrams] = useState('');
  // Gold-rate customers open on the Gold tab; everyone else keeps Silver.
  const [category, setCategory] = useState<Category>(() => (getRateMetal() === 'gold' ? 'gold' : 'silver'));
  const [goldRate, setGoldRate] = useState('');

  const rates = getRatesForDate(todayKey());
  const gramsNum = parseFloat(grams) || 0;
  // Typed rate wins; otherwise fall back to today's Daily/Sticky gold rate.
  const goldRateNum = parseFloat(goldRate) || rates.goldRate || 0;

  let priceAED = 0;
  if (category === 'silver') priceAED = gramsNum * rates.silverSellRate;
  else if (category === 'silver_branded') priceAED = gramsNum * rates.silverBrandedSellRate;
  else if (category === 'gold' && goldRateNum > 0) priceAED = gramsNum * goldRateNum;

  const pricePHP = priceAED * rates.phpRate;
  const hasResult = gramsNum > 0 && priceAED > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`p-1.5 transition-colors ${open ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
        title="Live Rate Calculator"
      >
        <Calculator className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 p-4 space-y-3 bg-card border border-border rounded-lg shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="text-xs font-cinzel flex items-center gap-1.5 text-primary">
                <Calculator className="h-3.5 w-3.5" />
                Rate Calculator
              </p>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Category tabs */}
            <div className="flex gap-1">
              {(['silver', 'silver_branded', 'gold'] as Category[]).map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`flex-1 text-[9px] py-1 font-cinzel uppercase transition-colors rounded ${
                    category === c
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-muted-foreground hover:text-foreground'
                  }`}
                  style={{ letterSpacing: '0.1em' }}
                >
                  {c === 'silver' ? 'Silver' : c === 'silver_branded' ? 'Ag Branded' : 'Gold'}
                </button>
              ))}
            </div>

            {/* Today's rates strip */}
            <div className="px-3 py-2 text-[10px] space-y-1 bg-muted rounded border border-border">
              <div className="flex justify-between text-muted-foreground">
                <span>Silver</span>
                <span className="font-medium text-foreground">AED {rates.silverSellRate}/g</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Branded Ag</span>
                <span className="font-medium text-foreground">AED {rates.silverBrandedSellRate}/g</span>
              </div>
              <div className="flex justify-between pt-1 mt-0.5 border-t border-border text-muted-foreground">
                <span>PHP Rate</span>
                <span className="font-medium text-foreground">1 AED = {rates.phpRate} PHP</span>
              </div>
            </div>

            {/* Gold rate input */}
            {category === 'gold' && (
              <div>
                <label className="text-[10px] block mb-1 text-muted-foreground">Gold Rate (AED/g)</label>
                <Input
                  type="number"
                  placeholder={rates.goldRate ? String(rates.goldRate) : "e.g. 210"}
                  value={goldRate}
                  onChange={e => setGoldRate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            )}

            {/* Grams input */}
            <div>
              <label className="text-[10px] block mb-1 text-muted-foreground">Weight (grams)</label>
              <Input
                type="number"
                placeholder="0.00"
                value={grams}
                onChange={e => setGrams(e.target.value)}
                className="h-8 text-sm"
                autoFocus
              />
            </div>

            {/* Result */}
            {hasResult ? (
              <div className="p-3 border border-primary/30 bg-accent rounded">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: '0.2em' }}>Price (AED)</span>
                  <span className="text-xl font-bold font-cinzel text-primary">
                    AED {Math.round(priceAED).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: '0.2em' }}>≈ PHP</span>
                  <span className="text-sm font-semibold text-foreground">
                    ₱ {Math.round(pricePHP).toLocaleString()}
                  </span>
                </div>
              </div>
            ) : (
              gramsNum > 0 && category === 'gold' && goldRateNum === 0 ? (
                <p className="text-[10px] text-center text-muted-foreground">Enter gold rate above ↑</p>
              ) : null
            )}
          </div>
        </>
      )}
    </div>
  );
}
