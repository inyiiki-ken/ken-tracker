interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  highlight?: boolean;
}

export default function KpiCard({ title, value, subtitle, highlight }: KpiCardProps) {
  return (
    <div
      className={`brand-left-bar border p-4 flex flex-col gap-1 pl-5 rounded-md bg-card ${highlight ? 'border-primary/30' : 'border-border'}`}
    >
      <p className="text-[9px] font-cinzel uppercase text-muted-foreground" style={{ letterSpacing: '0.25em' }}>{title}</p>
      <p className="text-2xl font-bold font-cinzel leading-none text-primary">{value}</p>
      {subtitle && <p className="text-[10px] mt-0.5 text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
