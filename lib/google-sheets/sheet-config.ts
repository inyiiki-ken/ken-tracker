/**
 * These header names are copied EXACTLY (character-for-character) from row 1
 * of your real Demo_Excel_for_Zite_-_Database.csv export -- not guessed.
 * Field key (left) -> DatabaseRowType property, matching src/types/index.ts
 * from your Zite export exactly.
 */

export const SHEET_ID = "1IrlqSb0HHoL5WEAk1DRog0ca88CyYRu_LWLbR-soHu4"; // your demo sheet

export const SHEET_TABS = {
  database: { title: "Database", gid: 0 },
  uploads: { title: "Uploads", gid: 174369801 },
  roles: { title: "Roles", gid: 1861377706 },
  // App-owned settings tab (branding, pricing, tabs, logos, etc.). Auto-created
  // with guaranteed columns so it works on any customer sheet regardless of how
  // their Uploads tab is structured. gid is a sentinel that won't match a real tab.
  config: { title: "Ken_Config", gid: -1 },
} as const;

/** Older name of the config tab, renamed in place on first access so existing
 * customer settings aren't lost. Kept brand-neutral so customers don't assume
 * another customer (MYK) is the builder. */
export const LEGACY_CONFIG_TITLES = ["MYK_Config"] as const;

/** DatabaseRowType key -> real header text, in real column order (A through AM). */
export const DATABASE_HEADERS: Record<string, string> = {
  orderId: "Order ID",
  dateOfLive: "Date of Live",
  page: "Page",
  liverName: "Liver NAME",
  locationOfMiner: "Location of Miner",
  minerName: "Miner Name",
  itemDescription: "Item Description",
  grams: "Grams",
  source: "Source",
  category: "Category",
  mc: "MC",
  goldRate: "Gold rate",
  supplierRate: "supplier rate",
  clientRate: "client rate",
  profit: "PROFIT",
  modeOfSale: "mode of sale",
  status: "status",
  modeOfPayment: "mode of payment",
  downpayment: "downpayment",
  la1MonthPayment: "la 1 month payment",
  la2MonthPayment: "la 2 month payment",
  la3MonthPayment: "la 3 month payment",
  la4MonthPayment: "la 4 month payment",
  liverAdminRemarks: "Liver/Admin Remarks",
  dispatchDate: "Dispatch Date",
  deliveredDate: "Delivered Date",
  reviewChasing: "Review Chasing",
  fbProfileName: "FB Profile Name",
  regions: "Regions",
  remittanceStatus: "Remittance Status",
  currency: "Currency",
  additionalCharges: "Additional Charges",
  amountReceived: "Amount Received",
  freeSf: "Free SF",
  auditTrail: "Audit Trail",
  tog: "T.O.G",
  invoiceNumber: "INVOICE #",
  qty: "QTY",
  customerId: "Customer id",
  // New columns — add these two headers to the Database tab (after "Customer id").
  clientAddress: "Client Address",
  clientNumber: "Client Number",
  /** Stable identity for a row, independent of its POSITION in the sheet.
   * Without this, sorting/inserting/deleting rows in Google Sheets makes the
   * app write to the wrong record. Auto-filled on create/import; backfill
   * existing rows from God Mode. */
  rowKey: "Row Key",
  /** Zoho Invoice link-back. "ZOHO Invoice" already exists in AR's sheet;
   * "Zoho Contact ID" is what stops duplicate customers being created there. */
  zohoInvoice: "ZOHO Invoice",
  zohoContactId: "Zoho Contact ID",
};

/**
 * Alternate header names some customers use for the same field. The app reads
 * from whichever exists and writes back to whichever the sheet actually has, so
 * one codebase serves sheets with slightly different column names.
 * e.g. AR Universal uses "Cost"/"Address"/"Number" instead of
 * "supplier rate"/"Client Address"/"Client Number".
 */
export const DATABASE_HEADER_ALIASES: Partial<Record<string, string[]>> = {
  supplierRate: ["Cost", "cost"],
  clientAddress: ["Address"],
  clientNumber: ["Number", "Contact", "Phone"],
  reviewChasing: ["Review Chasing"],
};

/**
 * NOTE: pureWeight exists on DatabaseRowType (src/types/index.ts) but has NO
 * matching column in your real CSV headers -- it may be unused/legacy, or
 * only appear on a sheet variant you haven't shown me. Left out of
 * DATABASE_HEADERS for now since mapping it would be a guess; tell me if you
 * spot a "Pure Weight" column somewhere and I'll wire it back in.
 *
 * "id" (DatabaseRowType.id) has no sheet column either -- in the original
 * Zite app it was an internal row ID assigned by their SDK. We derive it
 * ourselves from the actual spreadsheet row number instead (see
 * row-mapper.ts), which serves the exact same purpose (a stable per-row key
 * for updates).
 */

/**
 * CAVEAT: unlike DATABASE_HEADERS above (confirmed from your real CSV
 * export), these Uploads/Roles headers are a guess. zite.lock only gave me
 * the internal field KEYS (staffUploader, masterlistFile, status / email,
 * role, whatsappNumber) -- not the literal header text typed into row 1 of
 * those tabs. Going by the same "Title Case" convention as your Database
 * tab. Export those two tabs as CSV the same way and I'll correct these.
 */
export const UPLOADS_HEADERS: Record<string, string> = {
  staffUploader: "Staff/Uploader",
  masterlistFile: "Masterlist File",
  status: "Status",
};

/**
 * Confirmed from your real Roles sheet screenshot: headers are lowercase
 * "email" / "role" (not Title Case like I'd guessed earlier -- that guess
 * was the actual bug behind the false "Access Denied").
 */
export const ROLES_HEADERS: Record<string, string> = {
  email: "email",
  role: "role",
  name: "name", // display / liver name — used to lock "My Sales" to the user's own name
  whatsappNumber: "whatsapp", // optional; only present on some sheets
};
