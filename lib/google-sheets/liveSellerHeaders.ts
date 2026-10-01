/**
 * Column headers of the Live Sellers tabs (Live_Sessions / Live_Items /
 * Live_Stock). Shared by the Live Sellers actions and the demo workspace seed,
 * so both always write the same columns.
 */

export const SESSION_H = {
  id: "Session ID",
  date: "Date",
  seller: "Seller",
  weightOut: "Weight Out (g)",
  weightBack: "Weight Back (g)",
  status: "Status",
  notes: "Notes",
  outLog: "Out Log",
  updatedBy: "Updated By",
  updatedAt: "Updated At",
} as const;

export const ITEM_H = {
  id: "Item ID",
  sessionId: "Session ID",
  seller: "Seller",
  liveDate: "Live Date",
  description: "Description",
  type: "Type",
  grams: "Grams",
  rate: "Rate",
  amount: "Amount",
  status: "Status",
  pulloutDate: "Pullout Date",
  paidAmount: "Paid Amount",
  invoiceNo: "Invoice No",
  cancelledDate: "Cancelled Date",
  notes: "Notes",
  recordKey: "Record Key",
  customer: "Customer",
  updatedBy: "Updated By",
  updatedAt: "Updated At",
} as const;

export const STOCK_H = {
  id: "Entry ID",
  date: "Date",
  grams: "Grams",
  pcs: "Pcs",
  description: "Description",
  note: "Note",
  addedBy: "Added By",
  deleted: "Deleted",
} as const;

export const LIVE_TABS = { sessions: "Live_Sessions", items: "Live_Items", stock: "Live_Stock" } as const;
