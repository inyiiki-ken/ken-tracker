"use client";

import { useState, useMemo } from 'react';
import { Loader2, CopyPlus, AlertTriangle, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { createRecord } from '@/lib/api';
import { normalizeMinerName } from '@/lib/formatters';
import { customerKey } from '@/lib/customerId';
import { calcItemCostAED, calcItemPriceAED } from '@/lib/calculations';
import {
  getRatesForDate, saveRatesForDate,
  DEFAULT_PHP_RATE, DEFAULT_SILVER_SELL_RATE, DEFAULT_SILVER_BRANDED_SELL_RATE,
  DEFAULT_SILVER_COST_RATE, DEFAULT_SILVER_BRANDED_COST_RATE,
  usesGold,
} from '@/lib/ratesStore';
import { DatabaseRowType } from '@/types';
import { getOptions } from '@/lib/optionsConfig';
import { todayLocalISO } from '@/lib/businessConfig';
import { isFieldHidden } from '@/lib/appConfig';
import { getMakingCharge, getPerPcRate, getPerPcFallback } from '@/lib/pricingConfig';
import { getFieldLabel } from '@/lib/labelConfig';
import { getEffectiveStatuses } from '@/lib/statusRegistry';

// S6 FIX: Use timestamp + crypto random to avoid collisions
function generateCustomerId(): string {
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const arr = crypto.getRandomValues(new Uint8Array(3));
  const rand = Array.from(arr).map(b => chars[b % chars.length]).join('');
  return `CUST-${ts}${rand}`;
}

function resolveCustomerId(minerName: string, existingRecords: DatabaseRowType[]): { id: string; nearMatch?: string } {
  // Same matching rule as the server (ignores case, spaces and punctuation), so
  // the hint shown here is exactly what the server will do on save.
  const normalized = customerKey(minerName);

  const exactMatch = existingRecords.find(r => {
    if (!r.customerId) return false;
    return customerKey(r.minerName || '') === normalized;
  });
  if (exactMatch?.customerId) return { id: exactMatch.customerId };

  // Check for near-match (first+last) — warn only, don't reuse ID.
  // Uses the readable name (the key above has no spaces).
  const readable = normalizeMinerName(minerName).toLowerCase();
  const nameParts = readable.split(' ').filter(Boolean);
  const firstLast = nameParts.length >= 2 ? `${nameParts[0]} ${nameParts[nameParts.length - 1]}` : '';
  let nearMatchName: string | undefined;
  if (firstLast) {
    const near = existingRecords.find(r => {
      if (!r.customerId) return false;
      const existing = normalizeMinerName(r.minerName || '').toLowerCase();
      if (customerKey(r.minerName || '') === normalized) return false; // skip exact
      const ep = existing.split(' ').filter(Boolean);
      const efl = ep.length >= 2 ? `${ep[0]} ${ep[ep.length - 1]}` : existing;
      return efl === firstLast;
    });
    if (near) nearMatchName = normalizeMinerName(near.minerName || '');
  }

  return { id: generateCustomerId(), nearMatch: nearMatchName };
}

interface Props {
  onClose: () => void;
  userFirstName?: string;
  userEmail?: string;
  onRefresh?: () => void;
  existingRecords?: DatabaseRowType[];
}

// Pages & Sources are business-specific — derived from THIS customer's own data,
// not a hardcoded list (see getKnownPages/getKnownSources).

export default function AddClientModal({ onClose, userFirstName, userEmail, onRefresh, existingRecords = [] }: Props) {
  const [saving, setSaving] = useState(false);
  // Editable dropdown lists from the DATA'S sheet tab, merged over the
  // built-in defaults below (sheet wins, defaults fill any gaps).
  // All lists resolve through the central editable options (Settings wins exactly).
  const categoryOptions = getOptions('category');
  const currencyOptions = getOptions('currency');
  const sourceOptions = getOptions('source');
  const togOptions = getOptions('tog');
  const pageOptions = getOptions('page');
  const modeOfSaleOptions = getOptions('modeOfSale');
  const locationOptions = getOptions('location');
  const regionOptions = getOptions('region');
  const mopOptions = getOptions('modeOfPayment');
  // Use UAE timezone (UTC+4) so midnight UAE shows the correct local date, not the UTC date
  const today = todayLocalISO();
  const todayRates = getRatesForDate(today);
  const [phpRate, setPhpRate] = useState(() => String(todayRates.phpRate));
  const [silverSellRate, setSilverSellRateVal] = useState(() => String(todayRates.silverSellRate));
  const [silverBrandedSellRate, setSilverBrandedSellRateVal] = useState(() => String(todayRates.silverBrandedSellRate));
  const [silverCostRate, setSilverCostRateVal] = useState(() => String(todayRates.silverCostRate));
  const [silverBrandedCostRate, setSilverBrandedCostRateVal] = useState(() => String(todayRates.silverBrandedCostRate));
  // Gold tenants: pre-fill the gold rate from the Daily/Sticky gold rate.
  const defaultGoldRate = usesGold() && todayRates.goldRate > 0 ? String(todayRates.goldRate) : '';
  const [form, setForm] = useState({
    minerName: '',
    itemDescription: '',
    category: '',
    mc: '',
    grams: '',
    clientRate: '',
    goldRate: defaultGoldRate,
    orderId: '',
    currency: 'AED',
    modeOfPayment: '',
    modeOfSale: '',
    source: '',
    locationOfMiner: 'Local',
    regions: '',
    clientAddress: '',
    clientNumber: '',
    status: 'Walk-in',
    remittanceStatus: 'Pending Payment',
    dateOfLive: todayLocalISO(),
    liverName: userFirstName || '',
    page: '',
    tog: '',
    supplierRateOverride: '',
  });

  const set = (key: string, val: string) => setForm(p => ({ ...p, [key]: val }));

  const isManualSupplierRate = form.category === 'Diamond' || form.category === 'Per PC';
  const autoSupplierRate = useMemo(() => {
    const gr = parseFloat(form.goldRate) || 0;
    const mc = parseFloat(form.mc) || 0;
    return gr > 0 || mc > 0 ? (gr + mc).toFixed(2) : '';
  }, [form.goldRate, form.mc]);
  const supplierRate = isManualSupplierRate ? form.supplierRateOverride : autoSupplierRate;

  // Per-PC supplier price comes from the tenant pricing config (by T.O.G).
  const getPerPcSupplierRate = (tog: string, category: string) => {
    if (category === 'Per PC') return String(getPerPcRate(tog));
    return '';
  };

  const handleCategoryChange = (val: string) => {
    // MC tier is driven by the tenant pricing config (editable in Settings).
    let newMc = String(getMakingCharge(val));
    let newGoldRate = form.goldRate;
    let newSupplierRateOverride = form.supplierRateOverride;

    if (val === 'Diamond') {
      newGoldRate = '0';
      newSupplierRateOverride = '';
    } else if (val === 'Per PC') {
      newGoldRate = '0';
      newSupplierRateOverride = getPerPcSupplierRate(form.tog, val);
    }
    setForm(p => ({ ...p, category: val, mc: newMc, goldRate: newGoldRate, supplierRateOverride: newSupplierRateOverride }));
  };

  const handleTogChange = (val: string) => {
    const updates: Partial<typeof form> = { tog: val };
    if (form.category === 'Per PC') {
      updates.supplierRateOverride = getPerPcSupplierRate(val, 'Per PC');
    }
    setForm(p => ({ ...p, ...updates }));
  };

  const isDuplicateBarcode = useMemo(() => {
    if (!form.orderId.trim()) return false;
    const target = form.orderId.trim().toUpperCase();
    return existingRecords.some(r => r.orderId?.trim().toUpperCase() === target);
  }, [form.orderId, existingRecords]);

  // CR6: Exact match reuses ID, near-match warns but creates new ID
  const duplicateNameWarning = useMemo(() => {
    if (!form.minerName.trim()) return null;
    const { id, nearMatch } = resolveCustomerId(form.minerName, existingRecords);
    // Exact match → will link to same customer
    const normalized = customerKey(form.minerName);
    const exactMatch = existingRecords.find(r => r.customerId && customerKey(r.minerName || '') === normalized);
    if (exactMatch) return `Existing client found — will link to Customer ID ${exactMatch.customerId}.`;
    // Near-match → warn only, new ID created
    if (nearMatch) return `Similar name found: ${nearMatch} — new ID created. Merge later if needed.`;
    return null;
  }, [form.minerName, existingRecords]);

  const handleSave = async (isBulkAdd: boolean) => {
    if (!form.minerName.trim() || !form.itemDescription.trim()) {
      toast.error('Client name and item description are required');
      return;
    }
    if (!form.page) {
      toast.error('Page is required');
      return;
    }
    if (isDuplicateBarcode) {
      toast.error('Cannot save: This Order ID/Barcode already exists in the system.');
      return;
    }

    setSaving(true);
    
    const finalMinerName = normalizeMinerName(form.minerName);
    const finalItemDesc = form.itemDescription.trim().toUpperCase();
    const finalOrderId = form.orderId ? form.orderId.trim().toUpperCase() : undefined;

    try {
      const preview: DatabaseRowType = {
        id: 0,
        minerName: finalMinerName,
        itemDescription: finalItemDesc,
        category: form.category,
        mc: form.mc,
        grams: form.grams ? parseFloat(form.grams) : undefined,
        clientRate: form.clientRate ? parseFloat(form.clientRate) : undefined,
        goldRate: form.goldRate ? parseFloat(form.goldRate) : undefined,
        supplierRate: (isManualSupplierRate ? form.supplierRateOverride : supplierRate) || undefined,
        currency: form.currency,
        tog: form.tog || undefined,
      };
      
      const profit = (calcItemPriceAED(preview) - calcItemCostAED(preview)).toFixed(2);

      const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const creator = userEmail ? userEmail.split('@')[0] : (form.liverName || 'unknown');
      const auditTrail = `[Created by ${creator} on ${timestamp}]`;
      const { id: customerId } = resolveCustomerId(finalMinerName, existingRecords);

      const safePhpRate = parseFloat(phpRate) > 0 ? parseFloat(phpRate) : DEFAULT_PHP_RATE;
      const safeSilverSell = parseFloat(silverSellRate) > 0 ? parseFloat(silverSellRate) : DEFAULT_SILVER_SELL_RATE;
      const safeSilverBrandedSell = parseFloat(silverBrandedSellRate) > 0 ? parseFloat(silverBrandedSellRate) : DEFAULT_SILVER_BRANDED_SELL_RATE;
      const safeSilverCost = parseFloat(silverCostRate) > 0 ? parseFloat(silverCostRate) : DEFAULT_SILVER_COST_RATE;
      const safeSilverBrandedCost = parseFloat(silverBrandedCostRate) > 0 ? parseFloat(silverBrandedCostRate) : DEFAULT_SILVER_BRANDED_COST_RATE;

      // Rate snapshot is persisted client-side below via saveRatesForDate for
      // historical rate-locking; the sheet backend derives cost from category
      // + goldRate, so the rate fields are not sent to createRecord().
      await createRecord({
        fields: {
          minerName: finalMinerName,
          itemDescription: finalItemDesc,
          category: form.category,
          orderId: finalOrderId,
          mc: form.mc ? parseFloat(form.mc) : undefined,
          grams: form.grams ? parseFloat(form.grams) : undefined,
          clientRate: form.clientRate ? parseFloat(form.clientRate) : undefined,
          goldRate: form.goldRate ? parseFloat(form.goldRate) : undefined,
          supplierRate: (isManualSupplierRate ? form.supplierRateOverride : supplierRate) || undefined,
          pureWeight: undefined,
          currency: form.currency,
          modeOfPayment: form.modeOfPayment || undefined,
          modeOfSale: form.modeOfSale || undefined,
          source: form.source || undefined,
          locationOfMiner: form.locationOfMiner,
          regions: form.regions || undefined,
          clientAddress: form.clientAddress || undefined,
          clientNumber: form.clientNumber || undefined,
          status: form.status,
          remittanceStatus: form.remittanceStatus,
          dateOfLive: form.dateOfLive,
          liverName: form.liverName || undefined,
          page: form.page,
          tog: form.tog || undefined,
          reviewChasing: 'Pending',
          profit,
          auditTrail,
          customerId,
        },
      });
      // Persist the full rate snapshot for this date (historical rate locking)
      saveRatesForDate(form.dateOfLive, {
        phpRate: safePhpRate,
        silverSellRate: safeSilverSell,
        silverBrandedSellRate: safeSilverBrandedSell,
        silverCostRate: safeSilverCost,
        silverBrandedCostRate: safeSilverBrandedCost,
        silverRetailRate: safeSilverSell,
        goldRate: getRatesForDate(form.dateOfLive).goldRate,
      });
      
      toast.success(isBulkAdd ? 'Item added! Ready for next item.' : 'Client record created');
      onRefresh?.();
      
      if (isBulkAdd) {
        setForm(p => ({ 
          ...p, 
          itemDescription: '', 
          grams: '', 
          orderId: '', 
          tog: '', 
          category: '', 
          mc: '', 
          goldRate: defaultGoldRate, 
          clientRate: '', 
          supplierRateOverride: '' 
        }));
      } else {
        onClose();
      }
      
    } catch {
      toast.error('Failed to create record');
    } finally {
      setSaving(false);
    }
  };

  const isPinas = form.locationOfMiner === 'Pinas';

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-card border-border max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary">Add Client Record</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">{getFieldLabel('minerName')} *</Label>
              <Input
                value={form.minerName}
                onChange={e => set('minerName', e.target.value)}
                onBlur={e => set('minerName', normalizeMinerName(e.target.value))}
                className="h-8 text-xs mt-0.5 bg-background border-border"
                placeholder="e.g. Estella Jimenez"
              />
              {duplicateNameWarning && (
                <div className={`flex items-start gap-1 mt-1 text-[10px] rounded px-2 py-1 ${duplicateNameWarning.includes('new ID created') ? 'text-attention bg-attention/10 border border-attention/20' : 'text-info bg-info/10 border border-info/20'}`}>
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{duplicateNameWarning}</span>
                </div>
              )}
            </div>
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">{getFieldLabel('itemDescription')} *</Label>
              <Input value={form.itemDescription} onChange={e => set('itemDescription', e.target.value)} className="h-8 text-xs mt-0.5 bg-background border-border uppercase" placeholder="e.g. GOLD RING 18K" />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">{getFieldLabel('page')} *</Label>
              <Select value={form.page} onValueChange={v => set('page', v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {pageOptions.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{getFieldLabel('liverName')}</Label>
              <Input value={form.liverName} onChange={e => set('liverName', e.target.value)} className="h-8 text-xs mt-0.5 bg-background border-border" placeholder="Liver name" />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={form.category} onValueChange={handleCategoryChange}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {categoryOptions.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">T.O.G</Label>
              <Select value={form.tog} onValueChange={handleTogChange}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {togOptions.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <div className="flex items-center justify-between mb-0.5">
                <Label className="text-xs text-muted-foreground">Order ID / Barcode</Label>
                {isDuplicateBarcode && (
                  <span className="text-[10px] font-bold text-destructive flex items-center animate-pulse">
                    <AlertTriangle className="w-3 h-3 mr-1" /> ALREADY EXISTS
                  </span>
                )}
              </div>
              <Input 
                value={form.orderId} 
                onChange={e => set('orderId', e.target.value.toUpperCase())} 
                className={`h-8 text-xs bg-background uppercase transition-colors ${isDuplicateBarcode ? 'border-destructive focus-visible:ring-destructive' : 'border-border'}`} 
                placeholder="e.g. AM-SL-030909" 
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Grams (0 = PC)</Label>
              <Input type="number" value={form.grams} onChange={e => set('grams', e.target.value)} className="h-8 text-xs mt-0.5 bg-background border-border" placeholder="0.00" />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">MC (Making Charge)</Label>
              <Input type="number" value={form.mc} onChange={e => set('mc', e.target.value)} className="h-8 text-xs mt-0.5 bg-background border-border" placeholder="0" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Gold Rate</Label>
              <Input type="number" value={form.goldRate} onChange={e => set('goldRate', e.target.value)} className="h-8 text-xs mt-0.5 bg-background border-border" placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{getFieldLabel('clientRate')}</Label>
              <Input type="number" value={form.clientRate} onChange={e => set('clientRate', e.target.value)} className="h-8 text-xs mt-0.5 bg-background border-border" placeholder="0.00" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                {getFieldLabel('supplierRate')}
              </Label>
              {isManualSupplierRate ? (
                <Input
                  type="number"
                  value={form.supplierRateOverride}
                  onChange={e => set('supplierRateOverride', e.target.value)}
                  className="h-8 text-xs mt-0.5 bg-background border-border"
                  placeholder={form.category === 'Diamond' ? 'Enter supplier rate' : String(getPerPcFallback())}
                />
              ) : (
                <Input value={supplierRate} readOnly className="h-8 text-xs mt-0.5 bg-muted border-border opacity-70 cursor-not-allowed" placeholder="Auto" />
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Currency</Label>
              <Select value={form.currency} onValueChange={v => set('currency', v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {currencyOptions.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Mode of Sale</Label>
              <Select value={form.modeOfSale} onValueChange={v => set('modeOfSale', v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {modeOfSaleOptions.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Source</Label>
              <Select value={form.source} onValueChange={v => set('source', v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {sourceOptions.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Location</Label>
              <Select value={form.locationOfMiner} onValueChange={v => {
                set('locationOfMiner', v);
                if (v === 'Pinas') set('currency', 'PHP');
                else if (v === 'Local') set('currency', 'AED');
              }}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {locationOptions.map(l => <SelectItem key={l} value={l} className="text-xs">{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isPinas && (
              <div className="col-span-2 bg-primary/10 border border-primary/20 rounded-lg p-2">
                <Label className="text-xs text-primary font-semibold">PHP Conversion Rate (AED → PHP)</Label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">1 AED =</span>
                  <Input
                    type="number"
                    value={phpRate}
                    onChange={e => setPhpRate(e.target.value)}
                    className="h-7 text-xs bg-background border-border w-24"
                    step="0.1"
                  />
                  <span className="text-xs text-muted-foreground">PHP</span>
                </div>
              </div>
            )}

            {(form.category === 'Silver Normal' || form.category === 'Silver Branded') && (
              <div className="col-span-2 bg-secondary/40 border border-border rounded-lg p-2 space-y-2">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Daily Silver Rates — {form.category}
                </p>
                {form.category === 'Silver Normal' ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-28 shrink-0">Sell Rate (AED/g)</Label>
                      <Input type="number" step="0.5" value={silverSellRate}
                        onChange={e => setSilverSellRateVal(e.target.value)}
                        className="h-7 text-xs bg-background border-border w-20" placeholder="45" />
                      <span className="text-[10px] text-muted-foreground">default: 45</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-28 shrink-0">Cost Rate (AED/g)</Label>
                      <Input type="number" step="0.5" value={silverCostRate}
                        onChange={e => setSilverCostRateVal(e.target.value)}
                        className="h-7 text-xs bg-background border-border w-20" placeholder="15" />
                      <span className="text-[10px] text-muted-foreground">default: 15</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-28 shrink-0">Sell Rate (AED/g)</Label>
                      <Input type="number" step="0.5" value={silverBrandedSellRate}
                        onChange={e => setSilverBrandedSellRateVal(e.target.value)}
                        className="h-7 text-xs bg-background border-border w-20" placeholder="60" />
                      <span className="text-[10px] text-muted-foreground">default: 60</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground w-28 shrink-0">Cost Rate (AED/g)</Label>
                      <Input type="number" step="0.5" value={silverBrandedCostRate}
                        onChange={e => setSilverBrandedCostRateVal(e.target.value)}
                        className="h-7 text-xs bg-background border-border w-20" placeholder="32" />
                      <span className="text-[10px] text-muted-foreground">default: 32</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {form.locationOfMiner === 'Local' && (
              <div>
                <Label className="text-xs text-muted-foreground">Region</Label>
                <Select value={form.regions} onValueChange={v => set('regions', v)}>
                  <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {regionOptions.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label className="text-xs text-muted-foreground">Mode of Payment</Label>
              <Select value={form.modeOfPayment} onValueChange={v => set('modeOfPayment', v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {mopOptions.map(m => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={form.status} onValueChange={v => set('status', v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {getEffectiveStatuses('admin', form.status).map(s => <SelectItem key={s} value={s} className="text-xs text-foreground">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Remittance Status</Label>
              <Select value={form.remittanceStatus} onValueChange={v => set('remittanceStatus', v)}>
                <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {getOptions('remittanceStatus').map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {!isFieldHidden('clientAddress') && (
              <div>
                <Label className="text-xs text-muted-foreground">Client Address</Label>
                <Input
                  value={form.clientAddress}
                  onChange={e => set('clientAddress', e.target.value)}
                  placeholder="Delivery address…"
                  className="h-8 text-xs mt-0.5 bg-background border-border"
                />
              </div>
            )}
            {!isFieldHidden('clientNumber') && (
              <div>
                <Label className="text-xs text-muted-foreground">Client Number</Label>
                <Input
                  value={form.clientNumber}
                  onChange={e => set('clientNumber', e.target.value)}
                  placeholder="Mobile number…"
                  className="h-8 text-xs mt-0.5 bg-background border-border"
                />
              </div>
            )}
            <div className="col-span-2">
              <Label className="text-xs text-muted-foreground">Date of Live</Label>
              <Input type="date" value={form.dateOfLive} onChange={e => set('dateOfLive', e.target.value)} max={today} className="h-8 text-xs mt-0.5 bg-background border-border" />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="text-xs h-8 border-border w-20 shrink-0" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => handleSave(true)} disabled={saving || isDuplicateBarcode} variant="secondary" className="flex-1 text-xs h-8 border-border">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CopyPlus className="h-3.5 w-3.5 mr-1" /> Save & Add Another</>}
            </Button>
            <Button onClick={() => handleSave(false)} disabled={saving || isDuplicateBarcode} className="flex-1 text-xs h-8 bg-primary text-primary-foreground">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create Record'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}