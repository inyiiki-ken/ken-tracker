"use client";

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/formatters';

interface Props {
  date: string;
  onConfirm: (phpRate: number, silverRate?: number, silverBrandedRate?: number) => void;
  onSkip: () => void;
}

export default function PhpRateDialog({ date, onConfirm, onSkip }: Props) {
  const [phpRate, setPhpRateVal] = useState('');
  const [silverRate, setSilverRateVal] = useState('');
  const [silverBrandedRate, setSilverBrandedRateVal] = useState('');

  const phpParsed = parseFloat(phpRate);
  const isValid = !isNaN(phpParsed) && phpParsed > 0;

  const handleConfirm = () => {
    if (!isValid) return;
    const sr = parseFloat(silverRate);
    const sbr = parseFloat(silverBrandedRate);
    onConfirm(phpParsed, isNaN(sr) ? undefined : sr, isNaN(sbr) ? undefined : sbr);
  };

  return (
    <Dialog open onOpenChange={onSkip}>
      <DialogContent className="bg-card border-border max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-cinzel text-primary text-base">
            Set Rates for {formatDate(date)}
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <p className="text-xs text-muted-foreground">
            Pinas client detected. Set today's rates — these will be locked for all clients on this date.
          </p>

          <div>
            <Label className="text-xs text-muted-foreground">PHP Conversion Rate (1 AED =)</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="number" step="0.01" value={phpRate} onChange={e => setPhpRateVal(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                placeholder="e.g. 16.80" className="h-9 text-sm bg-background border-border" autoFocus />
              <span className="text-sm font-semibold shrink-0">PHP</span>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Silver Rate (AED/gram) — optional</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="number" step="0.5" value={silverRate} onChange={e => setSilverRateVal(e.target.value)}
                placeholder={`default: 45`} className="h-9 text-sm bg-background border-border" />
              <span className="text-sm font-semibold shrink-0">AED</span>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Silver Branded Rate (AED/gram) — optional</Label>
            <div className="flex items-center gap-2 mt-1">
              <Input type="number" step="0.5" value={silverBrandedRate} onChange={e => setSilverBrandedRateVal(e.target.value)}
                placeholder={`default: 60`} className="h-9 text-sm bg-background border-border" />
              <span className="text-sm font-semibold shrink-0">AED</span>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" className="text-xs border-border" onClick={onSkip}>Skip</Button>
          <Button size="sm" className="text-xs bg-primary text-primary-foreground" disabled={!isValid} onClick={handleConfirm}>
            Lock Rates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
