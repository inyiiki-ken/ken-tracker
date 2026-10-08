"use client";

import * as XLSX from "xlsx";
import type { StoredCustomer } from "@/lib/customerMemory";
import { getPricing } from "@/lib/pricingConfig";

/**
 * Reads a customer list workbook (e.g. Customers.xlsx) into Customer Memory
 * entries. Columns are found by their header text, so the order doesn't
 * matter: CUSTOMER, ALSO WRITTEN AS, TYPE, COUNTRY, DEFAULT INFO (address +
 * phone in one cell), ADDRESS, PHONE / NUMBER, SF, TABBY…, NOTES / REMARKS.
 */

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const head = (v: unknown) => str(v).toUpperCase().replace(/\s+/g, " ");

/** Phone numbers inside free text ("Al Nahda 2, Dubai 0501234567"). */
const PHONE = /(\+?\d[\d\s\-()]{7,}\d)/g;

/** Address + phone from one "DEFAULT INFO" cell. Placeholders ("INTERNATIONAL / RS") give nothing. */
export function splitContact(text: string): { address: string; phone: string } {
  const t = str(text);
  const phones = t.match(PHONE) ?? [];
  const phone = phones.map((p) => p.trim()).join(" / ");
  let address = t;
  for (const p of phones) address = address.replace(p, " ");
  address = address.replace(/\s+/g, " ").replace(/^[\s,;:/|\-]+|[\s,;:/|\-]+$/g, "").trim();
  if (/^((international|intl|rs|reseller|pick ?up|meet ?up|n\/?a|none|tbc|-)\s*[/,&]?\s*)*$/i.test(address)) address = "";
  return { address, phone };
}

/** Fees the app already charges by itself; only a different one is worth remembering. */
function standardFees(): Set<number> {
  const cfg = getPricing();
  return new Set([cfg.shippingFeeDefault, cfg.shippingFeeInternational, cfg.shippingFeeMeetUp, ...Object.values(cfg.shippingFees)]);
}

function sfOf(v: unknown): string {
  const s = str(v).toUpperCase();
  if (!s) return "";
  if (/FREE/.test(s)) return "FREE";
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || s.replace(/[^0-9.]/g, "") === "") return "";
  if (n === 0) return "FREE";
  return standardFees().has(n) ? "" : String(n);
}

export interface CustomerFileResult {
  entries: StoredCustomer[];
  sheet: string;
  error?: string;
}

export async function readCustomerFile(file: File): Promise<CustomerFileResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.SheetNames.find((n) => /customer/i.test(n)) ?? wb.SheetNames[0];
  if (!sheet) return { entries: [], sheet: "", error: "The file has no sheets." };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: "", raw: false });
  const headerAt = grid.findIndex((row) => row.some((c) => /^(CUSTOMER|CUSTOMER NAME|CLIENT|CLIENT NAME|NAME)$/.test(head(c))));
  if (headerAt < 0) return { entries: [], sheet, error: `No "CUSTOMER" column found on the "${sheet}" sheet.` };
  const header = grid[headerAt].map(head);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = {
    name: col(/^(CUSTOMER|CUSTOMER NAME|CLIENT|CLIENT NAME|NAME)$/),
    aliases: col(/ALSO|ALIAS|OTHER NAME|WRITTEN/),
    type: col(/^TYPE/),
    country: col(/COUNTRY/),
    info: col(/DEFAULT INFO|^INFO|DETAILS/),
    address: col(/ADDRESS/),
    phone: col(/PHONE|NUMBER|CONTACT|MOBILE/),
    sf: col(/^SF\b|SHIPPING/),
    tabby: col(/TABBY/),
    notes: col(/NOTE|REMARK/),
  };
  const at = (row: unknown[], i: number) => (i >= 0 ? str(row[i]) : "");

  const entries: StoredCustomer[] = [];
  for (const row of grid.slice(headerAt + 1)) {
    const name = at(row, c.name).toUpperCase().replace(/\s+/g, " ");
    if (!name) continue;
    const type = at(row, c.type).toUpperCase();
    const info = splitContact(at(row, c.info));
    const address = at(row, c.address) || info.address;
    const phone = at(row, c.phone) || info.phone;
    const location = /INTERNATIONAL|\bINTL\b/.test(type) ? "International" : /LOCAL/.test(type) ? "Local" : "";
    const fields: StoredCustomer["fields"] = {};
    if (address) fields.clientAddress = address;
    if (phone) fields.clientNumber = phone;
    if (location) fields.locationOfMiner = location;
    entries.push({
      name,
      customerId: "",
      aliases: at(row, c.aliases).split(/[,;/\n]| OR /i).map((a) => a.trim().toUpperCase()).filter(Boolean),
      type: /RESELL/.test(type) ? "Reseller" : type ? "Customer" : "",
      country: at(row, c.country),
      sf: sfOf(at(row, c.sf)),
      tabby: at(row, c.tabby),
      notes: at(row, c.notes),
      fields,
      source: "Customers.xlsx",
      updatedBy: "",
      updatedAt: "",
    });
  }
  return { entries, sheet };
}
