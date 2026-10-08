"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DatabaseRowType } from "@/types";
import { getCustomerMemory, getResellerConfig } from "@/lib/api";
import { buildCustomerMemory, type CustomerMemory, type StoredCustomer } from "@/lib/customerMemory";
import { knownResellers, parseResellerConfig, resellerKey, type ResellerConfig } from "@/lib/resellers";
import { customerKey } from "@/lib/customerId";

/**
 * Customer Memory for a screen that is open: read fresh from the active
 * tenant's sheet each time the screen opens (never cached across tenants),
 * combined with the orders already loaded.
 */
export function useCustomerMemory(records: DatabaseRowType[]) {
  const [stored, setStored] = useState<StoredCustomer[]>([]);
  const [resellerCfg, setResellerCfg] = useState<ResellerConfig>({ resellers: {} });
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    // A liver (or anyone without access) simply gets no memory.
    const [list, cfg] = await Promise.all([
      getCustomerMemory().catch(() => [] as StoredCustomer[]),
      getResellerConfig().then(({ config }) => parseResellerConfig(config)).catch(() => ({ resellers: {} }) as ResellerConfig),
    ]);
    setStored(list);
    setResellerCfg(cfg);
    setLoaded(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const memory: CustomerMemory = useMemo(() => {
    const mem = buildCustomerMemory(records, stored);
    // Anyone with reseller rates set up is a reseller unless marked otherwise.
    const resellers = new Set(knownResellers(resellerCfg).map((n) => customerKey(resellerKey(n))));
    for (const p of mem.profiles.values()) if (!p.type && resellers.has(p.key)) p.type = "Reseller";
    return mem;
  }, [records, stored, resellerCfg]);

  return { memory, stored, resellerCfg, loaded, reload };
}
