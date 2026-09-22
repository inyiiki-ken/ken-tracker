"use client";

import { useState, useRef, memo, useCallback, useMemo } from 'react';
import { FileText, Truck, Upload, History, ChevronDown, AlertTriangle, Pencil, Check, X, Scissors, StickyNote, Plus, Gift, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { DatabaseRowType } from '@/types';
import { useCompactMode } from '@/lib/compactMode';
import { calcShippingFee, isFreeSf, isPromoSf, getPromoSf, getQty } from '@/lib/calculations';
import { getEffectiveStatuses } from '@/lib/statusRegistry';
import { getOptions } from '@/lib/optionsConfig';
import StatusBadge from '@/components/StatusBadge';
import InvoiceModal from '@/components/InvoiceModal';
import CustomerHistoryModal from '@/components/CustomerHistoryModal';
import SplitItemDialog from '@/components/SplitItemDialog';
import { computeClientMilestones, getMilestoneAlert, getMilestoneBadge, ClientMilestone } from '@/lib/milestones';

interface Props {
  minerName: string;
  records: DatabaseRowType[];
  allRecords: DatabaseRowType[];
  onUpdate: (rowId: number, fields: Partial<DatabaseRowType>) => Promise<void>;
  userEmail?: string;
  clientMilestones?: Map<string, ClientMilestone>;
}

const MOP_OPTIONS = [
  'COD (Dubai)', 'COD (Sharjah)', 'COD (Abu Dhabi)',
  'Bank Transfer AED (Dubai)', 'Bank Transfer AED (Sharjah)', 'Bank Transfer AED (Abu Dhabi)',
  'Bank Transfer PHP', 'Bank Transfer USD', 'GCash',
  'Western Union (US)', 'Western Union (PH)',
  'Pick Up Shop', 'Meet Up', 'Tabby', 'Tamara', 'International',
];

// ─── Dispatch Notes helpers ──────────────────────────────────────────────────
const NOTE_SEP = '\u27E6NOTE:';
const NOTE_END = '\u27E7';

interface ParsedNote { author: string; time: string; text: string; }

function parseNotes(val?: string): { remarks: string; notes: ParsedNote[] } {
  if (!val) return { remarks: '', notes: [] };
  const notes: ParsedNote[] = [];
  const parts = val.split(NOTE_SEP);
  const remarks = parts[0].trim();
  for (let i = 1; i < parts.length; i++) {
    const endIdx = parts[i].indexOf(NOTE_END);
    if (endIdx === -1) continue;
    const inner = parts[i].substring(0, endIdx);
    const p1 = inner.indexOf('|');
    const p2 = inner.indexOf('|', p1 + 1);
    if (p1 === -1 || p2 === -1) continue;
    notes.push({ author: inner.substring(0, p1), time: inner.substring(p1 + 1, p2), text: inner.substring(p2 + 1) });
  }
  return { remarks, notes };
}

function buildNoteAppend(existing: string | undefined, author: string, text: string): string {
  const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${existing || ''}${NOTE_SEP}${author}|${now}|${text}${NOTE_END}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isGivenToShopMode(record: DatabaseRowType): boolean {
  const location = (record.locationOfMiner || '').toLowerCase();
  const region = (record.regions || '').toLowerCase();
  return location.includes('pinas') || location.includes('international') || region.includes('pinas') || region.includes('international');
}

function getDeliveryLabel(record: DatabaseRowType): string {
  const mop = record.modeOfPayment || '';
  const region = record.regions ? `(${record.regions})` : '';
  if (mop === 'Pick Up Shop') return 'Pick Up Shop';
  if (mop === 'Meet Up') return 'Meet Up';
  if (region) return `${mop} ${region}`.trim();
  return mop || 'Unknown';
}

function getDeliverySummary(records: DatabaseRowType[]): string {
  const labels = records.map(getDeliveryLabel);
  const unique = [...new Set(labels)];
  if (unique.length === 1) return unique[0];
  return `🔴 MIXED: ${unique.join(', ')}`;
}

function canDispatch(record: DatabaseRowType): boolean {
  const isCOD = (record.modeOfPayment || '').toUpperCase().includes('COD');
  if (isCOD) return true;
  const amountReceived = parseFloat(String(record.amountReceived || '0').replace(/,/g, '')) || 0;
  const clientRate = parseFloat(String(record.clientRate || '0').replace(/,/g, '')) || 0;
  return amountReceived >= clientRate;
}

// ─── Item Edit Row ────────────────────────────────────────────────────────────
function ItemEditRow({ record, onSave, onCancel, saving }: {
  record: DatabaseRowType;
  onSave: (fields: Partial<DatabaseRowType>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [mop, setMop] = useState(record.modeOfPayment || '');
  const [grams, setGrams] = useState(String(record.grams ?? ''));
  const [gramsError, setGramsError] = useState('');
  const [freeSf, setFreeSf] = useState(String(record.freeSf).toLowerCase() === 'true');
  const existingPromo = getPromoSf(record);
  const [promoSfVal, setPromoSfVal] = useState(isPromoSf(record) ? String(record.freeSf) : '');
  const [promoSfCurrency, setPromoSfCurrency] = useState(existingPromo?.currency ?? 'AED');
  const [promoSfAmount, setPromoSfAmount] = useState(existingPromo ? String(existingPromo.amount) : '');
  const [itemDesc, setItemDesc] = useState(record.itemDescription || '');
  const isScrewType = (record.category || '').toLowerCase().includes('screw type');

  const parseAddCharge = (val?: string) => {
    if (!val || !val.startsWith('ADDCHARGE:')) return null;
    const parts = val.split(':');
    return { currency: parts[1] ?? 'AED', amount: parts[2] ?? '' };
  };
  const existingAddCharge = parseAddCharge(record.additionalCharges);
  const [addChargeEnabled, setAddChargeEnabled] = useState(!!existingAddCharge);
  const [addChargeCurrency, setAddChargeCurrency] = useState(existingAddCharge?.currency ?? 'AED');
  const [addChargeAmount, setAddChargeAmount] = useState(existingAddCharge?.amount ?? '');

  const validateGrams = (val: string): boolean => {
    const num = parseFloat(val);
    if (val !== '' && (isNaN(num) || num < 0)) {
      setGramsError('Grams must be a positive number');
      return false;
    }
    setGramsError('');
    return true;
  };

  const handleSave = () => {
    if (!isScrewType && !validateGrams(grams)) return;
    const fields: Partial<DatabaseRowType> = {};
    const descTrimmed = itemDesc.trim().toUpperCase();
    if (descTrimmed && descTrimmed !== (record.itemDescription || '').toUpperCase()) fields.itemDescription = descTrimmed;
    if (mop !== record.modeOfPayment) fields.modeOfPayment = mop;
    if (!isScrewType) {
      const gramsNum = parseFloat(grams);
      if (!isNaN(gramsNum) && gramsNum !== record.grams) fields.grams = gramsNum;
    }
    const currentFreeSf = String(record.freeSf).toLowerCase() === 'true';
    const currentPromoSf = isPromoSf(record) ? String(record.freeSf) : '';
    if (freeSf !== currentFreeSf || promoSfVal !== currentPromoSf) {
      if (promoSfVal) (fields as Record<string, unknown>).freeSf = promoSfVal;
      else fields.freeSf = freeSf ? 'TRUE' : '';
    }
    const newAddCharge = addChargeEnabled && addChargeAmount ? `ADDCHARGE:${addChargeCurrency}:${addChargeAmount}` : '';
    if (newAddCharge !== (record.additionalCharges ?? '')) fields.additionalCharges = newAddCharge;
    onSave(fields);
  };

  return (
    <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Item Description</label>
        <Input value={itemDesc} onChange={e => setItemDesc(e.target.value)} className="h-7 text-xs bg-background border-border uppercase" placeholder="e.g. GOLD RING 18K" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Mode of Payment</label>
        <Select value={mop} onValueChange={setMop}>
          <SelectTrigger className="h-7 text-xs bg-background border-border"><SelectValue placeholder="Select MOP..." /></SelectTrigger>
          <SelectContent className="bg-popover border-border">
            {getOptions('modeOfPayment').map(opt => <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {!isScrewType && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Grams</label>
          <Input
            value={grams}
            onChange={e => { setGrams(e.target.value); validateGrams(e.target.value); }}
            type="number" step="0.01" min="0"
            className={`h-7 text-xs bg-background ${gramsError ? 'border-destructive' : 'border-border'}`}
            placeholder="e.g. 1.71"
          />
          {gramsError && <p className="text-[10px] text-destructive">{gramsError}</p>}
        </div>
      )}
      <div className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2 border border-border/40">
        <div><p className="text-xs font-medium">Free Shipping</p><p className="text-[10px] text-muted-foreground">Override SF to AED 0</p></div>
        <Switch checked={freeSf} onCheckedChange={v => { setFreeSf(v); if (v) setPromoSfVal(''); }} className="data-[state=checked]:bg-primary" />
      </div>
      <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div><p className="text-xs font-medium text-warning">Promo SF</p><p className="text-[10px] text-muted-foreground">Set a discounted shipping fee</p></div>
          <Switch checked={!!promoSfVal} onCheckedChange={v => { if (!v) setPromoSfVal(''); else setFreeSf(false); }} className="data-[state=checked]:bg-warning" />
        </div>
        {!!promoSfVal && (
          <div className="flex items-center gap-1.5">
            <Select value={promoSfCurrency} onValueChange={v => { setPromoSfCurrency(v); setPromoSfVal(`PROMO:${v}:${promoSfAmount}`); }}>
              <SelectTrigger className="h-7 w-16 text-xs bg-background border-warning/40"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="AED" className="text-xs">AED</SelectItem>
                <SelectItem value="PHP" className="text-xs">PHP</SelectItem>
                <SelectItem value="USD" className="text-xs">USD</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" value={promoSfAmount} onChange={e => { setPromoSfAmount(e.target.value); setPromoSfVal(`PROMO:${promoSfCurrency}:${e.target.value}`); }} className="h-7 text-xs flex-1 bg-background border-warning/40" placeholder="e.g. 20" />
          </div>
        )}
      </div>
      <div className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div><p className="text-xs font-medium text-info">Additional Charges</p><p className="text-[10px] text-muted-foreground">Extra fee on top of price</p></div>
          <Switch checked={addChargeEnabled} onCheckedChange={v => setAddChargeEnabled(v)} className="data-[state=checked]:bg-info" />
        </div>
        {addChargeEnabled && (
          <div className="flex items-center gap-1.5">
            <Select value={addChargeCurrency} onValueChange={v => setAddChargeCurrency(v)}>
              <SelectTrigger className="h-7 w-16 text-xs bg-background border-info/40"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="AED" className="text-xs">AED</SelectItem>
                <SelectItem value="PHP" className="text-xs">PHP</SelectItem>
                <SelectItem value="USD" className="text-xs">USD</SelectItem>
              </SelectContent>
            </Select>
            <Input type="number" value={addChargeAmount} onChange={e => setAddChargeAmount(e.target.value)} className="h-7 text-xs flex-1 bg-background border-info/40" placeholder="e.g. 50" />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave} disabled={saving}><Check className="h-3 w-3 mr-1" /> Save</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={onCancel} disabled={saving}><X className="h-3 w-3 mr-1" /> Cancel</Button>
      </div>
    </div>
  );
}

// ─── Dispatch Note Input ──────────────────────────────────────────────────────
function NoteInput({ onAdd, onCancel, saving }: { onAdd: (text: string) => void; onCancel: () => void; saving: boolean }) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
  };
  return (
    <div className="mt-2 space-y-1.5 border-t border-attention/30 pt-2">
      <Textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add a dispatch note..."
        className="text-xs bg-attention/5 border-attention/30 resize-none h-16 placeholder:text-muted-foreground/50"
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) submit(); if (e.key === 'Escape') onCancel(); }}
      />
      <p className="text-[9px] text-muted-foreground">Ctrl+Enter to save · Escape to cancel</p>
      <div className="flex gap-1.5">
        <Button size="sm" className="h-6 text-[10px] flex-1 bg-attention hover:bg-attention text-black" onClick={submit} disabled={saving || !text.trim()}>
          <Check className="h-3 w-3 mr-1" /> Add Note
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onCancel} disabled={saving}><X className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

// ─── Sticky Note Display ──────────────────────────────────────────────────────
function StickyNotes({ notes }: { notes: ParsedNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-1.5">
      {notes.map((note, i) => (
        <div key={i} className="rounded-md border border-attention/40 bg-attention/10 px-2.5 py-1.5">
          <div className="flex items-center gap-1 mb-0.5">
            <StickyNote className="h-2.5 w-2.5 text-attention" />
            <span className="text-[9px] font-bold text-attention">{note.author}</span>
            <span className="text-[9px] text-muted-foreground ml-auto">{note.time}</span>
          </div>
          <p className="text-[11px] text-foreground leading-snug">{note.text}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Main Card ────────────────────────────────────────────────────────────────
function DispatchClientCard({ minerName, records, allRecords, onUpdate, userEmail, clientMilestones }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [cancelRecord, setCancelRecord] = useState<DatabaseRowType | null>(null);
  const [resetKeys, setResetKeys] = useState<Record<number, number>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [splitRecord, setSplitRecord] = useState<DatabaseRowType | null>(null);

  // Inline name editing
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(minerName);
  const [savingName, setSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Per-item editing
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [savingItemId, setSavingItemId] = useState<number | null>(null);

  // Per-item note inputs
  const [addingNoteId, setAddingNoteId] = useState<number | null>(null);
  const [savingNoteId, setSavingNoteId] = useState<number | null>(null);

  // Optimistic local overrides: record id → partial fields applied optimistically
  const [localOverrides, setLocalOverrides] = useState<Map<number, Partial<DatabaseRowType>>>(new Map());

  // Sequential update queue per record id
  const updateQueues = useRef<Map<number, Promise<void>>>(new Map());

  const getEffective = useCallback((record: DatabaseRowType): DatabaseRowType => {
    const ov = localOverrides.get(record.id);
    return ov ? { ...record, ...ov } : record;
  }, [localOverrides]);

  // Enqueue update: apply optimistically, chain for sequential processing, rollback on failure
  const queueUpdate = useCallback(async (
    record: DatabaseRowType,
    fields: Partial<DatabaseRowType>,
  ): Promise<void> => {
    const id = record.id;
    const snapshot = localOverrides.get(id);

    // Optimistic apply
    setLocalOverrides(prev => {
      const next = new Map(prev);
      next.set(id, { ...(prev.get(id) || {}), ...fields });
      return next;
    });

    const prev = updateQueues.current.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        await onUpdate(id, fields);
        // Success: clear the override (server is now source of truth)
        setLocalOverrides(m => { const n = new Map(m); n.delete(id); return n; });
      } catch {
        // Rollback
        setLocalOverrides(m => {
          const n = new Map(m);
          if (snapshot) n.set(id, snapshot); else n.delete(id);
          return n;
        });
        toast.error('Save failed — changes reverted', { icon: '↩️' });
      }
    });
    updateQueues.current.set(id, next);
    return next;
  }, [onUpdate, localOverrides]);

  const first = records[0];
  const deliverySummary = getDeliverySummary(records);
  const { isCompact } = useCompactMode();

  // Milestone computation — use pre-computed if available, fallback to local
  const clientMilestone = useMemo(() => {
    const customerId = first?.customerId?.trim();
    if (!customerId) return null;
    if (clientMilestones) return clientMilestones.get(customerId) ?? null;
    const milestones = computeClientMilestones(allRecords);
    return milestones.get(customerId) ?? null;
  }, [first?.customerId, allRecords, clientMilestones]);
  const milestoneAlert = clientMilestone ? getMilestoneAlert(clientMilestone.qualifyingCount) : null;
  const milestoneBadge = clientMilestone ? getMilestoneBadge(clientMilestone.qualifyingCount) : null;

  const handleStatusChange = async (record: DatabaseRowType, newStatus: string) => {
    setResetKeys(prev => ({ ...prev, [record.id]: (prev[record.id] || 0) + 1 }));
    if (newStatus === 'Cancelled') { setCancelRecord(record); return; }
    const fields: Partial<DatabaseRowType> = { status: newStatus };
    if (newStatus === 'Dispatched') fields.dispatchDate = new Date().toISOString();
    if (newStatus === 'Delivered' || newStatus === 'Given to Shop') fields.deliveredDate = new Date().toISOString();
    if (userEmail) {
      const timestamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const newEntry = `[${newStatus} by ${userEmail.split('@')[0]} on ${timestamp}]`;
      fields.auditTrail = record.auditTrail ? `${record.auditTrail} ${newEntry}` : newEntry;
    }
    await queueUpdate(record, fields);
    toast.success(`Status: ${newStatus}`);
  };

  const startEditName = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNameValue(minerName);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const cancelEditName = (e?: React.MouseEvent) => { e?.stopPropagation(); setEditingName(false); setNameValue(minerName); };

  const saveEditName = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const trimmed = nameValue.trim();
    if (!trimmed || trimmed === minerName) { cancelEditName(); return; }
    setSavingName(true);
    try {
      await Promise.all(records.map(r => onUpdate(r.id, { minerName: trimmed })));
      toast.success(`Name updated to "${trimmed}"`);
      setEditingName(false);
    } catch { toast.error('Failed to update name'); }
    finally { setSavingName(false); }
  };

  const handleItemSave = async (record: DatabaseRowType, fields: Partial<DatabaseRowType>) => {
    if (Object.keys(fields).length === 0) { setEditingItemId(null); return; }
    setSavingItemId(record.id);
    try {
      await queueUpdate(record, fields);
      toast.success('Item updated');
      setEditingItemId(null);
    } catch { /* error handled in queueUpdate */ }
    finally { setSavingItemId(null); }
  };

  const handleAddNote = async (record: DatabaseRowType, text: string) => {
    setSavingNoteId(record.id);
    const author = userEmail ? userEmail.split('@')[0] : 'Dispatch';
    const effective = getEffective(record);
    const newRemarks = buildNoteAppend(effective.liverAdminRemarks, author, text);
    try {
      await queueUpdate(record, { liverAdminRemarks: newRemarks });
      toast.success('Note added');
      setAddingNoteId(null);
    } catch { /* handled in queueUpdate */ }
    finally { setSavingNoteId(null); }
  };

  return (
    <div className="mb-3 rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="w-full px-4 py-2.5 border-b border-border/50 flex items-center justify-between text-left focus:outline-none"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {editingName ? (
              <div className="flex items-center gap-1.5 flex-1" onClick={e => e.stopPropagation()}>
                <Input ref={nameInputRef} value={nameValue} onChange={e => setNameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveEditName(); if (e.key === 'Escape') cancelEditName(); }}
                  className="h-7 text-sm font-cinzel bg-background border-primary/50 text-primary w-full max-w-[220px]" disabled={savingName} />
                <button onClick={saveEditName} disabled={savingName} className="text-success hover:text-success transition-colors"><Check className="h-4 w-4" /></button>
                <button onClick={cancelEditName} className="text-muted-foreground hover:text-foreground transition-colors"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <>
                <span className="font-cinzel text-[13px] text-primary">{minerName}</span>
                <button className="shrink-0 text-muted-foreground hover:text-primary transition-colors" title="Edit customer name" onClick={startEditName}><Pencil className="h-3 w-3" /></button>
                {first?.customerId && (
                  <button className="shrink-0 text-muted-foreground hover:text-primary transition-colors" title="View Lifetime History" onClick={e => { e.stopPropagation(); setShowHistory(true); }}><History className="h-3.5 w-3.5" /></button>
                )}
                {milestoneBadge && (
                  <span className="text-[10px] font-bold bg-warning/20 text-warning px-1.5 py-0.5 rounded-full">{milestoneBadge}</span>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-0.5">
            <span>{records.length} item{records.length !== 1 ? 's' : ''}</span>
            {!isCompact && <span className={deliverySummary.startsWith('🔴') ? 'text-destructive font-medium' : ''}>{deliverySummary}</span>}
            {!isCompact && first?.liverName && <span className="flex items-center gap-1"><Upload className="h-3 w-3" />{first.liverName}</span>}
            {first?.clientNumber && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{first.clientNumber}</span>}
            {first?.clientAddress && <span className="flex items-center gap-1 truncate max-w-[240px]" title={first.clientAddress}><MapPin className="h-3 w-3 shrink-0" />{first.clientAddress}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          <Button variant="outline" size="sm" className="border-primary/40 text-primary text-xs h-7" onClick={e => { e.stopPropagation(); setShowInvoice(true); }}>
            <FileText className="h-3 w-3 mr-1" /> Invoice
          </Button>
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 py-2 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Milestone Alert Banner */}
          {milestoneAlert && (
            <div className="flex items-center gap-2 bg-warning/15 border border-warning/40 rounded-lg px-3 py-2 animate-pulse">
              <Gift className="h-4 w-4 text-warning shrink-0" />
              <p className="text-xs font-bold text-warning">{milestoneAlert}</p>
            </div>
          )}
          {records.map(record => {
            const effective = getEffective(record);
            const givenToShopMode = isGivenToShopMode(effective);
            const latestAudit = effective.auditTrail ? effective.auditTrail.split(/(?=\[)/).pop() : null;
            const dispatchAllowed = canDispatch(effective);
            const isScrewType = (effective.category || '').toLowerCase().includes('screw type');
            const isEditingThis = editingItemId === record.id;
            const isAddingNote = addingNoteId === record.id;
            const { remarks, notes } = parseNotes(effective.liverAdminRemarks);

            return (
              <div key={record.id} className="rounded-lg border border-border/50 bg-secondary/20 p-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{effective.itemDescription}</p>
                    {!isCompact && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {effective.category} · {isScrewType ? `${getQty(effective)} PCS` : (effective.grams ? `${effective.grams}g` : 'PC')}
                        <span className="text-foreground font-medium ml-1">· {effective.modeOfPayment || 'No MOP'} {effective.regions && `(${effective.regions})`}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {record.status === 'Outsource' && (record.grams ?? 0) > 0 && !isEditingThis && (
                      <button className="text-success hover:text-success transition-colors" title="Split item" onClick={() => setSplitRecord(record)}>
                        <Scissors className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!isEditingThis && record.status !== 'Cancelled' && (
                      <button className="text-muted-foreground hover:text-primary transition-colors" title="Edit MOP & Grams" onClick={() => setEditingItemId(record.id)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <StatusBadge status={effective.status} />
                  </div>
                </div>

                {!isCompact && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                    <Truck className="h-3 w-3" />
                    <span>SF: AED {calcShippingFee(effective).toFixed(2)}</span>
                    {isFreeSf(effective) && <span className="text-primary">(FREE)</span>}
                    {isPromoSf(effective) && (() => { const p = getPromoSf(effective); return p ? <span className="text-warning">(PROMO {p.currency} {p.amount})</span> : null; })()}
                    {effective.additionalCharges && (effective.additionalCharges.startsWith('ADDCHARGE:') || effective.additionalCharges.startsWith('CHARGE:')) && (() => {
                      const parts = effective.additionalCharges.split(':');
                      return <span className="text-info">(+{parts[1]} {parts[2]})</span>;
                    })()}
                    {effective.additionalCharges?.includes('DISCOUNT:') && (
                      <span className="text-success">(Discount applied)</span>
                    )}
                    {effective.source && <span className="ml-2 text-muted-foreground/70 border-l border-border/40 pl-2">📦 {effective.source}</span>}
                  </div>
                )}

                {!dispatchAllowed && !givenToShopMode && (
                  <div className="flex items-center gap-1.5 mb-2">
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 flex items-center gap-1">
                      <AlertTriangle className="h-2.5 w-2.5" /> Balance Pending
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">Received: {effective.amountReceived || 0} / {effective.clientRate || 0}</span>
                  </div>
                )}

                {!isCompact && remarks && (
                  <p className="text-xs text-muted-foreground/70 italic mb-1.5 truncate">Remarks: {remarks}</p>
                )}

                {!isCompact && latestAudit && (
                  <p className="text-[10px] text-primary/60 mb-2 truncate flex items-center gap-1" title={effective.auditTrail}>
                    <History className="h-2.5 w-2.5" />{latestAudit}
                  </p>
                )}

                {/* Sticky Notes */}
                <StickyNotes notes={notes} />

                {/* Add Note button */}
                {!isAddingNote && !isEditingThis && record.status !== 'Cancelled' && (
                  <button
                    className="flex items-center gap-1 text-[10px] text-attention/70 hover:text-attention transition-colors mt-1.5"
                    onClick={() => { setAddingNoteId(record.id); setEditingItemId(null); }}
                  >
                    <Plus className="h-3 w-3" />
                    Add dispatch note
                  </button>
                )}

                {/* Note input */}
                {isAddingNote && (
                  <NoteInput
                    saving={savingNoteId === record.id}
                    onAdd={text => handleAddNote(record, text)}
                    onCancel={() => setAddingNoteId(null)}
                  />
                )}

                {/* Inline MOP & Grams editor */}
                {isEditingThis && (
                  <ItemEditRow
                    record={effective}
                    saving={savingItemId === record.id}
                    onSave={fields => handleItemSave(record, fields)}
                    onCancel={() => setEditingItemId(null)}
                  />
                )}

                {effective.status !== 'Cancelled' && (
                  <Select key={`status-${record.id}-${resetKeys[record.id] || 0}`} onValueChange={v => handleStatusChange(record, v)}>
                    <SelectTrigger className="h-7 text-xs w-full bg-background border-border mt-2"><SelectValue placeholder="Set status..." /></SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {givenToShopMode ? (
                        <>
                          <SelectItem value="Given to Shop" className="text-xs">Given to Shop</SelectItem>
                          <SelectItem value="Dispatched" className="text-xs">Dispatched{!dispatchAllowed ? ' (Balance Pending)' : ''}</SelectItem>
                          <SelectItem value="Delivered" className="text-xs">Delivered{!dispatchAllowed ? ' (Balance Pending)' : ''}</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="Dispatched" className="text-xs">Dispatched{!dispatchAllowed ? ' (Balance Pending)' : ''}</SelectItem>
                          <SelectItem value="Delivered" className="text-xs">Delivered{!dispatchAllowed ? ' (Balance Pending)' : ''}</SelectItem>
                        </>
                      )}
                      {getEffectiveStatuses('dispatch', effective.status)
                        .filter((s) => !/^(dispatched|delivered|given to shop)$/i.test(s))
                        .map((s) => (
                          <SelectItem
                            key={s}
                            value={s}
                            className={`text-xs font-medium ${/cancel/i.test(s) ? 'text-destructive' : 'text-foreground'}`}
                          >
                            {s}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showInvoice && (
        <InvoiceModal
          records={allRecords.filter(r => r.minerName?.trim().toLowerCase() === minerName.trim().toLowerCase())}
          onClose={() => setShowInvoice(false)}
        />
      )}
      {splitRecord && (
        <SplitItemDialog record={splitRecord} onClose={() => setSplitRecord(null)} onComplete={() => onUpdate(splitRecord.id, {})} />
      )}
      {showHistory && first?.customerId && (
        <CustomerHistoryModal customerId={first.customerId} minerName={minerName} allRecords={allRecords} onClose={() => setShowHistory(false)} />
      )}

      <AlertDialog open={!!cancelRecord} onOpenChange={() => setCancelRecord(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this item?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone from the app.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={async () => {
              if (cancelRecord) {
                await queueUpdate(cancelRecord, { status: 'Cancelled' });
                toast.success('Cancelled');
                setCancelRecord(null);
              }
            }}>Cancel Item</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default memo(DispatchClientCard, (prev, next) => {
  if (prev.minerName !== next.minerName) return false;
  if (prev.records.length !== next.records.length) return false;
  for (let i = 0; i < prev.records.length; i++) {
    if (prev.records[i] !== next.records[i]) return false;
  }
  if (prev.allRecords !== next.allRecords) return false;
  if (prev.clientMilestones !== next.clientMilestones) return false;
  return true;
});
