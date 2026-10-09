/**
 * DEMO WORKSPACE CONTENT.
 *
 * Everything here is made up: names, phone numbers (+971 50 555 01xx is not a
 * real range), addresses, pages, sellers and suppliers. Nothing is copied from
 * a real customer sheet, so a demo account can be shown to prospects safely.
 *
 * The data is generated relative to "today" so the demo always looks current
 * (recent lives, overdue reminders, this month's reports), and it is
 * deterministic for a given day so re-running the seed gives the same demo.
 *
 * Pure module (no server or browser imports): the God Mode seed action uses it
 * to fill a demo tenant's own sheet.
 */

import type { DatabaseRowType } from "@/types";

/** A tenant counts as a demo account when its name, plan or notes say "demo". */
export function isDemoTenant(t: { displayName?: string; plan?: string; notes?: string } | null | undefined): boolean {
  if (!t) return false;
  return /\bdemo\b/i.test(`${t.displayName ?? ""} ${t.plan ?? ""} ${t.notes ?? ""}`);
}

// ── Small deterministic random helper ─────────────────────────────────────────

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDay(base: Date, daysAgo: number): string {
  const d = new Date(base.getTime() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function isoStamp(base: Date, daysAgo: number, hour = 14): string {
  const d = new Date(base.getTime() - daysAgo * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Same shape as the app's invoice numbers: MMDDYY-YYYYMMDD-row. */
function invoiceNo(dateOfLive: string, rowNumber: number): string {
  const [y, m, d] = dateOfLive.split("-");
  return `${m}${d}${y.slice(2)}-${y}${m}${d}-${rowNumber}`;
}

// ── Fictional cast ────────────────────────────────────────────────────────────

export const DEMO_LIVERS = ["BELLA", "MIKA", "JOJO", "ANDIE"];
export const DEMO_PAGES = ["Golden Hour Live", "Kislap Jewels", "Sunday Sparkle"];
export const DEMO_OUTSOURCE = ["Sunrise Gold Trading", "Pearl Line Atelier"];
export const DEMO_SUPPLIERS = ["Sunrise Gold Trading", "Pearl Line Atelier", "Golden Leaf Wholesale"];

interface DemoCustomer {
  name: string;
  fb: string;
  phone: string;
  address: string;
  region: string;
  location: "Local" | "Pinas" | "International";
}

const FIRST = [
  "Liza", "Marites", "Joanna", "Carmela", "Rowena", "Analie", "Dina", "Kristine", "Mylene", "Shiela",
  "Precious", "Jhen", "Rachelle", "Arlene", "Glaiza", "Nerissa", "Lovely", "Charmaine", "Divina", "Hazel",
  "Maricel", "Tess", "Bambi", "Yvette", "Cora", "Leah", "Joy", "Noemi",
];
const LAST = [
  "Dela Paz", "Santiago", "Villareal", "Manalo", "Bautista", "Cabrera", "Lumbao", "Ortega", "Salonga", "Tolentino",
  "Navarro", "Pascual", "Quiambao", "Rosales", "Gatchalian", "Mendoza", "Abalos", "Fajardo", "Dimaculangan", "Esguerra",
  "Lacson", "Buenaventura", "Ilagan", "Carandang", "Panganiban", "Ramirez", "Soriano", "Vergara",
];
const UAE_AREAS: { area: string; region: string }[] = [
  { area: "Al Barsha 1, Dubai", region: "Dubai" },
  { area: "International City, Dubai", region: "Dubai" },
  { area: "Deira, Dubai", region: "Dubai" },
  { area: "Al Nahda 2, Dubai", region: "Dubai" },
  { area: "Al Taawun, Sharjah", region: "Sharjah" },
  { area: "Al Nuaimiya, Ajman", region: "Ajman" },
  { area: "Mussafah, Abu Dhabi", region: "Abu Dhabi" },
  { area: "Al Jimi, Al Ain", region: "Al Ain" },
];
const BUILDINGS = ["Palm Breeze Tower", "Silver Sands Residence", "Orchid Court", "Blue Lagoon Bldg", "Maple Heights", "Coral Garden Villas"];
const PH_PLACES = ["Brgy. San Isidro, Batangas City", "Brgy. Poblacion, Tarlac City", "Brgy. Malinta, Valenzuela", "Brgy. Lahug, Cebu City"];

function buildCustomers(): DemoCustomer[] {
  const out: DemoCustomer[] = [];
  for (let i = 0; i < FIRST.length; i++) {
    const name = `${FIRST[i]} ${LAST[i]}`.toUpperCase();
    const phone = `+971 50 555 01${String(10 + i).padStart(2, "0")}`;
    const fb = `${FIRST[i]} ${LAST[(i + 7) % LAST.length]}`;
    if (i % 7 === 3) {
      out.push({
        name, fb,
        phone: `+63 917 555 0${String(100 + i)}`,
        address: `${10 + i} Mabini St., ${PH_PLACES[i % PH_PLACES.length]}, Philippines`,
        region: "Pinas",
        location: "Pinas",
      });
    } else if (i % 11 === 5) {
      out.push({
        name, fb,
        phone: `+974 5555 0${String(100 + i)}`,
        address: `Apt ${i + 3}, Al Sadd Street, Doha, Qatar`,
        region: "International",
        location: "International",
      });
    } else {
      const a = UAE_AREAS[i % UAE_AREAS.length];
      out.push({
        name, fb, phone,
        address: `Flat ${100 + i * 7}, ${BUILDINGS[i % BUILDINGS.length]}, ${a.area}`,
        region: a.region,
        location: "Local",
      });
    }
  }
  return out;
}

// ── Catalogue ─────────────────────────────────────────────────────────────────

interface Piece { desc: string; tog: string; category: string; grams: [number, number]; perPc?: number }

const PIECES: Piece[] = [
  { desc: "18K GOLD FIGARO CHAIN", tog: "18K", category: "Gold Normal", grams: [4, 12] },
  { desc: "18K GOLD HOOP EARRINGS", tog: "18K", category: "Gold Normal", grams: [1.2, 3.5] },
  { desc: "18K GOLD CUBAN BRACELET", tog: "18K", category: "Gold Normal", grams: [5, 15] },
  { desc: "18K GOLD HEART PENDANT", tog: "18K", category: "Special Price", grams: [0.8, 2.2] },
  { desc: "18K GOLD ROPE CHAIN", tog: "18K", category: "Special Price", grams: [3, 9] },
  { desc: "18K GOLD BANGLE", tog: "18K", category: "Special Price EF", grams: [6, 14] },
  { desc: "21K GOLD BABY RING", tog: "21K", category: "Gold Normal", grams: [0.9, 1.8] },
  { desc: "18K GOLD BUTTERFLY NECKLACE", tog: "18K", category: "Special Price", grams: [1.8, 4] },
  { desc: "S-925 TENNIS BRACELET", tog: "S-925", category: "Silver Branded", grams: [8, 16] },
  { desc: "S-925 CLOVER NECKLACE", tog: "S-925", category: "Silver Normal", grams: [4, 9] },
  { desc: "18K GOLD STUD EARRINGS (PER PC)", tog: "18K", category: "Per PC", grams: [0.5, 0.9], perPc: 350 },
];

/** Gold base rate (AED/g) and the making charge / selling rate per category. */
const GOLD_BASE = 372;
const MC: Record<string, number> = { "Gold Normal": 25, "Special Price": 30, "Special Price EF": 35 };
const SELL: Record<string, number> = { "Gold Normal": 409, "Special Price": 414, "Special Price EF": 439 };

// ── Orders ────────────────────────────────────────────────────────────────────

type Plan = {
  status: string;
  /** How many days ago the live was. */
  liveAgo: [number, number];
  paid: "none" | "dp" | "full" | "layaway";
  dispatchAgo?: number;
  deliveredAgo?: number;
  mop?: string;
  invoice?: boolean;
  outsource?: boolean;
  review?: string;
};

/** One entry per customer (customers repeat further down, so some are repeat buyers). */
const PLANS: Plan[] = [
  // Admin intake
  { status: "Pending", liveAgo: [0, 1], paid: "none" },
  { status: "Waiting for Details", liveAgo: [1, 2], paid: "none" },
  { status: "Waiting for Downpayment", liveAgo: [2, 4], paid: "none" },
  { status: "Waiting for Downpayment", liveAgo: [5, 9], paid: "none" },
  { status: "Payment for Verification", liveAgo: [1, 3], paid: "dp", mop: "Bank Transfer" },
  // Boxes
  { status: "For International Shipment", liveAgo: [3, 6], paid: "full", mop: "Bank Transfer PHP", invoice: true },
  { status: "For International Shipment", liveAgo: [6, 10], paid: "dp", mop: "International" },
  { status: "For COD", liveAgo: [1, 3], paid: "dp", mop: "COD", invoice: true },
  { status: "For COD", liveAgo: [2, 5], paid: "dp", mop: "COD" },
  { status: "For COD", liveAgo: [4, 7], paid: "none", mop: "COD" },
  { status: "For Pick Up", liveAgo: [2, 4], paid: "full", mop: "Pick Up Shop", invoice: true },
  { status: "For Pick Up", liveAgo: [3, 8], paid: "dp", mop: "Meet Up" },
  { status: "Outsource", liveAgo: [2, 6], paid: "dp", mop: "Bank Transfer", outsource: true },
  { status: "Outsource", liveAgo: [4, 9], paid: "full", mop: "COD", outsource: true },
  { status: "Layaway", liveAgo: [20, 40], paid: "layaway", mop: "Bank Transfer" },
  // Out of the door
  { status: "Dispatched", liveAgo: [3, 5], paid: "dp", mop: "COD", dispatchAgo: 1, invoice: true },
  { status: "Dispatched", liveAgo: [5, 8], paid: "full", mop: "Bank Transfer", dispatchAgo: 2, invoice: true },
  { status: "Dispatched", liveAgo: [8, 12], paid: "dp", mop: "COD", dispatchAgo: 5, invoice: true },
  { status: "Delivered", liveAgo: [6, 10], paid: "full", mop: "COD", dispatchAgo: 4, deliveredAgo: 3, invoice: true, review: "Pending" },
  { status: "Delivered", liveAgo: [10, 15], paid: "full", mop: "Tabby", dispatchAgo: 9, deliveredAgo: 8, invoice: true, review: "Chased" },
  { status: "Delivered", liveAgo: [14, 20], paid: "full", mop: "Credit Card", dispatchAgo: 12, deliveredAgo: 11, invoice: true, review: "Completed" },
  { status: "Delivered", liveAgo: [18, 25], paid: "full", mop: "Cash", dispatchAgo: 17, deliveredAgo: 16, invoice: true, review: "Completed" },
  { status: "Delivered", liveAgo: [25, 35], paid: "full", mop: "GCash", dispatchAgo: 24, deliveredAgo: 22, invoice: true, review: "Skipped" },
  { status: "Delivered", liveAgo: [30, 45], paid: "full", mop: "Bank Transfer", dispatchAgo: 29, deliveredAgo: 27, invoice: true, review: "Completed" },
  { status: "Picked Up", liveAgo: [9, 12], paid: "full", mop: "Pick Up Shop", deliveredAgo: 7, invoice: true, review: "Pending" },
  // Didn't go through
  { status: "Cancelled", liveAgo: [5, 12], paid: "none", mop: "COD" },
  { status: "Returned Item", liveAgo: [12, 20], paid: "dp", mop: "COD", dispatchAgo: 10 },
  { status: "Cancelled", liveAgo: [20, 30], paid: "none" },
];

export const DEMO_RESELLERS = [
  { name: "GOLDEN ANGEL RESELLER", phone: "+971 50 555 0190", address: "Shop 4, Meena Bazaar Arcade, Bur Dubai", rates: { "18K": 405, SP: 410, EF: 435 } },
  { name: "TALA JEWELS RESELLER", phone: "+971 50 555 0191", address: "Office 12, Rolla Square, Sharjah", rates: { "18K": 403, SP: 409, EF: 433 } },
] as const;

const RESELLER_END_CUSTOMERS = ["INDAY ROSIE", "ATE MARGIE", "KUYA BOYET", "TITA LORNA", "NENE AIKA", "MANG CARDING", "ATE JOSIE", "BEBANG"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * All demo Database rows, in sheet order. `firstRow` is the sheet row the
 * first record will land on (2 when the Database tab is emptied first), used
 * for invoice numbers that match what the app itself would print.
 */
export function buildDemoRecords(today: Date = new Date(), firstRow = 2): Partial<DatabaseRowType>[] {
  const rand = rng(Number(today.toISOString().slice(0, 10).replace(/-/g, "")));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const customers = buildCustomers();
  const rows: Partial<DatabaseRowType>[] = [];
  let orderSeq = 1001;

  const addItem = (c: DemoCustomer, cid: string, plan: Plan, liveAgo: number, liver: string, page: string, piece: Piece) => {
    const dateOfLive = isoDay(today, liveAgo);
    const isSilver = piece.category.startsWith("Silver");
    const grams = round2(between(piece.grams[0], piece.grams[1]));
    const intl = c.location !== "Local";
    const currency = c.location === "Pinas" ? "PHP" : "AED";
    let clientRate: number;
    let goldRate: number | undefined;
    let mc: number | undefined;
    let supplierRate: number | undefined;
    if (piece.perPc) {
      clientRate = piece.perPc;
      supplierRate = 230;
    } else if (isSilver) {
      clientRate = piece.category === "Silver Branded" ? 35 : 35;
    } else {
      goldRate = GOLD_BASE;
      mc = MC[piece.category] ?? 25;
      clientRate = SELL[piece.category] ?? 409;
      supplierRate = GOLD_BASE + 4;
    }
    if (currency === "PHP") clientRate = Math.round(clientRate * 17.5);
    const qty = piece.perPc ? (rand() < 0.5 ? 2 : 1) : 1;
    // Tabby demo orders are priced +15% per item, as the demo pricing says.
    const tabby = /tabby/i.test(plan.mop ?? "") ? 1.15 : 1;
    const price = piece.perPc ? Math.round(clientRate * qty * tabby) : Math.round(grams * clientRate * tabby);

    const rec: Partial<DatabaseRowType> = {
      orderId: `DM-${orderSeq++}`,
      dateOfLive,
      page,
      liverName: liver,
      locationOfMiner: c.location,
      minerName: c.name,
      itemDescription: piece.desc,
      grams,
      source: plan.outsource ? pick(DEMO_OUTSOURCE) : "Shop Stock",
      category: piece.category,
      tog: piece.tog,
      goldRate,
      mc,
      supplierRate,
      clientRate,
      qty,
      currency,
      modeOfSale: "Live",
      status: plan.status === "Layaway" ? "Waiting for Downpayment" : plan.status,
      modeOfPayment: plan.mop ?? (intl ? "International" : "COD"),
      regions: c.region,
      fbProfileName: c.fb,
      clientAddress: c.address,
      clientNumber: c.phone,
      customerId: cid,
      remittanceStatus: plan.status === "Delivered" ? "Remitted" : plan.paid === "full" ? "Cleared" : "Pending",
    };

    if (plan.paid === "dp") rec.downpayment = String(Math.round(price * 0.3));
    if (plan.paid === "full") rec.amountReceived = String(price);
    if (plan.paid === "layaway") {
      rec.status = "Paid/DP but Item Hold";
      rec.modeOfSale = "Layaway";
      rec.downpayment = String(Math.round(price * 0.25));
      rec.la1MonthPayment = String(Math.round(price * 0.25));
      rec.la2MonthPayment = String(Math.round(price * 0.25));
      rec.liverAdminRemarks = "Layaway 4 months, last payment due next month";
    }
    if (plan.dispatchAgo !== undefined) rec.dispatchDate = isoStamp(today, plan.dispatchAgo, 10);
    if (plan.deliveredAgo !== undefined) rec.deliveredDate = isoStamp(today, plan.deliveredAgo, 16);
    if (plan.review) rec.reviewChasing = plan.review;
    if (plan.status === "Cancelled") rec.liverAdminRemarks = "Customer changed mind, item back to stock";
    if (plan.status === "Returned Item") rec.liverAdminRemarks = "Returned by courier, customer unreachable";
    if (plan.status === "Waiting for Details") rec.liverAdminRemarks = "Asked for full address and landmark";
    if (plan.mop === "COD" && rand() < 0.3) rec.freeSf = "TRUE";
    if (plan.outsource) rec.liverAdminRemarks = "Outsourced, supplier to deliver to shop";

    rec.rowKey = `DEMO-${String(rows.length + 1).padStart(4, "0")}`;
    rec.auditTrail = `${isoStamp(today, liveAgo, 20)} | demo | Created`;
    rows.push(rec);
  };

  // Every customer gets their main order (1-3 pieces, same live).
  PLANS.forEach((plan, i) => {
    const c = customers[i % customers.length];
    const cid = `CUST-${String(i + 1).padStart(4, "0")}`;
    const liveAgo = Math.round(between(plan.liveAgo[0], plan.liveAgo[1]));
    const liver = DEMO_LIVERS[i % DEMO_LIVERS.length];
    const page = DEMO_PAGES[i % DEMO_PAGES.length];
    const pieces = 1 + Math.floor(rand() * 3);
    for (let p = 0; p < pieces; p++) addItem(c, cid, plan, liveAgo, liver, page, pick(PIECES));
  });

  // Repeat buyers: a few customers bought again on an earlier live (history + milestones).
  const repeat: { idx: number; plan: Plan }[] = [
    { idx: 0, plan: PLANS[21] },
    { idx: 2, plan: PLANS[22] },
    { idx: 7, plan: PLANS[23] },
    { idx: 7, plan: PLANS[20] },
    { idx: 15, plan: PLANS[19] },
  ];
  for (const r of repeat) {
    const c = customers[r.idx % customers.length];
    const cid = `CUST-${String(r.idx + 1).padStart(4, "0")}`;
    const liveAgo = r.plan.liveAgo[1] + 10;
    addItem(c, cid, { ...r.plan, dispatchAgo: liveAgo - 2, deliveredAgo: liveAgo - 3 }, liveAgo, DEMO_LIVERS[r.idx % 4], DEMO_PAGES[r.idx % 3], pick(PIECES));
  }

  // Reseller box: items billed to the reseller, end customer in the description.
  DEMO_RESELLERS.forEach((res, ri) => {
    const liveAgo = 2 + ri * 3;
    const dateOfLive = isoDay(today, liveAgo);
    for (let k = 0; k < 4; k++) {
      const karat = (["18K", "SP", "18K", "EF"] as const)[k];
      const base = pick(PIECES.filter((p) => !p.perPc && !p.category.startsWith("Silver")));
      const grams = round2(between(1.2, 6));
      const item = base.desc.replace(/^18K GOLD |^21K GOLD /, "");
      const endCustomer = RESELLER_END_CUSTOMERS[ri * 4 + k];
      rows.push({
        orderId: `DM-${orderSeq++}`,
        dateOfLive,
        page: DEMO_PAGES[ri],
        liverName: DEMO_LIVERS[ri],
        locationOfMiner: "Local",
        minerName: res.name,
        itemDescription: `18K GOLD ${item}${karat === "18K" ? "" : ` (${karat})`} - ${endCustomer}`,
        grams,
        source: "Shop Stock",
        category: karat === "18K" ? "Gold Normal" : karat === "SP" ? "Special Price" : "Special Price EF",
        tog: "18K",
        goldRate: GOLD_BASE,
        mc: karat === "18K" ? 25 : karat === "SP" ? 30 : 35,
        supplierRate: GOLD_BASE + 4,
        clientRate: res.rates[karat],
        qty: 1,
        currency: "AED",
        modeOfSale: "Reseller",
        status: "Reseller",
        modeOfPayment: "Bank Transfer",
        regions: ri === 0 ? "Dubai" : "Sharjah",
        clientAddress: res.address,
        clientNumber: res.phone,
        customerId: `RSL-${String(ri + 1).padStart(4, "0")}`,
        liverAdminRemarks: `Reseller import for ${endCustomer}`,
        downpayment: k === 0 ? String(Math.round(grams * res.rates[karat])) : "",
        remittanceStatus: "Pending",
        rowKey: `DEMO-${String(rows.length + 1).padStart(4, "0")}`,
        auditTrail: `${isoStamp(today, liveAgo, 20)} | demo | Reseller invoice`,
      });
    }
  });

  // Invoice numbers on the orders that would have one by now.
  const invoiced = new Set<string>();
  PLANS.forEach((p, i) => { if (p.invoice) invoiced.add(`CUST-${String(i + 1).padStart(4, "0")}`); });
  rows.forEach((r, i) => {
    if (r.customerId && invoiced.has(r.customerId) && r.dateOfLive) r.invoiceNumber = invoiceNo(r.dateOfLive, firstRow + i);
  });

  return rows;
}

// ── Settings that switch every feature on for the demo ────────────────────────

const ADMIN_STATUSES = [
  "Pending", "Waiting for Details", "Waiting for Downpayment", "Payment for Verification", "Paid/DP but Item Hold",
  "For International Shipment", "For COD", "For Pick Up", "Reseller", "Outsource", "Cancelled",
];
const DISPATCH_STATUSES = [
  "For International Shipment", "For COD", "For Pick Up", "Reseller", "Outsource",
  "Dispatched", "Delivered", "Picked Up", "Returned Item", "Cancelled",
];
const ACCOUNTS_STATUSES = [
  "Payment for Verification", "Waiting for Downpayment", "Paid/DP but Item Hold",
  "For International Shipment", "For COD", "For Pick Up", "Dispatched", "Delivered", "Cancelled",
];

export function buildDemoSettings(today: Date = new Date()): Record<string, string> {
  const tabs = {
    overrides: Object.fromEntries(
      ["admin", "dispatch", "accounts", "bossing", "liver", "purchasing", "invoicing", "livesellers"].map((k) => [k, { visible: true }])
    ),
  };
  const app = {
    columnAliases: {},
    hiddenFields: [],
    statusOptions: [],
    statusOptionsByTab: {},
    requirePaymentForPullout: true,
    saleStatuses: ["Dispatched", "Delivered", "Picked Up"],
    pulloutStatuses: ["For Pullout", "For COD", "For Pick Up", "For International Shipment"],
    statusDeadlines: [
      { status: "For COD", days: 2 },
      { status: "Waiting for Downpayment", days: 3 },
      { status: "Dispatched", days: 3 },
    ],
    deadlinesStartedAt: isoStamp(today, 30, 0),
  };
  const options = {
    statusAdmin: ADMIN_STATUSES,
    statusDispatch: DISPATCH_STATUSES,
    statusAccounts: ACCOUNTS_STATUSES,
    page: DEMO_PAGES,
    source: ["Shop Stock", ...DEMO_OUTSOURCE],
    modeOfSale: ["Live", "Reseller", "Layaway", "In-Store", "Offline"],
  };
  const resellers = {
    resellers: Object.fromEntries(
      DEMO_RESELLERS.map((r) => [
        r.name,
        {
          rates: {
            [isoDay(today, 7)]: { "18K": r.rates["18K"] - 3, SP: r.rates.SP - 3, EF: r.rates.EF - 3 },
            [isoDay(today, 0)]: { ...r.rates },
          },
        },
      ])
    ),
  };
  const livePrices = {
    currency: "AED",
    types: [
      { name: "Branded", rate: 27 },
      { name: "Rhodium", rate: 22 },
      { name: "Non-rhodium", rate: 18 },
      { name: "Moissanite", rate: 35 },
    ],
    holdWarnDays: 7,
    notMovingDays: 30,
  };
  return {
    __TAB_CONFIG__: JSON.stringify(tabs),
    __APP_CONFIG__: JSON.stringify(app),
    __OPTIONS_CONFIG__: JSON.stringify(options),
    __BUSINESS_CONFIG__: JSON.stringify({ mode: "weight", preset: "jewellery", timezoneOffsetHours: 4 }),
    __PRICING_CONFIG__: JSON.stringify({ tabbySurchargePct: 15, shippingPerShipment: true, newRulesFrom: "", leftoverShipping: "charge", shippingFeeDefault: 30, shippingFeeInternational: 450, shippingFees: { western: 45, "western region": 45 } }),
    __RESELLER_CONFIG__: JSON.stringify(resellers),
    __LIVE_PRICELIST__: JSON.stringify(livePrices),
  };
}

// ── DATA'S tab (dropdown sources) ─────────────────────────────────────────────

export function buildDemoDataOptions(): string[][] {
  const cols: [string, string[]][] = [
    ["Item Description", PIECES.map((p) => p.desc)],
    ["Currency", ["AED", "PHP", "USD"]],
    ["Category", ["Gold Normal", "Special Price", "Special Price EF", "Silver Normal", "Silver Branded", "Per PC"]],
    ["Source", ["Shop Stock", ...DEMO_OUTSOURCE]],
    ["T.O.G", ["18K", "21K", "S-925"]],
    ["Liver", DEMO_LIVERS],
    ["Page", DEMO_PAGES],
  ];
  const height = Math.max(...cols.map(([, v]) => v.length));
  const grid: string[][] = [cols.map(([h]) => h)];
  for (let r = 0; r < height; r++) grid.push(cols.map(([, v]) => v[r] ?? ""));
  return grid;
}

// ── Purchasing ────────────────────────────────────────────────────────────────

export function buildDemoPurchases(today: Date = new Date()): Record<string, string>[] {
  const list = [
    { ago: 28, supplier: DEMO_SUPPLIERS[0], ref: "PO-DM-0101", item: "18K gold chains assorted", category: "Gold Normal", qty: 120, unit: 376, paid: "full", status: "Received" },
    { ago: 21, supplier: DEMO_SUPPLIERS[2], ref: "PO-DM-0102", item: "18K special price pendants", category: "Special Price", qty: 60, unit: 380, paid: "full", status: "Received" },
    { ago: 14, supplier: DEMO_SUPPLIERS[1], ref: "PO-DM-0103", item: "S-925 branded bracelets", category: "Silver Branded", qty: 300, unit: 27, paid: "half", status: "Received" },
    { ago: 6, supplier: DEMO_SUPPLIERS[0], ref: "PO-DM-0104", item: "18K bangles EF", category: "Special Price EF", qty: 45, unit: 381, paid: "half", status: "Ordered" },
    { ago: 1, supplier: DEMO_SUPPLIERS[2], ref: "PO-DM-0105", item: "Stud earrings per pc", category: "Per PC", qty: 40, unit: 230, paid: "none", status: "Ordered" },
  ];
  return list.map((p) => {
    const total = p.qty * p.unit;
    const paid = p.paid === "full" ? total : p.paid === "half" ? Math.round(total / 2) : 0;
    return {
      Date: isoDay(today, p.ago),
      Supplier: p.supplier,
      Reference: p.ref,
      Item: p.item,
      Category: p.category,
      Qty: String(p.qty),
      "Unit Cost": String(p.unit),
      Currency: "AED",
      "Total Cost": String(total),
      "Amount Paid": String(paid),
      Balance: String(total - paid),
      Status: p.status,
      Notes: p.paid === "none" ? "Pay on delivery" : "",
    };
  });
}

// ── Live Sellers ──────────────────────────────────────────────────────────────

export interface DemoLive {
  sessions: { id: string; date: string; seller: string; weightOut: number; weightBack: number | null; status: "Out" | "Returned"; notes: string }[];
  items: {
    id: string; sessionId: string; seller: string; liveDate: string; description: string; type: string;
    grams: number; rate: number; amount: number; status: "On hold" | "Sold" | "Cancelled";
    pulloutDate: string; paidAmount: number; invoiceNo: string; cancelledDate: string; customer: string;
  }[];
  stock: { id: string; date: string; grams: number; pcs: number; description: string; note: string }[];
}

export function buildDemoLive(today: Date = new Date()): DemoLive {
  const rand = rng(7 + Number(today.toISOString().slice(0, 10).replace(/-/g, "")));
  const rates: Record<string, number> = { Branded: 27, Rhodium: 22, "Non-rhodium": 18, Moissanite: 35 };
  const descs: Record<string, string[]> = {
    Branded: ["Clover bracelet", "Love bangle", "Serpent ring"],
    Rhodium: ["Tennis necklace", "Halo ring", "Drop earrings"],
    "Non-rhodium": ["Plain chain", "Anklet", "Hoop earrings"],
    Moissanite: ["Solitaire ring", "Stud earrings", "Riviera necklace"],
  };
  const out: DemoLive = { sessions: [], items: [], stock: [] };
  out.stock.push(
    { id: "ST-DEMO-1", date: isoDay(today, 30), grams: 1500, pcs: 220, description: "Opening stock", note: "Demo" },
    { id: "ST-DEMO-2", date: isoDay(today, 12), grams: 600, pcs: 90, description: "New arrivals", note: "Demo" },
  );
  const sellers = ["PAPS", "KIMMY", "LOLA BEA"];
  let itemSeq = 1;
  const days = [9, 5, 2];
  sellers.forEach((seller, si) => {
    days.forEach((ago, di) => {
      const open = di === days.length - 1 && si === 0; // one seller still has stock out today
      const id = `LS-DEMO-${si + 1}${di + 1}`;
      const weightOut = 120 + Math.round(rand() * 80);
      const types = Object.keys(rates);
      const sessionItems: DemoLive["items"] = [];
      if (!open) {
        const n = 3 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const type = types[Math.floor(rand() * types.length)];
          const grams = round2(3 + rand() * 9);
          const amount = Math.round(grams * rates[type]);
          const roll = rand();
          const status: "On hold" | "Sold" | "Cancelled" = ago >= 5 ? (roll < 0.7 ? "Sold" : roll < 0.85 ? "Cancelled" : "On hold") : (roll < 0.2 ? "Sold" : "On hold");
          sessionItems.push({
            id: `LI-DEMO-${String(itemSeq++).padStart(3, "0")}`,
            sessionId: id,
            seller,
            liveDate: isoDay(today, ago),
            description: descs[type][Math.floor(rand() * descs[type].length)],
            type,
            grams,
            rate: rates[type],
            amount,
            status,
            pulloutDate: status === "Sold" ? isoDay(today, Math.max(0, ago - 2)) : "",
            paidAmount: status === "Sold" ? amount : 0,
            invoiceNo: status === "Sold" ? `LV-DEMO-${String(itemSeq).padStart(3, "0")}` : "",
            cancelledDate: status === "Cancelled" ? isoDay(today, Math.max(0, ago - 1)) : "",
            customer: RESELLER_END_CUSTOMERS[(itemSeq + si) % RESELLER_END_CUSTOMERS.length],
          });
        }
      }
      const taken = round2(sessionItems.reduce((s, it) => s + it.grams, 0));
      out.sessions.push({
        id,
        date: isoDay(today, ago),
        seller,
        weightOut,
        weightBack: open ? null : round2(weightOut - taken),
        status: open ? "Out" : "Returned",
        notes: "",
      });
      out.items.push(...sessionItems);
    });
  });
  return out;
}

// ── Copying a real customer's setup (not their data) ──────────────────────────

/**
 * Settings copied from the chosen customer (e.g. Crown), so the demo works
 * exactly like they do. Their brand, logos, resellers, live seller price list
 * and rates are NOT copied: those are theirs, or would show real names.
 */
export const COPYABLE_SETUP_MARKERS = [
  "__TAB_CONFIG__",
  "__APP_CONFIG__",
  "__OPTIONS_CONFIG__",
  "__CUSTOM_TOGGLES__",
  "__BUSINESS_CONFIG__",
  "__PRICING_CONFIG__",
  "__LABEL_CONFIG__",
  "__MASTERLIST_MAPPING__",
] as const;

function parseObj(json: string | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const p = JSON.parse(json);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Demo settings on top of a customer's copied setup. The customer's setup wins,
 * except: every tab stays visible with its default name, reminders count from 30 days ago (so the demo
 * shows some), column aliases are dropped (the demo sheet uses the standard
 * column names), and page / source lists are the demo's made-up ones.
 */
export function mergeCopiedSetup(copied: Record<string, string>, demo: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...demo };
  for (const marker of COPYABLE_SETUP_MARKERS) {
    const v = copied[marker];
    if (v && v.trim()) out[marker] = v;
  }

  const tabs = parseObj(out.__TAB_CONFIG__) ?? {};
  const overrides = (tabs.overrides && typeof tabs.overrides === "object" ? tabs.overrides : {}) as Record<string, Record<string, unknown>>;
  for (const k of ["admin", "dispatch", "accounts", "bossing", "liver", "purchasing", "invoicing", "livesellers"]) {
    // Tab labels are dropped: customers often rename tabs after staff (real names).
    overrides[k] = { visible: true };
  }
  out.__TAB_CONFIG__ = JSON.stringify({ ...tabs, overrides });

  const app = parseObj(out.__APP_CONFIG__);
  const demoApp = parseObj(demo.__APP_CONFIG__) ?? {};
  if (app) {
    app.columnAliases = {};
    app.deadlinesStartedAt = demoApp.deadlinesStartedAt;
    if (!Array.isArray(app.statusDeadlines) || !app.statusDeadlines.length) app.statusDeadlines = demoApp.statusDeadlines;
    out.__APP_CONFIG__ = JSON.stringify(app);
  }

  const opts = parseObj(out.__OPTIONS_CONFIG__);
  if (opts) {
    opts.page = DEMO_PAGES;
    opts.source = ["Shop Stock", ...DEMO_OUTSOURCE];
    out.__OPTIONS_CONFIG__ = JSON.stringify(opts);
  }
  return out;
}
