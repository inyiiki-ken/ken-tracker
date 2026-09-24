"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Scale, Plus, RefreshCw, Users, ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { getLiveData } from "@/lib/api";
import { DEFAULT_PRICE_LIST, computeSellers, computeStock, todayISO, type LiveData, type LiveSession } from "@/lib/liveSellers";
import LiveDayDialog, { type LiveDayMode } from "./LiveDayDialog";
import ContainerView from "./ContainerView";
import StockView from "./StockView";
import ReportView from "./ReportView";
import PriceListView from "./PriceListView";
import OutActionDialog, { type OutAction } from "./OutActionDialog";
import OpenOutPanel from "./OpenOutPanel";
import EditSessionDialog from "./EditSessionDialog";
import type { DatabaseRowType } from "@/types";
import { Chip, Kpi, g, holdingLabel, money } from "./parts";

type View = "sellers" | "stock" | "report" | "prices";

const EMPTY: LiveData = { priceList: DEFAULT_PRICE_LIST, sessions: [], items: [], stock: [] };

function monthStart(): string {
  const d = new Date();
  return todayISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

export default function LiveSellersTab({ canEditSettings, records = [] }: { canEditSettings: boolean; records?: DatabaseRowType[] }) {
  const [data, setData] = useState<LiveData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("sellers");
  const [seller, setSeller] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: LiveDayMode; session?: LiveSession | null; seller?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [outAction, setOutAction] = useState<{ action: OutAction; session: LiveSession } | null>(null);
  const [editSession, setEditSession] = useState<LiveSession | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await getLiveData({}));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load live sellers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const from = monthStart();
  const stock = useMemo(() => computeStock(data), [data]);
  const sellers = useMemo(() => computeSellers(data, from), [data, from]);
  const soldMonth = useMemo(
    () => data.items.filter((i) => i.status === "Sold" && i.pulloutDate >= from).reduce((s, i) => s + i.paidAmount, 0),
    [data.items, from]
  );
  const sellerNames = useMemo(() => sellers.map((s) => s.seller), [sellers]);
  const usedKeys = useMemo(
    () => new Set(data.items.filter((i) => i.recordKey && i.status !== "Cancelled").map((i) => i.recordKey)),
    [data.items]
  );
  const cur = data.priceList.currency;
  const warn = data.priceList.holdWarnDays;
  const shown = sellers.filter((s) => !search.trim() || s.seller.includes(search.trim().toUpperCase()));

  const views: { key: View; label: string }[] = [
    { key: "sellers", label: "Sellers" },
    { key: "stock", label: "Stock" },
    { key: "report", label: "Moving report" },
    { key: "prices", label: "Price list" },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-4 pt-4 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <h1 className="font-cinzel text-lg text-primary flex items-center gap-2 mr-auto">
            <Scale className="h-5 w-5" /> Live Sellers &amp; Stock
          </h1>
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {views.map((v) => (
              <button
                key={v.key}
                onClick={() => { setView(v.key); setSeller(null); }}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${view === v.key ? "bg-card shadow-sm font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => load()} title="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-16 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : view === "sellers" && seller ? (
          <ContainerView
            seller={seller}
            data={data}
            onBack={() => setSeller(null)}
            onChanged={() => load(true)}
            onAddItems={() => setDialog({ mode: "hold", seller })}
            onWeighBack={(s) => setDialog({ mode: "back", session: s })}
            onOutAction={(action, session) => (action === "edit" ? setEditSession(session) : setOutAction({ action, session }))}
          />
        ) : view === "sellers" ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <Kpi label="In shop" value={g(stock.inShop)} tone={stock.inShop < 0 ? "neg" : undefined} sub={stock.withSellers ? `${g(stock.withSellers)} out for live` : undefined} />
              <Kpi label="On hold" value={g(stock.onHold)} sub={money(stock.onHoldAmount, cur)} tone="warn" />
              <Kpi label="Sold this month" value={money(soldMonth, cur)} tone="pos" />
              <Kpi label="Sellers holding" value={String(sellers.filter((s) => s.holdCount > 0).length)} />
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search seller…" className="pl-8 h-8 text-sm" />
              </div>
              <Button size="sm" variant="outline" onClick={() => setDialog({ mode: "out" })}>
                <Scale className="h-3.5 w-3.5 mr-1.5" /> Weigh out
              </Button>
              <Button size="sm" onClick={() => setDialog({ mode: "back", session: null })}>
                <Plus className="h-3.5 w-3.5 mr-1.5" /> Record live
              </Button>
            </div>

            {shown.length === 0 ? (
              <div className="text-center py-14 border border-dashed border-border rounded-xl">
                <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {sellers.length === 0 ? "No live sellers yet. Tap Weigh out when a seller takes stock for a live." : "No seller matches that search."}
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {shown.map((s) => (
                  <div key={s.seller} className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2">
                    <button className="flex items-center gap-2 text-left" onClick={() => setSeller(s.seller)}>
                      <span className="font-semibold mr-auto">{s.seller}</span>
                      {s.holdCount > 0 && <Chip>On hold</Chip>}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <div className="text-sm text-muted-foreground">
                      {s.holdCount > 0 ? (
                        <>
                          {s.holdCount} item{s.holdCount === 1 ? "" : "s"} · {g(s.holdGrams)} · {money(s.holdAmount, cur)}
                          <div>
                            Oldest: <span className={s.oldestDays >= warn ? "text-destructive font-semibold" : "text-foreground"}>{holdingLabel(s.oldestDays)}</span>
                          </div>
                        </>
                      ) : (
                        "Nothing on hold"
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      This month: {money(s.soldAmount, cur)} sold{s.cancelledCount ? ` · ${s.cancelledCount} cancelled` : ""}
                    </div>
                    {s.out && (
                      <OpenOutPanel
                        compact
                        session={s.out}
                        onAdd={() => setOutAction({ action: "add", session: s.out! })}
                        onGive={() => setOutAction({ action: "give", session: s.out! })}
                        onWeighBack={() => setDialog({ mode: "back", session: s.out })}
                        onEdit={() => setEditSession(s.out)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : view === "stock" ? (
          <StockView data={data} stock={stock} onChanged={() => load(true)} canDelete={canEditSettings} onEditSession={setEditSession} onAddItems={(s) => setDialog({ mode: "hold", session: s })} />
        ) : view === "report" ? (
          <ReportView data={data} />
        ) : (
          <PriceListView priceList={data.priceList} canEdit={canEditSettings} onSaved={() => load(true)} />
        )}
      </div>

      <OutActionDialog
        open={!!outAction}
        action={outAction?.action ?? "add"}
        session={outAction?.session ?? null}
        sellers={sellerNames}
        onClose={() => setOutAction(null)}
        onSaved={() => load(true)}
      />
      <LiveDayDialog
        open={!!dialog}
        mode={dialog?.mode ?? "back"}
        session={dialog?.session ?? null}
        seller={dialog?.seller}
        onClose={() => setDialog(null)}
        onSaved={() => load(true)}
        priceList={data.priceList}
        sellers={sellerNames}
        records={records}
        usedKeys={usedKeys}
        alreadyListed={dialog?.session ? data.items.filter((i) => i.sessionId === dialog.session!.id).reduce((t, i) => t + i.grams, 0) : 0}
      />
      <EditSessionDialog
        session={editSession}
        data={data}
        sellers={sellerNames}
        onClose={() => setEditSession(null)}
        onSaved={() => load(true)}
        onAddItems={(s) => setDialog({ mode: "hold", session: s })}
      />
    </div>
  );
}
