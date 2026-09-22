import "server-only";
import { getActiveWorksheet, getActiveRows, invalidateActiveRows } from "./tenant-context";
import { UPLOADS_HEADERS as H } from "./sheet-config";

/**
 * Per-tenant app settings storage. Writes go to the app-owned "Ken_Config" tab
 * (auto-created with guaranteed columns; a legacy "MYK_Config" tab is renamed in
 * place on first access so existing settings carry over). Reads prefer that tab
 * but fall back to the legacy "Uploads" markers, so customers who already have settings there
 * (e.g. MYK) keep them until re-saved. Uses the same marker layout: the
 * "Status" column holds the marker key, "Masterlist File" holds the value.
 */

const MARKER = H.status;
const VALUE = H.masterlistFile;

/** Read a single marker's value (config tab first, then legacy uploads). */
export async function readConfig(marker: string): Promise<string> {
  try {
    const cfg = await getActiveRows("config");
    const c = cfg.find((r) => r.get(MARKER) === marker);
    const v = c?.get(VALUE);
    if (v) return String(v);
  } catch { /* fall through to legacy */ }
  try {
    const up = await getActiveRows("uploads");
    const u = up.find((r) => r.get(MARKER) === marker);
    return u?.get(VALUE) ? String(u.get(VALUE)) : "";
  } catch {
    return "";
  }
}

/** Create/update a single marker's value in the config tab. */
export async function writeConfig(marker: string, value: string): Promise<void> {
  const sheet = await getActiveWorksheet("config");
  const rows = await sheet.getRows();
  const r = rows.find((row) => row.get(MARKER) === marker);
  if (r) {
    r.set(VALUE, value);
    await r.save();
  } else {
    await sheet.addRow({ [MARKER]: marker, [VALUE]: value, [H.staffUploader]: "SYSTEM" });
  }
  invalidateActiveRows();
}

/** All markers whose key starts with a prefix (config + legacy, deduped). */
export async function readConfigByPrefix(prefix: string): Promise<{ marker: string; value: string }[]> {
  const out = new Map<string, string>();
  try {
    const up = await getActiveRows("uploads");
    for (const r of up) {
      const s = String(r.get(MARKER) ?? "");
      if (s.startsWith(prefix)) out.set(s, String(r.get(VALUE) ?? ""));
    }
  } catch { /* ignore */ }
  try {
    const cfg = await getActiveRows("config");
    for (const r of cfg) {
      const s = String(r.get(MARKER) ?? "");
      if (s.startsWith(prefix)) out.set(s, String(r.get(VALUE) ?? "")); // config overrides legacy
    }
  } catch { /* ignore */ }
  return [...out.entries()].map(([marker, value]) => ({ marker, value })).filter((x) => x.value);
}

/** Delete every row with the exact marker (config tab). */
export async function deleteConfigMarker(marker: string): Promise<void> {
  const sheet = await getActiveWorksheet("config");
  const rows = await sheet.getRows();
  const targets = rows.filter((r) => r.get(MARKER) === marker).sort((a, b) => b.rowNumber - a.rowNumber);
  for (const r of targets) await r.delete();
  invalidateActiveRows();
}

// ── Chunked values (large blobs like the masterlist template) ─────────────────

/** Reassemble a chunked value stored as "<prefix><index>" markers. */
export async function readConfigChunks(prefix: string): Promise<string> {
  const parts = await readConfigByPrefix(prefix);
  if (!parts.length) return "";
  return parts
    .map((p) => ({ i: parseInt(p.marker.slice(prefix.length), 10), v: p.value }))
    .filter((p) => !Number.isNaN(p.i))
    .sort((a, b) => a.i - b.i)
    .map((p) => p.v)
    .join("");
}

/** Replace a chunked value (deletes old chunks, writes new ones). */
export async function writeConfigChunks(prefix: string, data: string, chunkSize = 40000): Promise<void> {
  const sheet = await getActiveWorksheet("config");
  const rows = await sheet.getRows();
  const old = rows
    .filter((r) => String(r.get(MARKER) ?? "").startsWith(prefix))
    .sort((a, b) => b.rowNumber - a.rowNumber);
  for (const r of old) await r.delete();
  const total = Math.ceil((data || "").length / chunkSize);
  for (let i = 0; i < total; i++) {
    await sheet.addRow({
      [MARKER]: prefix + i,
      [VALUE]: data.slice(i * chunkSize, (i + 1) * chunkSize),
      [H.staffUploader]: "SYSTEM",
    });
  }
  invalidateActiveRows();
}

export async function clearConfigChunks(prefix: string): Promise<void> {
  const sheet = await getActiveWorksheet("config");
  const rows = await sheet.getRows();
  const old = rows
    .filter((r) => String(r.get(MARKER) ?? "").startsWith(prefix))
    .sort((a, b) => b.rowNumber - a.rowNumber);
  for (const r of old) await r.delete();
  invalidateActiveRows();
}
