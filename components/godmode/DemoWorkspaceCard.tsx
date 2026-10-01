"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getDemoStatus, seedDemoStep, type DemoStep } from "@/lib/google-sheets/demo";
import { prepareTenantSwitch } from "@/lib/tenantStorage";

const STEPS: { step: DemoStep; label: string }[] = [
  { step: "settings", label: "Copy the setup and switch on every feature (tabs, boxes, statuses, reminders)" },
  { step: "options", label: "Dropdown lists (sellers, pages, categories)" },
  { step: "orders", label: "Orders in every box, repeat customers, invoices, layaway" },
  { step: "purchasing", label: "Supplier purchases" },
  { step: "live", label: "Live Sellers: lives, containers and stock" },
];

/**
 * Fills the ACTIVE demo account with made-up customers and orders and turns on
 * every feature, for showing the app to prospects. The server refuses unless
 * the workspace is a demo account, so a real customer can't be overwritten.
 */
export default function DemoWorkspaceCard({ tenantId }: { tenantId?: string }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getDemoStatus>> | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<DemoStep[]>([]);

  useEffect(() => {
    getDemoStatus()
      .then((s) => {
        setStatus(s);
        // Crown has every recent update, so it's the default setup to copy.
        const crown = s.sources.find((t) => /crown/i.test(t.displayName));
        setCopyFrom(crown?.tenantId ?? "");
      })
      .catch(() => setStatus(null));
  }, [tenantId]);

  const run = async () => {
    if (!status?.isDemo) return;
    if (!window.confirm(`Replace ALL data in "${status.name}" with demo data? Its orders, purchases and live sellers are wiped first.`)) return;
    setRunning(true);
    setDone([]);
    try {
      for (const { step } of STEPS) {
        await seedDemoStep({ step, copyFrom: step === "settings" && copyFrom ? copyFrom : undefined });
        setDone((d) => [...d, step]);
      }
      toast.success(`${status.name} is filled with demo data. Reloading…`);
      // Settings changed on the sheet: drop this browser's cached copies.
      prepareTenantSwitch(tenantId ?? "");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Demo fill failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <Sparkles className="h-4 w-4" /> Demo account
      </h2>
      <p className="text-xs text-muted-foreground">
        Fills the active demo account with made-up customers (no real people, phones or addresses),
        orders in every box, resellers, invoices, purchases and live sellers, and switches every
        feature on. Settings (statuses, boxes, pricing, labels, tabs) can be copied from a real
        customer such as Crown; their orders, customers, resellers and branding are never copied. Running it again resets the demo. Only works on an account whose name or plan
        says &quot;Demo&quot;.
      </p>
      {status && !status.isDemo && (
        <p className="text-xs text-warning">{status.reason}</p>
      )}
      {(running || done.length > 0) && (
        <ul className="text-xs space-y-1">
          {STEPS.map(({ step, label }) => (
            <li key={step} className="flex items-center gap-2">
              {done.includes(step)
                ? <Check className="h-3.5 w-3.5 text-success" />
                : running && done.length === STEPS.findIndex((s) => s.step === step)
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <span className="h-3.5 w-3.5" />}
              {label}
            </li>
          ))}
        </ul>
      )}
      {status?.isDemo && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Copy setup from
          <select
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            disabled={running}
          >
            <option value="">Nobody (demo defaults)</option>
            {status.sources.map((t) => (
              <option key={t.tenantId} value={t.tenantId}>{t.displayName}</option>
            ))}
          </select>
        </label>
      )}
      <Button size="sm" variant="outline" onClick={run} disabled={running || !status?.isDemo}>
        {running ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
        Fill {status?.name || "demo account"} with demo data
      </Button>
    </div>
  );
}
