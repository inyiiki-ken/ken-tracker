"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { SUPER_ADMIN_EMAILS } from "@/config/roles";
import { getMyRoles } from "@/lib/api";

/**
 * True for super admins of the ACTIVE customer: the built-in list, a
 * "super_admin" in that customer's Roles sheet, or the developer (God Mode).
 * The server checks the same thing when saving.
 */
export function useIsSuperAdmin(): boolean {
  const { user } = useAuth();
  const email = (user?.email || "").toLowerCase();
  const staticSA = !!email && SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email);
  const [roleSA, setRoleSA] = useState(false);
  useEffect(() => {
    if (!email || staticSA) return;
    let alive = true;
    getMyRoles({})
      .then((roles) => { if (alive) setRoleSA(roles.includes("super_admin")); })
      .catch(() => {});
    return () => { alive = false; };
  }, [email, staticSA]);
  return staticSA || roleSA;
}
