"use client";

import { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DatabaseRowType } from '@/types';
import { calcItemPriceAED, calcTotalPaid, parseDateRobust } from '@/lib/calculations';
import { formatDate } from '@/lib/formatters';
import { Copy, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  customerId: string;
  minerName: string;
  allRecords: DatabaseRowType[];
  onClose: () => void;
}

export default function CustomerHistoryModal({ customerId, minerName, allRecords, onClose }: Props) {
  const customerRecords = useMemo(() => {
    return allRecords
      .filter(r => r.customerId === customerId)
      .sort((a, b) => {
        const dateA = a.dateOfLive ? (parseDateRobust(a.dateOfLive)?.getTime() || 0) : 0;
        const dateB = b.dateOfLive ? (parseDateRobust(b.dateOfLive)?.getTime() || 0) : 0;
        return dateB - dateA;
      });
  }, [allRecords, customerId]);

  const summary = useMemo(() => {
    const totalItems = customerRecords.length;
    const billableItems = customerRecords.filter(r =>
      r.status !== 'Cancelled' && r.status !== 'Returned Item'
    );
    const activeItems = billableItems.filter(r => r.status !== 'Delivered');
    const totalSpent = billableItems.reduce((sum, r) => sum + calcItemPriceAED(r), 0);
    const totalPaid = billableItems.reduce((sum, r) => sum + calcTotalPaid(r), 0);
    const balance = Math.max(0, totalSpent - totalPaid);
    return { totalItems, activeCount: activeItems.length, totalSpent, balance };
  }, [customerRecords]);

  const handleCopyId = () => {
    navigator.clipboard.writeText(customerId);
    toast.success('Customer ID copied to clipboard!');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary flex items-center justify-between pr-6">
            <span>Client Ledger: {minerName.toUpperCase()}</span>
            <button 
              onClick={handleCopyId}
              className="group flex items-center gap-1.5 px-2.5 py-1 transition-colors border border-border rounded bg-muted hover:bg-accent"
              title="Copy Customer ID"
            >
              <span className="text-xs font-mono text-muted-foreground group-hover:text-primary transition-colors">{customerId}</span>
              <Copy className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
          <div className="p-3 text-center bg-muted rounded-md border border-border">
            <p className="text-[10px] uppercase font-cinzel mb-1 text-muted-foreground" style={{ letterSpacing: '0.2em' }}>Total Items</p>
            <p className="text-lg font-bold font-cinzel text-primary">{summary.totalItems}</p>
          </div>
          <div className="p-3 text-center bg-muted rounded-md border border-border">
            <p className="text-[10px] uppercase font-cinzel mb-1 text-muted-foreground" style={{ letterSpacing: '0.2em' }}>Pending Items</p>
            <p className="text-lg font-bold font-cinzel text-primary">{summary.activeCount}</p>
          </div>
          <div className="p-3 text-center bg-muted rounded-md border border-border">
            <p className="text-[10px] uppercase font-cinzel mb-1 text-muted-foreground" style={{ letterSpacing: '0.2em' }}>Total Value</p>
            <p className="text-lg font-bold font-cinzel text-primary">AED {summary.totalSpent.toFixed(2)}</p>
          </div>
          <div className="p-3 text-center bg-accent rounded-md border border-primary/20">
            <p className="text-[10px] uppercase font-cinzel mb-1 text-muted-foreground" style={{ letterSpacing: '0.2em' }}>Outstanding</p>
            <p className={`text-lg font-bold ${summary.balance > 0 ? 'text-destructive' : 'text-success'}`}>
              AED {summary.balance.toFixed(2)}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {customerRecords.map(record => {
            const price = calcItemPriceAED(record);
            const paid = calcTotalPaid(record);
            const balance = Math.max(0, price - paid);
            const isDead = record.status === 'Cancelled' || record.status === 'Returned Item';
            const isDelivered = record.status === 'Delivered';

            return (
              <div key={record.id} className={`p-4 border brand-left-bar pl-5 rounded-md bg-card ${isDead ? 'opacity-60' : ''} ${isDead ? 'border-border/50' : isDelivered ? 'border-success' : 'border-border'}`}>
                <div className="flex flex-col md:flex-row justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border">
                        {record.status || 'Unknown'}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(record.dateOfLive)}</span>
                    </div>
                    <p className="text-sm font-medium mt-1">{record.itemDescription}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {record.orderId && <span>ID: <span className="font-mono">{record.orderId}</span></span>}
                      <span>{record.category || 'N/A'}</span>
                      {record.grams && <span>{Number(record.grams).toFixed(2)}g</span>}
                    </div>
                  </div>

                  <div className="flex flex-col items-end justify-center min-w-[120px] shrink-0">
                    {(!isDead || isDelivered) && (
                      <>
                        <div className="text-right w-full flex justify-between gap-4 mb-0.5">
                          <span className="text-xs text-muted-foreground">Price:</span>
                          <span className="text-sm font-medium">AED {price.toFixed(2)}</span>
                        </div>
                        <div className="text-right w-full flex justify-between gap-4 mb-1">
                          <span className="text-xs text-muted-foreground">Paid:</span>
                          <span className="text-sm font-medium text-success">AED {paid.toFixed(2)}</span>
                        </div>
                        <div className="w-full h-px bg-border my-1" />
                        <div className="text-right w-full flex justify-between gap-4">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground self-center">Bal:</span>
                          <span className={`text-sm font-bold ${balance > 0 ? 'text-destructive' : 'text-success flex items-center gap-1'}`}>
                            {balance === 0 && <CheckCircle2 className="w-3.5 h-3.5" />}
                            AED {balance.toFixed(2)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {customerRecords.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-xl">
              No history found for this customer.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
