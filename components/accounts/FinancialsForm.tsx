"use client";

import { useState, useEffect, useMemo } from 'react';
import { Loader2, Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { DatabaseRowType } from '@/types';
import { getFieldLabel } from '@/lib/labelConfig';
import {
  calcItemPrice, calcItemPriceAED, calcShippingFee, calcCCFee,
  calcTotalPaid, calcProfitAED, roundPrice, getEffectiveCurrency,
  toAED, fromAED, calcRemainingBalance, resolveDownpaymentCurrencyAED
} from '@/lib/calculations';
import {
  parseBillingModifiers, encodeBillingModifiers, getTotalChargesAED, getTotalDiscountsAED,
  BillingModifiers
} from '@/lib/billingModifiers';
import { getRatesForDate } from '@/lib/ratesStore';

interface Props {
  record: DatabaseRowType;
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}

import { getOptions } from '@/lib/optionsConfig';
const MODE_OF_SALE_OPTIONS = ['Live', 'Dropshipping', 'In-Store', 'Offline'];

export default function FinancialsForm({ record, onUpdate }: Props) {
  const [saving, setSaving] = useState(false);
  const isLayaway = record.status === 'Layaway' || record.modeOfPayment === 'Layaway';
  const currency = getEffectiveCurrency(record);

  // Parse billing modifiers from existing additionalCharges
  const initialMods = useMemo(() => parseBillingModifiers(record.additionalCharges), [record.additionalCharges]);

  const [form, setForm] = useState({
    goldRate: record.goldRate?.toString() || '',
    mc: record.mc || '',
    supplierRate: record.supplierRate || '',
    additionalFeeRemarks: record.liverAdminRemarks || '',
    downpayment: String(record.downpayment || ''),
    amountReceived: String(record.amountReceived || ''),
    la1MonthPayment: String(record.la1MonthPayment || ''),
    la2MonthPayment: String(record.la2MonthPayment || ''),
    la3MonthPayment: String(record.la3MonthPayment || ''),
    la4MonthPayment: String(record.la4MonthPayment || ''),
    remittanceStatus: record.remittanceStatus || '',
    modeOfSale: record.modeOfSale || '',
  });

  // Charge/discount state
  const [chargeEnabled, setChargeEnabled] = useState(initialMods.charges.length > 0);
  const [chargeAmount, setChargeAmount] = useState(initialMods.charges[0]?.amount?.toString() || '');
  const [chargeCurrency, setChargeCurrency] = useState(initialMods.charges[0]?.currency || 'AED');
  const [chargeDesc, setChargeDesc] = useState(initialMods.charges[0]?.description || '');

  const [discountEnabled, setDiscountEnabled] = useState(initialMods.discounts.length > 0);
  const [discountAmount, setDiscountAmount] = useState(initialMods.discounts[0]?.amount?.toString() || '');
  const [discountCurrency, setDiscountCurrency] = useState(initialMods.discounts[0]?.currency || 'AED');
  const [discountDesc, setDiscountDesc] = useState(initialMods.discounts[0]?.description || '');

  useEffect(() => {
    const mods = parseBillingModifiers(record.additionalCharges);
    setForm({
      goldRate: record.goldRate?.toString() || '',
      mc: record.mc || '',
      supplierRate: record.supplierRate || '',
      additionalFeeRemarks: record.liverAdminRemarks || '',
      downpayment: String(record.downpayment || ''),
      amountReceived: String(record.amountReceived || ''),
      la1MonthPayment: String(record.la1MonthPayment || ''),
      la2MonthPayment: String(record.la2MonthPayment || ''),
      la3MonthPayment: String(record.la3MonthPayment || ''),
      la4MonthPayment: String(record.la4MonthPayment || ''),
      remittanceStatus: record.remittanceStatus || '',
      modeOfSale: record.modeOfSale || '',
    });
    setChargeEnabled(mods.charges.length > 0);
    setChargeAmount(mods.charges[0]?.amount?.toString() || '');
    setChargeCurrency(mods.charges[0]?.currency || 'AED');
    setChargeDesc(mods.charges[0]?.description || '');
    setDiscountEnabled(mods.discounts.length > 0);
    setDiscountAmount(mods.discounts[0]?.amount?.toString() || '');
    setDiscountCurrency(mods.discounts[0]?.currency || 'AED');
    setDiscountDesc(mods.discounts[0]?.description || '');
  }, [record.id]);

  const set = (key: string, val: string) => setForm(p => ({ ...p, [key]: val }));

  const toDisplay = (val: unknown): string => {
    const num = parseFloat(String(val ?? '')) || 0;
    if (!num) return '';
    return String(Math.round(toAED(num, record) * 100) / 100);
  };
  const fromDisplay = (aedStr: string): string => {
    const num = parseFloat(aedStr) || 0;
    if (!num) return '';
    return String(Math.round(fromAED(num, record) * 100) / 100);
  };

  // Build the encoded additionalCharges string
  const buildAdditionalCharges = (): string => {
    const mods: BillingModifiers = {
      charges: [],
      discounts: [],
      shipFeeOverride: initialMods.shipFeeOverride, // preserve existing SHIPFEE overrides
    };
    if (chargeEnabled && (parseFloat(chargeAmount) || 0) > 0) {
      mods.charges.push({
        amount: parseFloat(chargeAmount) || 0,
        currency: chargeCurrency,
        description: chargeDesc.trim(),
      });
    }
    if (discountEnabled && (parseFloat(discountAmount) || 0) > 0) {
      mods.discounts.push({
        amount: parseFloat(discountAmount) || 0,
        currency: discountCurrency,
        description: discountDesc.trim(),
      });
    }
    return encodeBillingModifiers(mods);
  };

  const buildPreview = (): DatabaseRowType => ({
    ...record,
    goldRate: parseFloat(form.goldRate) || record.goldRate,
    supplierRate: form.supplierRate,
    mc: form.mc,
    additionalCharges: buildAdditionalCharges(),
    downpayment: form.downpayment,
    amountReceived: form.amountReceived,
    la1MonthPayment: isLayaway ? form.la1MonthPayment : '',
    la2MonthPayment: isLayaway ? form.la2MonthPayment : '',
    la3MonthPayment: isLayaway ? form.la3MonthPayment : '',
    la4MonthPayment: isLayaway ? form.la4MonthPayment : '',
  });

  const handlePayFull = () => {
    const preview = buildPreview();
    preview.amountReceived = '';
    const remainingAED = calcRemainingBalance(preview);
    if (remainingAED > 0) {
      set('amountReceived', String(fromAED(remainingAED, record)));
      toast.success('Auto-filled full balance!');
    } else {
      toast.info('Balance is already fully paid!');
    }
  };

  const handleSave = async () => {
    // Validation
    if (chargeEnabled && !(parseFloat(chargeAmount) > 0)) {
      toast.error('Charge amount is required when Additional Charges is ON');
      return;
    }
    if (discountEnabled && !(parseFloat(discountAmount) > 0)) {
      toast.error('Discount amount is required when Discount is ON');
      return;
    }
    if (discountEnabled && !discountDesc.trim()) {
      toast.error('Discount description is required');
      return;
    }

    // Layaway validation
    if (isLayaway) {
      const preview = buildPreview();
      const totalAED = calcItemPriceAED(preview) + calcShippingFee(preview) + calcCCFee(preview);
      const dpAED = resolveDownpaymentCurrencyAED(parseFloat(form.downpayment) || 0, record);
      const maxLayawayAED = totalAED - dpAED;
      const layawayRaw = [form.la1MonthPayment, form.la2MonthPayment, form.la3MonthPayment, form.la4MonthPayment]
        .reduce((s, v) => s + (parseFloat(v) || 0), 0);
      const layawayAED = toAED(layawayRaw, record);
      if (layawayAED > maxLayawayAED + 0.01) {
        toast.error(`Layaway total exceeds remaining balance. Please reduce installment amounts.`);
        return;
      }
    }

    setSaving(true);
    try {
      const previewRecord = buildPreview();
      const computedProfit = calcProfitAED(previewRecord).toFixed(2);
      const encodedCharges = buildAdditionalCharges();

      await onUpdate(record.id, {
        dateOfLive: record.dateOfLive,
        goldRate: parseFloat(form.goldRate) || record.goldRate,
        supplierRate: form.supplierRate,
        mc: form.mc,
        additionalCharges: encodedCharges,
        liverAdminRemarks: form.additionalFeeRemarks,
        downpayment: form.downpayment,
        amountReceived: form.amountReceived,
        la1MonthPayment: isLayaway ? form.la1MonthPayment : '',
        la2MonthPayment: isLayaway ? form.la2MonthPayment : '',
        la3MonthPayment: isLayaway ? form.la3MonthPayment : '',
        la4MonthPayment: isLayaway ? form.la4MonthPayment : '',
        remittanceStatus: form.remittanceStatus,
        modeOfSale: form.modeOfSale,
        profit: computedProfit,
      });
      toast.success('Financials saved');
    } finally {
      setSaving(false);
    }
  };

  const previewRecord = buildPreview();
  const itemPrice = calcItemPrice(previewRecord);
  const itemPriceAED = calcItemPriceAED(previewRecord);
  const shippingFee = calcShippingFee(previewRecord);
  const ccFee = calcCCFee(previewRecord);
  const snap = getRatesForDate(record.dateOfLive || '');
  const mods = parseBillingModifiers(buildAdditionalCharges());
  const chargesAED = Math.round(getTotalChargesAED(mods, snap.phpRate));
  const discountsAED = Math.round(getTotalDiscountsAED(mods, snap.phpRate));
  const totalAmount = roundPrice(itemPriceAED + shippingFee + ccFee + chargesAED - discountsAED);
  const totalPaid = calcTotalPaid(previewRecord);
  const remaining = roundPrice(totalAmount - totalPaid);
  const profitAED = calcProfitAED(previewRecord);

  const numField = (label: string, key: string, disabled = false) => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" value={form[key as keyof typeof form]} onChange={e => set(key, e.target.value)}
        disabled={disabled} className="h-8 text-xs bg-background border-border mt-0.5 disabled:opacity-50" placeholder="0.00" />
    </div>
  );

  const CURR_OPTS = ['AED', 'PHP', 'USD'];

  return (
    <div className="border-t border-border pt-3 mt-2">
      <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Financials</p>

      <div className="mb-3">
        <Label className="text-xs text-muted-foreground">Mode of Sale</Label>
        <Select value={form.modeOfSale} onValueChange={v => set('modeOfSale', v)}>
          <SelectTrigger className="h-8 text-xs bg-background border-border mt-0.5">
            <SelectValue placeholder="Select mode of sale..." />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {MODE_OF_SALE_OPTIONS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        {numField('Gold Rate', 'goldRate')}
        {numField('MC (Making Charge)', 'mc')}
        <div>
          <Label className="text-xs text-muted-foreground">{getFieldLabel('supplierRate')}</Label>
          <Input type="number" value={form.supplierRate} onChange={e => set('supplierRate', e.target.value)}
            className="h-8 text-xs bg-background border-border mt-0.5" placeholder="0.00" />
        </div>
      </div>

      {/* ── ADDITIONAL CHARGES TOGGLE ── */}
      <div className="mb-3 border border-border rounded-lg p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <Plus className="h-3 w-3 text-primary" /> Additional Charges
          </Label>
          <Switch checked={chargeEnabled} onCheckedChange={setChargeEnabled} />
        </div>
        {chargeEnabled && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex gap-2">
              <Select value={chargeCurrency} onValueChange={setChargeCurrency}>
                <SelectTrigger className="h-7 w-20 text-[10px] bg-background border-border shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {CURR_OPTS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" value={chargeAmount} onChange={e => setChargeAmount(e.target.value)}
                className="h-7 text-xs bg-background border-border flex-1" placeholder="Amount" min={0} />
            </div>
            <Input value={chargeDesc} onChange={e => setChargeDesc(e.target.value)}
              className="h-7 text-xs bg-background border-border" placeholder="Charge description (e.g. Rush delivery fee)" />
          </div>
        )}
      </div>

      {/* ── DISCOUNT TOGGLE ── */}
      <div className="mb-3 border border-border rounded-lg p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <Label className="text-xs font-semibold flex items-center gap-1.5">
            <Minus className="h-3 w-3 text-success" /> Discount
          </Label>
          <Switch checked={discountEnabled} onCheckedChange={setDiscountEnabled} />
        </div>
        {discountEnabled && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex gap-2">
              <Select value={discountCurrency} onValueChange={setDiscountCurrency}>
                <SelectTrigger className="h-7 w-20 text-[10px] bg-background border-border shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {CURR_OPTS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)}
                className="h-7 text-xs bg-background border-border flex-1" placeholder="Amount" min={0} />
            </div>
            <Input value={discountDesc} onChange={e => setDiscountDesc(e.target.value)}
              className="h-7 text-xs bg-background border-border" placeholder="Discount description (e.g. 3rd Order Reward Discount)" />
          </div>
        )}
      </div>

      <div className="mb-3">
        <Label className="text-xs text-muted-foreground">Additional Fee Remarks <span className="text-primary/60">(Col X)</span></Label>
        <Textarea value={form.additionalFeeRemarks} onChange={e => set('additionalFeeRemarks', e.target.value)}
          className="text-xs bg-background border-border mt-0.5 min-h-[60px]" placeholder="Enter remarks about additional fees..." />
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <Label className="text-xs text-muted-foreground">Downpayment (AED)</Label>
          <Input type="number"
            value={toDisplay(form.downpayment)}
            onChange={e => set('downpayment', fromDisplay(e.target.value))}
            className="h-8 text-xs bg-background border-border mt-0.5" placeholder="0.00" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <Label className="text-xs text-muted-foreground">Amount Received (AED)</Label>
            <button
              onClick={handlePayFull}
              disabled={isLayaway}
              className="text-[9px] font-bold text-primary bg-primary/10 hover:bg-primary/20 px-1.5 py-0.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={isLayaway ? 'PAY FULL is disabled for Layaway' : 'Auto-fill exact remaining balance'}
            >
              PAY FULL
            </button>
          </div>
          <Input type="number"
            value={toDisplay(form.amountReceived)}
            onChange={e => set('amountReceived', fromDisplay(e.target.value))}
            className="h-8 text-xs bg-background border-border" placeholder="0.00" />
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-2 mb-3 ${!isLayaway ? 'opacity-40' : ''}`}>
        <p className="col-span-2 text-xs text-muted-foreground">
          Layaway Payments <span className="font-bold text-primary">({currency})</span>{!isLayaway ? ' (locked — only active on Layaway MOP)' : ''}
        </p>
        {(['la1MonthPayment','la2MonthPayment','la3MonthPayment','la4MonthPayment'] as const).map((key, i) => (
          <div key={key}>
            <Label className="text-xs text-muted-foreground">Month {i + 1}</Label>
            <Input type="number" value={form[key]} onChange={e => set(key, e.target.value)}
              disabled={!isLayaway} className="h-8 text-xs bg-background border-border mt-0.5 disabled:opacity-50"
              placeholder="0.00" min={0} />
          </div>
        ))}
      </div>

      <div className="mb-3">
        <Label className="text-xs text-muted-foreground">Remittance Status</Label>
        <Select value={form.remittanceStatus} onValueChange={v => set('remittanceStatus', v)}>
          <SelectTrigger className="h-8 text-xs bg-background border-border mt-0.5">
            <SelectValue placeholder="Select remittance..." />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {getOptions('remittanceStatus').map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* ── Financial Summary ── */}
      <div className="bg-secondary/50 rounded-lg p-3 mb-3 space-y-1 text-xs">
        <div className="flex justify-between"><span className="text-muted-foreground">Item Price ({currency})</span><span>{currency} {itemPrice.toFixed(2)}</span></div>
        {currency !== 'AED' && <div className="flex justify-between"><span className="text-muted-foreground">Item Price (AED)</span><span>AED {itemPriceAED.toFixed(2)}</span></div>}
        <div className="flex justify-between"><span className="text-muted-foreground">Shipping Fee</span><span>AED {shippingFee.toFixed(2)}</span></div>
        {ccFee > 0 && <div className="flex justify-between"><span className="text-muted-foreground">CC Fee</span><span>AED {ccFee.toFixed(2)}</span></div>}
        {chargesAED > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{chargeDesc || 'Additional Charges'}</span>
            <span>AED {chargesAED.toFixed(2)}</span>
          </div>
        )}
        {discountsAED > 0 && (
          <div className="flex justify-between text-success">
            <span>{discountDesc || 'Discount'}</span>
            <span>- AED {discountsAED.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between font-semibold pt-1 border-t border-border">
          <span>Total Amount</span><span>AED {totalAmount.toFixed(2)}</span>
        </div>
        <div className="flex justify-between"><span className="text-muted-foreground">Total Paid</span><span>AED {totalPaid.toFixed(2)}</span></div>
        <div className={`flex justify-between font-bold pt-1 border-t border-border ${remaining > 0 ? 'text-destructive' : remaining < 0 ? 'text-hold' : 'text-success'}`}>
          <span>{remaining < 0 ? '🎁 Store Credit' : 'Remaining Balance'}</span>
          <span>AED {Math.abs(remaining).toFixed(2)}{remaining < 0 ? ' credit' : ''}</span>
        </div>
        <div className="flex justify-between pt-1 border-t border-border">
          <span className="text-muted-foreground">Expected Profit</span>
          <span className={profitAED >= 0 ? 'text-primary font-medium' : 'text-destructive font-medium'}>AED {profitAED.toFixed(2)}</span>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full bg-primary text-primary-foreground text-xs h-8">
        {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Saving...</> : 'Save Financials'}
      </Button>
    </div>
  );
}
