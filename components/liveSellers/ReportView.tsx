"use client";

import { useMemo, useState } from "react";
import { computeSellers, computeTopItems, computeTypeMovement, todayISO, type LiveData } from "@/lib/liveSellers";
import { Chip, Kpi, g, holdingLabel, money } from "./parts";

type Period = "month" | "30" | "90" | "all";

function periodStart(p: Period): string {
  const d = new Date();
  if (p === "month") return todayISO(new Date(d.getFullYear(), d.getMonth(), 1));
  if (p === "all") return "0000-00-00";
  return todayISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() - Number(p) + 1));
}

export default function ReportView({ data }: { data: LiveData }) {
  const [period, setPeriod] = useState<Period>("month");
  const from = periodStart(period);
  const cur = data.priceList.currency;

  const types = useMemo(() => computeTypeMovement(data, from), [data, from]);
  const top = useMemo(() => computeTopItems(data, from, 10), [data, from]);
  const sellers = useMemo(() => computeSellers(data, from), [data, from]);
  const sold = data.items.filter((i) => i.status === "Sold" && i.pulloutDate >= from);
  const cancelled = data.items.filter((i) => i.status === "Cancelled" && i.cancelledDate >= from);
  const soldGrams = sold.reduce((s, i) => s + i.grams, 0);
  const soldAmt = sold.reduce((s, i) => s + i.paidAmount, 0);
  const cancelRate = sold.length + cancelled.length ? Math.round((cancelled.length / (sold.length + cancelled.length)) * 100) : 0;
  const maxGrams = Math.max(1, ...types.map((t) => t.soldGrams));

  const periods: { key: Period; label: string }[] = [
    { key: "month", label: "This month" },
    { key: "30", label: "30 days" },
    { key: "90", label: "90 days" },
    { key: "all", label: "All time" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground mr-auto">
          Counts only items that were <b>pulled out</b> (sold). &quot;Not moving&quot; = no sale for {data.priceList.notMovingDays} days.
        </p>
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          {periods.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} className={`px-2.5 py-1 text-xs rounded-md ${period === p.key ? "bg-card shadow-sm font-semibold" : "text-muted-foreground"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Sold" value={money(soldAmt, cur)} tone="pos" />
        <Kpi label="Grams sold" value={g(soldGrams)} />
        <Kpi label="Items sold" value={String(sold.length)} />
        <Kpi label="Cancelled" value={String(cancelled.length)} sub={`${cancelRate}% of settled items`} tone={cancelRate >= 20 ? "warn" : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-sm font-semibold mb-2">By type</p>
          <table className="w-full text-sm">
            <tbody>
              {types.map((t) => (
                <tr key={t.type} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-2">{t.type}</td>
                  <td className="py-2 pr-2 w-28">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-success" style={{ width: `${(t.soldGrams / maxGrams) * 100}%` }} />
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{g(t.soldGrams)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap text-muted-foreground hidden sm:table-cell">{money(t.soldAmount, cur)}</td>
                  <td className="py-2 text-right">
                    <Chip>{t.label}</Chip>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{t.daysSinceSale === null ? "never sold" : `last sale ${holdingLabel(t.daysSinceSale)}${t.daysSinceSale ? " ago" : ""}`}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-sm font-semibold mb-2">Top-selling items</p>
          {top.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sales in this period.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {top.map((t, idx) => (
                <li key={t.description} className="flex items-center gap-2">
                  <span className="w-5 text-muted-foreground tabular-nums">{idx + 1}.</span>
                  <span className="mr-auto">{t.description}</span>
                  <span className="tabular-nums">{t.count} pcs</span>
                  <span className="tabular-nums text-muted-foreground w-20 text-right">{g(t.grams)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 overflow-x-auto">
        <p className="text-sm font-semibold mb-2">Sellers</p>
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="text-[11px] text-muted-foreground text-left border-b border-border">
              <th className="py-2 font-medium">Seller</th>
              <th className="py-2 font-medium text-right">Sold</th>
              <th className="py-2 font-medium text-right">Items</th>
              <th className="py-2 font-medium text-right">Cancelled</th>
              <th className="py-2 font-medium text-right">On hold</th>
              <th className="py-2 font-medium text-right">Oldest hold</th>
            </tr>
          </thead>
          <tbody>
            {sellers.map((s) => (
              <tr key={s.seller} className="border-b border-border/60 last:border-0">
                <td className="py-2">{s.seller}</td>
                <td className="py-2 text-right tabular-nums">{money(s.soldAmount, cur)}</td>
                <td className="py-2 text-right tabular-nums">{s.soldCount}</td>
                <td className="py-2 text-right tabular-nums">{s.cancelledCount}</td>
                <td className="py-2 text-right tabular-nums">{s.holdCount ? `${s.holdCount} · ${g(s.holdGrams)}` : "—"}</td>
                <td className={`py-2 text-right ${s.oldestDays >= data.priceList.holdWarnDays ? "text-destructive font-semibold" : ""}`}>{s.holdCount ? holdingLabel(s.oldestDays) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
