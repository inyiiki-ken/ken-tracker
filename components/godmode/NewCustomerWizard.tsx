"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Copy, Download, PlugZap, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { verifyConnectionAndHeaders } from "@/lib/api";
import { saveTenant } from "@/lib/tenancy";
import { parseSheetId } from "@/lib/google-sheets/sheetId";

/**
 * Developer tool: turn a new customer's raw pieces (sheet link + robot key JSON)
 * into (1) a validated sheet, (2) a ready-to-use .env for building their
 * installer, and (3) a Control-sheet registration (multi-tenant only).
 */
export default function NewCustomerWizard({ multiTenant, onRegistered }: { multiTenant: boolean; onRegistered?: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [allowedEmails, setAllowedEmails] = useState("");
  const [sheetLink, setSheetLink] = useState("");
  const [robotJson, setRobotJson] = useState("");

  // Shared across every customer — remembered locally so you paste them once.
  const [nextauthSecret, setNextauthSecret] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");

  const [checking, setChecking] = useState(false);
  const [checkOk, setCheckOk] = useState<null | boolean>(null);
  const [checkMsg, setCheckMsg] = useState("");
  const [registering, setRegistering] = useState(false);
  const [envText, setEnvText] = useState("");

  const SHARED_KEY = "myk_shared_secrets";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHARED_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        setNextauthSecret(s.nextauthSecret || "");
        setOauthClientId(s.oauthClientId || "");
        setOauthClientSecret(s.oauthClientSecret || "");
      }
    } catch { /* ignore */ }
  }, []);

  const rememberShared = () => {
    try {
      localStorage.setItem(SHARED_KEY, JSON.stringify({ nextauthSecret, oauthClientId, oauthClientSecret }));
      toast.success("Shared keys saved on this PC for next time.");
    } catch { toast.error("Could not save."); }
  };

  function parseRobot(): { email: string; key: string } | null {
    const t = robotJson.trim();
    if (!t) return null;
    try {
      const j = JSON.parse(t);
      if (j.client_email && j.private_key) return { email: j.client_email, key: j.private_key };
    } catch { /* not JSON */ }
    return null;
  }

  const validate = async () => {
    if (!sheetLink.trim()) return toast.error("Paste the customer's sheet link first.");
    setChecking(true);
    setCheckOk(null);
    try {
      const res = await verifyConnectionAndHeaders({ sheetIdOrUrl: sheetLink });
      if (res.error) { setCheckOk(false); setCheckMsg(res.error); }
      else { setCheckOk(res.ok); setCheckMsg(res.ok ? `Connected to "${res.title}" — headers OK.` : `Connected, but some headers don't match. Run the full check for details.`); }
    } catch (err) {
      setCheckOk(false);
      setCheckMsg(err instanceof Error ? err.message : "Check failed");
    } finally {
      setChecking(false);
    }
  };

  const generateEnv = () => {
    const robot = parseRobot();
    if (!robot) return toast.error("Paste the robot's JSON key (the file you downloaded from Google Cloud).");
    if (!sheetLink.trim()) return toast.error("Paste the customer's sheet link.");
    if (!nextauthSecret || !oauthClientId || !oauthClientSecret) return toast.error("Fill the shared keys (NEXTAUTH_SECRET + OAuth).");
    const sheetId = parseSheetId(sheetLink);
    const keyOneLine = robot.key.replace(/\r?\n/g, "\\n");
    const env = [
      `# ${displayName || "Customer"} — desktop config (Profile A)`,
      `GOOGLE_SERVICE_ACCOUNT_EMAIL=${robot.email}`,
      `GOOGLE_PRIVATE_KEY="${keyOneLine}"`,
      `GOOGLE_SHEET_ID=${sheetId}`,
      `NEXTAUTH_SECRET=${nextauthSecret}`,
      `GOOGLE_OAUTH_CLIENT_ID=${oauthClientId}`,
      `GOOGLE_OAUTH_CLIENT_SECRET=${oauthClientSecret}`,
      "",
    ].join("\n");
    setEnvText(env);
    toast.success("Generated .env — copy it into desktop/.env before building this customer's installer.");
  };

  const copyEnv = async () => {
    try { await navigator.clipboard.writeText(envText); toast.success("Copied."); }
    catch { toast.error("Copy failed — select and copy manually."); }
  };

  const downloadEnv = () => {
    const blob = new Blob([envText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = ".env"; document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const register = async () => {
    if (!displayName.trim()) return toast.error("Business name is required.");
    if (!sheetLink.trim()) return toast.error("Sheet link is required.");
    // allowedEmails is optional now — staff listed in the customer's own Roles
    // tab can log in even if this is left blank.
    setRegistering(true);
    try {
      const res = await saveTenant({ displayName, allowedEmails, sheetIdOrUrl: sheetLink });
      toast.success(`Registered ${res.tenant.displayName} in the Control sheet.`);
      if (res.warning) toast.warning(res.warning);
      onRegistered?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Register failed");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <h2 className="font-cinzel text-sm text-primary flex items-center gap-2">
        <UserPlus className="h-4 w-4" /> New Customer
      </h2>
      <p className="text-xs text-muted-foreground">
        Paste the customer&apos;s sheet link and their robot key. This validates the
        sheet and builds the exact <code className="font-mono">.env</code> to drop into
        <code className="font-mono"> desktop/.env</code> before building their installer.
        (First make their sheet + robot in Google Cloud — see ONBOARDING.md.)
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">Business name</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="MYKabayan" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Allowed emails (optional — staff in the Roles tab can log in too)</Label>
          <Input value={allowedEmails} onChange={(e) => setAllowedEmails(e.target.value)} placeholder="owner@gmail.com, staff@gmail.com" className="text-sm" />
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Customer&apos;s Google Sheet link</Label>
        <div className="flex gap-2">
          <Input value={sheetLink} onChange={(e) => setSheetLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" className="text-sm font-mono" />
          <Button size="sm" variant="outline" onClick={validate} disabled={checking}>
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {checkOk !== null && (
          <p className={`text-[11px] mt-1 flex items-center gap-1 ${checkOk ? "text-success" : "text-warning"}`}>
            {checkOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} {checkMsg}
          </p>
        )}
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Robot key (paste the service-account JSON you downloaded)</Label>
        <Textarea value={robotJson} onChange={(e) => setRobotJson(e.target.value)} rows={3} className="text-xs font-mono" placeholder='{ "client_email": "...", "private_key": "-----BEGIN..." }' />
      </div>

      {/* Shared keys */}
      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs text-muted-foreground">Shared keys (same for every customer — saved on this PC once):</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input value={nextauthSecret} onChange={(e) => setNextauthSecret(e.target.value)} placeholder="NEXTAUTH_SECRET" className="text-xs font-mono" />
          <Input value={oauthClientId} onChange={(e) => setOauthClientId(e.target.value)} placeholder="OAUTH_CLIENT_ID" className="text-xs font-mono" />
          <Input value={oauthClientSecret} onChange={(e) => setOauthClientSecret(e.target.value)} placeholder="OAUTH_CLIENT_SECRET" className="text-xs font-mono" />
        </div>
        <Button size="sm" variant="ghost" className="text-xs" onClick={rememberShared}>Remember these</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={generateEnv}>Generate .env</Button>
        {multiTenant && (
          <Button size="sm" variant="outline" onClick={register} disabled={registering}>
            {registering ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null} Register in Control sheet
          </Button>
        )}
      </div>

      {envText && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Generated .env</Label>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copyEnv}><Copy className="h-3.5 w-3.5 mr-1" /> Copy</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={downloadEnv}><Download className="h-3.5 w-3.5 mr-1" /> Download</Button>
            </div>
          </div>
          <Textarea readOnly value={envText} rows={7} className="text-[11px] font-mono" />
          <p className="text-[11px] text-muted-foreground">
            Save this as <code className="font-mono">desktop/.env</code> in the project, then run
            <code className="font-mono"> npm run dist:win</code> — the installer will contain this customer&apos;s config.
          </p>
        </div>
      )}
    </div>
  );
}
