import "server-only";
import { JWT } from "google-auth-library";
import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from "google-spreadsheet";
import { SHEET_ID, SHEET_TABS } from "./sheet-config";

/**
 * Server-only Google Sheets client. Never import this from a "use client"
 * component -- it reads the service account private key from env vars and
 * will throw if bundled into client JS.
 *
 * Required env vars (see .env.example):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY        (with literal \n escaped, or base64 -- see below)
 *   GOOGLE_SHEET_ID           (defaults to sheet-config.ts SHEET_ID if unset)
 */

let cachedDoc: GoogleSpreadsheet | null = null;

function getPrivateKey(): string {
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (!raw) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY is not set. Copy .env.example to .env.local and fill in your service account credentials."
    );
  }
  // Most hosts (Vercel included) require literal newlines to be escaped as \n
  // in the env var; google-auth-library needs the real newline characters.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function getAuth(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!email) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is not set.");
  }
  return new JWT({
    email,
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/**
 * Returns a loaded, cached GoogleSpreadsheet instance. Safe to call
 * repeatedly from server actions / route handlers within the same server
 * runtime -- it will only hit the Sheets API for doc metadata once.
 */
export async function getSpreadsheet(): Promise<GoogleSpreadsheet> {
  if (cachedDoc) return cachedDoc;

  const sheetId = process.env.GOOGLE_SHEET_ID || SHEET_ID;
  const doc = new GoogleSpreadsheet(sheetId, getAuth());
  await doc.loadInfo();
  cachedDoc = doc;
  return doc;
}

/**
 * Returns a loaded GoogleSpreadsheet for an ARBITRARY sheet id, cached per id.
 * This is the multi-tenant entry point: each customer has their own sheet, so
 * data access is keyed on the tenant's sheetId rather than a single env var.
 * The service account must be shared (Editor) on the target sheet.
 */
const docCacheById = new Map<string, GoogleSpreadsheet>();

export async function getSpreadsheetById(sheetId: string): Promise<GoogleSpreadsheet> {
  const id = sheetId.trim();
  if (!id) throw new Error("Sheet id is empty.");
  const cached = docCacheById.get(id);
  if (cached) return cached;

  const doc = new GoogleSpreadsheet(id, getAuth());
  await doc.loadInfo();
  docCacheById.set(id, doc);
  return doc;
}

/** Fetch a specific tab by its stable gid (preferred over title -- titles can
 * be renamed, gids can't). Falls back to title lookup if the gid isn't found. */
export async function getWorksheet(
  tab: keyof typeof SHEET_TABS
): Promise<GoogleSpreadsheetWorksheet> {
  const doc = await getSpreadsheet();
  const { gid, title } = SHEET_TABS[tab];

  const byGid = doc.sheetsById[gid];
  if (byGid) return byGid;

  const byTitle = doc.sheetsByTitle[title];
  if (byTitle) return byTitle;

  throw new Error(
    `Could not find worksheet "${title}" (gid ${gid}) in spreadsheet ${doc.spreadsheetId}. ` +
      `Check that the sheet still exists and the service account has access.`
  );
}

/** Call this once after deploy to verify credentials + sheet access are wired
 * up correctly. Throws with a descriptive message on failure. */
export async function verifyConnection(): Promise<{ title: string; sheetCount: number }> {
  const doc = await getSpreadsheet();
  return { title: doc.title, sheetCount: doc.sheetCount };
}
