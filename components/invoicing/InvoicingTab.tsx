"use client";

import { useEffect, useMemo, useState } from 'react';
import { FileText, ChevronDown, Eye, Edit2, CheckCircle, Info, Layers, Receipt } from 'lucide-react';
import SendToZohoDialog from '@/components/zoho/SendToZohoDialog';
import { isZohoEnabled } from '@/lib/zoho/actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { TabProps, DatabaseRowType } from '@/types';
import InvoiceModal from '@/components/InvoiceModal';
import { calcRemainingBalance } from '@/lib/calculations';
import { formatDate } from '@/lib/formatters';
import { toast } from 'sonner';
import TabHeader from '@/components/TabHeader';

const MOP_OPTIONS = [
  { value: 'Bank Transfer AED', label: 'Bank Transfer AED', currency: 'AED' },
  { value: 'Bank Transfer PHP', label: 'Bank Transfer PHP', currency: 'PHP' },
  { value: 'GCash', label: 'GCash', currency: 'PHP' },
  { value: 'COD (Dubai)', label: 'COD (Dubai)', currency: 'AED' },
  { value: 'COD (Abu Dhabi)', label: 'COD (Abu Dhabi)', currency: 'AED' },
  { value: 'COD (Sharjah)', label: 'COD (Sharjah)', currency: 'AED' },
  { value: 'Cash', label: 'Cash', currency: 'AED' },
  { value: 'Credit Card', label: 'Credit Card', currency: 'AED' },
  { value: 'Pick Up Shop', label: 'Pick Up Shop', currency: 'AED' },
  { value: 'Meet Up', label: 'Meet Up', currency: 'AED' },
  { value: 'Tabby', label: 'Tabby', currency: 'AED' },
  { value: 'Tamara', label: 'Tamara', currency: 'AED' },
];

function getMopCurrency(mop: string): string {
  const m = mop.toLowerCase().trim();
  if (m.includes('php') || m === 'gcash') return 'PHP';
  return 'AED';
}

function buildCustomerInvoices(records: DatabaseRowType[]) {
  const customers = new Map<string, Map<string, DatabaseRowType[]>>();
  for (const r of records) {
    const name = (r.minerName || '').trim() || 'Unknown Customer';
    const invoiceNum = String(r.invoiceNumber || r.pureWeight || '').trim() || '__no_invoice__';
    if (!customers.has(name)) customers.set(name, new Map());
    const byInvoice = customers.get(name)!;
    if (!byInvoice.has(invoiceNum)) byInvoice.set(invoiceNum, []);
    byInvoice.get(invoiceNum)!.push(r);
  }
  return new Map([...customers.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

// ─── Edit Downpayment Dialog ──────────────────────────────────────────────────
interface EditDownpaymentDialogProps {
  records: DatabaseRowType[];
  invoiceNum: string;
  onUpdate: TabProps['onUpdate'];
  onClose: () => void;
}

function EditDownpaymentDialog({ records, invoiceNum, onUpdate, onClose }: EditDownpaymentDialogProps) {
  const hasAnyLayaway = records.some(r => r.status === 'Layaway' || r.modeOfPayment === 'Layaway');

  const [values, setValues] = useState<Record<number, string>>(
    Object.fromEntries(records.map(r => [r.id, String(r.downpayment ?? '')]))
  );
  const [mops, setMops] = useState<Record<number, string>>(
    Object.fromEntries(records.map(r => [r.id, r.modeOfPayment || 'Bank Transfer AED']))
  );
  const [la1, setLa1] = useState<Record<number, string>>(
    Object.fromEntries(records.map(r => [r.id, String(r.la1MonthPayment ?? '')]))
  );
  const [la2, setLa2] = useState<Record<number, string>>(
    Object.fromEntries(records.map(r => [r.id, String(r.la2MonthPayment ?? '')]))
  );
  const [la3, setLa3] = useState<Record<number, string>>(
    Object.fromEntries(records.map(r => [r.id, String(r.la3MonthPayment ?? '')]))
  );
  const [la4, setLa4] = useState<Record<number, string>>(
    Object.fromEntries(records.map(r => [r.id, String(r.la4MonthPayment ?? '')]))
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const r of records) {
        const newDp = values[r.id];
        const newMop = mops[r.id];
        const isItemLayaway = r.status === 'Layaway' || newMop === 'Layaway';
        const fields: Partial<DatabaseRowType> = {};

        if (newDp !== String(r.downpayment ?? '')) fields.downpayment = newDp;
        if (newMop !== (r.modeOfPayment || '')) fields.modeOfPayment = newMop;

        if (isItemLayaway) {
          if (la1[r.id] !== String(r.la1MonthPayment ?? '')) fields.la1MonthPayment = la1[r.id];
          if (la2[r.id] !== String(r.la2MonthPayment ?? '')) fields.la2MonthPayment = la2[r.id];
          if (la3[r.id] !== String(r.la3MonthPayment ?? '')) fields.la3MonthPayment = la3[r.id];
          if (la4[r.id] !== String(r.la4MonthPayment ?? '')) fields.la4MonthPayment = la4[r.id];
        }

        if (Object.keys(fields).length > 0) {
          await onUpdate(r.id, fields);
        }
      }
      toast.success('Payment details updated');
      onClose();
    } catch {
      toast.error('Failed to update payment details');
    } finally {
      setSaving(false);
    }
  };

  const dialogTitle = hasAnyLayaway
    ? `Edit Payments — Invoice ${invoiceNum === '__no_invoice__' ? 'N/A' : invoiceNum}`
    : `Edit Downpayment — Invoice ${invoiceNum === '__no_invoice__' ? 'N/A' : invoiceNum}`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-background border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-sm font-bold font-cinzel text-primary">
            {dialogTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-start gap-2 text-[10px] text-muted-foreground bg-primary/5 rounded-md px-3 py-2 mb-2 border border-primary/20">
          <Info className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
          <span>Set the <strong>Mode of Payment</strong> so the system knows the DP currency (AED vs PHP).{hasAnyLayaway && ' Layaway installment fields are shown for items with Layaway status.'}</span>
        </div>

        <div className="space-y-4 mt-1 max-h-[60vh] overflow-y-auto pr-1">
          {records.map(r => {
            const currentMop = mops[r.id] || 'Bank Transfer AED';
            const dpCurr = getMopCurrency(currentMop);
            const isItemLayaway = r.status === 'Layaway' || currentMop === 'Layaway';
            return (
              <div key={r.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <p className="text-xs font-semibold text-foreground truncate">{r.itemDescription || '—'}</p>
                {isItemLayaway && (
                  <Badge variant="outline" className="text-[9px] border-hold/40 text-hold bg-hold/10">
                    LAYAWAY
                  </Badge>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-24 shrink-0">Mode of Payment</span>
                  <Select value={currentMop} onValueChange={val => setMops(prev => ({ ...prev, [r.id]: val }))}>
                    <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MOP_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <span className="flex items-center gap-2">
                            {opt.label}
                            <span className={`text-[9px] font-bold px-1 rounded ${opt.currency === 'PHP' ? 'bg-success/20 text-success' : 'bg-primary/20 text-primary'}`}>
                              {opt.currency}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-24 shrink-0">Downpayment</span>
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="number"
                      value={values[r.id]}
                      onChange={e => setValues(prev => ({ ...prev, [r.id]: e.target.value }))}
                      className="h-7 text-xs flex-1"
                      placeholder="0"
                    />
                    <Badge variant="outline" className={`text-[9px] font-bold shrink-0 ${dpCurr === 'PHP' ? 'border-success/40 text-success' : 'border-primary/40 text-primary'}`}>
                      {dpCurr}
                    </Badge>
                  </div>
                </div>

                {/* Layaway installment fields */}
                {isItemLayaway && (
                  <div className="mt-2 pt-2 border-t border-border/50 space-y-2">
                    <p className="text-[10px] font-semibold text-hold uppercase tracking-wider">Installment Payments</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { label: 'Month 1', state: la1, setter: setLa1 },
                        { label: 'Month 2', state: la2, setter: setLa2 },
                        { label: 'Month 3', state: la3, setter: setLa3 },
                        { label: 'Month 4', state: la4, setter: setLa4 },
                      ] as const).map(({ label, state, setter }) => (
                        <div key={label}>
                          <span className="text-[10px] text-muted-foreground">{label}</span>
                          <Input
                            type="number"
                            value={state[r.id] || ''}
                            onChange={e => setter(prev => ({ ...prev, [r.id]: e.target.value }))}
                            className="h-7 text-xs mt-0.5"
                            placeholder="0"
                            min={0}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-[9px] text-muted-foreground">
                  Current: DP={String(r.downpayment || '0')} · MOP={r.modeOfPayment || '—'}
                  {isItemLayaway && ` · M1=${r.la1MonthPayment || '0'} · M2=${r.la2MonthPayment || '0'} · M3=${r.la3MonthPayment || '0'} · M4=${r.la4MonthPayment || '0'}`}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2 pt-2 justify-end">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="h-7 text-xs bg-primary text-primary-foreground" onClick={handleSave} disabled={saving}>
            <CheckCircle className="h-3 w-3 mr-1" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoice Row ──────────────────────────────────────────────────────────────
interface InvoiceRowProps {
  invoiceNum: string;
  records: DatabaseRowType[];
  onUpdate: TabProps['onUpdate'];
}

function InvoiceRow({ invoiceNum, records, onUpdate }: InvoiceRowProps) {
  const [showModal, setShowModal] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showZoho, setShowZoho] = useState(false);
  // Only offer "Send to Zoho" when this customer has it switched on.
  const [zohoLive, setZohoLive] = useState(false);
  useEffect(() => {
    isZohoEnabled().then(setZohoLive).catch(() => setZohoLive(false));
  }, []);
  const zohoNumber = records.map(r => String(r.zohoInvoice ?? '').trim()).find(Boolean) ?? '';
  const [expanded, setExpanded] = useState(false);

  const displayNum = invoiceNum === '__no_invoice__' ? '—' : invoiceNum;
  const dates = records.map(r => r.dateOfLive).filter(Boolean) as string[];
  const firstDate = dates.length > 0 ? formatDate(dates[0]) : '—';
  const totalBalance = records.reduce((s, r) => s + calcRemainingBalance(r), 0);
  const totalItems = records.length;
  const mop = records[0]?.modeOfPayment || '';
  const isPaid = totalBalance <= 0;

  return (
    <>
      <div className="rounded-lg border border-border/60 bg-secondary/10 overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-2 py-2.5 px-3 hover:bg-secondary/20 transition-colors">
          <button onClick={() => setExpanded(e => !e)} className="shrink-0 p-0.5 rounded hover:bg-border/40 transition-colors">
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <FileText className="h-3.5 w-3.5 text-primary/60 shrink-0" />
          <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(e => !e)}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-foreground font-mono">#{displayNum}</span>
              <span className="text-[10px] text-muted-foreground">{firstDate}</span>
              <span className="text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full">{totalItems} item{totalItems !== 1 ? 's' : ''}</span>
              {mop && <span className="text-[9px] text-muted-foreground/70 italic">{mop}</span>}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-[10px] font-semibold ${isPaid ? 'text-success' : 'text-destructive'}`}>
                {isPaid ? '✓ Paid' : `Balance: ${Math.round(totalBalance).toLocaleString()}`}
              </span>
            </div>
          </button>
          <div className="flex items-center gap-0.5 shrink-0">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary" onClick={() => setShowEdit(true)} title="Edit downpayment">
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary" onClick={() => setShowModal(true)} title="View invoice">
              <Eye className="h-3.5 w-3.5" />
            </Button>
            {zohoLive && (
              <Button
                variant="ghost"
                size="sm"
                className={`h-7 w-7 p-0 ${zohoNumber ? 'text-success' : 'text-muted-foreground hover:text-primary'}`}
                onClick={() => setShowZoho(true)}
                title={zohoNumber ? `In Zoho: ${zohoNumber}` : 'Send to Zoho'}
              >
                <Receipt className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible items */}
        {expanded && (
          <div className="border-t border-border/40 bg-background/40 divide-y divide-border/30">
            {records.map((r, idx) => {
              const balance = calcRemainingBalance(r);
              const itemPaid = balance <= 0;
              return (
                <div key={r.id} className="px-4 py-2 flex items-start gap-3">
                  <span className="text-[9px] font-bold text-muted-foreground/50 mt-0.5 w-4 shrink-0">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-foreground leading-tight truncate">{r.itemDescription || '—'}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                      {r.tog && <span className="text-[9px] text-muted-foreground">TOG: <span className="text-foreground/70 font-medium">{r.tog}</span></span>}
                      {r.grams ? <span className="text-[9px] text-muted-foreground">{r.grams}g</span> : null}
                      {r.clientRate ? <span className="text-[9px] text-muted-foreground">Rate: <span className="text-foreground/70 font-medium">{r.clientRate}</span></span> : null}
                      {r.status && <span className="text-[9px] text-muted-foreground/70 italic">{r.status}</span>}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold shrink-0 ${itemPaid ? 'text-success' : 'text-destructive'}`}>
                    {itemPaid ? '✓' : `AED ${Math.round(balance)}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && <InvoiceModal records={records} onClose={() => setShowModal(false)} />}
      {showEdit && (
        <EditDownpaymentDialog records={records} invoiceNum={invoiceNum} onUpdate={onUpdate} onClose={() => setShowEdit(false)} />
      )}
      {showZoho && (
        <SendToZohoDialog
          minerName={(records[0]?.minerName || '').trim()}
          records={records}
          onClose={() => setShowZoho(false)}
        />
      )}
    </>
  );
}

// ─── Customer Card ────────────────────────────────────────────────────────────
interface CustomerCardProps {
  minerName: string;
  invoiceGroups: Map<string, DatabaseRowType[]>;
  onUpdate: TabProps['onUpdate'];
}

function CustomerCard({ minerName, invoiceGroups, onUpdate }: CustomerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAllModal, setShowAllModal] = useState(false);
  const totalInvoices = invoiceGroups.size;
  const allRecords = useMemo(() => [...invoiceGroups.values()].flat(), [invoiceGroups]);
  const totalItems = allRecords.length;
  const totalBalance = allRecords.reduce((s, r) => s + calcRemainingBalance(r), 0);
  const isPaid = totalBalance <= 0;

  return (
    <div className="mb-2 rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={() => setExpanded(e => !e)}
          className="flex-1 flex items-center justify-between gap-3 text-left min-w-0"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold font-cinzel truncate text-primary">{minerName}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {totalInvoices} invoice{totalInvoices !== 1 ? 's' : ''} · {totalItems} items
            </p>
          </div>
          <span className={`text-xs font-bold shrink-0 px-2 py-0.5 rounded-full border ${isPaid
            ? 'text-success border-success/30 bg-success/10'
            : 'text-destructive border-destructive/30 bg-destructive/10'}`}>
            {isPaid ? 'Paid' : `Balance: ${Math.round(totalBalance).toLocaleString()}`}
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] text-primary hover:bg-primary/10 shrink-0 gap-1"
          onClick={e => { e.stopPropagation(); setShowAllModal(true); }}
          title="View all items in one invoice"
        >
          <Layers className="h-3.5 w-3.5" />
          View All
        </Button>
        <button onClick={() => setExpanded(e => !e)} className="shrink-0 p-1">
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-1.5 border-t border-border pt-2 animate-in fade-in slide-in-from-top-1 duration-200">
          {[...invoiceGroups.entries()].map(([invoiceNum, recs]) => (
            <InvoiceRow key={invoiceNum} invoiceNum={invoiceNum} records={recs} onUpdate={onUpdate} />
          ))}
        </div>
      )}

      {showAllModal && <InvoiceModal records={allRecords} onClose={() => setShowAllModal(false)} />}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InvoicingTab({ records, onUpdate }: TabProps) {
  const [search, setSearch] = useState('');

  const customerMap = useMemo(() => {
    const EXCLUDED = new Set(['Cancelled', 'Returned Item']);
    const nonCancelled = records.filter(r => !EXCLUDED.has(r.status || ''));
    const filtered = search.trim()
      ? nonCancelled.filter(r =>
          (r.minerName || '').toLowerCase().includes(search.toLowerCase()) ||
          String(r.pureWeight ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (r.itemDescription || '').toLowerCase().includes(search.toLowerCase())
        )
      : nonCancelled;
    return buildCustomerInvoices(filtered);
  }, [records, search]);

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader
        title="Invoicing"
        subtitle={`${customerMap.size} customers`}
        searchQuery={search}
        onSearchChange={setSearch}
      />

      <div className="px-4 pt-4">
        {customerMap.size === 0 ? (
          <div className="text-center py-24 border-2 border-dashed border-border rounded-2xl">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground font-medium">No customers found.</p>
          </div>
        ) : (
          [...customerMap.entries()].map(([name, invoiceGroups]) => (
            <CustomerCard key={name} minerName={name} invoiceGroups={invoiceGroups} onUpdate={onUpdate} />
          ))
        )}
      </div>
    </div>
  );
}
