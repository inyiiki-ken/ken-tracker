"use client";

import { useRef, useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer, AlertCircle, Copy, Loader2, CreditCard, Download } from 'lucide-react';
import { DatabaseRowType } from '@/types';
import { calcShippingFee, isFreeSf, getEffectiveCurrency } from '@/lib/calculations';
import { getCcIncludeShipping } from '@/lib/pricingConfig';
import InvoicePrintContent from '@/components/InvoicePrintContent';
import { parseDateRobust } from '@/lib/calculations';
import { toast } from 'sonner';

interface Props {
  records: DatabaseRowType[];
  onClose: () => void;
}

const CURRENCIES = ['PHP', 'AED', 'USD'];

// Statuses that mean the item is completed/on-the-way — shown on a SEPARATE invoice
const DISPATCHED_STATUSES = new Set(['Dispatched', 'Delivered', 'Given to Shop']);
// Statuses fully excluded from all invoices
const EXCLUDED_STATUSES = new Set(['Cancelled', 'Returned Item']);

function sortByDate(list: DatabaseRowType[]) {
  return [...list].sort((a, b) => {
    const ta = a.dateOfLive ? (parseDateRobust(a.dateOfLive)?.getTime() || 0) : 0;
    const tb = b.dateOfLive ? (parseDateRobust(b.dateOfLive)?.getTime() || 0) : 0;
    return ta - tb;
  });
}

type InvoiceTab = 'active' | 'dispatched';

export default function InvoiceModal({ records, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [tab, setTab] = useState<InvoiceTab>('active');
  const [ccIncludeShipping, setCcIncludeShipping] = useState(getCcIncludeShipping());

  useEffect(() => {
    if (!document.getElementById('html2canvas-script') && !(window as any).html2canvas) {
      const script = document.createElement('script');
      script.id = 'html2canvas-script';
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  // ACTIVE: pending/waiting/payment — NOT dispatched/delivered/cancelled
  const activeRecords = useMemo(() =>
    sortByDate(records.filter(r => {
      const s = r.status || '';
      return !EXCLUDED_STATUSES.has(s) && !DISPATCHED_STATUSES.has(s);
    })),
    [records]
  );

  // DISPATCHED / COMPLETED: items on-the-way or already delivered
  const dispatchedRecords = useMemo(() =>
    sortByDate(records.filter(r => DISPATCHED_STATUSES.has(r.status || ''))),
    [records]
  );

  const visibleRecords =
    tab === 'active' ? activeRecords :
    dispatchedRecords;

  const baseRecord = visibleRecords[0] || records[0];
  // Default = the item's own currency; a blank currency means AED (local),
  // matching how the rest of the app prices it. Change it in the dropdown if needed.
  const [currency, setCurrency] = useState(() => (baseRecord ? getEffectiveCurrency(baseRecord) : 'AED'));

  // Show "Include Shipping in CC" toggle only when there are CC items AND shipping applies
  const hasCcItems = visibleRecords.some(r => (r.modeOfPayment || '') === 'Credit Card');
  const hasShipping = visibleRecords.length > 0 && !visibleRecords.every(r => isFreeSf(r)) && calcShippingFee(visibleRecords[0]) > 0;
  const showCcShippingToggle = hasCcItems && hasShipping;

  const handlePrint = () => {
    const content = printRef.current?.innerHTML || '';
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Invoice - ${baseRecord?.minerName || ''}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
        * { box-sizing: border-box; }
        img { max-width: 100%; }
      </style>
    </head><body>${content}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 400);
  };

  const handleCopyImage = () => {
    if (visibleRecords.length === 0 || !printRef.current) return;

    const html2canvas = (window as any).html2canvas;
    if (!html2canvas) {
      toast.error('Image tool still loading — try again in a moment.');
      return;
    }

    setIsCopying(true);
    toast.info('Copying invoice image…');

    const blobPromise: Promise<Blob> = html2canvas(printRef.current, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      scrollY: 0,
      windowHeight: printRef.current.scrollHeight || window.innerHeight,
    }).then((canvas: HTMLCanvasElement) =>
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
          'image/png'
        );
      })
    );

    navigator.clipboard
      .write([new ClipboardItem({ 'image/png': blobPromise })])
      .then(() => {
        toast.success('Invoice copied! Paste it directly into your message.');
      })
      .catch((err: any) => {
        const name: string = err?.name || 'UnknownError';
        if (name === 'NotAllowedError') {
          toast.error('Clipboard access denied. Please allow clipboard permissions in your browser settings and try again.');
        } else {
          toast.error(`Copy failed (${name}). Make sure you are using Chrome and the page is not inside a restricted frame.`);
        }
      })
      .finally(() => setIsCopying(false));
  };

  const tabConfig: { key: InvoiceTab; label: string; count: number }[] = [
    { key: 'active', label: 'Active Orders', count: activeRecords.length },
    { key: 'dispatched', label: 'Dispatched / Delivered', count: dispatchedRecords.length },
  ];

  const handleDownloadCSV = () => {
    if (visibleRecords.length === 0) return;
    const minerName = baseRecord?.minerName || 'Customer';
    const invoiceNum = baseRecord?.pureWeight || 'N/A';
    const invoiceDate = baseRecord?.dateOfLive || new Date().toISOString().split('T')[0];
    const headers = ['Invoice Number', 'Invoice Date', 'Customer Name', 'Item Name', 'Quantity', 'Rate', 'Amount', 'Currency Code'];
    const rows = visibleRecords.map(r => {
      const qty = r.qty && Number(r.qty) > 0 ? Number(r.qty) : 1;
      const rate = Number(r.clientRate) || 0;
      const amount = rate * qty;
      return [invoiceNum, invoiceDate, minerName, r.itemDescription || '', qty, rate, amount, currency].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoice_${invoiceNum}_${minerName.replace(/\s+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 bg-card border-border" aria-describedby={undefined}>
        <DialogHeader className="px-4 pt-4 pb-2 border-b border-border">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-4">
              <DialogTitle className="text-base font-bold font-cinzel text-primary">
                Statement of Account
              </DialogTitle>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium">Currency:</span>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger className="h-8 w-24 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleCopyImage}
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={visibleRecords.length === 0 || isCopying}
                >
                  {isCopying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
                  {isCopying ? 'Copying...' : 'Copy Image'}
                </Button>
                <Button
                  onClick={handleDownloadCSV}
                  size="sm"
                  variant="outline"
                  className="h-8"
                  disabled={visibleRecords.length === 0}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  CSV
                </Button>
                <Button onClick={handlePrint} size="sm" className="h-8 font-cinzel uppercase tracking-wider" disabled={visibleRecords.length === 0}>
                  <Printer className="h-3.5 w-3.5 mr-1.5" /> Print / PDF
                </Button>
              </div>
            </div>

            {/* CC Shipping Toggle */}
            {showCcShippingToggle && (
              <div className="flex items-center gap-2 px-1 py-1.5 rounded-lg bg-muted border border-border">
                <CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground font-medium">CC Surcharge on:</span>
                <div className="flex rounded-md overflow-hidden border border-border text-xs font-semibold">
                  <button
                    onClick={() => setCcIncludeShipping(false)}
                    className={`px-2.5 py-1 transition-colors ${!ccIncludeShipping ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                  >
                    Items only
                  </button>
                  <button
                    onClick={() => setCcIncludeShipping(true)}
                    className={`px-2.5 py-1 transition-colors ${ccIncludeShipping ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                  >
                    Items + Shipping
                  </button>
                </div>
                {ccIncludeShipping && (
                  <span className="text-xs text-warning font-medium">5% applied on subtotal + shipping</span>
                )}
              </div>
            )}

            {/* Tab switcher */}
            <div className="flex gap-1 flex-wrap">
              {tabConfig.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1 text-xs font-cinzel uppercase transition-colors ${
                    tab === t.key
                      ? 'border-b-2 border-primary text-primary bg-accent'
                      : 'text-muted-foreground hover:text-primary'
                  }`}
                  style={{ letterSpacing: '0.1em' }}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span className="ml-1.5 text-xs px-1.5 bg-muted rounded">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        {visibleRecords.length === 0 && (
          <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
            <AlertCircle className="h-8 w-8 text-warning mb-2" />
            <p className="font-semibold text-warning">No Items</p>
            <p className="text-xs">
              {tab === 'active'
                ? 'No active/pending items. Check the other tab.'
                : 'No dispatched or delivered items.'}
            </p>
          </div>
        )}

        {visibleRecords.length > 0 && (
          <div className="overflow-x-auto">
            <div ref={printRef} className="min-w-[640px] p-4 bg-white">
              <InvoicePrintContent records={visibleRecords} currency={currency} ccIncludeShipping={ccIncludeShipping} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
