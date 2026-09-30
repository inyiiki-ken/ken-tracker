"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, ImagePlus, ClipboardPaste, AlertTriangle, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { getResellerConfig, saveResellerConfig, importRows, bulkUpdateRecords, readResellerPhoto, resellerPhotoReaderReady } from "@/lib/api";
import { parseDateRobust } from "@/lib/calculations";
import { todayISO } from "@/lib/liveSellers";
import {
  RESELLER_KARATS, KARAT_CATEGORY, buildDescription, itemAmount, itemFromRecord, karatOf, knownResellers, newItem, parsePastedItems,
  parseResellerConfig, ratesFor, resellerKey, round2, withRates,
  type ResellerConfig, type ResellerItem, type ResellerKarat, type ResellerRates,
} from "@/lib/resellers";
import type { DatabaseRowType } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after the items were added, to reload the records. */
  onImported?: () => void;
  records: DatabaseRowType[];
}

/** Shrink a photo so one fits in a server-action request (and reads faster). */
async function photoToJpeg(file: File, maxSide = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.85);
    return data.slice(data.indexOf(",") + 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const EMPTY_RATES: Record<ResellerKarat, string> = { "18K": "", SP: "", EF: "" };

export default function ResellerImportDialog({ open, onClose, onImported, records }: Props) {
  const [cfg, setCfg] = useState<ResellerConfig>({ resellers: {} });
  const [reseller, setReseller] = useState("");
  const [date, setDate] = useState(todayISO());
  const [rates, setRates] = useState<Record<ResellerKarat, string>>(EMPTY_RATES);
  const [ratesFrom, setRatesFrom] = useState<string | null>(null);
  const [items, setItems] = useState<ResellerItem[]>([]);
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [showPick, setShowPick] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [photoReady, setPhotoReady] = useState<boolean | null>(null);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setItems([]);
    setPaste("");
    setShowPaste(false);
    setShowPick(false);
    setPicked(new Set());
    setDate(todayISO());
    getResellerConfig().then(({ config }) => setCfg(parseResellerConfig(config))).catch(() => setCfg({ resellers: {} }));
    resellerPhotoReaderReady().then(setPhotoReady).catch(() => setPhotoReady(false));
  }, [open]);

  // Saved rates for this reseller and day (or her latest earlier day).
  useEffect(() => {
    if (!reseller.trim()) { setRates(EMPTY_RATES); setRatesFrom(null); return; }
    const { rates: r, from } = ratesFor(cfg, reseller, date);
    setRates({ "18K": r["18K"] ? String(r["18K"]) : "", SP: r.SP ? String(r.SP) : "", EF: r.EF ? String(r.EF) : "" });
    setRatesFrom(from);
  }, [cfg, reseller, date]);

  // Everyone already in Admin, plus resellers with saved rates, for the picker.
  const customers = useMemo(() => {
    const s = new Set<string>(knownResellers(cfg));
    for (const r of records) {
      const n = resellerKey(String(r.minerName ?? ""));
      if (n) s.add(n);
    }
    return [...s].sort();
  }, [records, cfg]);

  // Items already in Admin for this day under their end customers' names
  // (e.g. the reseller's masterlist was uploaded as-is), grouped by upload.
  const dayGroups = useMemo(() => {
    const who = resellerKey(reseller);
    const inList = new Set(items.map((it) => it.record?.id).filter((x): x is number => x != null));
    const groups = new Map<string, DatabaseRowType[]>();
    for (const r of records) {
      const d = parseDateRobust(r.dateOfLive);
      if (!d || todayISO(d) !== date) continue;
      if (['Cancelled', 'Returned Item'].includes(String(r.status ?? ''))) continue;
      if (who && resellerKey(String(r.minerName ?? "")) === who) continue;
      if (inList.has(r.id)) continue;
      const g = [r.liverName, r.page].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ") || "No liver / page";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(r);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [records, date, reseller, items]);

  const addPicked = () => {
    const chosen = dayGroups.flatMap(([, rs]) => rs).filter((r) => picked.has(r.id));
    if (!chosen.length) return toast.error("Tick the items to bill to the reseller.");
    setItems((xs) => [...xs.filter((x) => x.item.trim() || x.grams.trim()), ...chosen.map(itemFromRecord)]);
    setPicked(new Set());
    setShowPick(false);
  };

  const rateNums: Partial<ResellerRates> = {
    "18K": parseFloat(rates["18K"]) || 0,
    SP: parseFloat(rates.SP) || 0,
    EF: parseFloat(rates.EF) || 0,
  };
  const filled = items.filter((it) => it.item.trim() || it.grams.trim());
  const totalGrams = round2(filled.reduce((s, it) => s + (parseFloat(it.grams) || 0), 0));
  const totalAmount = round2(filled.reduce((s, it) => s + itemAmount(it, rateNums), 0));
  const problems = filled.filter((it) => !(parseFloat(it.grams) > 0) || !it.customer.trim() || !rateNums[it.karat]);

  const setItem = (key: number, patch: Partial<ResellerItem>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const readPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    setReading({ done: 0, total: list.length });
    const found: ResellerItem[] = [];
    const errors: string[] = [];
    // A few at a time: each photo is its own request.
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const f = list[next++];
        try {
          const res = await readResellerPhoto({ data: await photoToJpeg(f), mediaType: "image/jpeg" });
          if (res.error) errors.push(`${f.name}: ${res.error}`);
          for (const r of res.items) {
            found.push(newItem({
              item: r.item,
              customer: r.customer,
              grams: r.grams != null ? String(r.grams) : "",
              karat: karatOf(r.karat) ?? "18K",
              note: r.note || undefined,
            }));
          }
        } catch (e) {
          errors.push(`${f.name}: ${e instanceof Error ? e.message : "could not read"}`);
        }
        setReading((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setReading(null);
    if (fileRef.current) fileRef.current.value = "";
    setItems((xs) => [...xs.filter((x) => x.item.trim() || x.grams.trim()), ...found]);
    if (found.length) toast.success(`Read ${found.length} item${found.length === 1 ? "" : "s"} from ${list.length} photo${list.length === 1 ? "" : "s"}. Check the names and weights.`);
    if (errors.length) toast.error(errors.slice(0, 3).join("\n"));
  };

  const addPasted = () => {
    const parsed = parsePastedItems(paste);
    if (!parsed.length) return toast.error("No items found. Put one item per line.");
    setItems((xs) => [...xs.filter((x) => x.item.trim() || x.grams.trim()), ...parsed]);
    setPaste("");
    setShowPaste(false);
  };

  const save = async () => {
    const who = resellerKey(reseller);
    if (!who) return toast.error("Choose the reseller the invoice goes to.");
    if (!filled.length) return toast.error("Add the items first.");
    if (problems.length) return toast.error("Each item needs a customer, grams, and a rate for its type.");
    setSaving(true);
    try {
      // Remember today's rates for this reseller (every PC sees them).
      const nextCfg = withRates(cfg, who, date, rateNums);
      try {
        await saveResellerConfig({ config: JSON.stringify(nextCfg) });
        setCfg(nextCfg);
      } catch {
        toast.warning("The rates were not saved for next time (only an admin can save them). The items still use them.");
      }

      // Bill to the reseller: her id and delivery details from her latest order.
      const theirs = records
        .filter((r) => resellerKey(String(r.minerName ?? "")) === who)
        .sort((a, b) => (parseDateRobust(b.dateOfLive)?.getTime() ?? 0) - (parseDateRobust(a.dateOfLive)?.getTime() ?? 0));
      const latest = theirs[0];
      const contact: Record<string, string> = {};
      const customerId = theirs.find((r) => r.customerId)?.customerId;
      if (customerId) contact.customerId = customerId;
      for (const k of ["clientAddress", "clientNumber", "regions", "locationOfMiner", "modeOfPayment"] as const) {
        const v = String(latest?.[k] ?? "").trim();
        if (v) contact[k] = v;
      }

      const stamp = new Date().toISOString();
      const moved = filled.filter((it) => it.record);
      const fresh = filled.filter((it) => !it.record);
      let updated = 0;
      if (moved.length) {
        const updates = moved.map((it) => {
          const rec = it.record!;
          const desc = buildDescription(it);
          const lines = String(rec.auditTrail ?? "").split("\n").filter(Boolean);
          lines.push(`${stamp} | Reseller invoice | Billed to ${who} (customer "${rec.minerName ?? ""}", description "${rec.itemDescription ?? ""}" → "${desc}", rate ${rateNums[it.karat]})`);
          const fields: Partial<DatabaseRowType> = {
            ...(contact as Partial<DatabaseRowType>),
            minerName: who,
            itemDescription: desc,
            grams: parseFloat(it.grams),
            category: KARAT_CATEGORY[it.karat],
            clientRate: rateNums[it.karat],
            currency: "AED",
            auditTrail: lines.slice(-20).join("\n"),
          };
          return { rowId: rec.id, rowKey: rec.rowKey, fields };
        });
        const res = await bulkUpdateRecords({ updates });
        updated = res.updatedCount;
      }
      const rows = fresh.map((it) => ({
        ...contact,
        dateOfLive: date,
        minerName: who,
        itemDescription: buildDescription(it),
        grams: String(parseFloat(it.grams)),
        category: KARAT_CATEGORY[it.karat],
        clientRate: String(rateNums[it.karat]),
        currency: "AED",
        modeOfSale: "Reseller",
        liverAdminRemarks: `Reseller import for ${it.customer.trim().toUpperCase()}`,
        rowKey: `R-${Date.now().toString(36)}-${it.key}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase(),
      }));
      const res = rows.length
        ? await importRows({ rows, importId: `reseller-${who}-${stamp}` })
        : { createdCount: 0, duplicates: 0, alreadyImported: 0, errors: [] as string[] };
      const skipped = res.duplicates + res.alreadyImported;
      const done = res.createdCount + updated;
      toast.success(
        `Billed ${done} item${done === 1 ? "" : "s"} to ${who}` +
          (updated && res.createdCount ? ` (${updated} moved from Admin, ${res.createdCount} new)` : "") +
          (skipped ? `; ${skipped} already there, skipped` : "") + "."
      );
      if (res.errors.length) toast.error(res.errors.slice(0, 3).join("\n"));
      onImported?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the items.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Reseller invoice</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Items are billed to the reseller. Each customer&apos;s name goes into the description.
          </p>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end">
          <label className="text-sm font-medium">
            Bill to reseller
            <Input list="reseller-names" value={reseller} onChange={(e) => setReseller(e.target.value)} placeholder="ARIAN" className="uppercase mt-1" />
            <datalist id="reseller-names">{customers.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="text-sm font-medium">
            Date
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
          </label>
        </div>

        <div className="rounded-xl border border-border p-3">
          <div className="flex flex-wrap items-end gap-3">
            {RESELLER_KARATS.map((k) => (
              <label key={k} className="text-sm font-medium w-28">
                {k} rate (AED/g)
                <Input inputMode="decimal" value={rates[k]} onChange={(e) => setRates((r) => ({ ...r, [k]: e.target.value }))} className="mt-1" />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {!reseller.trim()
              ? "Choose the reseller to load her rates."
              : ratesFrom === date
                ? "Saved rates for this day."
                : ratesFrom
                  ? `No rates saved for this day yet; showing her rates from ${ratesFrom}. Change them if today's are different.`
                  : "No rates saved for her yet. Enter today's rates; they are saved when you add the items."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => readPhotos(e.target.files)} />
          <Button type="button" variant="outline" disabled={!!reading || photoReady === false} onClick={() => fileRef.current?.click()}
            title={photoReady === false ? "Photo reading needs ANTHROPIC_API_KEY on this install." : undefined}>
            {reading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1" />}
            {reading ? `Reading photos ${reading.done}/${reading.total}…` : "Read photos"}
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowPaste((v) => !v)}>
            <ClipboardPaste className="h-4 w-4 mr-1" />Paste items
          </Button>
          <Button type="button" variant="outline" onClick={() => setShowPick((v) => !v)}>
            <ListChecks className="h-4 w-4 mr-1" />Already in Admin{dayGroups.length ? ` (${dayGroups.reduce((n, [, rs]) => n + rs.length, 0)})` : ""}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setItems((xs) => [...xs, newItem()])}>
            <Plus className="h-4 w-4 mr-1" />Add row
          </Button>
          {photoReady === false && (
            <span className="text-xs text-muted-foreground self-center">Photo reading is off on this install (no ANTHROPIC_API_KEY). Paste the items instead.</span>
          )}
        </div>

        {showPaste && (
          <div className="space-y-2">
            <Textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)}
              placeholder={"One item per line: item - customer - grams - type\nHOOP EARRINGS - INDAY MICHELLE - 1.65 - SP\n18K GOLD FIGARO CHAIN - CARBIZE BELLA - 11.32"} />
            <Button type="button" size="sm" onClick={addPasted}>Add these items</Button>
          </div>
        )}

        {showPick && (
          <div className="rounded-xl border border-border p-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Items already uploaded for {date} under their customers&apos; names. Tick the reseller&apos;s items to move them to her invoice.
            </p>
            {dayGroups.length === 0 && <p className="text-sm text-muted-foreground">Nothing uploaded for this day.</p>}
            {dayGroups.map(([g, rs]) => {
              const all = rs.every((r) => picked.has(r.id));
              return (
                <div key={g}>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={all} onChange={() => setPicked((p) => {
                      const n = new Set(p);
                      for (const r of rs) { if (all) n.delete(r.id); else n.add(r.id); }
                      return n;
                    })} />
                    {g} <span className="text-muted-foreground font-normal">({rs.length})</span>
                  </label>
                  <div className="mt-1 ml-5 space-y-0.5 max-h-48 overflow-y-auto">
                    {rs.map((r) => (
                      <label key={r.id} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={picked.has(r.id)} onChange={() => setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(r.id)) n.delete(r.id); else n.add(r.id);
                          return n;
                        })} />
                        <span className="font-medium w-40 truncate">{r.minerName || "—"}</span>
                        <span className="flex-1 truncate">{r.itemDescription}</span>
                        <span className="tabular-nums w-14 text-right">{r.grams ?? ""} g</span>
                        <span className="w-28 truncate text-muted-foreground">{r.category}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {dayGroups.length > 0 && <Button type="button" size="sm" onClick={addPicked}>Bill ticked items to {resellerKey(reseller) || "reseller"}</Button>}
          </div>
        )}

        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-1 py-1 font-medium">Item</th>
                  <th className="px-1 py-1 font-medium w-44">Customer</th>
                  <th className="px-1 py-1 font-medium w-20">Grams</th>
                  <th className="px-1 py-1 font-medium w-24">Type</th>
                  <th className="px-1 py-1 font-medium w-24 text-right">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const bad = (it.item.trim() || it.grams.trim()) && (!(parseFloat(it.grams) > 0) || !it.customer.trim());
                  return (
                    <tr key={it.key} className="align-top">
                      <td className="px-1 py-1">
                        <Input value={it.item} onChange={(e) => setItem(it.key, { item: e.target.value })} className="h-8 text-sm uppercase" />
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate" title="Description on the invoice">{it.record ? "Moves the Admin row · " : ""}{buildDescription(it)}</div>
                        {it.note && <div className="text-[11px] text-warning mt-0.5"><AlertTriangle className="inline h-3 w-3 mr-0.5" />{it.note}</div>}
                      </td>
                      <td className="px-1 py-1">
                        <Input value={it.customer} onChange={(e) => setItem(it.key, { customer: e.target.value })} className={`h-8 text-sm uppercase ${bad && !it.customer.trim() ? "border-destructive" : ""}`} />
                      </td>
                      <td className="px-1 py-1">
                        <Input inputMode="decimal" value={it.grams} onChange={(e) => setItem(it.key, { grams: e.target.value })} className={`h-8 text-sm ${bad && !(parseFloat(it.grams) > 0) ? "border-destructive" : ""}`} />
                      </td>
                      <td className="px-1 py-1">
                        <Select value={it.karat} onValueChange={(v) => setItem(it.key, { karat: v as ResellerKarat })}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>{RESELLER_KARATS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-1 py-1 text-right tabular-nums pt-2.5">{itemAmount(it, rateNums).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className="px-1 py-1">
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row sm:items-center gap-2">
          <div className="text-sm mr-auto tabular-nums">
            {filled.length} items · {totalGrams} g · <b>AED {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
            {problems.length > 0 && <span className="text-destructive ml-2">{problems.length} need a customer, grams or rate</span>}
          </div>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !!reading || !filled.length}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Bill {filled.length || ""} item{filled.length === 1 ? "" : "s"} to {resellerKey(reseller) || "reseller"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
