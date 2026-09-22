/**
 * Extracts a Google Sheet id from whatever the user pastes: a full edit URL
 * like "https://docs.google.com/spreadsheets/d/<ID>/edit?gid=0#gid=0", the
 * "<ID>/edit?gid=0#gid=0" fragment, or the bare id itself.
 */
export function parseSheetId(input: string): string {
  const raw = (input || "").trim();
  if (!raw) return "";

  // Full or partial URL: capture the id between /d/ and the next slash,
  // or before "/edit" / "?" if the "/d/" prefix was stripped off.
  const dMatch = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (dMatch) return dMatch[1];

  const editMatch = raw.match(/^([a-zA-Z0-9-_]+)(?:\/edit|\?|#|\/)/);
  if (editMatch) return editMatch[1];

  // Bare id (Google ids are long alphanumeric-with -/_ strings).
  const bareMatch = raw.match(/^[a-zA-Z0-9-_]{20,}$/);
  if (bareMatch) return raw;

  // Last resort: strip any trailing path/query from a leading token.
  return raw.split(/[/?#]/)[0];
}

/** True if the string looks like a plausible Google Sheet id. */
export function looksLikeSheetId(id: string): boolean {
  return /^[a-zA-Z0-9-_]{20,}$/.test(id.trim());
}
