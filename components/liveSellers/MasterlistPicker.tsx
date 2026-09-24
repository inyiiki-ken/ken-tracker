"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { calcItemPriceAED, parseDateRobust } from "@/lib/calculations";
import { round2, todayISO, type LivePriceList } from "@/lib/liveSellers";
import type { DatabaseRowType } from "@/types";
import { g, money } from "./parts";

export interface PickedItem {
  description: string;
  type: string;
  grams: number;
  amount: number;
  recordKey: string;
}

export function recordKeyOf(r: DatabaseRowType): string {
  return r.rowKey || `ROW-${r.id}`;
}

function recordISO(r: DatabaseRowType): string {
  const d = parseDateRobust(r.dateOfLive);
  return d ? todayISO(d) : "";
}

/**
 * Pick the items a liver took straight from the masterlist uploaded in Admin,
 * so nobody re-types descriptions, grams and prices.
 */
export default function MasterlistPicker({
  records, seller, date, usedKeys, priceList, onAdd, onClose,
}: {
  records: DatabaseRowType[];
  seller: string;
  date: string;
  usedKeys: Set<string>;
  priceList: LivePriceList;
  onAdd: (items: PickedItem[]) => void;
  onClose: () => void;
}) {
  const [liver, setLiver] = useState(seller);
  const [day, setDay] = useState(date);
  const [anyDate, setAnyDate] = useState(false);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const typeNames = useMemo(() => new Set(priceList.types.map((t) => t.name.toLowerCase())), [priceList]);
  const typeOf = (r: DatabaseRowType) => {
    const cands = [r.category, r.tog].map((x) => String(x ?? "").trim()).filter(Boolean);
    return cands.find((c) => typeNames.has(c.toLowerCase())) || cands[0] || "";
  };

  const rows = useMemo(() => {
    const L = liver.trim().toUpperCase();
    const text = q.trim().toLowerCase();
    return records
      .filter((r) => !usedKeys.has(recordKeyOf(r)))
      .filter((r) => !L || String(r.liverName ?? "").trim().toUpperCase() === L)
      .filter((r) => anyDate || recordISO(r) === day)
      .filter((r) => !text || [r.orderId, r.itemDescription, r.minerName].some((f) => String(f ?? "").toLowerCase().includes(text)))
      .slice(0, 300);
  }, [records, usedKeys, liver, day, anyDate, q]);

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const sel = rows.filter((r) => picked.has(recordKeyOf(r)));

  const add = () => {
    onAdd(sel.map((r) => ({
      description: [r.orderId, r.itemDescription].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · "),
      type: typeOf(r),
      grams: round2(Number(r.grams) || 0),
      amount: calcItemPriceAED(r),
      recordKey: recordKeyOf(r),
    })));
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <p className="text-[11px] text-muted-foreground">Liver (from Admin)</p>
          <Input value={liver} onChange={(e) => setLiver(e.target.value)} className="h-8 w-32 text-sm uppercase" />
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Date of live</p>
          <Input type="date" value={day} disabled={anyDate} onChange={(e) => setDay(e.target.value)} className="h-8 text-sm" />
        </div>
        <label className="flex items-center gap-1.5 text-xs pb-2">
          <Checkbox checked={anyDate} onCheckedChange={(v) => setAnyDate(!!v)} /> Any date
        </label>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code / item / client" className="h-8 text-sm flex-1 min-w-[140px]" />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-card">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No masterlist items for this liver and date (items already added are hidden).</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => {
                const k = recordKeyOf(r);
                return (
                  <tr key={k} className="border-b border-border/60 last:border-0 cursor-pointer hover:bg-muted/40" onClick={() => toggle(k)}>
                    <td className="px-2 py-1.5 w-7" onClick={(e) => e.stopPropagation()}><Checkbox checked={picked.has(k)} onCheckedChange={() => toggle(k)} /></td>
                    <td className="px-1 py-1.5 whitespace-nowrap text-muted-foreground">{r.orderId || "—"}</td>
                    <td className="px-1 py-1.5">{r.itemDescription || "—"}<div className="text-[11px] text-muted-foreground">{[r.minerName, r.liverName, r.dateOfLive].filter(Boolean).join(" · ")}</div></td>
                    <td className="px-1 py-1.5 whitespace-nowrap">{typeOf(r)}</td>
                    <td className="px-1 py-1.5 text-right tabular-nums">{(Number(r.grams) || 0).toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{calcItemPriceAED(r).toLocaleString("en-US")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(rows.map(recordKeyOf)))} disabled={!rows.length}>Select all</Button>
        <span className="text-xs text-muted-foreground mr-auto">
          {sel.length} selected · {g(sel.reduce((s, r) => s + (Number(r.grams) || 0), 0))} · {money(sel.reduce((s, r) => s + calcItemPriceAED(r), 0), "AED")}
        </span>
        <Button size="sm" variant="outline" onClick={onClose}>Close</Button>
        <Button size="sm" onClick={add} disabled={!sel.length}>Add {sel.length || ""} to list</Button>
      </div>
    </div>
  );
}
