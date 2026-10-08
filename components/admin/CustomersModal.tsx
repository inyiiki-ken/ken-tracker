"use client";

import { useMemo, useRef, useState } from 'react';
import { Loader2, Search, Upload, Users, Sparkles, Trash2, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { DatabaseRowType } from '@/types';
import { saveCustomerMemory, deleteCustomerMemory, importCustomerList } from '@/lib/api';
import { useCustomerMemory } from '@/lib/useCustomerMemory';
import { MEMORY_FIELDS, MEMORY_FIELD_LABELS, type CustomerProfile, type Learned, type MemoryField, type StoredCustomer, type CustomerType } from '@/lib/customerMemory';
import { readCustomerFile } from '@/lib/customerImport';
import { getOptions } from '@/lib/optionsConfig';
import { formatDate } from '@/lib/formatters';

interface Props {
  onClose: () => void;
  records: DatabaseRowType[];
}

/** Dropdown list (from Settings) for a field, or null for free text. */
function optionsFor(f: MemoryField): string[] | null {
  if (f === 'regions') return getOptions('region');
  if (f === 'locationOfMiner') return getOptions('location');
  if (f === 'modeOfPayment') return getOptions('modeOfPayment');
  if (f === 'page') return getOptions('page');
  return null;
}

function sourceText(l?: Learned): string {
  if (!l) return '';
  if (l.from === 'orders') return l.at ? `from order ${formatDate(new Date(l.at).toISOString())}` : 'from orders';
  if (l.from === 'imported') return 'from Customers.xlsx';
  return 'edited here';
}

const NONE = '__none__';

function CustomerEditor({ profile, onSaved }: { profile: CustomerProfile; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(profile.name);
  const [aliases, setAliases] = useState(profile.aliases.join(', '));
  const [type, setType] = useState<CustomerType>(profile.type);
  const [country, setCountry] = useState(profile.country);
  const [sf, setSf] = useState(profile.sf);
  const [tabby, setTabby] = useState(profile.tabby);
  const [notes, setNotes] = useState(profile.notes);
  const [fields, setFields] = useState<Partial<Record<MemoryField, string>>>(
    () => Object.fromEntries(MEMORY_FIELDS.map(f => [f, profile.fields[f]?.value ?? ''])),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast.error("Enter the customer's name"); return; }
    setSaving(true);
    try {
      // Only what differs from her orders is stored; her orders keep teaching the rest.
      const stored: StoredCustomer['fields'] = {};
      for (const f of MEMORY_FIELDS) {
        const v = (fields[f] ?? '').trim();
        const l = profile.fields[f];
        if (v && !(l?.from === 'orders' && l.value === v)) stored[f] = v;
      }
      await saveCustomerMemory({
        matchName: profile.stored?.name || profile.name,
        entry: {
          name, customerId: profile.customerId,
          aliases: aliases.split(/[,;\n]/).map(a => a.trim()).filter(Boolean),
          type, country, sf, tabby, notes, fields: stored,
          source: '', updatedBy: '', updatedAt: '',
        },
      });
      toast.success(`${name.toUpperCase()} saved. New orders will use these details.`);
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const forget = async () => {
    setSaving(true);
    try {
      await deleteCustomerMemory({ name: profile.stored?.name || profile.name });
      toast.success('Saved details removed. Her orders still count.');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
      <div className="sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Name</Label>
        <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-xs mt-0.5 uppercase" />
      </div>
      <div className="sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Also written as <span className="opacity-70">(fixed automatically to the name above; separate with commas)</span></Label>
        <Input value={aliases} onChange={e => setAliases(e.target.value)} className="h-8 text-xs mt-0.5 uppercase" placeholder="e.g. ROTH LYN, RUTHLYN" />
      </div>
      <div>
        <Label className="text-[11px] text-muted-foreground">Type</Label>
        <Select value={type || NONE} onValueChange={v => setType(v === NONE ? '' : (v as CustomerType))}>
          <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE} className="text-xs">Not set</SelectItem>
            <SelectItem value="Customer" className="text-xs">Customer</SelectItem>
            <SelectItem value="Reseller" className="text-xs">Reseller (uses her reseller rate)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-[11px] text-muted-foreground">Country</Label>
        <Input value={country} onChange={e => setCountry(e.target.value)} className="h-8 text-xs mt-0.5" />
      </div>
      {MEMORY_FIELDS.map(f => {
        const opts = optionsFor(f);
        const v = fields[f] ?? '';
        return (
          <div key={f} className={f === 'clientAddress' ? 'sm:col-span-2' : ''}>
            <Label className="text-[11px] text-muted-foreground">
              {MEMORY_FIELD_LABELS[f]} <span className="opacity-70">{sourceText(profile.fields[f])}</span>
            </Label>
            {opts ? (
              <Select value={v || NONE} onValueChange={x => setFields(p => ({ ...p, [f]: x === NONE ? '' : x }))}>
                <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs">Not set</SelectItem>
                  {[...new Set([...(v ? [v] : []), ...opts])].map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input value={v} onChange={e => setFields(p => ({ ...p, [f]: e.target.value }))} className="h-8 text-xs mt-0.5" />
            )}
          </div>
        );
      })}
      <div>
        <Label className="text-[11px] text-muted-foreground">Own shipping fee (AED) <span className="opacity-70">blank = normal, FREE, or an amount</span></Label>
        <Input value={sf} onChange={e => setSf(e.target.value)} className="h-8 text-xs mt-0.5" placeholder="blank" />
      </div>
      <div>
        <Label className="text-[11px] text-muted-foreground">Tabby</Label>
        <Input value={tabby} onChange={e => setTabby(e.target.value)} className="h-8 text-xs mt-0.5" />
      </div>
      <div className="sm:col-span-2">
        <Label className="text-[11px] text-muted-foreground">Notes</Label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-xs mt-0.5" />
      </div>
      <div className="sm:col-span-2 flex flex-wrap gap-2 justify-end pt-1">
        {profile.stored && (
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={saving} onClick={forget}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Forget saved details
          </Button>
        )}
        <Button size="sm" className="h-8 text-xs" disabled={saving} onClick={save}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Save
        </Button>
      </div>
    </div>
  );
}

export default function CustomersModal({ onClose, records }: Props) {
  const { memory, loaded, reload } = useCustomerMemory(records);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [pending, setPending] = useState<{ entries: StoredCustomer[]; file: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...memory.profiles.values()]
      .filter(p => !q
        || p.name.toLowerCase().includes(q)
        || p.aliases.some(a => a.toLowerCase().includes(q))
        || (p.fields.clientNumber?.value ?? '').toLowerCase().includes(q))
      .sort((a, b) => b.lastOrder - a.lastOrder || a.name.localeCompare(b.name));
  }, [memory, query]);
  const shown = list.slice(0, 150);

  const pickFile = async (file?: File) => {
    if (!file) return;
    try {
      const res = await readCustomerFile(file);
      if (res.error) { toast.error(res.error); return; }
      if (!res.entries.length) { toast.error('No customers found in that file.'); return; }
      setPending({ entries: res.entries, file: file.name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read that file");
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runImport = async () => {
    if (!pending) return;
    setImporting(true);
    try {
      const { saved } = await importCustomerList({ entries: pending.entries });
      toast.success(`${saved} customers imported. Their details now fill in new orders.`);
      setPending(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl w-[calc(100vw-1rem)] bg-card border-border max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary flex items-center gap-2"><Users className="h-4 w-4" /> Customers</DialogTitle>
        </DialogHeader>
        <p className="text-[11px] text-muted-foreground -mt-1">
          What the app learnt about each customer. A repeat customer&apos;s empty details are filled in on Add Client and uploads, tagged
          <span className="inline-flex items-center gap-0.5 mx-1 text-info"><Sparkles className="h-2.5 w-2.5" />remembered</span>
          so you can double-check before setting the status. The newest details win.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, spelling or phone…" className="h-9 text-xs pl-7" />
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => void pickFile(e.target.files?.[0])} />
          <Button variant="outline" className="h-9 text-xs" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5 mr-1.5" /> Import Customers.xlsx
          </Button>
        </div>

        {pending && (
          <div className="rounded-lg border border-info/30 bg-info/10 p-3 text-xs space-y-2">
            <p>
              <b>{pending.entries.length}</b> customers found in {pending.file}
              {' '}({pending.entries.filter(e => e.aliases.length).length} with other spellings, {pending.entries.filter(e => e.type === 'Reseller').length} resellers).
              Details already saved here are kept where the file is blank.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setPending(null)} disabled={importing}>Cancel</Button>
              <Button size="sm" className="h-8 text-xs" onClick={runImport} disabled={importing}>
                {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Import
              </Button>
            </div>
          </div>
        )}

        {!loaded ? (
          <div className="py-10 text-center text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Loading customers…</div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground">{list.length} customer{list.length === 1 ? '' : 's'}{list.length > shown.length ? `, showing the latest ${shown.length}. Search to find others.` : ''}</p>
            {shown.map(p => {
              const isOpen = open === p.key;
              const contact = [p.fields.clientAddress?.value, p.fields.clientNumber?.value].filter(Boolean).join(' · ');
              return (
                <div key={p.key} className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
                  <button type="button" className="w-full text-left flex items-start gap-2" onClick={() => setOpen(isOpen ? null : p.key)} aria-expanded={isOpen}>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-primary truncate">{p.name}</span>
                        {p.type === 'Reseller' && <span className="text-[9px] px-1.5 py-px rounded bg-primary/15 text-primary border border-primary/20">Reseller</span>}
                        {p.box && <span className="text-[9px] px-1.5 py-px rounded bg-muted text-muted-foreground border border-border">{p.box}</span>}
                        {p.orders > 0 && <span className="text-[10px] text-muted-foreground">{p.orders} order{p.orders === 1 ? '' : 's'}{p.lastOrder ? `, last ${formatDate(new Date(p.lastOrder).toISOString())}` : ''}</span>}
                      </div>
                      {contact && <p className="text-[10px] text-muted-foreground truncate">{contact}</p>}
                      {p.aliases.length > 0 && <p className="text-[10px] text-muted-foreground truncate">Also written as {p.aliases.join(', ')}</p>}
                    </div>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && <CustomerEditor key={`${p.key}|${p.stored?.updatedAt ?? ''}`} profile={p} onSaved={async () => { await reload(); setOpen(null); }} />}
                </div>
              );
            })}
            {list.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">No customers yet.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
