"use client";

import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { AlertCircle, Loader2, Pencil, Copy, Check, Scissors } from 'lucide-react';
import EditItemDialog from '@/components/admin/EditItemDialog';
import SplitItemDialog from '@/components/SplitItemDialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { DatabaseRowType } from '@/types';
import { isOverdue, isFreeSf, isPromoSf, getPromoSf, getQty, calcItemPriceAED, calcRemainingBalance, getEffectiveCurrency, calcItemPrice } from '@/lib/calculations';
import { MOP_OPTIONS, REGION_OPTIONS, getLocationFromRegion, formatDate } from '@/lib/formatters';
import { getEffectiveStatuses } from '@/lib/statusRegistry';
import { isFieldHidden, getRequirePaymentForPullout } from '@/lib/appConfig';
import { getOptions } from '@/lib/optionsConfig';
import { getCustomToggles, isToggleOn, toggleUpdate, toggleColorClass } from '@/lib/customToggles';
import { SavedTick, useSavedFlash } from '@/components/ui/motion';
import StatusBadge from '@/components/StatusBadge';
import { generateInvoiceNumber } from '@/lib/api';
import { parseDateRobust } from '@/lib/calculations';
import { useCompactMode } from '@/lib/compactMode';

interface Props {
  record: DatabaseRowType;
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
  onGroupUpdate: (fields: Partial<DatabaseRowType>) => Promise<void>;
  /** Updates all records in the same client+date group — used for invoice # assignment */
  onDateGroupUpdate?: (fields: Partial<DatabaseRowType>) => Promise<void>;
  onDpGroupUpdate?: (dp: string) => Promise<void>;
  groupHasDP?: boolean; // true when group-level DP is satisfied — unlocks status changes
  userEmail?: string;
}

const TOG_OPTIONS = ['18K', 'VCA', '21K', '24K', 'S-925'];

function isInStore(record: DatabaseRowType): boolean {
  const mos = (record.modeOfSale || '').toLowerCase().trim();
  return mos === 'in-store' || mos === 'walk-in' || mos === 'walk in';
}

function detectAutoFill(remarks: string): Partial<DatabaseRowType> | null {
  const r = (remarks || '').toLowerCase();
  if (r.includes('tabby approved')) return { modeOfPayment: 'Tabby' };
  if (r.includes('tamara approved')) return { modeOfPayment: 'Tamara' };
  if (/\bcod\b/.test(r)) return { modeOfPayment: 'COD' };
  if (/\bcc\b/.test(r) || r.includes('credit card')) return { modeOfPayment: 'Credit Card' };
  return null;
}

/** Returns MMDDYY prefix from the record's dateOfLive (falls back to today) */
function getDatePrefix(dateOfLive?: string): string {
  const d = dateOfLive ? parseDateRobust(dateOfLive) : null;
  const date = d || new Date();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}${dd}${yy}`;
}

// ─── Additional Charge inline control ────────────────────────────────────────
import { parseBillingModifiers, encodeBillingModifiers, BillingModifiers } from '@/lib/billingModifiers';

function AdditionalChargeToggle({ record, onUpdate }: {
  record: DatabaseRowType;
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}) {
  const mods = parseBillingModifiers(record.additionalCharges);
  const existingCharge = mods.charges[0];
  const [enabled, setEnabled] = useState(!!existingCharge);
  const [currency, setCurrency] = useState(existingCharge?.currency ?? 'AED');
  const [amount, setAmount] = useState(existingCharge?.amount?.toString() ?? '');

  const handleToggle = async (on: boolean) => {
    setEnabled(on);
    if (!on) {
      const updated: BillingModifiers = { ...mods, charges: [] };
      await onUpdate(record.id, { additionalCharges: encodeBillingModifiers(updated) as any });
    }
  };

  const handleApply = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    const updated: BillingModifiers = {
      ...mods,
      charges: [{ amount: amt, currency, description: '' }],
    };
    await onUpdate(record.id, { additionalCharges: encodeBillingModifiers(updated) as any });
    toast.success(`Additional charge set: ${currency} ${amt}`);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          className="scale-90 data-[state=checked]:bg-info"
        />
        <Label className="text-xs text-info">ADD CHARGE</Label>
      </div>
      {enabled && (
        <div className="flex items-center gap-1 mt-0.5">
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-7 w-16 text-xs bg-background border-info/40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="AED" className="text-xs">AED</SelectItem>
              <SelectItem value="PHP" className="text-xs">PHP</SelectItem>
              <SelectItem value="USD" className="text-xs">USD</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="h-7 w-16 text-xs bg-background border-info/40"
            placeholder="0"
          />
          <Button size="sm" variant="outline" className="h-7 text-xs px-2 border-info/40 text-info" onClick={handleApply}>
            Set
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Discount inline control ─────────────────────────────────────────────────
function DiscountToggle({ record, onUpdate }: {
  record: DatabaseRowType;
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
}) {
  const mods = parseBillingModifiers(record.additionalCharges);
  const existingDiscount = mods.discounts[0];
  const [enabled, setEnabled] = useState(!!existingDiscount);
  const [currency, setCurrency] = useState(existingDiscount?.currency ?? 'AED');
  const [amount, setAmount] = useState(existingDiscount?.amount?.toString() ?? '');
  const [desc, setDesc] = useState(existingDiscount?.description ?? '');

  const handleToggle = async (on: boolean) => {
    setEnabled(on);
    if (!on) {
      const updated: BillingModifiers = { ...mods, discounts: [] };
      await onUpdate(record.id, { additionalCharges: encodeBillingModifiers(updated) as any });
      toast.success('Discount removed');
    }
  };

  const handleApply = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid discount amount'); return; }
    if (!desc.trim()) { toast.error('Enter who approved / reason for discount'); return; }
    const updated: BillingModifiers = {
      ...mods,
      discounts: [{ amount: amt, currency, description: desc.trim() }],
    };
    await onUpdate(record.id, { additionalCharges: encodeBillingModifiers(updated) as any });
    toast.success(`Discount set: ${currency} ${amt} — ${desc.trim()}`);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          className="scale-90 data-[state=checked]:bg-success"
        />
        <Label className="text-xs text-success">DISCOUNT</Label>
      </div>
      {enabled && (
        <div className="space-y-1 mt-0.5">
          <div className="flex items-center gap-1">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="h-7 w-16 text-xs bg-background border-success/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="AED" className="text-xs">AED</SelectItem>
                <SelectItem value="PHP" className="text-xs">PHP</SelectItem>
                <SelectItem value="USD" className="text-xs">USD</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="h-7 w-16 text-xs bg-background border-success/40"
              placeholder="0"
            />
            <Button size="sm" variant="outline" className="h-7 text-xs px-2 border-success/40 text-success" onClick={handleApply}>
              Set
            </Button>
          </div>
          <Input
            value={desc}
            onChange={e => setDesc(e.target.value)}
            className="h-7 text-xs bg-background border-success/40"
            placeholder="Approved by / reason (e.g. DISCOUNTED APPROVED BY MJ)"
          />
        </div>
      )}
    </div>
  );
}

// ─── Promo SF inline control ──────────────────────────────────────────────────
function PromoSfToggle({ record, onGroupUpdate }: {
  record: DatabaseRowType;
  onGroupUpdate: (fields: Partial<DatabaseRowType>) => Promise<void>;
}) {
  const promo = getPromoSf(record);
  const active = isPromoSf(record);
  const [amount, setAmount] = useState(promo ? String(promo.amount) : '');
  const [currency, setCurrency] = useState(promo ? promo.currency : 'AED');
  const [open, setOpen] = useState(active);

  const handleToggle = async (on: boolean) => {
    setOpen(on);
    if (!on) {
      await onGroupUpdate({ freeSf: '' });
    } else {
      const amt = parseFloat(amount);
      if (amt > 0) {
        await onGroupUpdate({ freeSf: `PROMO:${currency}:${amt}` });
      }
    }
  };

  const handleApply = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    await onGroupUpdate({ freeSf: `PROMO:${currency}:${amt}` as any });
    toast.success(`Promo SF set: ${currency} ${amt}`);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Switch
          checked={active}
          onCheckedChange={handleToggle}
          className="scale-90 data-[state=checked]:bg-warning"
        />
        <Label className="text-xs text-warning">PROMO SF</Label>
      </div>
      {(open || active) && (
        <div className="flex items-center gap-1 mt-0.5">
          <Select value={currency} onValueChange={v => { setCurrency(v); }}>
            <SelectTrigger className="h-7 w-16 text-xs bg-background border-warning/40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="AED" className="text-xs">AED</SelectItem>
              <SelectItem value="PHP" className="text-xs">PHP</SelectItem>
              <SelectItem value="USD" className="text-xs">USD</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="h-7 w-16 text-xs bg-background border-warning/40"
            placeholder="0"
          />
          <Button size="sm" variant="outline" className="h-7 text-xs px-2 border-warning/40 text-warning" onClick={handleApply}>
            Set
          </Button>
        </div>
      )}
    </div>
  );
}

function AdminItemRow({ record, onUpdate, onGroupUpdate, onDateGroupUpdate, onDpGroupUpdate, groupHasDP, userEmail }: Props) {
  const [showCancel, setShowCancel] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);

  // CR3 FIX: Keep a ref to the latest record so debounced callbacks always read fresh data
  const latestRecordRef = useRef(record);
  useEffect(() => { latestRecordRef.current = record; }, [record]);

  const handleCopyInvoice = () => {
    if (!invoiceNum) return;
    navigator.clipboard.writeText(invoiceNum).then(() => {
      setCopiedInvoice(true);
      setTimeout(() => setCopiedInvoice(false), 1500);
    });
  };

  const itemPriceAED = calcItemPriceAED(record);
  const itemPriceNative = calcItemPrice(record);
  const currency = getEffectiveCurrency(record);
  const remainingBalance = calcRemainingBalance(record);
  const [remarks, setRemarks] = useState(record.liverAdminRemarks || '');
  // Confirms a write actually landed — the app used to save silently.
  const [justSaved, flashSaved] = useSavedFlash();
  const [clientAddress, setClientAddress] = useState(record.clientAddress || '');
  const [clientNumber, setClientNumber] = useState(record.clientNumber || '');
  const [invoiceNum, setInvoiceNum] = useState(record.pureWeight || '');
  const [resetKey, setResetKey] = useState(Date.now());
  const [hasDownpayment, setHasDownpayment] = useState(!!record.downpayment);
  const [downpayment, setDownpayment] = useState(record.downpayment || '');
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const overdue = isOverdue(record);
  const inStore = isInStore(record);
  const { isCompact } = useCompactMode();

  // Sync if record.pureWeight changes externally
  useEffect(() => {
    if (record.pureWeight) setInvoiceNum(record.pureWeight);
  }, [record.pureWeight]);

  useEffect(() => {
    if (!record.modeOfPayment && record.liverAdminRemarks) {
      const auto = detectAutoFill(record.liverAdminRemarks);
      if (auto) onGroupUpdate(auto);
    }
  }, [record.modeOfPayment, record.liverAdminRemarks, onGroupUpdate]);

  const debouncedDownpayment = useDebouncedCallback(async (val: string) => {
    await onUpdate(latestRecordRef.current.id, { downpayment: val });
  }, 700);

  const debouncedRemarks = useDebouncedCallback(async (val: string) => {
    const autoFill = detectAutoFill(val);
    const r = latestRecordRef.current;
    await onUpdate(r.id, { liverAdminRemarks: val });
    flashSaved();
    if (autoFill) {
      await onGroupUpdate(autoFill);
      toast.success('Auto-filled MOP from remarks');
    }
  }, 700);

  const debouncedAddress = useDebouncedCallback(async (val: string) => {
    await onUpdate(latestRecordRef.current.id, { clientAddress: val });
    flashSaved();
  }, 700);

  const debouncedNumber = useDebouncedCallback(async (val: string) => {
    await onUpdate(latestRecordRef.current.id, { clientNumber: val });
    flashSaved();
  }, 700);

  const handleMopChange = async (mop: string) => {
    const fields: Partial<DatabaseRowType> = { modeOfPayment: mop };
    if (mop === 'Pick Up Shop' || mop === 'Meet Up') fields.regions = 'Dubai';
    await onUpdate(record.id, fields);
  };

  const handleMopApplyAll = async () => {
    if (!record.modeOfPayment) return;
    const fields: Partial<DatabaseRowType> = { modeOfPayment: record.modeOfPayment };
    if (record.modeOfPayment === 'Pick Up Shop' || record.modeOfPayment === 'Meet Up') fields.regions = 'Dubai';
    await onGroupUpdate(fields);
    toast.success(`MOP "${record.modeOfPayment}" applied to all items in group`);
  };

  const handleRegionChange = async (region: string) => {
    const newLocation = getLocationFromRegion(region);
    await onGroupUpdate({ regions: region, locationOfMiner: newLocation });
  };

  const handleTogChange = async (tog: string) => {
    await onUpdate(record.id, { tog });
  };

  // Determine the currency the downpayment is collected in, based on the MOP
  // e.g. "Bank Transfer AED" → AED, "Bank Transfer PHP" → PHP, others fall back to record currency
  const dpCurrency = (() => {
    const mop = (record.modeOfPayment || '').toUpperCase();
    if (mop.includes('AED')) return 'AED';
    if (mop.includes('PHP')) return 'PHP';
    if (mop.includes('USD')) return 'USD';
    return record.currency || 'AED';
  })();

  const isWaitingForDP = record.status === 'Waiting for Downpayment';
  // Waiting for Details is the default status — prompt for the client's address
  // and number so staff can fill them in once the customer sends details.
  const isWaitingForDetails = !record.status || record.status === 'Waiting for Details';
  // Item is unlocked if: it has its own DP amount, OR the group-level DP is
  // satisfied, OR the customer provided their EID instead of a downpayment.
  const hasDPAmount = hasDownpayment && !!downpayment && (downpayment === 'acknowledged' || parseFloat(downpayment) > 0 || (downpayment.toUpperCase().startsWith('CHARGE:') && parseFloat(downpayment.split(':')[2] || '0') > 0));
  const hasEid = String(record.downpayment || '').trim().toUpperCase() === 'EID';
  // The lock can be turned off per-customer in Settings.
  const dpLocked = getRequirePaymentForPullout() && isWaitingForDP && !hasDPAmount && !groupHasDP && !hasEid;

  const handleStatusChange = async (newStatus: string) => {
    setResetKey(Date.now());
    if (newStatus === 'Cancelled') { setShowCancel(true); return; }
    if (dpLocked) {
      toast.error('Enter a downpayment amount to enable other status options');
      return;
    }
    if (newStatus === 'For Pullout') {
      if (!record.modeOfPayment) { toast.error('Mode of Payment is required'); return; }
      if (record.locationOfMiner === 'Local' && !record.regions) { toast.error('Region required for Local miners'); return; }
    }
    const fields: Partial<DatabaseRowType> = { status: newStatus };
    if (userEmail) {
      const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const newEntry = `[${newStatus} by ${userEmail.split('@')[0]} on ${timestamp}]`;
      fields.auditTrail = record.auditTrail ? `${record.auditTrail} ${newEntry}` : newEntry;
    }
    await onUpdate(record.id, fields);
    flashSaved();
    toast.success(`Status set to ${newStatus}`);
  };

  return (
    <div className={`rounded-lg border p-3 mb-2 ${overdue ? 'border-destructive bg-destructive/5' : 'border-border bg-secondary/30'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium truncate">{record.itemDescription || '—'}</p>
            <button onClick={() => setShowEdit(true)} className="shrink-0 text-muted-foreground hover:text-primary transition-colors" title="Edit item details">
              <Pencil className="h-3 w-3" />
            </button>
            <SavedTick show={justSaved} />

          </div>
          <div className="flex flex-wrap gap-1 mt-1">
            <StatusBadge status={record.status} />
            {overdue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold bg-destructive/20 text-destructive border-destructive/40">
                <AlertCircle className="h-3 w-3" /> NEEDS ATTENTION
              </span>
            )}
          </div>
        </div>
        <div className="text-right ml-2 shrink-0">
          <p className="text-xs text-muted-foreground">{record.category}</p>
          <p className="text-xs text-muted-foreground">
            {(record.category || '').toLowerCase().includes('screw type')
              ? `${getQty(record)} PCS`
              : (record.grams ? `${record.grams}g` : 'PC')}
          </p>
          {itemPriceNative > 0 && (
            <p className="text-xs font-bold text-primary">
              {currency} {itemPriceNative.toLocaleString()}
            </p>
          )}
          {currency !== 'AED' && itemPriceAED > 0 && (
            <p className="text-[10px] text-muted-foreground">≈ AED {itemPriceAED.toLocaleString()}</p>
          )}
          {remainingBalance > 0 && (
            <p className="text-[10px] font-semibold text-warning">Owed: {Math.round(remainingBalance)}</p>
          )}
        </div>
      </div>
      {!isCompact && <p className="text-xs text-muted-foreground mb-3">Live: {formatDate(record.dateOfLive)} · {record.locationOfMiner}</p>}

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Mode of Payment</Label>
            {record.modeOfPayment && (
              <button
                onClick={handleMopApplyAll}
                className="text-[10px] text-primary/70 hover:text-primary underline transition-colors"
                title="Apply this MOP to all items in the group"
              >
                Apply to all
              </button>
            )}
          </div>
          <Select value={record.modeOfPayment || ''} onValueChange={handleMopChange}>
            <SelectTrigger className="h-8 text-xs bg-background border-border mt-0.5">
              <SelectValue placeholder="Select MOP..." />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {getOptions('modeOfPayment').map(opt => <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!inStore && !isCompact && (
          <div>
            <Label className="text-xs text-muted-foreground">Region <span className="text-primary/60">(applies to all items)</span></Label>
            <Select value={record.regions || ''} onValueChange={handleRegionChange}>
              <SelectTrigger className="h-8 text-xs bg-background border-border mt-0.5">
                <SelectValue placeholder="Select region..." />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {getOptions('region').map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">T.O.G</Label>
            <Select value={record.tog || ''} onValueChange={handleTogChange}>
              <SelectTrigger className="h-8 text-xs bg-background border-border mt-0.5">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {getOptions('tog').map(opt => <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-primary/80 font-semibold">Invoice #</Label>
            <div className="flex gap-1 mt-0.5">
              <Input
                type="text"
                value={invoiceNum || ''}
                readOnly
                className="h-8 text-xs bg-muted/40 border-border cursor-not-allowed font-mono flex-1 min-w-0"
                placeholder="—"
              />
              {invoiceNum && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-primary"
                  onClick={handleCopyInvoice}
                  title="Copy invoice number"
                >
                  {copiedInvoice ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs px-2 border-border shrink-0"
                disabled={generating}
                onClick={async () => {
                  if (generatingRef.current) return;
                  generatingRef.current = true;
                  setGenerating(true);
                  try {
                    const prefix = getDatePrefix(record.dateOfLive);
                    const { invoiceNumber } = await generateInvoiceNumber({ prefix, recordId: record.id, dateOfLive: record.dateOfLive || '', minerName: record.minerName || '', rowKey: record.rowKey || undefined });
                    setInvoiceNum(invoiceNumber);
                    // Apply to ALL items in the same client+date group (not just this one)
                    if (onDateGroupUpdate) {
                      await onDateGroupUpdate({ pureWeight: invoiceNumber, invoiceNumber: invoiceNumber });
                    } else {
                      await onUpdate(record.id, { pureWeight: invoiceNumber, invoiceNumber: invoiceNumber });
                    }
                    toast.success(`Invoice # ${invoiceNumber} assigned to all items in this group`);
                  } catch {
                    toast.error('Failed to generate invoice #');
                  } finally {
                    generatingRef.current = false;
                    setGenerating(false);
                  }
                }}
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Gen'}
              </Button>
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Qty</Label>
            <Input
              type="number"
              defaultValue={getQty(record)}
              onChange={e => onUpdate(record.id, { qty: Number(e.target.value) })}
              className="h-8 text-xs bg-background border-border mt-0.5"
              placeholder="1"
            />
          </div>
        </div>

        {!isCompact && (
          <div>
            <Label className="text-xs text-muted-foreground">Liver/Admin Remarks</Label>
            <Textarea value={remarks} onChange={e => { setRemarks(e.target.value); debouncedRemarks(e.target.value); }} className="h-14 text-xs bg-background border-border mt-0.5 resize-none" placeholder="e.g. TABBY APPROVED, COD..." />
          </div>
        )}

        {/* When Waiting for Details (default), let staff fill in the client's
            delivery details as soon as the customer sends them. */}
        {isWaitingForDetails && (!isFieldHidden('clientAddress') || !isFieldHidden('clientNumber')) && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {!isFieldHidden('clientAddress') && (
              <div>
                <Label className="text-xs text-muted-foreground">Client Address</Label>
                <Input
                  value={clientAddress}
                  onChange={e => { setClientAddress(e.target.value); debouncedAddress(e.target.value); }}
                  className="h-8 text-xs bg-background border-border mt-0.5"
                  placeholder="Delivery address…"
                />
              </div>
            )}
            {!isFieldHidden('clientNumber') && (
              <div>
                <Label className="text-xs text-muted-foreground">Client Number</Label>
                <Input
                  value={clientNumber}
                  onChange={e => { setClientNumber(e.target.value); debouncedNumber(e.target.value); }}
                  className="h-8 text-xs bg-background border-border mt-0.5"
                  placeholder="Contact number…"
                />
              </div>
            )}
          </div>
        )}

        {/* Downpayment is managed at the group level in AdminClientCard */}

        <div className="flex items-center justify-between">
          {!inStore ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Switch
                    checked={isFreeSf(record)}
                    onCheckedChange={v => onGroupUpdate({ freeSf: v ? 'TRUE' : '' })}
                    className="scale-90"
                  />
                  <Label className="text-xs">FREE SF</Label>
                </div>
                <PromoSfToggle record={record} onGroupUpdate={onGroupUpdate} />
                <AdditionalChargeToggle record={record} onUpdate={onUpdate} />
                <DiscountToggle record={record} onUpdate={onUpdate} />
                {/* Developer-defined toggles (Settings → Custom Toggles) */}
                {getCustomToggles().map(t => (
                  <div key={t.id} className="flex items-center gap-1.5">
                    <Switch
                      checked={isToggleOn(record, t)}
                      onCheckedChange={v => onUpdate(record.id, toggleUpdate(t, v))}
                      className="scale-90"
                    />
                    <Label className={`text-xs ${toggleColorClass(t.color)}`}>{t.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          ) : <div />}

          <Select key={resetKey} onValueChange={handleStatusChange}>
            <SelectTrigger className="h-7 text-xs w-40 bg-background border-border">
              <SelectValue placeholder="Change status..." />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {inStore ? (
                <>
                  <SelectItem value="Delivered" className="text-xs text-foreground font-medium">Delivered</SelectItem>
                  <SelectItem value="Cancelled" className="text-xs text-destructive font-medium">Cancelled</SelectItem>
                </>
              ) : (
                getEffectiveStatuses('admin', record.status).map((s) => {
                  const isCancel = /cancel/i.test(s);
                  const lockPullout = dpLocked && /for pullout/i.test(s);
                  return (
                    <SelectItem
                      key={s}
                      value={s}
                      disabled={lockPullout}
                      className={`text-xs font-medium ${
                        lockPullout
                          ? 'opacity-60 text-muted-foreground'
                          : isCancel
                            ? 'text-destructive'
                            : 'text-foreground'
                      }`}
                    >
                      {s}
                    </SelectItem>
                  );
                })
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showEdit && (
        <EditItemDialog
          record={record}
          onSave={fields => onUpdate(record.id, fields)}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showSplit && (
        <SplitItemDialog
          record={record}
          onClose={() => setShowSplit(false)}
          onComplete={() => onUpdate(record.id, {})}
        />
      )}

      <AlertDialog open={showCancel} onOpenChange={setShowCancel}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this item?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone from the app.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={async () => { await onUpdate(record.id, { status: 'Cancelled' }); toast.success('Item cancelled'); }}>
              Cancel Item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default memo(AdminItemRow, (prevProps, nextProps) => {
  return prevProps.record === nextProps.record && prevProps.userEmail === nextProps.userEmail;
});
