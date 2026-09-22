/** Client-safe constants for the Purchasing tab (kept out of the "use server"
 * actions module, which may only export async functions). */
export const PURCHASE_STATUSES = ["Ordered", "Received", "Partially Paid", "Paid", "Cancelled"] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
