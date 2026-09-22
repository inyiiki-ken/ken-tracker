"use client";

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatabaseRowType } from '@/types';
import { getFieldLabel } from '@/lib/labelConfig';

const LOCATION_OPTIONS = ['Local', 'Pinas', 'Dubai'];
const CURRENCY_OPTIONS = ['AED', 'PHP', 'USD'];


interface Props {
  record: DatabaseRowType;
  onSave: (fields: Partial<DatabaseRowType>) => Promise<void>;
  onClose: () => void;
}

export default function EditItemDialog({ record, onSave, onClose }: Props) {
  const [minerName, setMinerName] = useState(record.minerName || '');
  const [itemDescription, setItemDescription] = useState(record.itemDescription || '');
  const [clientRate, setClientRate] = useState(record.clientRate != null ? String(record.clientRate) : '');
  const [currency, setCurrency] = useState(record.currency || 'AED');
  const [grams, setGrams] = useState(record.grams != null ? String(record.grams) : '');
  const [location, setLocation] = useState(record.locationOfMiner || '');
  const [saving, setSaving] = useState(false);



  const handleSave = async () => {
    setSaving(true);
    const fields: Partial<DatabaseRowType> = { minerName };
    if (itemDescription.trim()) fields.itemDescription = itemDescription.trim().toUpperCase();
    if (clientRate !== '') fields.clientRate = parseFloat(clientRate) || 0;
    fields.currency = currency;
    if (grams !== '') fields.grams = parseFloat(grams) || 0;
    if (location) fields.locationOfMiner = location;
    await onSave(fields);
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Edit Item Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs text-muted-foreground">{getFieldLabel('minerName')}</Label>
            <Input
              value={minerName}
              onChange={e => setMinerName(e.target.value)}
              className="h-8 text-xs mt-0.5 bg-background border-border"
              placeholder="Enter name..."
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{getFieldLabel('itemDescription')}</Label>
            <Input
              value={itemDescription}
              onChange={e => setItemDescription(e.target.value)}
              className="h-8 text-xs mt-0.5 bg-background border-border uppercase"
              placeholder="e.g. GOLD RING 18K"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{getFieldLabel('clientRate')}</Label>
            <div className="flex gap-2 mt-0.5">
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="h-8 w-20 text-xs bg-background border-border shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {CURRENCY_OPTIONS.map(c => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={clientRate}
                onChange={e => setClientRate(e.target.value)}
                className="h-8 text-xs bg-background border-border flex-1"
                placeholder="e.g. 220"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Grams</Label>
            <Input
              type="number"
              value={grams}
              onChange={e => setGrams(e.target.value)}
              className="h-8 text-xs mt-0.5 bg-background border-border"
              placeholder="e.g. 7.28"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Location of Miner</Label>
            <Select value={location} onValueChange={setLocation}>
              <SelectTrigger className="h-8 text-xs mt-0.5 bg-background border-border">
                <SelectValue placeholder="Select location..." />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                {LOCATION_OPTIONS.map(opt => (
                  <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground">
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
