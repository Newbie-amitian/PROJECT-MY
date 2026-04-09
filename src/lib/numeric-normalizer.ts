// ============================================================
// Intelligent Numeric Normalization Engine v2
// ============================================================
// Detects numeric columns, normalizes values with confidence
// scoring, and generates inline uncertainty flags.
//
// Pipeline:
//   STEP 1: Numeric Column Detection (≥60% threshold)
//   STEP 2: Value Normalization (word→digit, clean, range)
//   STEP 3: Confidence Scoring (0.0–1.0)
//   STEP 4: Flag Generation (< 0.85 → flagged)
//   STEP 5: Type Conversion (FLOAT vs INTEGER)

// ── Word-to-Number Map ─────────────────────────────

const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, "fourty": 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

// Only word-based keys (not digit strings) for fuzzy matching
const WORD_KEYS = Object.keys(WORD_TO_NUMBER).filter((k) => isNaN(Number(k)));

// ── Compound Word-Number Parser ────────────────────
// Handles concatenated word numbers: "thirtyfive" → 35, "sixtysix" → 66, "onehundred" → 100
// Also handles with suffix: "thirtyfivek" → 35000, "twentyfivek" → 25000
// Strategy: greedy longest-match from left to right
//   "thirtyfivek" → ["thirty", "five", "k"] → (30+5)*1000 = 35000
//   "onehundred" → ["one", "hundred"] → (1)*100 = 100
//   "sixtysix" → ["sixty", "six"] → 60+6 = 66

const MULTIPLIER_MAP: Record<string, number> = {
  // Single letter suffixes (any case — lowercased before lookup)
  k: 1000, m: 1000000, b: 1000000000, t: 1000000000000,
  l: 100000, // Indian Lakh
  g: 1000,   // "60g" colloquial
  // Short abbreviations
  cr: 10000000, // Indian Crore
  lpa: 100000, // Lakh Per Annum
  // Full word denominations
  thousand: 1000, thousands: 1000,
  million: 1000000, millions: 1000000,
  billion: 1000000000, billions: 1000000000,
  trillion: 1000000000000, trillions: 1000000000000,
  lakh: 100000, lakhs: 100000,
  crore: 10000000, crores: 10000000,
  // Colloquial
  grand: 1000, grands: 1000,
  thou: 1000, // abbreviation
  mil: 1000000, // abbreviation
  bil: 1000000000, // abbreviation
};

const ALL_MULTIPLIERS = Object.keys(MULTIPLIER_MAP).sort((a, b) => b.length - a.length);

const ALL_WORD_NUMBERS = Object.keys(WORD_TO_NUMBER);
// Sort by length descending so longest match wins (e.g., "thirteen" before "three")
ALL_WORD_NUMBERS.sort((a, b) => b.length - a.length);

function tryParseCompoundWordNumber(input: string): { value: number; confidence: number } | null {
  let lower = input.toLowerCase().trim();

  // Check for trailing multiplier suffix (greedy longest-match)
  // Handles: k, m, b, l, cr, lpa, thousand, million, billion, lakh, crore
  let mult = 1;
  let consumedByMult = 0;

  // Skip spaces at the end, then try to match a multiplier
  let stripped = lower.replace(/\s+$/, "");
  for (const m of ALL_MULTIPLIERS) {
    if (stripped.endsWith(m)) {
      mult = MULTIPLIER_MAP[m] ?? 1;
      consumedByMult = m.length;
      stripped = stripped.slice(0, -consumedByMult);
      // Also consume any space before multiplier
      stripped = stripped.replace(/\s+$/, "");
      break;
    }
  }

  lower = stripped;

  // Greedy left-to-right longest match
  let pos = 0;
  let total = 0;
  let matchedAny = false;
  let wordCount = 0;

  while (pos < lower.length) {
    let found = false;
    for (const word of ALL_WORD_NUMBERS) {
      if (lower.startsWith(word, pos)) {
        const num = WORD_TO_NUMBER[word];
        // "hundred" acts as multiplier for preceding value
        if (num === 100 && wordCount > 0) {
          total = total * 100;
        } else {
          total += num;
        }
        pos += word.length;
        matchedAny = true;
        wordCount++;
        found = true;
        break;
      }
    }
    if (!found) break; // Can't parse further
  }

  // Must consume entire string and match at least 1 word
  if (!matchedAny || pos !== lower.length || wordCount === 0) return null;

  return { value: total * mult, confidence: 0.90 };
}

// ── Column Name Patterns ───────────────────────────

const NUMERIC_NAME_PATTERNS = [
  /\b(year|years|yr|age|old|duration|tenure|exp|experience)\b/i,
  /\b(rating|rate|score|grade|gpa|mark|points|point)\b/i,
  /\b(salary|wage|pay|income|revenue|cost|price|amount|fee|budget)\b/i,
  /\b(count|total|sum|quantity|qty|number|num|volume)\b/i,
  /\b(percent|percentage|pct|ratio|proportion|share)\b/i,
  /\b(range|avg|average|mean|median|min|max|stdev|std)\b/i,
  /\b(height|width|length|depth|weight|mass|size|area|distance|speed|velocity)\b/i,
  /\b(temperature|temp|humidity|pressure|frequency)\b/i,
  /\b(id_|_id|no_|_no|seq|index)\b/i,
  /\b(hours|hrs|minutes|min|seconds|sec|days|weeks|months|time)\b/i,
];

// ── Flag Types ─────────────────────────────────────

export type FlagType =
  | "fuzzy_match"        // Prefix match: "fiv" → 5 (distance 1, e.g., "fiv" vs "five")
  | "fuzzy_number"       // Misspelled word number: "fiv", "sics" (general fuzzy number)
  | "typo_uncertain"     // Edit distance 2: "fourr" → 4 (e.g., "fourr" vs "four", "thre" vs "three")
  | "mixed_unit"         // Number with attached text (e.g., "4 years" → 4)
  | "non_numeric"        // Non-numeric text in a numeric column (e.g., "good", "high", "low")
  | "invalid_numeric"     // Unrecognized text that cannot be converted — flagged, never NaN
  | "ambiguous_number"   // Unclear numeric meaning
  | "ambiguous_numeric"  // Word number in ambiguous context — not converted for safety
  | "low_confidence"     // General below-threshold flag
  | "reversed_range"     // Range bounds were swapped (e.g., "70000-50000")
  | "partial_range";     // Only one bound parseable

export interface CellFlag {
  raw: string;              // Original value before transformation
  flag: FlagType;           // Type of uncertainty
  confidence: number;       // 0.0 – 1.0
  reason: string;           // Human-readable explanation
  suggestedValue?: unknown; // What the normalizer thinks it should be
}

export interface FlaggedNormalization {
  value: unknown;           // Final value (number, string, or null)
  flag: CellFlag | null;    // Flag if confidence < 0.85
}

// ── Levenshtein Distance ───────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      prev = temp;
    }
  }
  return dp[n];
}

// ── Fuzzy Word Match ───────────────────────────────

function findFuzzyWordMatch(input: string): { word: string; number: number; distance: number } | null {
  const lower = input.toLowerCase().trim();
  if (lower.length < 3) return null; // Too short to fuzzy match

  let best: { word: string; number: number; distance: number } | null = null;
  for (const word of WORD_KEYS) {
    const dist = levenshtein(lower, word);
    if (dist > 0 && dist <= 2) {
      if (!best || dist < best.distance) {
        best = { word, number: WORD_TO_NUMBER[word], distance: dist };
      }
    }
  }
  return best;
}

// ── Mixed Unit Detection ───────────────────────────

function tryExtractMixedUnit(str: string): { number: number; unit: string } | null {
  // Generic: ANY number followed by space and text — "4 years", "3 pcs", "10 units", "5 things"
  const match = str.trim().match(/^([\d.]+)\s+([a-zA-Z]\S*)$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  return { number: num, unit: match[2].toLowerCase() };
}

// BUG FIX #3: Extract number from attached-unit strings like "4years", "2yrs", "3pcs"
function tryExtractAttachedUnit(str: string): { number: number; unit: string } | null {
  // Generic: ANY number followed immediately by text — "4years", "3pcs", "10items"
  const match = str.trim().match(/^([\d.]+)([a-zA-Z]\S*)$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  const unit = match[2].toLowerCase();
  // Only match if the text part looks like a word (not random letters after a number that happens to be text)
  if (unit.length >= 1 && unit.length <= 20) {
    return { number: num, unit };
  }
  return null;
}

// ── 3-Tier Confidence Engine ────────────────────────
// ≥ 0.90 → auto apply (no flag)
// 0.70–0.89 → apply + soft flag (WARNING)
// < 0.70 → DO NOT apply, mark as NEEDS_REVIEW (HIGH_RISK / BLOCKED)

const CONFIDENCE_AUTO = 0.90;
const CONFIDENCE_SOFT_FLAG = 0.70;  // below this → NEEDS_REVIEW

// Map confidence to severity level
function confidenceToSeverity(confidence: number): "clean" | "warning" | "high_risk" | "blocked" {
  if (confidence >= CONFIDENCE_AUTO) return "clean";
  if (confidence >= CONFIDENCE_SOFT_FLAG) return "warning";
  return "high_risk";
}

// ── Types ──────────────────────────────────────────

export interface NumericColumnDetection {
  column: string;
  isNumeric: boolean;
  confidence: "high" | "medium" | "low";
  detectedBy: string[];
  reasons: string[];
  sampleIssues: string[];
}

export interface NormalizationResult {
  value: unknown;
  wasNormalized: boolean;
  normalizationSteps: string[];
}

// ── STEP 1: Numeric Column Detection ───────────────

/**
 * Detect if a column is semantically numeric.
 * Threshold: ≥60% values are numeric-like
 */
export function detectNumericColumns(
  data: Record<string, unknown>[],
  columns: { name: string; type: string }[]
): NumericColumnDetection[] {
  return columns.map((col) => {
    const values = data.map((r) => r[col.name]).filter((v) => v !== null && v !== undefined);
    const stringValues = values.map((v) => String(v).trim()).filter((s) => s !== "");
    const detectedBy: string[] = [];
    const reasons: string[] = [];
    const sampleIssues: string[] = [];

    // Check 1: Schema type is already "number"
    const isTypedNumber = col.type === "number";
    if (isTypedNumber) {
      detectedBy.push("schema_type");
      reasons.push("Schema type is 'number'");
    }

    // Check 2: Column name suggests numeric
    const nameMatch = NUMERIC_NAME_PATTERNS.some((pat) => pat.test(col.name));
    if (nameMatch) {
      detectedBy.push("column_name");
      reasons.push(`Column name suggests measurement: ${col.name}`);
    }

    // Check 3: ≥60% of values are numeric-like
    if (stringValues.length > 0) {
      let numericLikeCount = 0;
      let wordNumberCount = 0;
      let rangeCount = 0;
      let messyNumericCount = 0;
      let mixedUnitCount = 0;

      for (const sv of stringValues) {
        // Direct number
        if (!isNaN(Number(sv)) && sv !== "") {
          numericLikeCount++;
        }
        // Word-based number
        else if (WORD_TO_NUMBER[sv.toLowerCase()] !== undefined) {
          wordNumberCount++;
          if (sampleIssues.length < 3) sampleIssues.push(`word number: "${sv}"`);
        }
        // Fuzzy word match
        else if (findFuzzyWordMatch(sv) !== null) {
          wordNumberCount++;
          if (sampleIssues.length < 3) sampleIssues.push(`fuzzy word: "${sv}"`);
        }
        // Range pattern
        else if (/(\d+)\s*[-–—]\s*(\d+)/.test(sv)) {
          rangeCount++;
          if (sampleIssues.length < 3) sampleIssues.push(`range: "${sv}"`);
        }
        // Mixed unit (number + text)
        else if (tryExtractMixedUnit(sv) !== null) {
          mixedUnitCount++;
          if (sampleIssues.length < 3) sampleIssues.push(`mixed unit: "${sv}"`);
        }
        // Messy numeric (commas, spaces inside digits)
        else if (/^[\s,\d.]+[km]?$/.i.test(sv.replace(/\s/g, ""))) {
          messyNumericCount++;
          if (sampleIssues.length < 3) sampleIssues.push(`messy numeric: "${sv}"`);
        }
      }

      const totalNonEmpty = stringValues.length;
      const numericTotal = numericLikeCount + wordNumberCount + rangeCount + messyNumericCount + mixedUnitCount;
      const numericRatio = numericTotal / totalNonEmpty;

      // Threshold: ≥60% (updated from 70%)
      if (numericRatio >= 0.6 && totalNonEmpty >= 3) {
        detectedBy.push("value_pattern");
        reasons.push(`${(numericRatio * 100).toFixed(0)}% of values are numeric-like (${numericTotal}/${totalNonEmpty})`);
        if (wordNumberCount > 0) reasons.push(`${wordNumberCount} word-based numbers detected`);
        if (rangeCount > 0) reasons.push(`${rangeCount} range values detected`);
        if (mixedUnitCount > 0) reasons.push(`${mixedUnitCount} mixed-unit values detected`);
        if (messyNumericCount > 0) reasons.push(`${messyNumericCount} messy numeric strings detected`);
      }
    }

    // Determine final confidence
    let isNumeric = false;
    let confidence: "high" | "medium" | "low" = "low";

    if (detectedBy.length >= 2 || (isTypedNumber && nameMatch)) {
      isNumeric = true;
      confidence = "high";
    } else if (detectedBy.length === 1) {
      if (detectedBy[0] === "value_pattern" && reasons.some((r) => r.includes("word-based") || r.includes("mixed-unit"))) {
        isNumeric = true;
        confidence = "medium";
      } else if (detectedBy[0] === "column_name" || detectedBy[0] === "schema_type") {
        isNumeric = true;
        confidence = "medium";
      } else if (detectedBy[0] === "value_pattern") {
        isNumeric = true;
        confidence = "low";
      }
    }

    return { column: col.name, isNumeric, confidence, detectedBy, reasons, sampleIssues };
  });
}

// ── STEP 2+3+4: Value Normalization with Confidence ─

/**
 * Normalize a single value with 3-tier confidence scoring and flag generation.
 * ≥ 0.90 → auto apply (no flag)
 * 0.70–0.89 → apply + soft flag ⚠ (severity: warning)
 * < 0.70 → DO NOT apply, mark as NEEDS_REVIEW (severity: high_risk)
 */
export function normalizeWithFlags(value: unknown): FlaggedNormalization {
  // ── Null / undefined → NULL (no flag) ──
  if (value === null || value === undefined) {
    return { value: null, flag: null };
  }

  const str = String(value).trim();
  const raw = str;

  // ── Empty, NA, N/A, undefined, dash → NULL (no flag) ──
  if (str === "" || /^(na|n\/a|null|undefined|-|none|nan|nil|tbd|n\.a\.|not available)$/i.test(str)) {
    return { value: null, flag: null };
  }

  // ── Already a valid number → passthrough (confidence 1.0) ──
  if (typeof value === "number" && isFinite(value)) {
    return { value, flag: null };
  }

  // ── A. Exact word-to-number (confidence 0.95) → auto ──
  const wordKey = str.toLowerCase();
  if (WORD_TO_NUMBER[wordKey] !== undefined) {
    return {
      value: WORD_TO_NUMBER[wordKey],
      flag: null, // 0.95 ≥ 0.90 → auto, no flag
    };
  }

  // ── A2. Compound word-number (confidence 0.90) → auto ──
  // Handles: "thirtyfivek" → 35000, "twentyfive" → 25, "onehundred" → 100
  const compound = tryParseCompoundWordNumber(str);
  if (compound) {
    return { value: compound.value, flag: null };
  }

  // ── B. Fuzzy / typo word match ──
  const fuzzy = findFuzzyWordMatch(str);
  if (fuzzy) {
    // Distance 1: prefix typo ("fiv" → 5) — warning tier
    // Distance 2+: edit-distance typo ("fourr" → 4) — high_risk, DO NOT apply
    const isTypo = fuzzy.distance >= 2;
    const flagType = isTypo ? "typo_uncertain" : "fuzzy_number";
    const conf = isTypo ? 0.55 : 0.75;
    const severity = confidenceToSeverity(conf);

    if (severity === "high_risk") {
      // DO NOT apply — return original with NEEDS_REVIEW flag
      return {
        value: raw,
        flag: {
          raw,
          flag: flagType as FlagType,
          confidence: conf,
          severity: "high_risk",
          reason: `invalid_numeric (distance ${fuzzy.distance})`,
          suggestedValue: fuzzy.number,
        },
      };
    }
    // Warning tier (0.70-0.89): apply + soft flag
    return {
      value: fuzzy.number,
      flag: {
        raw,
        flag: flagType as FlagType,
        confidence: conf,
        severity: "warning",
        reason: `invalid_numeric (distance ${fuzzy.distance})`,
        suggestedValue: fuzzy.number,
      },
    };
  }

  // ── C. Mixed unit extraction (confidence 0.80) → warning tier ──
  const mixed = tryExtractMixedUnit(str);
  if (mixed) {
    return {
      value: mixed.number,
      flag: {
        raw,
        flag: "mixed_unit",
        confidence: 0.80,
        severity: "warning",
        reason: `mixed_unit (${mixed.unit} stripped)`,
        suggestedValue: mixed.number,
      },
    };
  }

  // ── C2. BUG FIX #3: Attached unit extraction (confidence 0.80) → "4years", "2yrs" ──
  const attached = tryExtractAttachedUnit(str);
  if (attached) {
    return {
      value: attached.number,
      flag: {
        raw,
        flag: "mixed_unit",
        confidence: 0.80,
        severity: "warning",
        reason: `mixed_unit (${attached.unit} stripped)`,
        suggestedValue: attached.number,
      },
    };
  }

  // ── D. Clean numeric strings ──
  let cleaned = str
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "-");

  // ── E. Try as plain number after cleaning ──
  const plainNum = Number(cleaned);
  if (!isNaN(plainNum) && cleaned !== "") {
    // Check for range
    const rangeMatch = cleaned.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
    if (rangeMatch) {
      const lower = parseFloat(rangeMatch[1]);
      const upper = parseFloat(rangeMatch[2]);
      if (!isNaN(lower) && !isNaN(upper)) {
        let swapped = false;
        let lo = lower, hi = upper;
        if (lo > hi) { [lo, hi] = [hi, lo]; swapped = true; }
        const avg = (lo + hi) / 2;
        const conf = swapped ? 0.85 : 0.92;
        const severity = confidenceToSeverity(conf);
        const flag: CellFlag | null = severity === "warning" ? {
          raw, flag: "reversed_range", confidence: conf, severity: "warning",
          reason: `reversed_range (${lower}→${upper})`,
          suggestedValue: avg,
        } : null;
        return { value: avg, flag };
      }
      // Partial range → high_risk, DO NOT apply
      return {
        value: null,
        flag: {
          raw, flag: "partial_range", confidence: 0.40, severity: "high_risk",
          reason: `partial_range`,
        },
      };
    }

    // Suffix range: "50K-70K"
    const suffixRangeMatch = cleaned.match(/^([\d.]+)([km])\s*-\s*([\d.]+)([km])$/i);
    if (suffixRangeMatch) {
      const mult = (s: string) => s.toLowerCase() === "k" ? 1000 : 1000000;
      const val1 = parseFloat(suffixRangeMatch[1]) * mult(suffixRangeMatch[2]);
      const val2 = parseFloat(suffixRangeMatch[3]) * mult(suffixRangeMatch[4]);
      if (!isNaN(val1) && !isNaN(val2)) {
        const lo = Math.min(val1, val2);
        const hi = Math.max(val1, val2);
        const avg = (lo + hi) / 2;
        const swapped = val1 > val2;
        const conf = swapped ? 0.85 : 0.92;
        const severity = confidenceToSeverity(conf);
        const flag: CellFlag | null = severity === "warning" ? {
          raw, flag: "reversed_range", confidence: conf, severity: "warning",
          reason: `reversed_range (suffix)`,
          suggestedValue: avg,
        } : null;
        return { value: avg, flag };
      }
    }

    // Single number with suffix (K, M)
    const suffixMatch = cleaned.match(/^([\d.]+)([km])$/i);
    if (suffixMatch) {
      const num = parseFloat(suffixMatch[1]);
      const multiplier = suffixMatch[2].toLowerCase() === "k" ? 1000 : 1000000;
      return {
        value: num * multiplier,
        flag: null, // 0.95 ≥ 0.90 → auto
      };
    }

    // Plain number (possibly after cleaning)
    return { value: plainNum, flag: null };
  }

  // ── F. Non-numeric text → NULL + ⚠ invalid_numeric (NEVER silently convert to NaN) ──
  // DETERMINISTIC GUARANTEE: same input X ALWAYS produces same output.
  // Word numbers (e.g., "four") are handled above in step A.
  // If we reach here, the input is unrecognized text — flag as invalid_numeric, not NaN.
  return {
    value: null,
    flag: {
      raw,
      flag: "invalid_numeric" as FlagType,
      confidence: 0.30,
      severity: "high_risk",
      reason: `invalid_numeric (unrecognized text — cannot silently convert to NaN)`,
      suggestedValue: raw,
    },
  };
}

// ── Legacy API (backward compatible) ───────────────

export function normalizeNumericValue(value: unknown): NormalizationResult {
  const steps: string[] = [];
  if (value === null || value === undefined) {
    return { value: null, wasNormalized: false, normalizationSteps: [] };
  }
  const str = String(value).trim();
  if (str === "" || /^(na|n\/a|null|undefined|-|none|nan|nil|tbd)$/i.test(str)) {
    return { value: null, wasNormalized: false, normalizationSteps: ["mapped to NULL"] };
  }
  if (typeof value === "number" && isFinite(value)) {
    return { value, wasNormalized: false, normalizationSteps: [] };
  }

  const wordKey = str.toLowerCase();
  if (WORD_TO_NUMBER[wordKey] !== undefined) {
    steps.push(`word "${str}" → ${WORD_TO_NUMBER[wordKey]}`);
    return { value: WORD_TO_NUMBER[wordKey], wasNormalized: true, normalizationSteps: steps };
  }

  let cleaned = str.replace(/,/g, "").replace(/\s+/g, "").replace(/–/g, "-").replace(/—/g, "-");
  const plainNum = Number(cleaned);
  if (!isNaN(plainNum) && cleaned !== "") {
    return { value: plainNum, wasNormalized: true, normalizationSteps: steps };
  }
  steps.push(`non-numeric "${str}" → NULL`);
  return { value: null, wasNormalized: true, normalizationSteps: steps };
}

// ── Apply Normalization to a Column (with Flags) ──

export interface NormalizationStats {
  totalRows: number;
  normalized: number;
  nullified: number;
  unchanged: number;
  flagged: number;
  detectedType: "float" | "integer";
  wordNumbersFound: number;
  fuzzyMatches: number;
  mixedUnits: number;
  rangesFound: number;
  nonNumeric: number;
}

/**
 * Apply numeric normalization with confidence-based flagging.
 * Returns: cleaned data, flag map (keyed by "rowIdx-colName"), stats.
 */
export function applyNumericNormalization(
  data: Record<string, unknown>[],
  column: string
): {
  data: Record<string, unknown>[];
  flagMap: Map<string, CellFlag>;
  stats: NormalizationStats;
} {
  let normalized = 0;
  let nullified = 0;
  let unchanged = 0;
  let flagged = 0;
  let wordNumbersFound = 0;
  let fuzzyMatches = 0;
  let mixedUnits = 0;
  let rangesFound = 0;
  let nonNumeric = 0;
  const allResults: (number | string | null)[] = [];
  const flagMap = new Map<string, CellFlag>();

  const result = data.map((row, rowIdx) => {
    const raw = row[column];
    const { value, flag } = normalizeWithFlags(raw);

    if (flag) {
      flagged++;
      flagMap.set(`${rowIdx}-${column}`, flag);
      if (flag.flag === "fuzzy_match" || flag.flag === "typo_uncertain") fuzzyMatches++;
      else if (flag.flag === "mixed_unit") mixedUnits++;
      else if (flag.flag === "non_numeric") nonNumeric++;
      else if (flag.flag === "reversed_range" || flag.flag === "partial_range") rangesFound++;
    }

    if (raw === null || raw === undefined) {
      unchanged++;
    } else if (value === null && raw !== null && raw !== undefined) {
      nullified++;
    } else if (value !== raw) {
      normalized++;
      // Count sub-types for stats
      const s = String(raw).trim().toLowerCase();
      if (WORD_TO_NUMBER[s] !== undefined) wordNumbersFound++;
      else if (/(\d+)\s*[-–—]\s*(\d+)/.test(String(raw))) rangesFound = Math.max(rangesFound, 1);
    } else {
      unchanged++;
    }

    allResults.push(typeof value === "number" || value === null ? value : value);
    return { ...row, [column]: value };
  });

  // Determine type from numeric results only
  const numericResults = allResults.filter((v): v is number => typeof v === "number");
  let detectedType: "float" | "integer" = "integer";
  for (const v of numericResults) {
    if (!Number.isInteger(v)) { detectedType = "float"; break; }
  }

  return {
    data: result,
    flagMap,
    stats: {
      totalRows: data.length,
      normalized,
      nullified,
      unchanged,
      flagged,
      detectedType,
      wordNumbersFound,
      fuzzyMatches,
      mixedUnits,
      rangesFound,
      nonNumeric,
    },
  };
}

// ── Monetary Value Cleaner ─────────────────────────

export interface MonetaryCleanResult {
  value: number | null;
  steps: string[];
  flag?: string;
  original?: string;
}

/**
 * Clean monetary values by removing currency symbols, noise tokens,
 * detecting multipliers (K, M, B, Cr, LPA), and extracting the numeric part.
 *
 * Handles: "₹60000", "50K", "1.2M", "40K INR", "5LPA", "3.5 Cr",
 * "approx 60k", "~60000", "70k+", "50k to 70k", etc.
 */
export function cleanMonetaryValue(value: unknown): MonetaryCleanResult {
  const steps: string[] = [];

  // Null / undefined → NULL
  if (value === null || value === undefined) {
    return { value: null, steps: ["null input → NULL"] };
  }

  let v = String(value).toLowerCase().trim();
  if (v === "") return { value: null, steps: ["empty → NULL"] };

  // NA patterns → NULL
  if (/^(na|n\/a|null|undefined|-|none|nan|nil|tbd|n\.a\.|not available)$/i.test(v)) {
    return { value: null, steps: ["null pattern → NULL"] };
  }

  // ── Step 1: Remove currency symbols + noise tokens ──
  // NOTE: "lpa", "lakh", "crore" are NOT noise — they are multipliers (handled in Step 2)
  const noiseTokens = [
    "₹", "$", "€", "£", "¥",
    "inr", "rs", "rupees", "usd", "eur", "gbp",
    "approx", "~", "+",
    "/month", "/year", "/mo", "/yr",
    "per annum", "pa", "per month", "per year",
    "annually", "p.a", "p.a.",
    ",", " ",
  ];

  const original = v;
  for (const token of noiseTokens) {
    // Word-boundary aware replacement for multi-char tokens
    if (token.length > 1 && /^[a-z]/.test(token)) {
      // Use word boundary for alphabetic tokens
      const regex = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      v = v.replace(regex, " ");
    } else {
      v = v.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), " ");
    }
  }
  v = v.replace(/\s+/g, " ").trim();
  steps.push(`cleaned: "${original}" → "${v}"`);

  // ── Step 2: Detect multiplier (prioritize LONGER words) ──
  let mult = 1;
  let multLabel = "";

  // Indian notation: crore (prioritize LONGER words first)
  if (/\bcrore\b/.test(v)) {
    mult = 1e7;
    multLabel = "crore (×10000000)";
    v = v.replace(/\bcrore\b/g, " ");
  } else if (/\bcr\b/.test(v)) {
    mult = 1e7;
    multLabel = "Cr (×10000000)";
    v = v.replace(/\bcr\b/g, " ");
  } else if (/\blakh\b/.test(v)) {
    mult = 1e5;
    multLabel = "lakh (×100000)";
    v = v.replace(/\blakh\b/g, " ");
  } else if (/\blpa\b/.test(v)) {
    mult = 1e5; // lakh per annum
    multLabel = "LPA (×100000)";
    v = v.replace(/\blpa\b/g, " ");
  }

  // Check "trillion" / "tn" BEFORE "thousand" / "th" (prioritize longer)
  if (mult === 1 && /\btrillion\b|\btn\b/.test(v)) {
    mult = 1e12;
    multLabel = "trillion (×1e12)";
    v = v.replace(/\btrillion\b|\btn\b/g, " ");
  } else if (mult === 1 && /\bbillion\b|\bbn\b/.test(v)) {
    mult = 1e9;
    multLabel = "billion (×1e9)";
    v = v.replace(/\bbillion\b|\bbn\b/g, " ");
  } else if (mult === 1 && /\bmillion\b|\bmn\b/.test(v)) {
    mult = 1e6;
    multLabel = "million (×1e6)";
    v = v.replace(/\bmillion\b|\bmn\b/g, " ");
  } else if (mult === 1 && /\bthousand\b|\bth\b/.test(v)) {
    mult = 1e3;
    multLabel = "thousand (×1e3)";
    v = v.replace(/\bthousand\b|\bth\b/g, " ");
  }

  if (multLabel) {
    steps.push(`multiplier: ${multLabel}`);
  }

  v = v.replace(/\s+/g, " ").trim();

  // K, M, B, L suffix detection with word boundaries
  // "500K" matches but "MARK" does NOT match "K"
  if (mult === 1) {
    // Check for 'k' suffix — must be preceded by digit and NOT followed by alpha
    const kMatch = v.match(/\b(\d[\d.]*)\s*k\b/i);
    if (kMatch) {
      mult = 1e3;
      multLabel = "K (×1000)";
      v = v.replace(/\b(\d[\d.]*)\s*k\b/i, "$1 ");
      steps.push(`multiplier: ${multLabel}`);
    } else {
      // Check for 'm' suffix — NOT "mn" or "million" or "months"
      const mMatch = v.match(/\b(\d[\d.]*)\s*m\b/i);
      if (mMatch && !/\b(million|mn|months?|mons?)\b/.test(v)) {
        mult = 1e6;
        multLabel = "M (×1000000)";
        v = v.replace(/\b(\d[\d.]*)\s*m\b/i, "$1 ");
        steps.push(`multiplier: ${multLabel}`);
      } else {
        // Check for 'b' suffix — NOT "bn" or "billion"
        const bMatch = v.match(/\b(\d[\d.]*)\s*b\b/i);
        if (bMatch && !/\b(billion|bn)\b/.test(v)) {
          mult = 1e9;
          multLabel = "B (×1000000000)";
          v = v.replace(/\b(\d[\d.]*)\s*b\b/i, "$1 ");
          steps.push(`multiplier: ${multLabel}`);
        } else {
          // Check for 'l' suffix (Indian lakh) — NOT inside words, word boundary
          const lMatch = v.match(/\b(\d[\d.]*)\s*l\b/i);
          if (lMatch && !/\b(lakh|lpa)\b/.test(v)) {
            mult = 1e5;
            multLabel = "L (×100000)";
            v = v.replace(/\b(\d[\d.]*)\s*l\b/i, "$1 ");
            steps.push(`multiplier: ${multLabel}`);
          }
        }
      }
    }
  }

  v = v.replace(/\s+/g, " ").trim();

  // ── Step 2.5: Handle "X to Y" range → average ──
  const rangeMatch = v.match(/^([\d.]+)\s+to\s+([\d.]+)$/);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]);
    const hi = parseFloat(rangeMatch[2]);
    if (!isNaN(lo) && !isNaN(hi)) {
      const avg = (lo + hi) * mult / 2;
      steps.push(`range average: ${lo} to ${hi} × ${multLabel || "×1"} → avg ${avg}`);
      return { value: Math.round(avg * 100) / 100, steps, flag: "range_average", original };
    }
  }

  // Handle hyphen range: "50-70"
  const hyphenRangeMatch = v.match(/^([\d.]+)\s*[-–—]\s*([\d.]+)$/);
  if (hyphenRangeMatch) {
    const lo = parseFloat(hyphenRangeMatch[1]);
    const hi = parseFloat(hyphenRangeMatch[2]);
    if (!isNaN(lo) && !isNaN(hi)) {
      const avg = (lo + hi) * mult / 2;
      steps.push(`hyphen range average: ${lo}-${hi} × ${multLabel || "×1"} → avg ${avg}`);
      return { value: Math.round(avg * 100) / 100, steps, flag: "range_average", original };
    }
  }

  // ── Step 2.8: Try compound word-number parsing BEFORE giving up ──
  // Handles: "thirtyfivek", "twentyfivek", "fortyfivek", "onehundred", etc.
  const wordOnly = v.replace(/[\s.,]+/g, "").trim();
  if (wordOnly && !/^\d/.test(wordOnly)) {
    const compoundResult = tryParseCompoundWordNumber(wordOnly);
    if (compoundResult) {
      const finalVal = compoundResult.value * mult;
      steps.push(`compound word: "${wordOnly}" → ${compoundResult.value}${multLabel ? " × " + multLabel : ""} → ${finalVal}`);
      return { value: Math.round(finalVal * 100) / 100, steps, original };
    }
  }

  // ── Step 3: Extract numeric part ──
  const numMatch = v.match(/([\d]+(?:\.\d+)?)/);
  if (!numMatch) {
    return { value: null, steps: [...steps, "no numeric found → NULL"], flag: "non_numeric" };
  }

  const num = parseFloat(numMatch[1]);
  if (isNaN(num)) {
    return { value: null, steps: [...steps, "NaN → NULL"], flag: "non_numeric" };
  }

  // ── Step 4: Multiply ──
  const result = num * mult;
  steps.push(`extracted ${num} × ${mult} = ${result}`);

  return { value: Math.round(result * 100) / 100, steps, original };
}

// ── Normalize Entire Dataset ───────────────────────

export interface DatasetNormalizationResult {
  data: Record<string, unknown>[];
  flagMap: Map<string, CellFlag>;
  columnFlags: Map<string, number>; // column → flagged count
  totalFlags: number;
  columnDetections: NumericColumnDetection[];
  columnStats: Map<string, NormalizationStats>;
}

/**
 * Detect numeric columns and normalize all of them in one pass.
 * Returns the full cleaned dataset with inline flags.
 */
export function normalizeDataset(
  data: Record<string, unknown>[],
  columns: { name: string; type: string }[]
): DatasetNormalizationResult {
  const detections = detectNumericColumns(data, columns);
  const numericCols = detections.filter((d) => d.isNumeric);

  let result = data.map((row) => ({ ...row }));
  const mergedFlagMap = new Map<string, CellFlag>();
  const columnFlags = new Map<string, number>();
  const columnStats = new Map<string, NormalizationStats>();

  for (const det of numericCols) {
    const { data: normalized, flagMap, stats } = applyNumericNormalization(result, det.column);
    result = normalized;

    // Merge flags (adjust row indices since data is already transformed)
    flagMap.forEach((flag, key) => {
      mergedFlagMap.set(key, flag);
    });

    columnFlags.set(det.column, flagMap.size);
    columnStats.set(det.column, stats);
  }

  return {
    data: result,
    flagMap: mergedFlagMap,
    columnFlags,
    totalFlags: mergedFlagMap.size,
    columnDetections: detections,
    columnStats,
  };
}
