"use client";

import { Textarea } from '@/components/ui/textarea';

export const CANCEL_REASON_PRESETS = ['Past the reservation period'];

/**
 * Free note for why an item is cancelled. Optional — leave empty if there's
 * nothing to say. The liver sees it on their tab.
 */
export default function CancelReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5 text-left">
      <label className="text-xs text-muted-foreground">Reason (optional, the liver will see this)</label>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Why is it cancelled?"
        className="text-sm min-h-[56px]"
      />
      <div className="flex flex-wrap gap-1.5">
        {CANCEL_REASON_PRESETS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`text-[11px] px-2 py-0.5 rounded-full border ${value === p ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'}`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
