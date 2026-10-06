"use client";

import { getEffectiveStatuses, type StatusContext } from '@/lib/statusRegistry';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Scissors, ArrowRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { DatabaseRowType } from '@/types';
import { splitItem } from '@/lib/api';
import { isPulloutStatus } from '@/lib/appConfig';
import { fulfilmentStage } from '@/lib/fulfilment';

interface Props {
  record: DatabaseRowType;
  onClose: () => void;
  onComplete: () => void;
  /** Whose status list to offer for the split-off part (default Dispatch's). */
  statusContext?: StatusContext;
  /** Status picked at first (default Dispatched). */
  defaultStatus?: string;
  /** Replaces the status list (e.g. an in-store item: Delivered / Cancelled only). */
  statuses?: string[];
  /** Statuses that can't be picked yet (e.g. no downpayment), as on the item's own dropdown. */
  isStatusLocked?: (status: string) => boolean;
}

export default function SplitItemDialog({ record, onClose, onComplete, statusContext = 'dispatch', defaultStatus = 'Dispatched', statuses, isStatusLocked }: Props) {
  const originalGrams = parseFloat(String(record.grams ?? '0')) || 0;
  const [splitGrams, setSplitGrams] = useState('');
  const statusOptions = statuses ?? getEffectiveStatuses(statusContext, defaultStatus);
  // Pick the list's own spelling ("waiting for downpayment" typed in the sheet
  // → "Waiting for Downpayment"), else the dropdown would show blank.
  const [newStatus, setNewStatus] = useState(
    () => statusOptions.find(s => s.toLowerCase() === defaultStatus.trim().toLowerCase()) ?? defaultStatus,
  );
  const [loading, setLoading] = useState(false);

  const splitVal = parseFloat(splitGrams) || 0;
  const remainingGrams = Math.round((originalGrams - splitVal) * 10000) / 10000;
  const isValid = splitVal > 0 && splitVal < originalGrams;

  const handleConfirm = async () => {
    if (!isValid) return;
    if (isStatusLocked?.(newStatus)) { toast.error('Enter a downpayment amount to enable other status options'); return; }
    // From Admin, a "going out" status needs the delivery details first, as
    // when the status is changed on the item itself.
    if (statusContext === 'admin' && isPulloutStatus(newStatus)) {
      if (!record.modeOfPayment) { toast.error('Mode of Payment is required'); return; }
      if (record.locationOfMiner === 'Local' && !record.regions) { toast.error('Region required for Local miners'); return; }
    }
    setLoading(true);
    try {
      // Build a clean record object for the backend (strip undefined values)
      const existingRecord: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(record)) {
        if (v !== undefined && v !== null) existingRecord[k] = v;
      }

      // Rate snapshot (phpRate/silver*) is persisted client-side via the
      // rates store for historical rate-locking; the sheet backend derives
      // cost from category + goldRate, so these don't go to splitItem().
      await splitItem({
        rowId: record.id,
        splitGrams: splitVal,
        newStatus,
        // Worked out here, where this customer's own status settings are loaded.
        newStage: fulfilmentStage(newStatus),
        existingRecord,
      });

      toast.success(`Split complete! ${remainingGrams}g remains · ${splitVal}g → ${newStatus}`);
      onComplete();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to split item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-bold">
            <Scissors className="h-4 w-4 text-success" />
            Split Item
          </DialogTitle>
        </DialogHeader>

        {/* Item info */}
        <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-0.5">
          <p className="text-xs font-semibold truncate">{record.itemDescription}</p>
          <p className="text-xs text-muted-foreground">{record.category} · <span className="font-bold text-foreground">{originalGrams}g total</span></p>
          {record.pureWeight && <p className="text-[10px] text-primary/70">Invoice #{record.pureWeight}</p>}
        </div>

        {/* Split grams input */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Grams to split out</Label>
          <Input
            type="number"
            step="0.01"
            min="0.01"
            max={originalGrams - 0.01}
            value={splitGrams}
            onChange={e => setSplitGrams(e.target.value)}
            className="h-8 text-xs bg-background border-border"
            placeholder={`0 – ${originalGrams}`}
            autoFocus
          />
        </div>

        {/* Visual breakdown */}
        {splitVal > 0 && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${isValid ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}`}>
            <div className="text-center flex-1">
              <p className="font-bold text-foreground">{originalGrams}g</p>
              <p className="text-muted-foreground text-[10px]">Original</p>
            </div>
            <ArrowRight className={`h-3.5 w-3.5 shrink-0 ${isValid ? 'text-success' : 'text-destructive'}`} />
            <div className="text-center flex-1">
              <p className={`font-bold ${isValid ? 'text-foreground' : 'text-destructive'}`}>{isValid ? remainingGrams : '—'}g</p>
              <p className="text-muted-foreground text-[10px]">Stays (Original)</p>
            </div>
            <span className="text-muted-foreground">+</span>
            <div className="text-center flex-1">
              <p className={`font-bold ${isValid ? 'text-success' : 'text-destructive'}`}>{splitVal}g</p>
              <p className="text-muted-foreground text-[10px]">New Row</p>
            </div>
          </div>
        )}

        {splitVal >= originalGrams && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Split grams must be less than {originalGrams}g
          </div>
        )}

        {/* New status picker */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status for split-out portion</Label>
          <Select value={newStatus} onValueChange={setNewStatus}>
            <SelectTrigger className="h-8 text-xs bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              {statusOptions.map(s => {
                const locked = !!isStatusLocked?.(s);
                return (
                  <SelectItem key={s} value={s} disabled={locked} className={`text-xs ${locked ? 'opacity-60 text-muted-foreground' : ''}`}>{s}</SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Note about fees */}
        <p className="text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-1.5 border border-border/50">
          Payments are shared by weight between the two rows. Extra charges stay on the original row.
        </p>

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1 h-8 text-xs border-border" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1 h-8 text-xs bg-success/90 hover:bg-success text-white border-0"
            onClick={handleConfirm}
            disabled={!isValid || loading}
          >
            <Scissors className="h-3 w-3 mr-1" />
            {loading ? 'Splitting...' : 'Confirm Split'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
