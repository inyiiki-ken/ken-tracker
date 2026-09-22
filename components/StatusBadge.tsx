import { STATUS_COLORS } from '@/lib/formatters';

interface StatusBadgeProps {
  status?: string;
  className?: string;
}

export default function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  if (!status) return null;
  const colorClass = STATUS_COLORS[status] || 'bg-muted text-muted-foreground border-border';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 border text-[10px] font-bold tracking-wide uppercase ${colorClass} ${className}`}>
      {status}
    </span>
  );
}
