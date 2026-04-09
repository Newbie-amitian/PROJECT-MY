// ============================================================
// Deterministic Geographic Entity Normalizer — Rules Only
// ============================================================
// Handles REGION and COUNTRY columns.
// Deterministic rules: noise removal, suffix stripping, title case.
// NO hardcoded mappings. NO AI.
//
// AI is used SEPARATELY for semantic tasks (abbreviation expansion,
// fuzzy matching, country name standardization) that require world knowledge.
//
// Pipeline:
//   0. Invalid value check (unknown, n/a, none → flagged as invalid)
//   1. Strip emojis
//   2. Trim whitespace
//   3. Remove numbers
//   4. Remove symbols (everything except letters, spaces, hyphens, dots, commas)
//   5. Strip suffix noise ("region", "country", "zone", "area")
//   6. Normalize whitespace
//   7. Title Case formatting
//
// This produces a clean value that can then be sent to AI for
// semantic resolution (abbreviation expansion, fuzzy matching).

// Emoji regex (same as cleaning-engine)
const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\u{20E3}\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]/gu;

// Geographic suffix noise — common suffixes that add no geographic meaning
const GEOGRAPHIC_SUFFIXES = [
  "region", "country", "zone", "area", "territory", "district",
  "state", "nation", "zone", "market",
];

// Values that are NEVER valid geographic entities — always RED_FLAG
// "unknown", "n/a", "none", "na", "nil", "tbd", "undefined", etc.
const GEOGRAPHIC_INVALID_VALUES = new Set([
  "unknown", "unk", "n/a", "none", "nil", "tbd",
  "undefined", "not available", "not_available", "not_a_value",
  "?", "!", "-", "???", "!!!",
  // NOTE: "na" REMOVED — it's a legitimate abbreviation for "North America" in REGION columns.
  // The post-processor will expand "NA" → "North America" when the expanded form exists.
]);

export interface GeographicRuleResult {
  original: string;
  ruleCleaned: string;    // After deterministic rules
  changed: boolean;
  isEmpty: boolean;       // Value became empty after cleaning (noise/symbols only)
  isInvalid: boolean;     // Value is known invalid (unknown, n/a, etc.) → RED_FLAG
  flags: string[];        // ["noise_removed", "suffix_stripped", "title_cased", "trimmed", "invalid_value"]
}

/**
 * Check if a value is a known invalid geographic value (unknown, n/a, none, etc.)
 */
export function isGeographicInvalid(val: string): boolean {
  if (!val || typeof val !== "string") return false;
  const t = val.trim().toLowerCase();
  return GEOGRAPHIC_INVALID_VALUES.has(t);
}

/**
 * Apply deterministic rules to a single geographic value (region or country).
 * Returns the rule-cleaned value + metadata about what was done.
 */
export function normalizeGeographicRules(raw: string): GeographicRuleResult {
  if (!raw || typeof raw !== "string") {
    return { original: raw, ruleCleaned: "", changed: false, isEmpty: true, isInvalid: false, flags: [] };
  }

  const flags: string[] = [];
  let s = raw.trim();

  // 0. Check for known invalid values → flag immediately, no further processing
  if (isGeographicInvalid(s)) {
    return {
      original: raw,
      ruleCleaned: s,       // Keep original value
      changed: false,
      isEmpty: false,
      isInvalid: true,       // Signals RED_FLAG to the caller
      flags: ["invalid_value"],
    };
  }

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

  // 3. Remove numbers (e.g., "emea2" → "emea", "latam3" → "latam")
  const afterNumbers = s.replace(/\d+/g, "").trim();
  if (afterNumbers !== s) {
    flags.push("noise_removed");
    s = afterNumbers;
  }

  // 4. Strip suffix noise from end of string (case-insensitive)
  // E.g., "emea region" → "emea", "india country" → "india"
  const lower = s.toLowerCase();
  for (const suffix of GEOGRAPHIC_SUFFIXES) {
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
    return { original: raw, ruleCleaned: "", changed: true, isEmpty: true, isInvalid: false, flags };
  }

  // 7. Title Case
  const titleCased = toTitleCase(s);
  if (titleCased !== s) {
    flags.push("title_cased");
    s = titleCased;
  }

  const changed = s !== raw.trim();

  return { original: raw, ruleCleaned: s, changed, isEmpty: false, isInvalid: false, flags };
}

/**
 * Title Case a string — capitalize first letter of each word.
 * Handles multi-word geographic entities.
 * Preserves standard abbreviations: APAC, EMEA, LATAM, NA, SA, UK, UAE, USA
 */
function toTitleCase(s: string): string {
  if (!s) return s;

  // Known abbreviations to preserve as-is
  const ABBREVIATIONS = new Set([
    "apac", "emea", "latam", "nafta", "asean", "eu", "g7", "g20",
    "na", "sa", "ea", "wa", "uk", "us", "uae", "usa",
    "cis", "oceania",
  ]);

  return s
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      // Preserve known abbreviations in uppercase
      if (ABBREVIATIONS.has(word.toLowerCase())) return word.toUpperCase();
      // Preserve dots and hyphens: "u.s." or "south-east"
      if (word.length === 1) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Batch-normalize an array of geographic values using deterministic rules.
 * Returns a Map from original → rule-cleaned value.
 */
export function batchNormalizeGeographic(values: string[]): Map<string, GeographicRuleResult> {
  const results = new Map<string, GeographicRuleResult>();
  for (const v of values) {
    const trimmed = (v || "").trim();
    if (trimmed === "") continue;
    results.set(trimmed, normalizeGeographicRules(trimmed));
  }
  return results;
}

/**
 * Check if a rule-cleaned geographic value likely needs AI semantic resolution.
 * Values that are:
 *   - Very short (≤3 chars, likely abbreviations: "ind", "us", "eu")
 *   - All uppercase with length ≤ 5 (likely abbreviation: "APAC" is fine, "A" is not)
 *   - Have no vowels in the cleaned form (garbage)
 *   - Common abbreviation patterns (3-5 chars, all caps)
 * ...need AI for abbreviation expansion / fuzzy matching.
 *
 * Values that are already proper-case with reasonable length (≥4 chars)
 * are considered "rules sufficient" — no AI needed.
 */
export function needsGeographicSemanticResolution(ruleCleaned: string): boolean {
  if (!ruleCleaned || ruleCleaned.length === 0) return false;

  // Pure noise/symbols → don't send to AI, it's garbage
  if (/^[^a-zA-Z]+$/.test(ruleCleaned)) return false;

  // Very short → likely abbreviation, needs AI
  if (ruleCleaned.length <= 3) return true;

  // All caps with length ≤ 8 → might be abbreviation
  if (ruleCleaned === ruleCleaned.toUpperCase() && ruleCleaned.length <= 5) return true;

  return false;
}
