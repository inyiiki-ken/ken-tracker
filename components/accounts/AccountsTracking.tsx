"use client";

import { useMemo, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabProps } from '@/types';
import { applySearch } from '@/lib/formatters';
import { businessDay } from '@/lib/calculations';
import { buildAccounts } from '@/lib/accountsLedger';
import TabHeader from '@/components/TabHeader';
import AccountsCustomerCard from './AccountsCustomerCard';
import AddClientModal from './AddClientModal';
import { Plus } from 'lucide-react';

export default function AccountsTracking({ records, searchQuery, onSearchChange, onUpdate, userFirstName, userEmail, onRefresh }: TabProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [liverFilter, setLiverFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('balance');
  const accounts = useMemo(() => buildAccounts(records), [records]);
  const liverNames = useMemo(() => [...new Set(records.map(r => r.liverName?.trim().toUpperCase()).filter(Boolean))] as string[], [records]);
  const invalidRange = !!from && !!to && from > to;
  const visible = useMemo(() => accounts.filter(account => !invalidRange && account.records.concat(account.excludedPayments).some(r => {
    if (liverFilter !== 'all' && r.liverName?.trim().toUpperCase() !== liverFilter) return false;
    const date = businessDay(r.dispatchDate || r.deliveredDate || r.dateOfLive);
    if ((from || to) && !date) return false;
    if (from && date < from || to && date > to) return false;
    return applySearch([r], searchQuery).length > 0;
  })).sort((a, b) => (sort === 'balance' ? b.due - a.due : sort === 'credit' ? b.credit - a.credit : 0) || a.name.localeCompare(b.name)),
  [accounts, liverFilter, from, to, searchQuery, sort, invalidRange]);
  const outstanding = visible.filter(a => a.due > 0);
  const settled = visible.filter(a => a.due === 0);
  const review = visible.filter(a => a.verification || a.excludedPayments.length || a.batches.some(b => b.uncertain));
  const money = (n: number) => `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="min-h-screen bg-background pb-24">
      <TabHeader title="Accounts" subtitle="Customer balances, shipments and store credit" searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <div className="px-4 pt-4 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Select value={liverFilter} onValueChange={setLiverFilter}>
            <SelectTrigger className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Livers</SelectItem>{[...liverNames].sort().map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
          <label className="text-xs text-muted-foreground">From<Input aria-label="From shipment or order date" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-40" /></label>
          <label className="text-xs text-muted-foreground">To<Input aria-label="To shipment or order date" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-40" /></label>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort customers" className="h-9 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="balance">Highest outstanding</SelectItem><SelectItem value="name">Customer A–Z</SelectItem><SelectItem value="credit">Highest store credit</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => { setFrom(''); setTo(''); setLiverFilter('all'); onSearchChange(''); }}>Reset filters</Button>
          <Button className="ml-auto h-9 text-xs" onClick={() => setShowAddModal(true)}><Plus className="h-4 w-4 mr-1" />Add Client</Button>
        </div>
        <p className="text-xs text-muted-foreground">Filters find matching customers by shipment date (or live date for unshipped items). Each result keeps the complete account and all its payments.</p>
        {invalidRange && <p role="alert" className="text-sm text-destructive">The end date must be on or after the start date.</p>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Customers', String(visible.length)],
            ['Recorded payments', money(visible.reduce((s, a) => s + a.paid, 0))],
            ['Outstanding', money(visible.reduce((s, a) => s + a.due, 0))],
            ['Available store credit', money(visible.reduce((s, a) => s + a.credit, 0))],
          ].map(([label, value]) => <div key={label} className="rounded-xl border border-border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold mt-1">{value}</p></div>)}
        </div>
        <Tabs defaultValue="all">
          <TabsList className="flex h-auto flex-wrap justify-start">
            <TabsTrigger value="all">All ({visible.length})</TabsTrigger>
            <TabsTrigger value="outstanding">Outstanding ({outstanding.length})</TabsTrigger>
            <TabsTrigger value="settled">Paid / Credit ({settled.length})</TabsTrigger>
            <TabsTrigger value="review">Needs review ({review.length})</TabsTrigger>
          </TabsList>
          {([['all', visible], ['outstanding', outstanding], ['settled', settled], ['review', review]] as const).map(([key, list]) => (
            <TabsContent key={key} value={key} className="space-y-3">
              {!list.length && <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No customers match this view.</p>}
              {list.map(account => <AccountsCustomerCard key={account.key} account={account} onUpdate={onUpdate} />)}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      {showAddModal && <AddClientModal onClose={() => setShowAddModal(false)} userFirstName={userFirstName} userEmail={userEmail} onRefresh={onRefresh} existingRecords={records} />}
    </div>
  );
}
