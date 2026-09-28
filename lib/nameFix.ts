/**
 * Catch typing mistakes in masterlists: customer names that are misspelled or
 * cut short ("ROTH LYN" → "RUTH LYN", "WENNIE MARIE" → "WENNIE MARIE LOBITANA")
 * and misspelled item words ("NEACKLACE" → "NECKLACE").
 */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

/**
 * Best known customer this name probably means, or null if it looks right.
 * `known` maps a normalised name → how many records use it.
 */
export function suggestCustomer(name: string, known: Map<string, number>): string | null {
  const n = norm(name);
  if (n.length < 3) return null;
  const selfCount = known.get(n) ?? 0;
  let best: { name: string; score: number } | null = null;
  for (const [k, count] of known) {
    if (k === n) continue;
    let score = Infinity;
    if (k.startsWith(n + " ")) score = 0.5; // cut short: "WENNIE MARIE" → "WENNIE MARIE LOBITANA"
    else {
      const d = levenshtein(n, k);
      const limit = n.length >= 8 ? 2 : 1;
      if (d <= limit) score = d;
    }
    // Only suggest a name that is used at least as often as the typed one, and
    // never between two established customers (ANA vs ANNA are both real).
    if (score === Infinity || count < selfCount) continue;
    if (selfCount >= 2 && score >= 1) continue;
    if (!best || score < best.score || (score === best.score && count > (known.get(best.name) ?? 0))) best = { name: k, score };
  }
  return best ? best.name : null;
}

const JEWELLERY_WORDS = [
  "NECKLACE", "BRACELET", "BANGLE", "EARRING", "EARRINGS", "PENDANT", "CHAIN", "RING", "ANKLET",
  "CUBAN", "ROSARY", "SPIRAL", "FASHION", "HOOP", "HOOPS", "DANGLING", "STUDS", "STUD", "HEART", "CROSS",
  "TIFFANY", "CARTIER", "VERSACE", "MONACO", "ROLEX", "BULGARI", "BVLGARI", "CHANEL", "HERMES", "DIOR",
  "CLOVER", "TWISTED", "KNOT", "LINK", "HARDWARE", "FOXTAIL", "FIGARO", "ROPE", "SNAKE", "BOX", "TENNIS",
  "WHITE", "GOLD", "ROSE", "YELLOW", "SILVER", "SLIM", "CHUNKY", "DIACUT", "OPEN", "FLOWER", "NAIL",
  "BUTTERFLY", "LOCKET", "CHARM", "BEADS", "PEARL", "INFINITY", "LETTER", "INITIAL", "BABY", "KIDS",
];

/** Words that count as correctly spelled: the built-in list plus words used in past descriptions. */
export function buildDictionary(descriptions: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const d of descriptions) {
    for (const w of norm(d).split(/[^A-Z]+/)) if (w.length >= 3) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  // Singular and plural are both correct (RING / RINGS, BEAD / BEADS).
  const dict = new Set(JEWELLERY_WORDS.flatMap((w) => [w, w.endsWith("S") ? w.slice(0, -1) : w + "S"]));
  for (const [w, c] of counts) if (c >= 3) { dict.add(w); dict.add(w + "S"); }
  return dict;
}

/** The description with obvious misspellings fixed, or null if nothing to fix. */
export function fixSpelling(text: string, dict: Set<string>): string | null {
  const words = norm(text).split(" ");
  let changed = false;
  const out = words.map((w) => {
    const core = w.replace(/[^A-Z]/g, "");
    if (core.length < 4 || dict.has(core) || core !== w) return w;
    let best = "";
    let bestD = Infinity;
    let tie = false;
    for (const d of dict) {
      if (Math.abs(d.length - core.length) > 2) continue;
      const dist = levenshtein(core, d);
      if (dist < bestD) { best = d; bestD = dist; tie = false; }
      else if (dist === bestD) tie = true;
    }
    const limit = core.length >= 7 ? 2 : 1;
    if (best && bestD <= limit && !tie) { changed = true; return best; }
    return w;
  });
  return changed ? out.join(" ") : null;
}
