"use client";

import { useState, useMemo } from 'react';
import { Merge, AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { mergeClients } from '@/lib/api';
import { DatabaseRowType } from '@/types';

interface ClientProfile {
  customerId: string;
  minerName: string;
  recordCount: number;
}

interface Props {
  onClose: () => void;
  onRefresh?: () => void;
  records: DatabaseRowType[];
}

function buildProfiles(records: DatabaseRowType[]): ClientProfile[] {
  const map = new Map<string, { name: string; count: number }>();
  for (const r of records) {
    const id = r.customerId?.trim();
    const name = r.minerName?.trim() || '';
    if (!id) continue;
    if (!map.has(id)) {
      map.set(id, { name, count: 0 });
    }
    map.get(id)!.count++;
  }
  return Array.from(map.entries())
    .map(([customerId, { name, count }]) => ({ customerId, minerName: name, recordCount: count }))
    .sort((a, b) => a.minerName.localeCompare(b.minerName));
}

function ProfilePicker({
  label,
  profiles,
  selected,
  onSelect,
  exclude,
}: {
  label: string;
  profiles: ClientProfile[];
  selected: ClientProfile | null;
  onSelect: (p: ClientProfile) => void;
  exclude?: string;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return profiles.filter(p =>
      p.customerId !== exclude &&
      (p.minerName.toLowerCase().includes(q) || p.customerId.toLowerCase().includes(q))
    ).slice(0, 80);
  }, [profiles, search, exclude]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</Label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or CUST-ID..."
          className="h-8 text-xs pl-8 bg-background border-border"
        />
      </div>
      <div className="border border-border rounded-md overflow-y-auto max-h-48 bg-background">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">No profiles found</p>
        )}
        {filtered.map(p => (
          <button
            key={p.customerId}
            onClick={() => onSelect(p)}
            className={`w-full text-left px-3 py-2 text-xs flex justify-between items-center transition-colors border-b border-border last:border-0 hover:bg-secondary/60
              ${selected?.customerId === p.customerId ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground'}`}
          >
            <span className="truncate max-w-[160px]">{p.minerName}</span>
            <span className={`text-[10px] font-mono shrink-0 ml-2 ${selected?.customerId === p.customerId ? 'text-primary' : 'text-muted-foreground'}`}>
              {p.customerId} · {p.recordCount}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-xs">
          <span className="text-muted-foreground">Selected: </span>
          <span className="font-semibold text-foreground">{selected.minerName}</span>
          <span className="text-muted-foreground ml-2">({selected.customerId} · {selected.recordCount} records)</span>
        </div>
      )}
    </div>
  );
}

export default function MergeClientsModal({ onClose, onRefresh, records }: Props) {
  const profiles = useMemo(() => buildProfiles(records), [records]);
  const [duplicate, setDuplicate] = useState<ClientProfile | null>(null);
  const [master, setMaster] = useState<ClientProfile | null>(null);
  const [merging, setMerging] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; count: number } | null>(null);

  const canMerge = duplicate && master && duplicate.customerId !== master.customerId;

  const handleMerge = async () => {
    if (!duplicate || !master) return;
    setMerging(true);
    setConfirm(false);
    try {
      const res = await mergeClients({
        duplicateCustomerId: duplicate.customerId,
        masterCustomerId: master.customerId,
        masterMinerName: master.minerName,
      });
      setResult({ success: res.success, message: res.message, count: res.updatedCount });
      if (res.success) {
        toast.success(res.message);
        onRefresh?.();
        setDuplicate(null);
        setMaster(null);
      } else {
        toast.error(res.message);
      }
    } catch {
      toast.error('Merge failed. Please try again.');
    } finally {
      setMerging(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="font-cinzel text-primary flex items-center gap-2">
              <Merge className="w-4 h-4" /> Merge Client Profiles
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {/* Warning banner */}
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive/90 leading-relaxed">
                <strong>Irreversible action.</strong> All records from the <em>Duplicate Profile</em> will be re-assigned to the <em>Master Profile</em> and its name. This cannot be undone — double-check before confirming.
              </p>
            </div>

            {/* Two pickers */}
            <div className="grid grid-cols-2 gap-4">
              <ProfilePicker
                label="① Duplicate Profile (To Delete)"
                profiles={profiles}
                selected={duplicate}
                onSelect={setDuplicate}
                exclude={master?.customerId}
              />
              <ProfilePicker
                label="② Master Profile (To Keep)"
                profiles={profiles}
                selected={master}
                onSelect={setMaster}
                exclude={duplicate?.customerId}
              />
            </div>

            {/* Merge preview */}
            {canMerge && (
              <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-1.5">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Merge Preview</p>
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="bg-destructive/20 text-destructive px-2 py-0.5 rounded font-mono">{duplicate!.customerId}</span>
                  <span className="text-muted-foreground font-semibold">{duplicate!.minerName}</span>
                  <span className="text-muted-foreground">({duplicate!.recordCount} records)</span>
                  <span className="text-primary font-bold mx-1">→</span>
                  <span className="bg-primary/20 text-primary px-2 py-0.5 rounded font-mono">{master!.customerId}</span>
                  <span className="text-muted-foreground font-semibold">{master!.minerName}</span>
                  <span className="text-muted-foreground">({master!.recordCount} records)</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {duplicate!.recordCount} record(s) will be updated. Names will be normalized to <strong>{master!.minerName}</strong>.
                </p>
              </div>
            )}

            {/* Result banner */}
            {result?.success && (
              <div className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/30 px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                <p className="text-xs text-success">{result.message}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="text-xs h-8 border-border" onClick={onClose}>
                Close
              </Button>
              <Button
                className="flex-1 text-xs h-8 bg-primary text-primary-foreground"
                disabled={!canMerge || merging}
                onClick={() => setConfirm(true)}
              >
                {merging
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Merging…</>
                  : <><Merge className="w-3.5 h-3.5 mr-1" /> Merge Records</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Confirm Merge</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm">
              You are about to move <strong>{duplicate?.recordCount} record(s)</strong> from{' '}
              <span className="font-mono text-destructive">{duplicate?.customerId}</span> ({duplicate?.minerName}) into{' '}
              <span className="font-mono text-primary">{master?.customerId}</span> ({master?.minerName}).{' '}
              This action <strong>cannot be undone</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs border-border">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleMerge}
              className="text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, Merge Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
