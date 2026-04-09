// ============================================================
// Deterministic Location Normalizer — Rules Only
// ============================================================
// Handles: noise removal, suffix stripping, title case, trimming.
// NO hardcoded city mappings. NO AI.
//
// AI is used SEPARATELY for semantic tasks (abbreviation expansion,
// fuzzy matching) that genuinely require world knowledge.
//
// Pipeline:
//   1. Strip emojis
//   2. Trim whitespace
//   3. Remove numbers embedded in location names (e.g., "hyd123" → "hyd")
//   4. Remove symbols (everything except letters, spaces, hyphens, dots, commas)
//   5. Strip suffix noise ("city", "area", "zone", "district", "region", "state", "town", "village")
//   6. Normalize whitespace (collapse multiple spaces)
//   7. Title Case formatting
//
// This produces a clean value that can then be sent to AI for
// semantic resolution (abbreviation expansion, fuzzy matching).

// Emoji regex (same as cleaning-engine)
const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\u{20E3}\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]/gu;

// Location suffix noise — common suffixes that add no geographic meaning
const LOCATION_SUFFIXES = [
  "city", "area", "zone", "district", "region", "state",
  "town", "village", "municipality", "taluka", "tehsil",
  "block", "sector", "phase", "ward",
  "urb", "rural", "metro",
];

export interface LocationRuleResult {
  original: string;
  ruleCleaned: string;    // After deterministic rules
  changed: boolean;
  isEmpty: boolean;       // Value became empty after cleaning (noise/symbols only)
  flags: string[];        // ["noise_removed", "suffix_stripped", "title_cased", "trimmed"]
}

/**
 * Apply deterministic rules to a single location value.
 * Returns the rule-cleaned value + metadata about what was done.
 */
export function normalizeLocationRules(raw: string): LocationRuleResult {
  if (!raw || typeof raw !== "string") {
    return { original: raw, ruleCleaned: "", changed: false, isEmpty: true, flags: [] };
  }

  const flags: string[] = [];
  let s = raw.trim();

  // 1. Strip emojis
  const afterEmoji = s.replace(EMOJI_REGEX, "").trim();
  if (afterEmoji !== s) {
    flags.push("noise_removed");
    s = afterEmoji;
  }

  // 2. Remove symbols — keep only: letters, spaces, hyphens, dots, commas
  const afterSymbols = s.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s.\-,]/g, "").trim();
  if (afterSymbols !== s) {
    flags.push("noise_removed");
    s = afterSymbols;
  }

  // 3. Remove numbers (e.g., "hyd123" → "hyd")
  const afterNumbers = s.replace(/\d+/g, "").trim();
  if (afterNumbers !== s) {
    flags.push("noise_removed");
    s = afterNumbers;
  }

  // 4. Strip suffix noise from end of string (case-insensitive)
  // E.g., "bangalore city" → "bangalore", "MUMBAI AREA" → "MUMBAI"
  const lower = s.toLowerCase();
  for (const suffix of LOCATION_SUFFIXES) {
    const pattern = new RegExp(`\\s+${suffix}\\s*$`, "i");
    if (pattern.test(s)) {
      s = s.replace(pattern, "").trim();
      flags.push("suffix_stripped");
      break; // Only strip one suffix
    }
  }

  // 5. Normalize whitespace (collapse multiple spaces into one)
  s = s.replace(/\s+/g, " ").trim();

  // 6. Check if value is now empty (was pure noise/symbols)
  if (s === "") {
    return { original: raw, ruleCleaned: "", changed: true, isEmpty: true, flags };
  }

  // 7. Title Case
  const titleCased = toTitleCase(s);
  if (titleCased !== s) {
    flags.push("title_cased");
    s = titleCased;
  }

  const changed = s !== raw.trim();

  return { original: raw, ruleCleaned: s, changed, isEmpty: false, flags };
}

/**
 * Title Case a string — capitalize first letter of each word.
 * Handles multi-word locations: "new delhi ncr" → "New Delhi Ncr"
 * Preserves: hyphens, dots, commas
 */
function toTitleCase(s: string): string {
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      // Preserve dots and hyphens: "u.s." or "coimbatore-south"
      if (word.length === 1) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Batch-normalize an array of location values using deterministic rules.
 * Returns a Map from original → rule-cleaned value.
 */
export function batchNormalizeLocations(values: string[]): Map<string, LocationRuleResult> {
  const results = new Map<string, LocationRuleResult>();
  for (const v of values) {
    const trimmed = (v || "").trim();
    if (trimmed === "") continue;
    results.set(trimmed, normalizeLocationRules(trimmed));
  }
  return results;
}

/**
 * Check if a rule-cleaned value likely needs AI semantic resolution.
 * Values that are:
 *   - Very short (≤3 chars, likely abbreviations: "blr", "hyd", "del")
 *   - All uppercase (likely abbreviation: "MUM", "BLR")
 *   - Have no vowels in the cleaned form (garbage)
 * ...need AI for abbreviation expansion / fuzzy matching.
 *
 * Values that are already proper-case with reasonable length (≥4 chars)
 * are considered "rules sufficient" — no AI needed.
 */
export function needsSemanticResolution(ruleCleaned: string): boolean {
  if (!ruleCleaned || ruleCleaned.length === 0) return false;

  // Pure noise/symbols → don't send to AI, it's garbage
  if (/^[^a-zA-Z]+$/.test(ruleCleaned)) return false;

  // Very short → likely abbreviation, needs AI
  if (ruleCleaned.length <= 3) return true;

  // All caps with length ≤ 8 → likely abbreviation (e.g., "HYDERABAD" is fine, "HYD" is not)
  if (ruleCleaned === ruleCleaned.toUpperCase() && ruleCleaned.length <= 5) return true;

  return false;
}
