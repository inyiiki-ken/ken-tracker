"use client";

import { Eye, X } from "lucide-react";

/**
 * Developer / super-admin tool: preview the app exactly as another user sees it,
 * using their role(s) straight from the customer's Roles tab. Purely a view
 * override — it changes which tabs/sections render for you; it does not change
 * anyone's real permissions or what the server allows.
 */
export default function PreviewAsUser({
  users,
  value,
  onChange,
}: {
  users: { email?: string; role?: string }[];
  value: string | null;
  onChange: (email: string | null) => void;
}) {
  const valid = users.filter((u) => (u.email ?? "").trim());
  if (valid.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <div className="relative flex items-center">
        <Eye className="h-3.5 w-3.5 text-muted-foreground absolute left-1.5 pointer-events-none" />
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="h-7 pl-6 pr-2 text-[10px] bg-background border border-border rounded-md text-foreground max-w-[150px]"
          title="Preview as user (from the Roles tab)"
        >
          <option value="">Preview as…</option>
          {valid.map((u) => (
            <option key={u.email} value={u.email}>
              {u.email}{u.role ? ` · ${u.role}` : ""}
            </option>
          ))}
        </select>
      </div>
      {value && (
        <button
          onClick={() => onChange(null)}
          className="p-1 text-muted-foreground hover:text-foreground"
          title="Exit preview"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
