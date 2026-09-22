"use client";

import { useState, useEffect } from 'react';
import { ChevronDown, Settings2, Lock, LockOpen, ShieldAlert, Pin, RefreshCw } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import {
  getRatesForDate,
  saveRatesForDate,
  getStickyRates,
  setStickyRates,
  DEFAULT_RATES,
  isRateLockedForDate,
  lockRatesForDate,
  unlockRatesForDate,
  hasRatesSnapshotForDate,
  serializeRatesConfig,
  getRateMetal,
  setRateMetal,
  type RateMetal,
} from '@/lib/ratesStore';
import { SUPER_ADMIN_EMAILS } from '@/config/roles';
import { saveRatesConfig } from '@/lib/api';

async function persistRatesToBackend() {
  try {
    await saveRatesConfig({ config: serializeRatesConfig() });
  } catch (e) {
    console.error('Failed to persist rates to backend:', e);
  }
}

interface Props {
  date: string;
}

export default function DailyRatesEditor({ date }: Props) {
  const { user } = useAuth();
  const isSuperAdmin = user?.email
    ? SUPER_ADMIN_EMAILS.map(e => e.toLowerCase()).includes(user.email.toLowerCase())
    : false;

  const [open, setOpen] = useState(false);
  const [selectedRateDate, setSelectedRateDate] = useState(date || new Date().toISOString().split('T')[0]);
  const [silverRetail, setSilverRetailVal] = useState('');
  const [silverCost, setSilverCostVal] = useState('');
  const [silverBrandedCost, setSilverBrandedCostVal] = useState('');
  const [isLocked, setIsLocked] = useState(false);
  const [stickySnap, setStickySnap] = useState(getStickyRates());
  const [editingSticky, setEditingSticky] = useState(false);
  const [stickyRetail, setStickyRetail] = useState('');
  const [stickyCost, setStickyCost] = useState('');
  const [stickyBrandedCost, setStickyBrandedCost] = useState('');
  // Per-tenant: is the daily/sticky rate for silver, gold, or both?
  const [metal, setMetal] = useState<RateMetal>(getRateMetal());
  const showSilver = metal !== 'gold';
  const showGold = metal !== 'silver';
  const [stickyGold, setStickyGold] = useState('');
  const [goldVal, setGoldVal] = useState('');

  useEffect(() => {
    if (date) setSelectedRateDate(date);
  }, [date]);

  useEffect(() => {
    const snap = getRatesForDate(selectedRateDate);
    setSilverRetailVal(String(snap.silverRetailRate));
    setSilverCostVal(String(snap.silverCostRate));
    setSilverBrandedCostVal(String(snap.silverBrandedCostRate));
    setGoldVal(snap.goldRate ? String(snap.goldRate) : '');
    setIsLocked(isRateLockedForDate(selectedRateDate));
  }, [selectedRateDate, open]);

  useEffect(() => {
    const s = getStickyRates();
    setStickySnap(s);
    setStickyRetail(String(s.silverRetailRate));
    setStickyCost(String(s.silverCostRate));
    setStickyBrandedCost(String(s.silverBrandedCostRate));
    setStickyGold(s.goldRate ? String(s.goldRate) : '');
    setMetal(getRateMetal());
  }, [open]);

  const changeMetal = (m: RateMetal) => {
    setRateMetal(m);
    setMetal(m);
    persistRatesToBackend();
    toast.success(m === 'gold' ? 'Default rate is now GOLD for this customer' : m === 'both' ? 'Default rate now covers GOLD + SILVER' : 'Default rate is now SILVER for this customer');
  };

  const saveSticky = () => {
    const retail = parseFloat(stickyRetail);
    const cost = parseFloat(stickyCost);
    const bcost = parseFloat(stickyBrandedCost);
    const gold = parseFloat(stickyGold);
    if (showSilver && [retail, cost, bcost].some(v => isNaN(v) || v <= 0)) {
      toast.error('All silver rates must be positive numbers');
      return;
    }
    if (showGold && (isNaN(gold) || gold <= 0)) {
      toast.error('Gold rate must be a positive number');
      return;
    }
    const cur = getStickyRates();
    setStickyRates({
      ...cur,
      ...(showSilver ? {
        silverRetailRate: retail,
        silverSellRate: retail,
        silverBrandedSellRate: retail,
        silverCostRate: cost,
        silverBrandedCostRate: bcost,
      } : {}),
      ...(showGold ? { goldRate: gold } : {}),
    });
    setStickySnap(getStickyRates());
    setEditingSticky(false);
    persistRatesToBackend();
    toast.success('Default rates updated 📌');
  };

  const save = () => {
    if (isLocked) {
      toast.error('Rates are locked. Only a Super Admin can unlock them.');
      return;
    }
    const retail = parseFloat(silverRetail);
    const cost = parseFloat(silverCost);
    const bcost = parseFloat(silverBrandedCost);
    const gold = parseFloat(goldVal);
    if (showSilver && (isNaN(retail) || retail <= 0)) {
      toast.error('Silver Retail Rate must be a positive number');
      return;
    }
    if (showGold && (isNaN(gold) || gold <= 0)) {
      toast.error('Gold Rate must be a positive number');
      return;
    }
    const existing = getRatesForDate(selectedRateDate);
    saveRatesForDate(selectedRateDate, {
      ...existing,
      ...(showSilver ? {
        silverRetailRate: retail,
        silverSellRate: retail,
        silverBrandedSellRate: retail,
        silverCostRate: (!isNaN(cost) && cost > 0) ? cost : existing.silverCostRate,
        silverBrandedCostRate: (!isNaN(bcost) && bcost > 0) ? bcost : existing.silverBrandedCostRate,
      } : {}),
      ...(showGold ? { goldRate: gold } : {}),
    });
    lockRatesForDate(selectedRateDate);
    setIsLocked(true);
    persistRatesToBackend();
    toast.success(`Rates locked for ${selectedRateDate} 🔒`);
    setOpen(false);
  };

  const handleUnlock = () => {
    if (!isSuperAdmin) {
      toast.error('Only Super Admins can unlock rates.');
      return;
    }
    unlockRatesForDate(selectedRateDate);
    setIsLocked(false);
    persistRatesToBackend();
    toast.success(`Rates unlocked for ${selectedRateDate} 🔓`);
  };

  const snap = getRatesForDate(selectedRateDate);
  const isToday = selectedRateDate === new Date().toISOString().split('T')[0];
  const hasDateOverride = hasRatesSnapshotForDate(selectedRateDate);

  return (
    <div className="mb-4">
      {/* Collapsed Summary Bar */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border hover:bg-secondary/40 transition-colors text-left"
      >
        <Settings2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Daily Rates</span>
        <span className="text-[10px] text-foreground ml-1">
          {showGold && (
            <>Gold <span className="text-primary font-semibold">{snap.goldRate || '—'}</span>{showSilver && <>&nbsp;·&nbsp;</>}</>
          )}
          {showSilver && (
            <>
              Ag Retail <span className="text-primary font-semibold">{snap.silverRetailRate}</span>
              &nbsp;·&nbsp; Cost <span className="text-primary font-semibold">{snap.silverCostRate}</span>
              &nbsp;·&nbsp; B.Cost <span className="text-primary font-semibold">{snap.silverBrandedCostRate}</span>
            </>
          )}
        </span>
        {!hasDateOverride && (
          <Pin className="h-3 w-3 text-info ml-1 shrink-0" />
        )}
        {isRateLockedForDate(selectedRateDate) && (
          <Lock className="h-3 w-3 text-warning ml-1 shrink-0" />
        )}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground ml-auto transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 px-3 py-3 rounded-lg bg-card border border-border space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">

          {/* ── RATE METAL (per customer) ── */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">Rate for</span>
            {(['silver', 'gold', 'both'] as RateMetal[]).map(m => (
              <button
                key={m}
                type="button"
                disabled={!isSuperAdmin}
                onClick={() => changeMetal(m)}
                className={`text-[10px] px-2.5 py-1 rounded border transition-colors disabled:opacity-60 ${
                  metal === m ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'silver' ? 'Silver' : m === 'gold' ? 'Gold' : 'Gold + Silver'}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-1">(this customer only)</span>
          </div>

          {/* ── STICKY DEFAULT RATE SECTION ── */}
          <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pin className="h-3.5 w-3.5 text-info" />
                <span className="text-xs font-bold text-info">Default Rate (Sticky)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {showGold && <>Gold <strong>{stickySnap.goldRate || '—'}</strong>{showSilver && ' · '}</>}
                  {showSilver && <>Retail <strong>{stickySnap.silverRetailRate}</strong> · Cost <strong>{stickySnap.silverCostRate}</strong> · B.Cost <strong>{stickySnap.silverBrandedCostRate}</strong></>}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[10px] h-6 border-info/40 text-info hover:bg-info/10"
                  onClick={() => setEditingSticky(e => !e)}
                >
                  {editingSticky ? 'Cancel' : <><RefreshCw className="h-2.5 w-2.5 mr-1" /> Change</>}
                </Button>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground">
              This rate applies to <strong>all dates</strong> that don't have a specific override.
            </p>

            {editingSticky && (
              <div className="space-y-2 pt-1 border-t border-info/20">
                {showGold && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-40 shrink-0">Gold Rate (AED/g)</span>
                    <Input type="number" step="0.01" value={stickyGold} onChange={e => setStickyGold(e.target.value)}
                      placeholder="e.g. 426.25" className="h-7 text-xs bg-background border-border w-24" />
                  </div>
                )}
                {showSilver && (<>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">Silver Retail (AED/g)</span>
                  <Input type="number" step="0.5" value={stickyRetail} onChange={e => setStickyRetail(e.target.value)}
                    className="h-7 text-xs bg-background border-border w-24" />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">Silver Cost Non-Branded</span>
                  <Input type="number" step="0.5" value={stickyCost} onChange={e => setStickyCost(e.target.value)}
                    className="h-7 text-xs bg-background border-border w-24" />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">Silver Cost Branded</span>
                  <Input type="number" step="0.5" value={stickyBrandedCost} onChange={e => setStickyBrandedCost(e.target.value)}
                    className="h-7 text-xs bg-background border-border w-24" />
                </div>
                </>)}
                <Button size="sm" className="text-xs h-7 bg-info text-white hover:bg-info" onClick={saveSticky}>
                  <Pin className="h-3 w-3 mr-1" /> Save as Default
                </Button>
              </div>
            )}
          </div>

          <div className="h-px bg-border" />

          {/* ── DATE-SPECIFIC OVERRIDE ── */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider shrink-0">Date Override</span>
            <input
              type="date"
              value={selectedRateDate}
              onChange={e => setSelectedRateDate(e.target.value)}
              className="h-7 text-xs rounded-md border border-border bg-background text-foreground px-2 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {!isToday && <span className="text-[10px] text-warning font-semibold">Historical</span>}
            {hasDateOverride && <Badge variant="outline" className="text-[10px]">Has Override</Badge>}
          </div>

          {/* Lock Status */}
          {isLocked ? (
            <div className="flex items-center justify-between rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
              <div className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-warning" />
                <span className="text-xs font-semibold text-warning">Rates Locked for {selectedRateDate}</span>
              </div>
              {isSuperAdmin ? (
                <Button variant="outline" size="sm" className="text-[10px] h-6 border-warning/50 text-warning hover:bg-warning/20" onClick={handleUnlock}>
                  <LockOpen className="h-2.5 w-2.5 mr-1" /> Unlock
                </Button>
              ) : (
                <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">
                  <ShieldAlert className="h-2.5 w-2.5 mr-1" /> Super Admin Only
                </Badge>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <LockOpen className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">
                {hasDateOverride ? `Override set for ${selectedRateDate} — unlocked` : `No override for ${selectedRateDate} — using default rate`}
              </span>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">
            Rates for <span className="text-primary">{selectedRateDate}</span>
            {!hasDateOverride && <span className="text-info ml-2">(from default)</span>}
          </p>

          {!isSuperAdmin ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              {showGold && <div className="flex justify-between"><span>Gold Rate</span><span className="font-semibold text-foreground">{snap.goldRate || '—'}</span></div>}
              {showSilver && <>
              <div className="flex justify-between"><span>Silver Retail Rate</span><span className="font-semibold text-foreground">{snap.silverRetailRate}</span></div>
              <div className="flex justify-between"><span>Silver Cost (Non-Branded)</span><span className="font-semibold text-foreground">{snap.silverCostRate}</span></div>
              <div className="flex justify-between"><span>Silver Cost (Branded)</span><span className="font-semibold text-foreground">{snap.silverBrandedCostRate}</span></div>
              </>}
            </div>
          ) : (
            <>
              {showGold && (
                <>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gold</p>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-40 shrink-0">Gold Rate (AED/g)</span>
                    <Input type="number" step="0.01" value={goldVal} onChange={e => setGoldVal(e.target.value)}
                      placeholder="e.g. 426.25" disabled={isLocked}
                      className="h-7 text-xs bg-background border-border w-24 disabled:opacity-50" />
                  </div>
                  {showSilver && <div className="h-px bg-border" />}
                </>
              )}
              {showSilver && (<>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Silver Retail (selling price for all silver)</p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-40 shrink-0">Retail Rate (AED/g)</span>
                <Input type="number" step="0.5" value={silverRetail} onChange={e => setSilverRetailVal(e.target.value)}
                  placeholder={String(DEFAULT_RATES.silverRetailRate)} disabled={isLocked}
                  className="h-7 text-xs bg-background border-border w-24 disabled:opacity-50" />
              </div>

              <div className="h-px bg-border" />
              <p className="text-[10px] font-semibold text-warning/80 uppercase tracking-wider">Silver Cost Rates</p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-40 shrink-0">Cost Non-Branded (AED/g)</span>
                <Input type="number" step="0.5" value={silverCost} onChange={e => setSilverCostVal(e.target.value)}
                  placeholder="24" disabled={isLocked}
                  className="h-7 text-xs bg-background border-border w-24 disabled:opacity-50" />
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-40 shrink-0">Cost Branded (AED/g)</span>
                <Input type="number" step="0.5" value={silverBrandedCost} onChange={e => setSilverBrandedCostVal(e.target.value)}
                  placeholder="27" disabled={isLocked}
                  className="h-7 text-xs bg-background border-border w-24 disabled:opacity-50" />
              </div>
              </>)}
            </>
          )}

          {/* Clear old rate locks (super admin only) */}
          {isSuperAdmin && (
            <div className="pt-1 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] h-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  const now = Date.now();
                  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
                  let cleared = 0;
                  for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (!k || !k.startsWith('rates_') || k === 'rates_current_default' || k.startsWith('rates_lock_')) continue;
                    const dateStr = k.replace('rates_', '');
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime()) && (now - d.getTime()) > NINETY_DAYS_MS) {
                      localStorage.removeItem(k);
                      localStorage.removeItem(`rates_lock_${dateStr}`);
                      cleared++;
                    }
                  }
                  toast.success(`Cleared ${cleared} old rate lock${cleared !== 1 ? 's' : ''} (>90 days)`);
                  persistRatesToBackend();
                }}
              >
                🗑️ Clear old rate locks (&gt;90 days)
              </Button>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="text-xs h-7 border-border" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {isSuperAdmin && (
              <Button size="sm" className="text-xs h-7 bg-primary text-primary-foreground" onClick={save} disabled={isLocked}>
                <Lock className="h-3 w-3 mr-1" /> Lock for {selectedRateDate}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
