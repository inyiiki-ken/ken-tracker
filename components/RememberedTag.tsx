import { Sparkles } from 'lucide-react';

/** Marks a field the app filled from Customer Memory, so staff double-check it. */
export default function RememberedTag({ show = true, title }: { show?: boolean; title?: string }) {
  if (!show) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 ml-1 px-1 py-px rounded border text-[9px] font-semibold uppercase tracking-wide align-middle bg-info/10 text-info border-info/30"
      title={title ?? 'Filled in from this customer\'s past orders. Please double-check.'}
    >
      <Sparkles className="h-2.5 w-2.5" />
      remembered
    </span>
  );
}
