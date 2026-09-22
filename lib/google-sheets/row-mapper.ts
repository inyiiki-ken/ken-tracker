import type { GoogleSpreadsheetRow } from "google-spreadsheet";
import type { DatabaseRowType } from "@/types";
import { DATABASE_HEADERS, DATABASE_HEADER_ALIASES } from "./sheet-config";

/**
 * IMPORTANT: unlike my first pass, this does NOT aggressively coerce most
 * fields to number/boolean. The real DatabaseRowType (src/types/index.ts)
 * only requires 4 fields to be true numbers -- everything else (mc,
 * supplierRate, profit, downpayment, la1-4MonthPayment, amountReceived,
 * freeSf, etc.) is typed as string | (number|string), because
 * lib/calculations.ts does its own parsing at calc time (parseNum, the
 * CHARGE:/PROMO: prefixed formats, etc.). Pre-converting those here would
 * silently break that parsing (e.g. freeSf can be "TRUE", "", or
 * "PROMO:AED:25" -- not a boolean).
 */

function toNumber(v: unknown): number {
  if (v === "" || v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function aliasesFor(key: string, extra?: Record<string, string[]>): string[] {
  return [...(DATABASE_HEADER_ALIASES[key] ?? []), ...(extra?.[key] ?? [])];
}

export function rowToDatabaseRecord(
  row: GoogleSpreadsheetRow,
  extraAliases?: Record<string, string[]>
): DatabaseRowType {
  // Read the primary header; if empty/missing, fall back to alternate names
  // (built-in + this tenant's configured aliases).
  const get = (key: string) => {
    const primary = row.get(DATABASE_HEADERS[key]);
    if (primary !== undefined && primary !== "") return primary;
    for (const alt of aliasesFor(key, extraAliases)) {
      const v = row.get(alt);
      if (v !== undefined && v !== "") return v;
    }
    return primary;
  };

  return {
    id: row.rowNumber, // stable per-row key, replaces the Zite SDK's internal id
    orderId: get("orderId") ?? "",
    dateOfLive: get("dateOfLive") ?? "",
    page: get("page") ?? "",
    liverName: get("liverName") ?? "",
    locationOfMiner: get("locationOfMiner") ?? "",
    minerName: get("minerName") ?? "",
    itemDescription: get("itemDescription") ?? "",
    grams: toNumber(get("grams")),
    source: get("source") ?? "",
    category: get("category") ?? "",
    mc: get("mc") ?? "",
    goldRate: toNumber(get("goldRate")),
    supplierRate: get("supplierRate") ?? "",
    clientRate: toNumber(get("clientRate")),
    profit: get("profit") ?? "",
    modeOfSale: get("modeOfSale") ?? "",
    status: get("status") ?? "",
    modeOfPayment: get("modeOfPayment") ?? "",
    downpayment: get("downpayment") ?? "",
    la1MonthPayment: get("la1MonthPayment") ?? "",
    la2MonthPayment: get("la2MonthPayment") ?? "",
    la3MonthPayment: get("la3MonthPayment") ?? "",
    la4MonthPayment: get("la4MonthPayment") ?? "",
    liverAdminRemarks: get("liverAdminRemarks") ?? "",
    dispatchDate: get("dispatchDate") ?? "",
    deliveredDate: get("deliveredDate") ?? "",
    reviewChasing: get("reviewChasing") ?? "",
    fbProfileName: get("fbProfileName") ?? "",
    regions: get("regions") ?? "",
    remittanceStatus: get("remittanceStatus") ?? "",
    currency: get("currency") ?? "",
    additionalCharges: get("additionalCharges") ?? "",
    amountReceived: get("amountReceived") ?? "",
    freeSf: get("freeSf") ?? "",
    auditTrail: get("auditTrail") ?? "",
    tog: get("tog") ?? "",
    qty: toNumber(get("qty")) || 1,
    customerId: get("customerId") ?? "",
    invoiceNumber: get("invoiceNumber") ?? "",
    clientAddress: get("clientAddress") ?? "",
    clientNumber: get("clientNumber") ?? "",
    // Position-independent row identity + Zoho links. These MUST be mapped:
    // without them the row-key write targeting and the duplicate-invoice guard
    // silently fall back to unsafe behaviour.
    rowKey: get("rowKey") ?? "",
    zohoInvoice: get("zohoInvoice") ?? "",
    zohoContactId: get("zohoContactId") ?? "",
  };
}

/** Converts a (partial) typed record back into the string map google-spreadsheet
 * expects for row.set() / worksheet.addRow(). `id` is never written back --
 * it's derived from the row position, not a stored field. */
export function databaseRecordToRow(
  record: Partial<DatabaseRowType>,
  availableHeaders?: Set<string>,
  extraAliases?: Record<string, string[]>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(record) as (keyof DatabaseRowType)[]) {
    if (key === "id") continue;
    let header = DATABASE_HEADERS[key];
    if (!header) continue;
    // If the sheet doesn't have the primary column but does have an alternate
    // (e.g. AR uses "Cost"/"Address"/"Number"), write to the one that exists.
    if (availableHeaders && !availableHeaders.has(header)) {
      const alt = aliasesFor(key, extraAliases).find((a) => availableHeaders.has(a));
      if (alt) header = alt;
    }
    const value = record[key];
    out[header] = value === undefined || value === null ? "" : String(value);
  }
  return out;
}
