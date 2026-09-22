"use client";

import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyConnectionAndHeaders, type ConnectionCheckResult } from "@/lib/api";

/**
 * Super-admin diagnostic: confirms the service account can reach the sheet and
 * that row-1 headers match what the app writes by. Because writes are keyed on
 * header TEXT, drift here silently corrupts data -- this makes it visible.
 */
export default function ConnectionCheck() {
  const [result, setResult] = useState<ConnectionCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheetInput, setSheetInput] = useState("");

  const run = async () => {
    setLoading(true);
    try {
      const trimmed = sheetInput.trim();
      setResult(await verifyConnectionAndHeaders(trimmed ? { sheetIdOrUrl: trimmed } : undefined));
    } catch (err) {
      setResult({
        ok: false,
        title: "",
        sheetCount: 0,
        tabs: [],
        error: err instanceof Error ? err.message : "Check failed",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <PlugZap className="h-4 w-4" /> Sheet Connection &amp; Headers
      </h2>
      <p className="text-xs text-muted-foreground">
        Verifies a Google Sheet is reachable and that each tab&apos;s row-1 headers
        match what the app reads and writes. Leave the box empty to check this
        account&apos;s own sheet, or paste any customer&apos;s sheet link/ID to test it
        before onboarding them.
      </p>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Sheet link or ID (optional)</Label>
        <Input
          value={sheetInput}
          onChange={(e) => setSheetInput(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/…  — or leave blank"
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          The service account must be shared as Editor on the target sheet, or the check will fail.
        </p>
      </div>

      <Button size="sm" variant="outline" onClick={run} disabled={loading}>
        {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlugZap className="h-4 w-4 mr-2" />}
        Run check
      </Button>

      {result && (
        <div className="space-y-3 text-sm">
          {result.error ? (
            <div className="flex items-start gap-2 text-destructive">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Could not connect: {result.error}</span>
            </div>
          ) : (
            <>
              <div
                className={`flex items-center gap-2 font-medium ${
                  result.ok ? "text-success dark:text-success" : "text-warning dark:text-warning"
                }`}
              >
                {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {result.ok
                  ? `Connected to "${result.title}" — all headers match.`
                  : `Connected to "${result.title}" — header mismatches found.`}
              </div>

              <div className="space-y-2">
                {result.tabs.map((t) => {
                  const clean = t.found && t.missing.length === 0;
                  return (
                    <div key={t.tab} className="rounded-md border border-border p-2.5">
                      <div className="flex items-center gap-2">
                        {clean ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                        )}
                        <span className="font-medium capitalize">{t.tab}</span>
                        {!t.found && <span className="text-destructive text-xs">tab not found</span>}
                      </div>
                      {t.missing.length > 0 && (
                        <p className="text-xs text-warning dark:text-warning mt-1">
                          Missing header(s): {t.missing.join(", ")}
                        </p>
                      )}
                      {t.extra.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Extra column(s) the app ignores: {t.extra.join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
