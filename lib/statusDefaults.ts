/** Built-in status lists (no imports, so any module can use them). */

/** Comprehensive default lifecycle, in a sensible order. */
export const DEFAULT_STATUSES: string[] = [
  "Pending",
  "Waiting for Details",
  "Waiting for Downpayment",
  "Paid/DP but Item Hold",
  "Payment for Verification",
  "Pending for Tabby",
  "Pending for Tamara",
  "For Pullout",
  "Dispatched",
  "Picked Up",
  "Given to Shop",
  "Delivered",
  "Reseller",
  "Returned Item",
  "Walk-in",
  "In-Store",
  "Cancelled",
];

/** Admin / intake team: order-taking + payment phase (NOT courier/delivery). */
export const DEFAULT_ADMIN_STATUSES: string[] = [
  "Pending",
  "Waiting for Details",
  "Waiting for Downpayment",
  "Paid/DP but Item Hold",
  "Payment for Verification",
  "Pending for Tabby",
  "Pending for Tamara",
  "For Pullout",
  "Reseller",
  "Cancelled",
];

/** Accounts team: payment verification + holds, plus a few fulfillment states. */
export const DEFAULT_ACCOUNTS_STATUSES: string[] = [
  "Payment for Verification",
  "Paid/DP but Item Hold",
  "Waiting for Downpayment",
  "Pending for Tabby",
  "Pending for Tamara",
  "Dispatched",
  "Delivered",
  "Given to Shop",
  "Cancelled",
];

/** Dispatch team: fulfillment phase — couriers (from data) are added on top. */
export const DEFAULT_DISPATCH_STATUSES: string[] = [
  "For Pullout",
  "Dispatched",
  "Picked Up",
  "Given to Shop",
  "Delivered",
  "Returned Item",
  "Paid/DP but Item Hold",
  "Payment for Verification",
  "Cancelled",
];
