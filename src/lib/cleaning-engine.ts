// ============================================================
// Dynamic Self-Learning Data Cleaning Engine
// ============================================================
// Zero hardcoded value lists. All categorical mapping is discovered
// dynamically from data frequency + similarity + memory engine.
//
// Pipeline: NULL → Numeric Extract → Word-to-Number → Categorical Cluster → Flag
// Core Principle: ALWAYS prefer extraction/transformation over flagging.
//
// Architecture:
//   🧱 Layer 1: Raw Engine — deterministic universal rules (NULL, numeric, date)
//   🧠 Layer 2: Learning Engine — frequency clustering + similarity grouping
//   💾 Layer 3: Memory Engine — persistent mapping memory across sessions
//   🛡️ Promotion: OBSERVED → CONFIRMED → ACTIVE (with drift detection)
//
// NO API. NO ML. NO hardcoded value lists. PURE deterministic logic.

import type { RawDataRow, ColumnMeta, CellFlag, FlagSeverity } from "./dashboard-types";
import { parseRangeValue } from "./range-parser";
import { memoryEngine, type ColumnMappingMemory, type DriftAlert } from "./memory-engine";
import { cleanMonetaryValue, detectSemanticType } from "./semantic-analyzer";
import { parseSalaryValue, containsWordNumber, looksLikeSalaryValue, parseSalaryWithAI } from "./salary-parser";

// ── Number Words for Smart Decimal Detection ──────────────────────────────────
// Used to determine if a "." is a decimal separator or just text
const NUMBER_WORDS = new Set([
  // Units
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  // Tens
  "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  // Scales
  "hundred", "thousand", "million", "billion", "trillion", "lakh", "crore",
  // Common abbreviations
  "k", "m", "b", "l", "cr",
  // Fractional words
  "half", "quarter", "third", "percent", "percentage", "pct",
]);

// Check if a string part is numeric or a number word
function isNumericOrNumberWord(part: string): boolean {
  const trimmed = part.trim().toLowerCase();
  if (trimmed === "") return false;
  // Is it a plain number?
  if (/^[\d,]+$/.test(trimmed)) return true;
  // Is it a number word?
  if (NUMBER_WORDS.has(trimmed)) return true;
  // Is it a hyphenated number word like "thirty-five"?
  const words = trimmed.split(/[\s\-]+/);
  if (words.every(w => NUMBER_WORDS.has(w))) return true;
  return false;
}

// Smart decimal detection: returns true if "." is a decimal separator (not text delimiter)
// Logic: if both parts around "." are numeric or number words → it's a decimal
function isSmartDecimal(s: string): boolean {
  if (!s.includes(".")) return false;
  const parts = s.split(".");
  if (parts.length !== 2) return false; // Multiple dots = likely text (e.g., "item.description.value")
  
  const [before, after] = parts;
  // Both parts should be numeric or number words for it to be a decimal
  const beforeIsNumeric = isNumericOrNumberWord(before);
  const afterIsNumeric = isNumericOrNumberWord(after);
  
  // If after part is just digits (like "3.5") → definitely decimal
  if (beforeIsNumeric && /^\d+$/.test(after.trim())) return true;
  
  // If both parts are numeric-like → decimal
  if (beforeIsNumeric && afterIsNumeric) return true;
  
  // Otherwise it's text (like "item.description", "user.name")
  return false;
}

// ── Strict Email Regex ──────────────────────────────────
// local@domain.tld — requires proper TLD (≥2 alpha chars)
// Rejects: "vikram@mail", "a@b.c", "user@", "@domain.com"
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
import type { SemanticType } from "./semantic-analyzer";

// ── Column Type Detection ──────────────────────────

export type DetectedType = "numeric_integer" | "numeric_float" | "text" | "categorical" | "date" | "range" | "semi_structured_numeric" | "id" | "boolean";

// Semantic type from semantic-analyzer — multi-signal confidence scoring
export type { SemanticType } from "./semantic-analyzer";

export interface SemanticDetectionResult {
  type: SemanticType;
  confidence: number;
  scores: Record<string, number>;
  signals: string[];
  understanding?: string;
  validationRules?: {
    allowedPattern: string;
    constraints: string[];
  };
  normalizationPlan?: {
    targetDatatype: string;
    steps: string[];
    unitHandling: string;
  };
}

export interface ColumnProfile {
  name: string;
  detectedType: DetectedType;
  missingCount: number;
  missingPct: number;
  uniqueCount: number;
  totalCount: number;
  sampleValues: string[];
  hasRanges: boolean;
  hasWordNumbers: boolean;
  hasMixedUnits: boolean;
  numericPct: number;
  numericLikePct: number;
  dateLikePct: number;
  categoricalScore: number;
  isIdColumn: boolean;
  isBooleanColumn: boolean;
  isDateColumn: boolean;
  isConsistentCase: boolean;
  semanticType?: SemanticType;
  semanticConfidence?: number;
  semanticSignals?: string[];
}

const NULL_VALUES = new Set(["", " ", "null", "null ", " null", "na", "n/a", "null.", "none", "-", "nan", "nil", "tbd", "undefined", "unknown", "unk", "not available", "!", "?", "not_a_value"]);
// BOOLEAN_VALUES removed — boolean detection is now dynamic (pattern-based, not lookup-based)

// Exact word-to-number mapping (0–100) for controlled conversion
const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, "fourty": 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

// Fuzzy word-number detection: find the closest valid word number within edit distance
function fuzzyMatchWordNumber(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (t.length < 2) return null;
  for (const [word] of Object.entries(WORD_NUMBERS)) {
    if (word.length >= t.length - 1 && word.length <= t.length + 2) {
      // Simple edit-distance proxy: check if word contains all chars of input in order
      let wi = 0;
      for (let ti = 0; ti < t.length && wi < word.length; ti++) {
        if (t[ti] === word[wi]) wi++;
      }
      if (wi >= Math.max(t.length - 1, word.length - 2)) return word;
    }
  }
  return null;
}

// Compound word-number extraction: "forty five" → 45, "twenty three" → 23, "one hundred" → 100
// Handles: two-word combos (twenty one → 21) and "X hundred Y" patterns (one hundred twenty → 120)
const COMPOUND_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, "fourty": 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function extractCompoundWordNumber(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;

  // Single word — use WORD_NUMBERS directly
  if (WORD_NUMBERS[t] !== undefined) return WORD_NUMBERS[t];

  // Two-word compound: "twenty one" → 21, "forty five" → 45
  const twoWordMatch = t.match(/^(\w+)\s+(\w+)$/);
  if (twoWordMatch) {
    const first = WORD_NUMBERS[twoWordMatch[1]] ?? COMPOUND_TENS[twoWordMatch[1]];
    const second = WORD_NUMBERS[twoWordMatch[2]];
    if (first !== undefined && second !== undefined && first >= 20 && second < 10) {
      return first + second; // e.g., twenty(20) + five(5) = 25
    }
    // "one hundred" → 100, "three hundred" → 300
    if (second === 100) return first * 100;
  }

  // Three-word compound: "one hundred twenty" → 120, "two hundred five" → 205
  const threeWordMatch = t.match(/^(\w+)\s+hundred\s+(\w+)$/);
  if (threeWordMatch) {
    const hundreds = WORD_NUMBERS[threeWordMatch[1]];
    const rest = extractCompoundWordNumber(threeWordMatch[2]); // recursive for "twenty five"
    if (hundreds !== undefined && rest !== null) {
      return hundreds * 100 + rest;
    }
  }

  // Word number followed by noise: "fortyK" → 40 (extract word, ignore suffix)
  const wordThenNoise = t.match(/^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred)/i);
  if (wordThenNoise) {
    return WORD_NUMBERS[wordThenNoise[1].toLowerCase()] ?? null;
  }

  return null;
}

// Extract word-number with optional decimal: "forty five point five" → 45.5, "twenty point five" → 20.5
// Handles: integer word numbers + optional "point X" decimal suffix
function extractWordNumberWithDecimal(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;

  // Check for "X point Y" pattern: "forty five point five" → 45.5
  const pointMatch = t.match(/^(.+?)\s+point\s+(\w+)$/);
  if (pointMatch) {
    const integerPart = extractCompoundWordNumber(pointMatch[1]);
    const decimalWord = WORD_NUMBERS[pointMatch[2]];
    if (integerPart !== null && decimalWord !== undefined) {
      // Handle multi-digit decimals: "point five" → 0.5, "point fifty" → 0.50
      if (decimalWord < 10) {
        return integerPart + decimalWord / 10;
      } else {
        return integerPart + decimalWord / 100;
      }
    }
  }

  // No decimal — use standard compound extraction
  return extractCompoundWordNumber(t);
}

// Detect domain-specific valid range for numeric columns
// Now supports semantic type override for richer classification
function getNumericDomainRules(name: string, semanticType?: SemanticType): { min: number; max: number; label: string } | null {
  // If semantic type is known, use it for better bounds
  if (semanticType === "MONEY") return { min: 0, max: 100_000_000, label: "0–10 Cr" };
  if (semanticType === "RATING") return { min: 0, max: 10, label: "0–10" };
  if (semanticType === "EXPERIENCE") return { min: 0, max: 50, label: "0–50" };
  if (semanticType === "AGE") return { min: 0, max: 120, label: "0–120" };
  if (semanticType === "PERCENTAGE") return { min: 0, max: 100, label: "0–100" };

  const n = name.toLowerCase();
  if (/\b(years?|yr|exp|experience|tenure|duration)\b/.test(n)) {
    return { min: 0, max: 50, label: "0–50" };
  }
  if (/\b(rating|rate|score)\b/.test(n)) {
    return { min: 1, max: 10, label: "1–10" };
  }
  if (/\b(age)\b/.test(n)) {
    return { min: 0, max: 120, label: "0–120" };
  }
  if (/\b(grade)\b/.test(n)) {
    return { min: 0, max: 100, label: "0–100" };
  }
  if (/\b(hours?|height|width|weight|temperature)\b/.test(n)) {
    return { min: 0, max: 100000, label: "≥ 0" };
  }
  return null;
}

// Strip emojis from a string — used before null checking
const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D\u{20E3}\u{E0020}-\u{E007F}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]/gu;
export function stripEmojis(s: string): string {
  return s.replace(EMOJI_REGEX, "").trim();
}

export function containsEmoji(s: string): boolean {
  return EMOJI_REGEX.test(s);
}

// ── Feedback-Appropriate Emoji Detection ─────────────────────
// Feedback columns (feedback, review, comment, response, remarks, notes, opinion, survey_response)
// should allow emojis that are semantically appropriate for expressing sentiment/feedback.
// Allowed: thumbs up/down, stars, hearts, check/cross, fire, celebration, face emojis (emotions),
//          100/OK, clapping, thinking, peace, rocket, etc.
// NOT allowed: random objects, flags, food, animals (unless commonly used as sentiment), etc.
const FEEDBACK_EMOJI_RANGES = [
  // Thumbs: 👍👍🏻👍🏼👍🏽👍🏾👍🏿 👎👎🏻👎🏼👎🏽👎🏾👎🏿
  /[\u{1F44D}\u{1F44E}]/u,
  // Star: ⭐ 🌟 ✨ 💫
  /[\u{2B50}\u{1F31F}\u{2728}\u{1F4AB}]/u,
  // Heart: ❤️🧡💛💚💙💜🖤🤍🤎💯
  /[\u{2764}\u{1F9E1}\u{1F49B}\u{1F49A}\u{1F499}\u{1F49C}\u{1F90D}\u{1F90E}\u{1F4AF}]/u,
  // Check/Cross: ✅ ❌ ⭕ ❗
  /[\u{2705}\u{274C}\u{2B55}\u{2049}]/u,
  // Fire/celebration: 🔥 🎉 🎊 🎈 🎁 🏆 🥇
  /[\u{1F525}\u{1F389}\u{1F38A}\u{1F388}\u{1F381}\u{1F3C6}\u{1F947}]/u,
  // Clapping/hands: 👏🙌 👌 ✌️ 🤝
  /[\u{1F44F}\u{1F64C}\u{1F44C}\u{270C}\u{1F91D}]/u,
  // Common sentiment faces: 😊😄😁😆🥰😍😘😏🤔😐😑😕🙁😟😢😭😤😡🤯🥳😴
  /[\u{1F60A}\u{1F604}\u{1F601}\u{1F606}\u{1F970}\u{1F60D}\u{1F618}\u{1F60F}\u{1F914}\u{1F610}\u{1F611}\u{1F615}\u{1F61E}\u{1F61F}\u{1F622}\u{1F62D}\u{1F624}\u{1F621}\u{1F92F}\u{1F973}\u{1F634}]/u,
  // Thinking/ok: 💭 💡 📌 📝 🔔
  /[\u{1F4AD}\u{1F4A1}\u{1F4CC}\u{1F4DD}\u{1F514}]/u,
  // Rocket/trending: 🚀 📈 📊 💪 👍
  /[\u{1F680}\u{1F4C8}\u{1F4CA}\u{1F4AA}]/u,
];

/**
 * Check if a column is a feedback/survey/response column (by name pattern).
 * These columns should allow feedback-appropriate emojis.
 */
export function isFeedbackColumn(columnName: string): boolean {
  if (!columnName) return false;
  const n = columnName.toLowerCase();
  return /\b(feedback|review|comment|response|remark|note|opinion|survey_response|survey_response_text|sentiment|rating_text|experience_text|testimonial)\b/i.test(n);
}

/**
 * Check if all emojis in a string are feedback-appropriate.
 * Returns true if the string has no emojis, or only feedback-appropriate ones.
 * Returns false if any non-feedback emoji is found.
 */
export function hasOnlyFeedbackEmojis(s: string): boolean {
  // Extract all emojis from the string
  const emojis = s.match(EMOJI_REGEX);
  if (!emojis || emojis.length === 0) return true; // no emojis = fine

  // Check each emoji against feedback ranges
  for (const emoji of emojis) {
    let isFeedbackEmoji = false;
    for (const range of FEEDBACK_EMOJI_RANGES) {
      if (range.test(emoji)) {
        isFeedbackEmoji = true;
        break;
      }
    }
    if (!isFeedbackEmoji) return false; // found a non-feedback emoji
  }
  return true;
}

/**
 * Check if a string has non-feedback emojis (emojis that should be flagged).
 * Only meaningful for feedback columns.
 */
export function hasNonFeedbackEmoji(s: string): boolean {
  if (!containsEmoji(s)) return false;
  return !hasOnlyFeedbackEmojis(s);
}

// ── Name Special Character Detection ─────────────────────
// Full names should ONLY contain: Unicode letters (any script), spaces, hyphens, apostrophes, dots
// Numbers, @#$%^&*() and other special chars → flag RED
function containsNameSpecialChars(s: string): boolean {
  // Allow: Unicode letters (any script), spaces, hyphens, apostrophes, periods
  // Reject: numbers, @#$%^&*()_+=[]{}|\\<>~`!?, and any other non-letter chars
  return /[0-9@#$%^&*()_+=\[\]{}|\\<>~`!?/"',;\d]/.test(s);
}

// Allow common name punctuation: hyphen, apostrophe, dot, space
// Everything else that isn't a Unicode letter → special char for names
function isNameTextOnly(s: string): boolean {
  // Must have at least one letter (any script)
  if (!/\p{L}/u.test(s)) return false;
  // Only allow: Unicode letters, spaces, hyphens, apostrophes, periods
  // Reject: digits, and all non-letter non-allowed-punctuation chars
  return !/[^\p{L}\s'\-.\u0300-\u036F]/u.test(s);
}

// ── Comprehensive Country Code Database ─────────────────
// Format: +<code><subscriber> — subscriber digits validated per-country
// subMin/subMax = valid subscriber digit range (after country code)
// Matching: longest prefix first (3-digit codes before 2-digit, before 1-digit)
interface CountryCodeInfo {
  code: string;
  name: string;
  subMin: number; // minimum subscriber digits (after country code)
  subMax: number; // maximum subscriber digits (after country code)
}

const COUNTRY_CODES: CountryCodeInfo[] = [
  // ── Zone 1: North America ──
  { code: "1", name: "US/Canada", subMin: 10, subMax: 10 },

  // ── Zone 2: Africa (3-digit codes first for longest-prefix matching) ──
  { code: "269", name: "Comoros", subMin: 7, subMax: 7 },
  { code: "268", name: "Eswatini", subMin: 7, subMax: 8 },
  { code: "266", name: "Lesotho", subMin: 8, subMax: 8 },
  { code: "265", name: "Malawi", subMin: 8, subMax: 9 },
  { code: "262", name: "Réunion", subMin: 9, subMax: 9 },
  { code: "261", name: "Madagascar", subMin: 9, subMax: 9 },
  { code: "260", name: "Zambia", subMin: 9, subMax: 9 },
  { code: "258", name: "Mozambique", subMin: 8, subMax: 9 },
  { code: "257", name: "Burundi", subMin: 8, subMax: 8 },
  { code: "256", name: "Uganda", subMin: 9, subMax: 9 },
  { code: "255", name: "Tanzania", subMin: 9, subMax: 9 },
  { code: "254", name: "Kenya", subMin: 9, subMax: 9 },
  { code: "253", name: "Djibouti", subMin: 8, subMax: 8 },
  { code: "252", name: "Somalia", subMin: 8, subMax: 8 },
  { code: "251", name: "Ethiopia", subMin: 9, subMax: 9 },
  { code: "250", name: "Rwanda", subMin: 8, subMax: 9 },
  { code: "249", name: "Sudan", subMin: 9, subMax: 9 },
  { code: "248", name: "Seychelles", subMin: 7, subMax: 7 },
  { code: "246", name: "British Indian Ocean", subMin: 7, subMax: 7 },
  { code: "245", name: "Guinea-Bissau", subMin: 7, subMax: 7 },
  { code: "244", name: "Angola", subMin: 9, subMax: 9 },
  { code: "243", name: "DR Congo", subMin: 9, subMax: 9 },
  { code: "242", name: "Congo", subMin: 9, subMax: 9 },
  { code: "241", name: "Gabon", subMin: 8, subMax: 9 },
  { code: "240", name: "Equatorial Guinea", subMin: 9, subMax: 9 },
  { code: "239", name: "São Tomé", subMin: 7, subMax: 7 },
  { code: "238", name: "Cape Verde", subMin: 7, subMax: 7 },
  { code: "237", name: "Cameroon", subMin: 8, subMax: 9 },
  { code: "236", name: "CAR", subMin: 8, subMax: 8 },
  { code: "235", name: "Chad", subMin: 7, subMax: 8 },
  { code: "234", name: "Nigeria", subMin: 8, subMax: 10 },
  { code: "233", name: "Ghana", subMin: 9, subMax: 10 },
  { code: "232", name: "Sierra Leone", subMin: 8, subMax: 8 },
  { code: "231", name: "Liberia", subMin: 8, subMax: 8 },
  { code: "230", name: "Mauritius", subMin: 7, subMax: 8 },
  { code: "229", name: "Benin", subMin: 8, subMax: 8 },
  { code: "228", name: "Togo", subMin: 8, subMax: 8 },
  { code: "227", name: "Niger", subMin: 8, subMax: 8 },
  { code: "226", name: "Burkina Faso", subMin: 8, subMax: 8 },
  { code: "225", name: "Ivory Coast", subMin: 9, subMax: 10 },
  { code: "224", name: "Guinea", subMin: 9, subMax: 9 },
  { code: "223", name: "Mali", subMin: 8, subMax: 8 },
  { code: "222", name: "Mauritania", subMin: 8, subMax: 8 },
  { code: "221", name: "Senegal", subMin: 9, subMax: 9 },
  { code: "220", name: "Gambia", subMin: 7, subMax: 7 },
  { code: "218", name: "Libya", subMin: 9, subMax: 9 },
  { code: "216", name: "Tunisia", subMin: 8, subMax: 8 },
  { code: "213", name: "Algeria", subMin: 9, subMax: 9 },
  { code: "212", name: "Morocco", subMin: 9, subMax: 9 },
  { code: "20", name: "Egypt", subMin: 10, subMax: 10 },
  { code: "291", name: "Eritrea", subMin: 7, subMax: 7 },
  { code: "297", name: "Aruba", subMin: 7, subMax: 7 },
  { code: "298", name: "Faroe Islands", subMin: 6, subMax: 7 },
  { code: "299", name: "Greenland", subMin: 6, subMax: 7 },
  { code: "264", name: "Namibia", subMin: 9, subMax: 9 },
  { code: "267", name: "Botswana", subMin: 8, subMax: 8 },
  { code: "263", name: "Zimbabwe", subMin: 9, subMax: 10 },

  // ── Zone 3+4: Europe (3-digit first) ──
  { code: "359", name: "Bulgaria", subMin: 8, subMax: 9 },
  { code: "358", name: "Finland", subMin: 9, subMax: 10 },
  { code: "357", name: "Cyprus", subMin: 8, subMax: 8 },
  { code: "356", name: "Malta", subMin: 8, subMax: 8 },
  { code: "355", name: "Albania", subMin: 9, subMax: 9 },
  { code: "354", name: "Iceland", subMin: 7, subMax: 9 },
  { code: "353", name: "Ireland", subMin: 9, subMax: 9 },
  { code: "352", name: "Luxembourg", subMin: 8, subMax: 9 },
  { code: "351", name: "Portugal", subMin: 9, subMax: 9 },
  { code: "350", name: "Gibraltar", subMin: 8, subMax: 8 },
  { code: "389", name: "North Macedonia", subMin: 8, subMax: 8 },
  { code: "387", name: "Bosnia", subMin: 8, subMax: 8 },
  { code: "386", name: "Slovenia", subMin: 8, subMax: 8 },
  { code: "385", name: "Croatia", subMin: 8, subMax: 9 },
  { code: "383", name: "Kosovo", subMin: 8, subMax: 9 },
  { code: "382", name: "Montenegro", subMin: 8, subMax: 8 },
  { code: "381", name: "Serbia", subMin: 9, subMax: 10 },
  { code: "380", name: "Ukraine", subMin: 9, subMax: 9 },
  { code: "378", name: "San Marino", subMin: 10, subMax: 10 },
  { code: "377", name: "Monaco", subMin: 8, subMax: 9 },
  { code: "376", name: "Andorra", subMin: 6, subMax: 6 },
  { code: "375", name: "Belarus", subMin: 9, subMax: 9 },
  { code: "374", name: "Armenia", subMin: 8, subMax: 8 },
  { code: "373", name: "Moldova", subMin: 8, subMax: 8 },
  { code: "372", name: "Estonia", subMin: 7, subMax: 8 },
  { code: "371", name: "Latvia", subMin: 8, subMax: 8 },
  { code: "370", name: "Lithuania", subMin: 8, subMax: 8 },
  { code: "423", name: "Liechtenstein", subMin: 7, subMax: 9 },
  { code: "421", name: "Slovakia", subMin: 9, subMax: 9 },
  { code: "420", name: "Czech Republic", subMin: 9, subMax: 9 },
  // 2-digit European codes
  { code: "39", name: "Italy", subMin: 9, subMax: 11 },
  { code: "36", name: "Hungary", subMin: 9, subMax: 9 },
  { code: "34", name: "Spain", subMin: 9, subMax: 9 },
  { code: "33", name: "France", subMin: 9, subMax: 9 },
  { code: "32", name: "Belgium", subMin: 8, subMax: 9 },
  { code: "31", name: "Netherlands", subMin: 9, subMax: 9 },
  { code: "30", name: "Greece", subMin: 10, subMax: 10 },
  { code: "49", name: "Germany", subMin: 9, subMax: 12 },
  { code: "48", name: "Poland", subMin: 9, subMax: 9 },
  { code: "47", name: "Norway", subMin: 8, subMax: 9 },
  { code: "46", name: "Sweden", subMin: 7, subMax: 9 },
  { code: "45", name: "Denmark", subMin: 8, subMax: 8 },
  { code: "44", name: "UK", subMin: 9, subMax: 10 },
  { code: "43", name: "Austria", subMin: 9, subMax: 13 },
  { code: "41", name: "Switzerland", subMin: 9, subMax: 9 },
  { code: "40", name: "Romania", subMin: 9, subMax: 9 },

  // ── Zone 5: Central/South America ──
  { code: "599", name: "Curaçao", subMin: 7, subMax: 8 },
  { code: "598", name: "Uruguay", subMin: 8, subMax: 8 },
  { code: "597", name: "Suriname", subMin: 7, subMax: 7 },
  { code: "596", name: "Martinique", subMin: 9, subMax: 9 },
  { code: "595", name: "Paraguay", subMin: 9, subMax: 9 },
  { code: "594", name: "French Guiana", subMin: 9, subMax: 9 },
  { code: "593", name: "Ecuador", subMin: 9, subMax: 9 },
  { code: "592", name: "Guyana", subMin: 7, subMax: 7 },
  { code: "591", name: "Bolivia", subMin: 8, subMax: 8 },
  { code: "590", name: "Guadeloupe", subMin: 9, subMax: 9 },
  { code: "509", name: "Haiti", subMin: 8, subMax: 8 },
  { code: "508", name: "Saint Pierre", subMin: 6, subMax: 6 },
  { code: "507", name: "Panama", subMin: 8, subMax: 8 },
  { code: "506", name: "Costa Rica", subMin: 8, subMax: 8 },
  { code: "505", name: "Nicaragua", subMin: 8, subMax: 8 },
  { code: "504", name: "Honduras", subMin: 8, subMax: 8 },
  { code: "503", name: "El Salvador", subMin: 8, subMax: 8 },
  { code: "502", name: "Guatemala", subMin: 8, subMax: 8 },
  { code: "501", name: "Belize", subMin: 7, subMax: 7 },
  { code: "500", name: "Falkland Islands", subMin: 5, subMax: 5 },
  { code: "51", name: "Peru", subMin: 9, subMax: 9 },
  { code: "53", name: "Cuba", subMin: 8, subMax: 8 },
  { code: "54", name: "Argentina", subMin: 10, subMax: 10 },
  { code: "55", name: "Brazil", subMin: 10, subMax: 11 },
  { code: "56", name: "Chile", subMin: 9, subMax: 9 },
  { code: "57", name: "Colombia", subMin: 10, subMax: 10 },
  { code: "58", name: "Venezuela", subMin: 10, subMax: 10 },
  { code: "52", name: "Mexico", subMin: 10, subMax: 10 },

  // ── Zone 6: Southeast Asia & Oceania ──
  { code: "692", name: "Marshall Islands", subMin: 7, subMax: 7 },
  { code: "691", name: "Micronesia", subMin: 7, subMax: 7 },
  { code: "690", name: "Tokelau", subMin: 4, subMax: 4 },
  { code: "689", name: "French Polynesia", subMin: 6, subMax: 6 },
  { code: "688", name: "Tuvalu", subMin: 5, subMax: 5 },
  { code: "687", name: "New Caledonia", subMin: 6, subMax: 6 },
  { code: "686", name: "Kiribati", subMin: 5, subMax: 5 },
  { code: "685", name: "Samoa", subMin: 5, subMax: 7 },
  { code: "683", name: "Niue", subMin: 4, subMax: 4 },
  { code: "682", name: "Cook Islands", subMin: 5, subMax: 5 },
  { code: "681", name: "Wallis and Futuna", subMin: 6, subMax: 6 },
  { code: "680", name: "Palau", subMin: 7, subMax: 7 },
  { code: "679", name: "Fiji", subMin: 7, subMax: 7 },
  { code: "678", name: "Vanuatu", subMin: 7, subMax: 7 },
  { code: "677", name: "Solomon Islands", subMin: 7, subMax: 7 },
  { code: "676", name: "Tonga", subMin: 5, subMax: 7 },
  { code: "675", name: "Papua New Guinea", subMin: 7, subMax: 8 },
  { code: "674", name: "Nauru", subMin: 7, subMax: 7 },
  { code: "673", name: "Brunei", subMin: 7, subMax: 7 },
  { code: "672", name: "Antarctica", subMin: 6, subMax: 6 },
  { code: "670", name: "East Timor", subMin: 7, subMax: 8 },
  { code: "66", name: "Thailand", subMin: 9, subMax: 9 },
  { code: "65", name: "Singapore", subMin: 8, subMax: 8 },
  { code: "64", name: "New Zealand", subMin: 9, subMax: 10 },
  { code: "63", name: "Philippines", subMin: 10, subMax: 10 },
  { code: "62", name: "Indonesia", subMin: 9, subMax: 12 },
  { code: "61", name: "Australia", subMin: 9, subMax: 9 },
  { code: "60", name: "Malaysia", subMin: 9, subMax: 10 },

  // ── Zone 7: Russia & Central Asia ──
  { code: "7", name: "Russia/Kazakhstan", subMin: 10, subMax: 10 },

  // ── Zone 8: East Asia & Special ──
  { code: "886", name: "Taiwan", subMin: 9, subMax: 10 },
  { code: "880", name: "Bangladesh", subMin: 9, subMax: 10 },
  { code: "856", name: "Laos", subMin: 10, subMax: 10 },
  { code: "855", name: "Cambodia", subMin: 9, subMax: 9 },
  { code: "853", name: "Macau", subMin: 8, subMax: 8 },
  { code: "852", name: "Hong Kong", subMin: 8, subMax: 8 },
  { code: "850", name: "North Korea", subMin: 9, subMax: 10 },
  { code: "84", name: "Vietnam", subMin: 9, subMax: 10 },
  { code: "82", name: "South Korea", subMin: 9, subMax: 10 },
  { code: "81", name: "Japan", subMin: 9, subMax: 10 },
  { code: "86", name: "China", subMin: 10, subMax: 11 },

  // ── Zone 9: South & Central Asia, Middle East ──
  { code: "998", name: "Uzbekistan", subMin: 9, subMax: 9 },
  { code: "996", name: "Kyrgyzstan", subMin: 9, subMax: 9 },
  { code: "995", name: "Georgia", subMin: 9, subMax: 9 },
  { code: "994", name: "Azerbaijan", subMin: 9, subMax: 9 },
  { code: "993", name: "Turkmenistan", subMin: 8, subMax: 8 },
  { code: "992", name: "Tajikistan", subMin: 9, subMax: 9 },
  { code: "977", name: "Nepal", subMin: 10, subMax: 10 },
  { code: "976", name: "Mongolia", subMin: 8, subMax: 8 },
  { code: "975", name: "Bhutan", subMin: 8, subMax: 8 },
  { code: "974", name: "Qatar", subMin: 8, subMax: 8 },
  { code: "973", name: "Bahrain", subMin: 8, subMax: 8 },
  { code: "972", name: "Israel", subMin: 9, subMax: 9 },
  { code: "971", name: "UAE", subMin: 9, subMax: 9 },
  { code: "970", name: "Palestine", subMin: 9, subMax: 9 },
  { code: "968", name: "Oman", subMin: 8, subMax: 8 },
  { code: "967", name: "Yemen", subMin: 9, subMax: 9 },
  { code: "966", name: "Saudi Arabia", subMin: 9, subMax: 9 },
  { code: "965", name: "Kuwait", subMin: 8, subMax: 8 },
  { code: "964", name: "Iraq", subMin: 10, subMax: 10 },
  { code: "963", name: "Syria", subMin: 9, subMax: 9 },
  { code: "962", name: "Jordan", subMin: 9, subMax: 9 },
  { code: "961", name: "Lebanon", subMin: 7, subMax: 8 },
  { code: "960", name: "Maldives", subMin: 7, subMax: 7 },
  { code: "95", name: "Myanmar", subMin: 9, subMax: 10 },
  { code: "94", name: "Sri Lanka", subMin: 9, subMax: 10 },
  { code: "93", name: "Afghanistan", subMin: 9, subMax: 9 },
  { code: "92", name: "Pakistan", subMin: 9, subMax: 10 },
  { code: "91", name: "India", subMin: 10, subMax: 10 },
  { code: "90", name: "Turkey", subMin: 10, subMax: 10 },
  { code: "98", name: "Iran", subMin: 10, subMax: 10 },
];

// ── Country Name → Phone Code Reverse Lookup ─────────────────
// Maps common country names to their international dialing codes.
// Used for cross-referencing phone numbers with location/region/country columns.
const COUNTRY_NAME_TO_PHONE_CODE: Record<string, string> = {};
// Build from COUNTRY_CODES
for (const cc of COUNTRY_CODES) {
  const names = cc.name.split("/"); // "US/Canada" → ["US", "Canada"]
  for (const name of names) {
    COUNTRY_NAME_TO_PHONE_CODE[name.trim().toLowerCase()] = cc.code;
  }
}
// Add common full names that might differ from COUNTRY_CODES entries
Object.assign(COUNTRY_NAME_TO_PHONE_CODE, {
  "india": "91", "united states": "1", "usa": "1", "uk": "44", "united kingdom": "44",
  "canada": "1", "australia": "61", "germany": "49", "france": "33", "italy": "39",
  "spain": "34", "japan": "81", "china": "86", "brazil": "55", "mexico": "52",
  "russia": "7", "south korea": "82", "nigeria": "234", "south africa": "27",
  "new zealand": "64", "singapore": "65", "sweden": "46", "norway": "47",
  "denmark": "45", "finland": "358", "netherlands": "31", "belgium": "32",
  "switzerland": "41", "austria": "43", "portugal": "351", "poland": "48",
  "ireland": "353", "greece": "30", "turkey": "90", "egypt": "20", "kenya": "254",
  "ghana": "233", "argentina": "54", "colombia": "57", "chile": "56", "peru": "51",
  "thailand": "66", "vietnam": "84", "malaysia": "60", "indonesia": "62",
  "philippines": "63", "pakistan": "92", "bangladesh": "880", "sri lanka": "94",
  "nepal": "977", "saudi arabia": "966", "iran": "98", "iraq": "964",
  "israel": "972", "jordan": "962", "uae": "971", "united arab emirates": "971",
  "qatar": "974", "kuwait": "965", "oman": "968", "bahrain": "973",
  "north america": "1", "europe": "44", "asia": "91", "africa": "234",
});

// ── ISO 3166-1 alpha-2 → Phone Code Mapping ──
// Used when country code column contains ISO codes (IN, US, DE, etc.)
const ISO_TO_PHONE_CODE: Record<string, string> = {
  "af": "93", "al": "355", "dz": "213", "as": "1684", "ad": "376", "ao": "244",
  "ai": "1264", "aq": "672", "ag": "1268", "ar": "54", "am": "374", "aw": "297",
  "au": "61", "at": "43", "az": "994", "bs": "1242", "bh": "973", "bd": "880",
  "bb": "1246", "by": "375", "be": "32", "bz": "501", "bj": "229", "bm": "1441",
  "bt": "975", "bo": "591", "ba": "387", "bw": "267", "br": "55", "io": "246",
  "bn": "673", "bg": "359", "bf": "226", "bi": "257", "cv": "238", "kh": "855",
  "cm": "237", "ca": "1", "ky": "1345", "cf": "236", "td": "235", "cl": "56",
  "cn": "86", "cx": "61", "cc": "61", "co": "57", "km": "269", "cg": "242",
  "cd": "243", "ck": "682", "cr": "506", "ci": "225", "hr": "385", "cu": "53",
  "cw": "599", "cy": "357", "cz": "420", "dk": "45", "dj": "253", "dm": "1767",
  "do": "1809", "ec": "593", "eg": "20", "sv": "503", "gq": "240", "er": "291",
  "ee": "372", "sz": "268", "et": "251", "fk": "500", "fo": "298", "fj": "679",
  "fi": "358", "fr": "33", "gf": "594", "pf": "689", "tf": "262", "ga": "241",
  "gm": "220", "ge": "995", "de": "49", "gh": "233", "gi": "350", "gr": "30",
  "gl": "299", "gd": "1473", "gp": "590", "gu": "1671", "gt": "502", "gg": "44",
  "gn": "224", "gw": "245", "gy": "592", "ht": "509", "hm": "672", "va": "379",
  "hn": "504", "hk": "852", "hu": "36", "is": "354", "in": "91", "id": "62",
  "ir": "98", "iq": "964", "ie": "353", "im": "44", "il": "972", "it": "39",
  "jm": "1876", "je": "44", "jo": "962", "jp": "81", "ke": "254", "ki": "686",
  "kp": "850", "kr": "82", "kw": "965", "kg": "996", "la": "856", "lv": "371",
  "lb": "961", "ls": "266", "lr": "231", "ly": "218", "li": "423", "lt": "370",
  "lu": "352", "mo": "853", "mg": "261", "mw": "265", "my": "60", "mv": "960",
  "ml": "223", "mt": "356", "mh": "692", "mq": "596", "mr": "222", "mu": "230",
  "yt": "262", "mx": "52", "fm": "691", "md": "373", "mc": "377", "mn": "976",
  "me": "382", "ms": "1664", "ma": "212", "mz": "258", "mm": "95", "na": "264",
  "nr": "674", "np": "977", "nl": "31", "nc": "687", "nz": "64", "ni": "505",
  "ne": "227", "ng": "234", "nu": "683", "nf": "672", "mk": "389", "mp": "1670",
  "no": "47", "om": "968", "pk": "92", "pw": "680", "ps": "970", "pa": "507",
  "pg": "675", "py": "595", "pe": "51", "ph": "63", "pn": "64", "pl": "48",
  "pt": "351", "pr": "1939", "qa": "974", "re": "262", "ro": "40", "ru": "7",
  "rw": "250", "bl": "590", "sh": "290", "kn": "1869", "lc": "1758", "mf": "590",
  "pm": "508", "vc": "1784", "ws": "685", "sm": "378", "st": "239", "sa": "966",
  "sn": "221", "rs": "381", "sc": "248", "sl": "232", "sg": "65", "sx": "1721",
  "sk": "421", "si": "386", "sb": "677", "so": "252", "za": "27", "gs": "500",
  "ss": "211", "es": "34", "lk": "94", "sd": "249", "sr": "597", "sj": "47",
  "se": "46", "ch": "41", "sy": "963", "tw": "886", "tj": "992", "tz": "255",
  "th": "66", "tl": "670", "tg": "228", "tk": "690", "to": "676", "tt": "1868",
  "tn": "216", "tr": "90", "tm": "993", "tc": "1649", "tv": "688", "ug": "256",
  "ua": "380", "ae": "971", "gb": "44", "us": "1", "um": "1", "uy": "598",
  "uz": "998", "vu": "678", "ve": "58", "vn": "84", "vg": "1284", "vi": "1340",
  "wf": "681", "eh": "212", "ye": "967", "zm": "260", "zw": "263",
};

/**
 * Look up phone country code from a country name string.
 * Handles full names, ISO 2-letter codes (IN, US, DE), and abbreviations.
 */
export function getPhoneCodeFromCountryName(countryName: string): string | null {
  if (!countryName || typeof countryName !== "string") return null;
  const t = countryName.trim().toLowerCase();
  // Check ISO 3166-1 alpha-2 first (e.g., "in" → "91", "us" → "1")
  if (ISO_TO_PHONE_CODE[t]) return ISO_TO_PHONE_CODE[t];
  // Direct name lookup
  if (COUNTRY_NAME_TO_PHONE_CODE[t]) return COUNTRY_NAME_TO_PHONE_CODE[t];
  // Try without common suffixes
  const withoutSuffix = t.replace(/\s*(country|region|zone|area|state|nation)\s*$/i, "").trim();
  if (withoutSuffix !== t) {
    if (ISO_TO_PHONE_CODE[withoutSuffix]) return ISO_TO_PHONE_CODE[withoutSuffix];
    if (COUNTRY_NAME_TO_PHONE_CODE[withoutSuffix]) return COUNTRY_NAME_TO_PHONE_CODE[withoutSuffix];
  }
  return null;
}

/**
 * Format a phone number with comprehensive country code detection and validation.
 * Returns { formatted: string, country: string | null, isValid: boolean, digits: number }
 * 
 * Pipeline:
 *   1. Strip all non-digit chars, extract leading +
 *   2. Normalize: "00" prefix → strip, leading "0" → strip (trunk prefix)
 *   3. Match country code (longest prefix first from 200+ world codes)
 *   4. Strip trunk prefix zero from subscriber if present
 *   5. Validate subscriber digit count against country-specific subMin/subMax
 *   6. Output format: +<country_code> <subscriber_digits>
 */
export function formatPhoneNumber(raw: string, countryHint?: string | null): { formatted: string; country: string | null; isValid: boolean; digits: number } {
  let cleaned = raw.trim();
  
  // Extract digits and leading +
  const hasPlus = cleaned.startsWith("+");
  const digits = cleaned.replace(/[^\d]/g, "");
  
  if (digits.length === 0) {
    return { formatted: raw, country: null, isValid: false, digits: 0 };
  }
  
  // ── Step 1: Normalize prefixes ──
  let strippedDigits = digits;
  // "00" prefix → international dialing (e.g., "0091..." → "91...")
  if (strippedDigits.startsWith("00")) {
    strippedDigits = strippedDigits.slice(2);
  }
  // Single leading "0" → domestic trunk prefix (e.g., "09876..." → "9876...")
  else if (strippedDigits.startsWith("0") && strippedDigits.length > 1) {
    strippedDigits = strippedDigits.slice(1);
  }
  
  // ── Step 2: Match country code (longest prefix first) ──
  // Sort once — 3-digit codes first, then 2-digit, then 1-digit
  const sortedCodes = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  
  let matchedCountry: CountryCodeInfo | null = null;
  let subscriberDigits = strippedDigits;
  let countryCodeStr = "";
  
  for (const cc of sortedCodes) {
    if (strippedDigits.startsWith(cc.code)) {
      matchedCountry = cc;
      countryCodeStr = cc.code;
      subscriberDigits = strippedDigits.slice(cc.code.length);
      // Strip one leading zero from subscriber (trunk prefix)
      // e.g., "+9109876543210" → CC "91", subscriber "09876543210" → "9876543210"
      if (subscriberDigits.startsWith("0") && subscriberDigits.length > 1) {
        subscriberDigits = subscriberDigits.slice(1);
      }
      break; // Longest prefix match wins
    }
  }
  
  // ── Step 2b: Validate prefix match — if subscriber length is wrong, try country hint ──
  // Example: "9812345670" matches "98" (Iran) but subscriber "12345670" (8 digits) ≠ Iran's 10 required.
  // If we have a country hint (India), prefer that: India +91, subscriber "9812345670" (10 digits) ✓
  let prefixMatchInvalid = false;
  if (matchedCountry) {
    const subLen = subscriberDigits.length;
    if (subLen < matchedCountry.subMin || subLen > matchedCountry.subMax) {
      prefixMatchInvalid = true;
    }
  }
  
  // ── Step 3: Fallback inference — no match OR prefix match produced invalid subscriber ──
  if (!matchedCountry || prefixMatchInvalid) {
    // Reset if prefix match was invalid
    if (prefixMatchInvalid) {
      matchedCountry = null;
      subscriberDigits = strippedDigits;
      countryCodeStr = "";
    }
    
    // ── Try country hint from location/region/country columns ──
    if (countryHint) {
      const hintCode = getPhoneCodeFromCountryName(countryHint);
      if (hintCode) {
        const hintCC = COUNTRY_CODES.find(c => c.code === hintCode);
        if (hintCC) {
          matchedCountry = hintCC;
          countryCodeStr = hintCC.code;
          // The digits are without country code, so use all as subscriber
          subscriberDigits = strippedDigits;
          // But if the total digits exceed subMax for this country, it might have the country code included
          if (subscriberDigits.length > hintCC.subMax) {
            // Try stripping the country code from the start
            if (subscriberDigits.startsWith(hintCC.code)) {
              subscriberDigits = subscriberDigits.slice(hintCC.code.length);
              if (subscriberDigits.startsWith("0") && subscriberDigits.length > 1) {
                subscriberDigits = subscriberDigits.slice(1);
              }
            }
          }
          // If hint also produces invalid subscriber, fall through to generic fallback
          const hintSubLen = subscriberDigits.length;
          if (hintSubLen < hintCC.subMin || hintSubLen > hintCC.subMax) {
            matchedCountry = null;
            subscriberDigits = strippedDigits;
            countryCodeStr = "";
          }
        }
      }
    }
    
    // Fallback: 10 digits starting with 6-9 → India mobile (without country code)
    if (!matchedCountry && strippedDigits.length === 10 && /^[6-9]/.test(strippedDigits)) {
      matchedCountry = COUNTRY_CODES.find(c => c.code === "91")!;
      countryCodeStr = "91";
      subscriberDigits = strippedDigits;
    }
    // 10 digits → likely US/Canada
    else if (!matchedCountry && strippedDigits.length === 10) {
      matchedCountry = COUNTRY_CODES.find(c => c.code === "1")!;
      countryCodeStr = "1";
      subscriberDigits = strippedDigits;
    }
    // 11 digits starting with 1 → US with country code already present
    else if (!matchedCountry && strippedDigits.length === 11 && strippedDigits.startsWith("1")) {
      matchedCountry = COUNTRY_CODES.find(c => c.code === "1")!;
      countryCodeStr = "1";
      subscriberDigits = strippedDigits.slice(1);
    }
    // 10 digits starting with 0 → strip trunk prefix, re-evaluate
    else if (!matchedCountry && strippedDigits.length === 11 && strippedDigits.startsWith("0")) {
      const trimmed = strippedDigits.slice(1); // strip leading 0
      if (trimmed.length === 10 && /^[6-9]/.test(trimmed)) {
        matchedCountry = COUNTRY_CODES.find(c => c.code === "91")!;
        countryCodeStr = "91";
        subscriberDigits = trimmed;
      } else if (trimmed.length === 10) {
        matchedCountry = COUNTRY_CODES.find(c => c.code === "1")!;
        countryCodeStr = "1";
        subscriberDigits = trimmed;
      }
    }
  }
  
  // ── Step 4: Validate and format ──
  const totalDigits = strippedDigits.length;
  
  if (matchedCountry) {
    const subLen = subscriberDigits.length;
    // Per-country validation: subscriber must be within [subMin, subMax] AND total ≤ 15 (E.164)
    let isValid = subLen >= matchedCountry.subMin && subLen <= matchedCountry.subMax && totalDigits <= 15;

    // ── India-specific: subscriber MUST start with 6, 7, 8, or 9 ──
    // Indian mobile numbers (and most fixed-line) begin with 6-9.
    // A +91 number with subscriber starting with 0-5 is invalid.
    if (isValid && matchedCountry.code === "91") {
      isValid = /^[6-9]/.test(subscriberDigits);
    }

    const formatted = `+${countryCodeStr} ${subscriberDigits}`;
    return {
      formatted,
      country: matchedCountry.name,
      isValid,
      digits: totalDigits,
    };
  }
  
  // ── Step 5: No country code matched at all — INVALID ──
  // If none of the 200+ country codes matched AND no heuristic fallback
  // (10-digit India/US, 11-digit with trunk prefix) applied, the number
  // cannot be validated against any known telecom standard.
  // Examples that correctly end up here as INVALID:
  //   +987654321 (9 digits, no country match)
  //   +12345     (5 digits, too short)
  //   +1234567890123456 (16 digits, too long for E.164)
  const formatted = `+${strippedDigits}`;
  return {
    formatted,
    country: null,
    isValid: false,
    digits: totalDigits,
  };
}

// Garbage/banned pattern detection — catches tokens that don't belong in real data
function isGarbageToken(s: string): boolean {
  if (!s || s.trim().length === 0) return false;
  const t = s.trim().toLowerCase();
  // Symbol-only tokens: ???, !!!, ---, ~~~, ????
  if (/^[?!~\-_.#*]{2,}$/.test(t)) return true;
  // Infinity/unicode symbols: ∞, ∆, etc.
  if (/[\u2200-\u22FF\u2300-\u23FF]/.test(t)) return true;
  return false;
}

function isBannedPattern(s: string): boolean {
  if (!s || s.trim().length === 0) return false;
  const t = s.trim().toLowerCase();
  // Security/injection patterns — ONLY match dangerous standalone words or clear injection attempts
  // "system" removed — it's a common English word (e.g., "Very Efficient System")
  // "drop", "delete" removed — too common in normal text (e.g., "price drop", "delete column")
  if (/(?:hack|inject|override|exploit|malware|sql_inject|eval|exec|cmd|script_inject)/i.test(t)) return true;
  // Exact-match injection patterns (not substrings of normal words)
  if (/^(?:hack_mode|injection|exploit_code|malware_payload|script_tag|sql_inject)$/i.test(t)) return true;
  // Placeholder/system tokens
  if (/^(?:unknown|undefined|n\/a|null|none|tbd|not_available|not_a_value)$/i.test(t)) return false; // these are handled by null detection
  return false;
}

function isNullValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number" && Number.isNaN(v)) return true; // NaN → NULL
  if (typeof v === "string") {
    const stripped = stripEmojis(v).trim();
    if (stripped === "") return true; // emoji-only or whitespace-only after strip → NULL
    return NULL_VALUES.has(stripped.toLowerCase());
  }
  return false;
}

function looksLikeDate(s: string): boolean {
  if (!s || s.trim().length < 6) return false;
  const t = s.trim();
  // YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, YYYY/MM/DD, MM/DD/YYYY
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(t)) return true;
  if (/^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(t)) return true;
  // Mon DD, YYYY or Month DD, YYYY
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) && t.length >= 8) return true;
  return false;
}

function looksLikeRange(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  // Strict: must start with digit(s), not text. Prevents matching "New York-Boston"
  // Hyphen-separated: "50000-70000", "50K-70K"
  if (/^\d[\d,.]*[km]?\s*[-–—]\s*\d[\d,.]*[km]?$/i.test(t)) return true;
  // Word separator: "50,000 to 70,000", "50K to 70K"
  if (/^\d[\d,.]*[km]?\s+to\s+\d[\d,.]*[km]?$/i.test(t)) return true;
  return false;
}

function hasWordNumber(s: string): boolean {
  return /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred)$/i.test(s.trim());
}

function hasMixedNumeric(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim().toLowerCase();
  // "2 yrs", "4years", "twenty", "2-years", "three"
  return /(\d+\s*[-]?\s*(yrs?|years?|months?|mos?|days?|days?))|(\d+\s*[-]?\s*(?:yrs?|years?))|((?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety))|(\d+\s*[-]?\s*y(?:ears?)?)/i.test(t);
}

// Check if a value is "numeric-like": a real number, a word number, or a number with units
function isNumericLike(s: string): boolean {
  if (!s || s.trim() === "") return false;
  const t = s.trim();
  // 1. Plain numeric: "5", "4.5", "1,000"
  if (/^[\d,.]+$/.test(t)) {
    const cleaned = t.replace(/,/g, "");
    return !isNaN(Number(cleaned)) && cleaned !== "";
  }
  // 2. Word number: "three", "twenty"
  if (hasWordNumber(t)) return true;
  // 3. Number with ANY text: "7 years", "3 pcs", "10 units", "4items" — dynamic, no hardcoded list
  if (/^\d[\d.]*\s*[a-zA-Z]/.test(t)) return true;
  return false;
}

// Substring similarity: normalized Levenshtein-based for categorical grouping
// Returns similarity score 0..1 where 1 = identical
function substringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  // Quick check: one contains the other
  if (la >= lb && a.includes(b)) return lb / la;
  if (lb > la && b.includes(a)) return la / lb;
  // Levenshtein distance
  const matrix: number[][] = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  const dist = matrix[la][lb];
  const maxLen = Math.max(la, lb);
  return 1 - dist / maxLen;
}

// ── Grammatical Quality Scoring ──────────────────────────
// Heuristic scoring for English word quality — used to pick the
// grammatically correct canonical form when cross-canonical merge
// finds similar candidates (e.g., "Delivered" vs "Deliverd").
//
// Priority: grammatically correct > meaningful > longest
//
// Scoring criteria:
//   +3  Ends in common English suffix (-ed, -ing, -tion, -ment, etc.)
//   +2  Contains proper consonant doubling (ll, pp, tt, ss, rr, nn, mm)
//        that's typical in English morphology (e.g., "cancelled", "shipped")
//   +1  Vowel ratio in normal English range (30–55%)
//   -1  Vowel ratio abnormal (<20% or >65% — likely misspelled)
//   +1  Ends in common English phonetic pattern (vowel+consonant)
//   -1  Ends in unusual consonant cluster without vowel (e.g., "rd", "ld", "nt")

const COMMON_ENGLISH_SUFFIXES = [
  "ed", "ing", "tion", "sion", "ment", "ness", "able", "ible",
  "ous", "ive", "ful", "less", "ly", "er", "est", "al",
  "ent", "ant", "ance", "ence", "ity", "ism", "ist", "ize",
  "ise", "ate", "ure", "ory", "ary", "ery", "tic", "ical",
  "ling", "let", "ette", "ling",
];

// Consonant pairs that commonly double in English morphology
const DOUBLED_CONSONANTS = ["ll", "pp", "tt", "ss", "rr", "nn", "mm", "dd", "cc", "bb", "gg", "ff"];

function grammaticalQualityScore(word: string): number {
  if (!word || word.length < 2) return 0;
  const w = word.toLowerCase();
  let score = 0;

  // 1. Common English suffix check (highest weight — +3)
  for (const suffix of COMMON_ENGLISH_SUFFIXES) {
    if (w.endsWith(suffix)) {
      score += 3;
      break;
    }
  }

  // 2. Proper consonant doubling (+2)
  // Check for doubled consonants that are common in English
  for (const pair of DOUBLED_CONSONANTS) {
    if (w.includes(pair)) {
      score += 2;
      break;
    }
  }

  // 3. Vowel ratio analysis (+1 or -1)
  const vowels = (w.match(/[aeiouy]/g) || []).length;
  const ratio = w.length > 0 ? vowels / w.length : 0;
  if (ratio >= 0.25 && ratio <= 0.6) {
    score += 1; // Normal English range
  } else if (ratio < 0.18 || ratio > 0.65) {
    score -= 1; // Abnormal — likely misspelled or garbage
  }

  // 4. Ending quality check
  const lastChar = w[w.length - 1];
  const secondLast = w[w.length - 2];
  // Words ending in vowel are natural in English (+0.5)
  if ("aeiouy".includes(lastChar)) {
    score += 0.5;
  }
  // Words ending in common consonant+silent-e pattern (e.g., "delivered")
  // or consonant+consonant with vowel before them
  else if (w.length >= 3 && "aeiou".includes(w[w.length - 3])) {
    score += 0.5; // Has vowel support near the end
  }
  // Unusual ending: consonant cluster without recent vowel (e.g., "rd" in "Deliverd")
  else if (w.length >= 2 && !"aeiou".includes(lastChar) && !"aeiou".includes(secondLast)) {
    score -= 0.5; // Double consonant ending without vowel nearby
  }

  return score;
}

// Compare two word candidates and return the one that should be the canonical form.
// Priority: grammatically correct > meaningful (frequency) > longest
function pickBetterCanonical(
  a: string, b: string,
  aFreq: number, bFreq: number
): string {
  const aScore = grammaticalQualityScore(a);
  const bScore = grammaticalQualityScore(b);

  // Priority 1: Grammatical quality (higher score wins)
  if (aScore !== bScore) {
    return aScore > bScore ? a : b;
  }

  // Priority 2: Frequency (more frequent = more likely correct/meaningful)
  if (aFreq !== bFreq) {
    return aFreq > bFreq ? a : b;
  }

  // Priority 3: Longest form (more complete word)
  return a.length >= b.length ? a : b;
}

function hasMixedUnit(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  // Any number followed by text — fully dynamic
  return /^[\d.]+\s+[a-zA-Z]/.test(s.trim());
}

function isNumericString(s: string): boolean {
  if (!s || s.trim() === "") return false;
  const cleaned = s.replace(/,/g, "").trim();
  return !isNaN(Number(cleaned)) && cleaned !== "";
}

function isIdLike(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  // Ends with common ID suffixes: emp_id, student_no, order_code, etc.
  if (/(?:_id|_no|_seq|_code|_index|_ssn)$/.test(n)) return true;
  // Contains known ID words as standalone tokens
  return /\b(id|no|seq|index|code|ssn|employee_id|student_id|roll)\b/.test(n);
}

function isBooleanLike(values: string[]): boolean {
  if (values.length === 0) return false;
  const normalized = values.map((v) => v.trim().toLowerCase()).filter((v) => v !== "");
  if (normalized.length === 0) return false;
  const uniqueNonEmpty = new Set(normalized);
  // Dynamic: ≤2 unique values AND appears to be binary/polar (not arbitrary text)
  if (uniqueNonEmpty.size < 2 || uniqueNonEmpty.size > 4) return false;
  // Check if all values are short (≤10 chars) — booleans tend to be short
  const allShort = normalized.every((v) => v.length <= 10);
  // Check if at least one value appears in a known boolean-like pattern
  // (not a full lookup — just a hint for common patterns)
  const hasPolarHint = normalized.some((v) =>
    /^(yes|no|y|n|true|false|0|1|present|absent|active|inactive|on|off|enabled|disabled|approved|rejected|pass|fail|positive|negative)$/i.test(v)
  );
  // High cardinality ratio (>60% repetition) + short values + polar hint → likely boolean
  const total = normalized.length;
  const maxFreq = Math.max(...[...uniqueNonEmpty].map((v) => normalized.filter((n) => n === v).length));
  const repetitionRatio = total > 0 ? maxFreq / total : 0;
  return allShort && uniqueNonEmpty.size <= 3 && (repetitionRatio > 0.4 || hasPolarHint);
}

function checkConsistentCase(values: string[]): boolean {
  const nonEmpty = values.filter((v) => v.trim().length > 0);
  if (nonEmpty.length < 2) return true;
  const firstUpper = nonEmpty[0][0] === nonEmpty[0][0].toUpperCase();
  return nonEmpty.every((v) => {
    const ch = v.trim()[0];
    return ch === undefined || (ch === ch.toUpperCase()) === firstUpper;
  });
}

// v3 spec: isNumericIntended() removed — statistical inference replaces semantic name-based override

// BUG FIX #1: Detect location-like column names that should NEVER be treated as ranges
function isLocationLike(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return /\b(location|city|state|country|address|place|region|area|zone|district|province|territory)\b/i.test(n);
}

// Detect salary/compensation/pay range columns by name
function isSalaryRangeColumn(name: string): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return /\b(salary|compensation|pay|wage|income|remuneration|ctc|package)\b/i.test(n);
}

// Extended salary-range pattern matching: ranges, approx, lower-bound+, single numeric, suffix
// Covers: "₹60000", "$50K", "50000-70000", "50K-70K", "approx 60k", "70k+",
// "50000", "50K", "0.5M", "40K INR", "5LPA", "3.5 Cr", "sixtyk", "fifty crore",
// "thirtyfivek", "forty five thousand", "sixty lakh"
function looksLikeSalaryExtended(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim();
  if (t === "") return false;
  // Use unified parser's detection
  if (looksLikeSalaryValue(t)) return true;
  // Has currency symbol + digits → definitely salary
  if (/[₹$€£¥]/.test(t) && /\d/.test(t)) return true;
  // Standard ranges (hyphen or "to" separator)
  if (looksLikeRange(t)) return true;
  // Plain numeric: "50000", "60000.50"
  if (/^[\d.]+$/.test(t) && !isNaN(Number(t))) return true;
  // Noise tokens with numbers: "40K INR", "Rs.60000", "USD 50000"
  if (/\b(inr|rs|rupees|usd|eur|gbp|per\s+annum|p\.?a\.?)\b/i.test(t) && /\d/.test(t)) return true;
  return false;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1);
  return sorted[idx];
}

// Local suffix converter for salary values: "50K" → 50000, "0.5M" → 500000
function convertSuffixLocal(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (t === "") return null;
  if (t.endsWith("k")) {
    const num = parseFloat(t.slice(0, -1));
    return isNaN(num) ? null : num * 1000;
  }
  if (t.endsWith("m")) {
    const num = parseFloat(t.slice(0, -1));
    return isNaN(num) ? null : num * 1000000;
  }
  const num = parseFloat(t.replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

// ── detectSemanticType is imported from semantic-analyzer.ts (multi-signal confidence scoring) ──

// AI override for column classification — set by /api/classify-columns
export interface AIColumnOverride {
  type: string;
  confidence: number;
}

export function detectColumnProfile(col: ColumnMeta, data: RawDataRow[], aiOverride?: AIColumnOverride): ColumnProfile {
  const values = data.map((r) => r[col.name]).filter((v) => v !== null && v !== undefined);
  const strValues = values.map((v) => String(v));
  const nonEmptyStr = strValues.map((s) => s.trim()).filter((s) => s !== "");
  const totalCount = data.length;
  const missingCount = col.missingCount;
  const missingPct = totalCount > 0 ? (missingCount / totalCount) * 100 : 0;
  const uniqueCount = col.uniqueCount;

  const sampleValues = strValues.slice(0, 8);
  const hasRanges = nonEmptyStr.some(looksLikeRange);
  const hasWordNumbers = nonEmptyStr.some(hasWordNumber);
  const hasMixedUnits = nonEmptyStr.some(hasMixedUnit);
  const numericPct = nonEmptyStr.length > 0
    ? (nonEmptyStr.filter(isNumericString).length / nonEmptyStr.length) * 100
    : 0;
  // ── SMART CLASSIFICATION: numericLikePct = (numeric + word numbers + unit-based) / total ──
  const numericLikePct = nonEmptyStr.length > 0
    ? (nonEmptyStr.filter(isNumericLike).length / nonEmptyStr.length) * 100
    : 0;
  // ── DATE detection ──
  const dateLikePct = nonEmptyStr.length >= 2
    ? (nonEmptyStr.filter(looksLikeDate).length / nonEmptyStr.length) * 100
    : 0;
  const isIdColumn = isIdLike(col.name);
  const isDateColumn = dateLikePct >= 50;
  const isBooleanColumn = isBooleanLike(nonEmptyStr.slice(0, 20));
  const isConsistentCase = checkConsistentCase(nonEmptyStr.slice(0, 30));

  // ── CATEGORICAL detection: limited unique + frequent repetition ──
  // Scoring: combines cardinality (≤20 unique) and repetition frequency (>30% max)
  const totalNonEmpty = nonEmptyStr.length;
  const valFreq: Record<string, number> = {};
  for (const v of nonEmptyStr) {
    const k = v.toLowerCase();
    valFreq[k] = (valFreq[k] || 0) + 1;
  }
  const maxFreq = Math.max(...Object.values(valFreq), 0);
  const hasFrequentRepeat = totalNonEmpty > 0 && maxFreq / totalNonEmpty > 0.3;
  const cardinalityScore = uniqueCount <= 5 ? 1.0 : uniqueCount <= 10 ? 0.8 : uniqueCount <= 20 ? 0.6 : 0.2;
  const repeatScore = totalNonEmpty > 0 ? maxFreq / totalNonEmpty : 0;
  const categoricalScore = uniqueCount > 1 && nonEmptyStr.length > 0
    ? (cardinalityScore * 0.4 + repeatScore * 0.6)
    : 0;
  const isCategorical = categoricalScore >= 0.35 && uniqueCount > 1 && nonEmptyStr.length > 0;

  // ── TYPE INFERENCE: Priority chain DATE > NUMERIC_INTENT > CATEGORICAL > TEXT ──
  let detectedType: DetectedType = "text";
  // Smart decimal detection: only treat as decimal if parts around "." are numeric/number words
  // This prevents "item.description" from being detected as numeric
  const hasDecimalInColumn = nonEmptyStr.some(isSmartDecimal);


  if (isIdColumn) {
    detectedType = "id";
  } else if (isBooleanColumn) {
    detectedType = "boolean";
  }
  // PRIORITY 1: DATE (≥50% date-like)
  else if (isDateColumn) {
    detectedType = "date";
  }
  // PRIORITY 2: LOCATION-like columns (never numeric/range)
  else if (isLocationLike(col.name)) {
    detectedType = isCategorical ? "categorical" : "text";
  }
  // PRIORITY 3: SALARY/RANGE columns (always semi_structured_numeric or range)
  else if (isSalaryRangeColumn(col.name)) {
    const strictRangePct = nonEmptyStr.length > 0
      ? (nonEmptyStr.filter(looksLikeRange).length / nonEmptyStr.length) * 100
      : 0;
    const extendedPct = nonEmptyStr.length > 0
      ? (nonEmptyStr.filter(looksLikeSalaryExtended).length / nonEmptyStr.length) * 100
      : 0;
    if (strictRangePct >= 30) {
      detectedType = "range";
    } else if (extendedPct >= 40) {
      detectedType = "semi_structured_numeric";
    } else {
      // Salary-named but doesn't look like salary data — fallback to numeric intent check
      if (numericLikePct >= 40) {
        detectedType = "numeric_integer";
      }
    }
  }
  // PRIORITY 4: Standard range columns (≥30% strict numeric ranges)
  else if (hasRanges && nonEmptyStr.length > 0 && nonEmptyStr.filter(looksLikeRange).length / nonEmptyStr.length >= 0.3) {
    detectedType = "range";
  }
  // PRIORITY 5: NUMERIC_INTENT — (numeric + numeric-like) ≥ 40% OR decimals detected
  // v3 spec: Lower threshold from 60% to 40% + decimal detection override
  else if (numericLikePct >= 40 || hasDecimalInColumn) {
    detectedType = hasDecimalInColumn ? "numeric_float" : "numeric_integer";
  }
  // PRIORITY 7: CATEGORICAL — limited unique + frequent repetition
  else if (isCategorical) {
    detectedType = "categorical";
  }
  // PRIORITY 8: TEXT — fallback

  // ── SEMANTIC TYPE DETECTION (multi-signal confidence scoring) ──
  // Run for ALL columns — not just numeric. Detects FULL_NAME, EMAIL, PHONE, LOCATION, etc.
  // AI override takes priority when confidence >= 0.6
  let semanticType: SemanticType | undefined;
  let semanticConfidence: number | undefined;
  let semanticSignals: string[] | undefined;

  if (nonEmptyStr.length > 0) {
    const semantic = detectSemanticType(col.name, nonEmptyStr);

    // AI override: if AI classified this column with confidence >= 0.6, use it
    if (aiOverride && aiOverride.confidence >= 0.6 && aiOverride.type !== "UNKNOWN") {
      semanticType = aiOverride.type as SemanticType;
      semanticConfidence = aiOverride.confidence;
      semanticSignals = [...(semantic.signals || []), "ai_classified"];
    } else {
      semanticType = semantic.type;
      semanticConfidence = semantic.confidence;
      semanticSignals = semantic.signals;
    }
  }

  return {
    name: col.name,
    detectedType,
    missingCount,
    missingPct,
    uniqueCount,
    totalCount,
    sampleValues,
    hasRanges,
    hasWordNumbers,
    hasMixedUnits,
    numericPct,
    numericLikePct,
    dateLikePct,
    categoricalScore,
    isIdColumn,
    isBooleanColumn,
    isDateColumn,
    isConsistentCase,
    semanticType,
    semanticConfidence,
    semanticSignals,
  };
}

// ── Cleaning Rule Types ─────────────────────────────

export interface CleaningRule {
  id: string;
  step: number;
  stepName: string;
  section: "text_cleaning" | "null_standardization" | "numeric_normalization" | "range_parsing" | "date_standardization" | "categorical_normalization" | "category_clustering" | "id_validation" | "anomaly_detection";
  column: string;
  columnClass: string;
  expectedType: string;
  method: string;
  transformation: string;
  condition: string;
  severity: "info" | "warning" | "critical";
  riskLevel: "medium" | "high";
  confidence_score: number;
  confidence_label: "HIGH" | "MEDIUM" | "LOW";
  exampleConversions: string[];
  reason: string;
  applied: boolean;
  issueType: string;
  params?: Record<string, number | string | string[] | Record<string, string>>;
  suggestedActions?: string[];
}

// ── Rule Generation ─────────────────────────────────

function titleCase(val: string): string {
  return val.trim().split(/\s+/).map((word) =>
    word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word
  ).join(" ");
}

// ── Smart Name Titlecase ─────────────────────────────
// Handles: O'Brien, O'Connor, Mc/Mac prefix, hyphenated names (Mary-Jane),
// multi-part names (De La Cruz), van/von prefixes, Roman numerals (IV, III)
function nameTitleCase(val: string): string {
  const trimmed = val.trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;

  const specialPrefixes = ["mc", "mac", "o'", "d'", "de", "di", "du", "da", "le", "la", "van", "von", "el", "al", "del", "della", "der", "den", "het", "st", "ter", "bin", "ibn"];

  const words = trimmed.split(/\s+/);

  const result = words.map((word, idx) => {
    // Preserve hyphenated names: Mary-Jane, Anne-Marie
    if (word.includes("-")) {
      return word.split("-").map((part) => {
        if (!part) return part;
        // Check for special prefix within hyphen parts
        const lowerPart = part.toLowerCase();
        for (const prefix of specialPrefixes) {
          if (lowerPart.startsWith(prefix) && lowerPart.length > prefix.length) {
            const after = lowerPart.slice(prefix.length);
            const capitalized = after.charAt(0).toUpperCase() + after.slice(1);
            return prefix.charAt(0).toUpperCase() + prefix.slice(1) + capitalized;
          }
        }
        // Default: capitalize each part
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }).join("-");
    }

    // Handle apostrophe names: O'Brien, O'Connor, D'Angelo
    if (word.includes("'")) {
      const parts = word.split("'");
      if (parts.length === 2 && parts[0].length <= 2) {
        // O'Brien pattern: prefix is 1-2 chars
        return parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() + "'" +
          parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase();
      }
    }

    const lower = word.toLowerCase();

    // Mc/Mac prefix: McDonald, MacDonald, McCartney
    if (lower.startsWith("mc") && lower.length > 2) {
      return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
    }
    if (lower.startsWith("mac") && lower.length > 3 && !lower.startsWith("macc")) {
      return "Mac" + lower.charAt(3).toUpperCase() + lower.slice(4);
    }

    // Small connector words (only lowercase if not first/last word)
    const connectors = ["de", "di", "du", "da", "le", "la", "van", "von", "el", "al", "del", "della", "der", "den", "het", "st", "ter", "bin", "ibn"];
    if (idx > 0 && idx < words.length - 1 && connectors.includes(lower)) {
      return lower;
    }

    // Roman numerals (II, III, IV, V, VI, VII, VIII, IX, X, XII)
    if (/^(i{1,3}|iv|v(?:i{0,3})|x(?:i{0,3}))$/i.test(lower) && lower.length <= 4) {
      return lower.toUpperCase();
    }

    // Default: capitalize first letter, lowercase rest
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });

  return result.join(" ");
}

/** Check if a name value needs title-casing or whitespace cleanup */
function nameNeedsStandardization(val: string): boolean {
  if (!val || val.trim() !== val) return true; // has leading/trailing whitespace
  if (/\s{2,}/.test(val)) return true; // multiple spaces
  // ALL UPPERCASE → needs title case
  if (val === val.toUpperCase() && val.length > 1 && /[a-zA-Z]/.test(val)) return true;
  // all lowercase → needs title case
  if (val === val.toLowerCase() && val.length > 1 && /[a-zA-Z]/.test(val)) return true;
  // Mixed case that doesn't match name titlecase
  if (val !== nameTitleCase(val)) return true;
  return false;
}

function generateDateExamples(sampleValues: string[]): string[] {
  const examples: string[] = [];
  const seen = new Set<string>();
  for (const raw of sampleValues.slice(0, 5)) {
    const v = String(raw).trim();
    if (!v || seen.has(v)) continue;
    const { result: normalized, isAmbiguous } = tryNormalizeDate(v);
    if (normalized && normalized !== v) {
      const ambigTag = isAmbiguous ? " (confidence: 0.75 | MEDIUM ⚠ ambiguous_date)" : " (confidence: 0.95 | HIGH)";
      examples.push(`"${v}" → "${normalized}"${ambigTag}`);
      seen.add(v);
    }
  }
  // Fallback examples if no real transformations found
  if (examples.length === 0) {
    examples.push(
      '"2021/04/10" → "2021-04-10" (confidence: 0.95 | HIGH)',
      '"10-05-2020" → "2020-05-10" (DD-MM-YYYY, confidence: 0.75 | MEDIUM ⚠ ambiguous_date)',
    );
  }
  return examples.slice(0, 3);
}

export function generateCleaningPlan(columns: ColumnMeta[], data: RawDataRow[], precomputedProfiles?: ColumnProfile[]): CleaningRule[] {
  const profiles = precomputedProfiles || columns.map((col) => detectColumnProfile(col, data));
  const rules: CleaningRule[] = [];
  let ruleId = 0;

  // ═══════════════════════════════════════════════════════
  // STEP 1: EMOJI DETECTION — NEVER allowed in any column
  // Emojis are caught by deterministic regex — NO AI needed.
  // Scans ALL non-ID, non-FEEDBACK columns for emoji-containing values → flag RED.
  // FEEDBACK columns are EXCLUDED — sentiment-appropriate emojis are valid there.
  // ═══════════════════════════════════════════════════════
  const emojiCols: string[] = [];
  let emojiCount = 0;
  for (const p of profiles) {
    if (p.isIdColumn) continue;
    if (p.semanticType === "FEEDBACK") continue; // FEEDBACK columns allow sentiment emojis
    let colEmojiCount = 0;
    for (const row of data) {
      const v = row[p.name];
      if (v == null || typeof v !== "string") continue;
      if (containsEmoji(v)) colEmojiCount++;
    }
    if (colEmojiCount > 0) {
      emojiCols.push(p.name);
      emojiCount += colEmojiCount;
    }
  }
  if (emojiCols.length > 0) {
    rules.push({
      id: `rule-${ruleId++}`,
      step: 1,
      stepName: "Emoji Detection",
      section: "text_cleaning",
      column: emojiCols.join(", "),
      columnClass: "all",
      expectedType: "Text (no emoji)",
      method: "emoji_reject",
      transformation: `Flag ${emojiCount} emoji-containing value(s) across ${emojiCols.length} column(s)`,
      condition: `Any value containing emoji → RED flag (value kept)`,
      severity: "warning",
      riskLevel: "high",
      confidence_score: 1.0,
      confidence_label: "HIGH",
      exampleConversions: emojiCols.slice(0, 3).map((c) => `"value with 👍" → ⚠ RED flag (emoji detected)`),
      reason: "Emojis are never allowed in any data column — deterministic regex detection",
      applied: false,
      issueType: "text_quality",
      params: { emojiCols: emojiCols.length, emojiCount },
      suggestedActions: ["Emojis detected via regex — flagged RED, values kept as-is"],
    });
  }

  const hasGlobalMissing = profiles.some((p) => p.missingCount > 0);

  // STEP 2: NULL STANDARDIZATION — ALL non-ID columns (never skip any)
  // BUG FIX #5: Include ALL columns with missing values except ID — even Rating, Years_Exp, etc.
  if (hasGlobalMissing) {
    const affectedCols = profiles.filter((p) => p.missingCount > 0 && !p.isIdColumn).map((p) => p.name);
    // Safety: also scan raw data for null-like strings that ColumnMeta might have missed
    const colsToCheck = profiles.filter((p) => !p.isIdColumn);
    for (const p of colsToCheck) {
      if (affectedCols.includes(p.name)) continue; // already included
      const hasNullLike = data.some((r) => {
        const v = r[p.name];
        if (v === null || v === undefined) return true;
        if (typeof v === "string" && NULL_VALUES.has(v.trim().toLowerCase())) return true;
        return false;
      });
      if (hasNullLike) affectedCols.push(p.name);
    }
    rules.push({
      id: `rule-${ruleId++}`,
      step: 2,
      stepName: "Null Standardization",
      section: "null_standardization",
      column: affectedCols.join(", "),
      columnClass: "all",
      expectedType: "—",
      method: "null_standardize",
      transformation: `Convert null-like values ("", "NA", "null", "-") to NULL across ${affectedCols.length} column(s)`,
      condition: `When value matches null pattern`,
      severity: "warning",
      riskLevel: "high",
      confidence_score: 1.0,
      confidence_label: "HIGH",
      exampleConversions: affectedCols.slice(0, 3).map((c) => `"NA" → NULL ⚠ missing_value (confidence: 1.00 | HIGH)`),
      reason: "Deterministic null detection — always correct",
      applied: false,
      issueType: "missing_values",
    });
  }

  // STEP 3: NUMERIC NORMALIZATION — Apply ONLY to NUMERIC_INTENT columns (type-based gate)
  // Detects: word numbers, unit-based values, typos, domain violations
  // Safety: only deterministic conversions auto-applied; ambiguous → flag only
  for (const p of profiles) {
    // Gate: ONLY apply if column is statistically classified as NUMERIC_INTENT
    // EXCEPTION: Numeric-like semantic types (MONEY, EXPERIENCE, RATING, PERCENTAGE, AGE)
    //            bypass the gate — they may have text-mixed values (e.g., "five years of experience")
    const numericSemanticTypes = ["MONEY", "EXPERIENCE", "RATING", "PERCENTAGE", "AGE"];
    const isNumericSemantic = p.semanticType != null && numericSemanticTypes.includes(p.semanticType);
    if (!isNumericSemantic && p.detectedType !== "numeric_integer" && p.detectedType !== "numeric_float") continue;
    if (isSalaryRangeColumn(p.name) && !isNumericSemantic) continue; // non-semantic salary columns handled by salary_pre_normalization

    // Scan column values to classify issues
    const domainRules = getNumericDomainRules(p.name, p.semanticType);
    let unitBasedCount = 0;
    let wordNumberCount = 0;
    let typoCount = 0;
    let domainViolationCount = 0;
    let qualitativeCount = 0;
    const unitExamples: string[] = [];
    const wordExamples: string[] = [];
    const typoExamples: string[] = [];
    const domainExamples: string[] = [];
    const qualitativeExamples: string[] = [];

    // Semantic type-based override for money columns — DISABLED (AI-ONLY)
    // Salary normalization is handled EXCLUSIVELY by the AI button on the column header.
    // No rule-based cleaning for MONEY columns.
    /*
    if (p.semanticType === "MONEY") {
      // Scan for money-specific patterns
      for (const row of data) {
        const val = row[p.name];
        if (val == null || isNullValue(val)) continue;
        const str = String(val).trim();
        if (str === "") continue;
        if (typeof val === "number" || /^[\d.]+$/.test(str)) continue;

        const cleaned = cleanMonetaryValue(val);
        if (cleaned.value !== null && cleaned.flag === undefined) {
          unitBasedCount++;
          if (unitExamples.length < 2) unitExamples.push(`"${str}" → ${cleaned.value} (confidence: 0.95 | HIGH)`);
        } else if (cleaned.flag === "range_average") {
          unitBasedCount++;
          if (unitExamples.length < 2) unitExamples.push(`"${str}" → ${cleaned.value} (confidence: 0.92 | HIGH | range avg)`);
        } else {
          qualitativeCount++;
          if (qualitativeExamples.length < 2) qualitativeExamples.push(`"${str}" → ⚠ non_numeric`);
        }
      }

      const totalIssues = unitBasedCount + qualitativeCount;
      if (totalIssues > 0) {
        const parts: string[] = [];
        if (unitBasedCount > 0) parts.push(`${unitBasedCount} monetary values → auto-fix`);
        if (qualitativeCount > 0) parts.push(`${qualitativeCount} non-numeric → flag`);

        rules.push({
          id: `rule-${ruleId++}`,
          step: 3,
          stepName: "Money Normalization",
          section: "numeric_normalization",
          column: p.name,
          columnClass: "money",
          expectedType: "Numeric (Float)",
          method: "numeric_normalize",
          transformation: `Normalize monetary values in ${p.name} (detected as MONEY, confidence: ${(p.semanticConfidence ?? 0).toFixed(2)}): ${parts.join("; ")}`,
          condition: `Currency symbols stripped, K/M/B/Cr/LPA multipliers applied, ranges averaged`,
          severity: qualitativeCount > 0 ? "warning" : "info",
          riskLevel: qualitativeCount > 0 ? "high" : "medium",
          confidence_score: p.semanticConfidence ?? 0.90,
          confidence_label: p.semanticConfidence && p.semanticConfidence >= 0.7 ? "HIGH" : "MEDIUM",
          exampleConversions: [
            ...unitExamples.slice(0, 2),
            ...qualitativeExamples.slice(0, 2),
          ],
          reason: `Semantic detection identified ${p.name} as MONEY column (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
          applied: false,
          issueType: "type_mismatch",
          params: { unitBasedCount, qualitativeCount, semanticType: "MONEY" },
          suggestedActions: [
            "Currency symbols (₹, $, €, £) are stripped automatically",
            "Multipliers applied: K=×1000, M=×1M, B=×1B, LPA=×100K, Cr=×10M",
            "Non-numeric values are FLAGGED only — manual review required",
          ],
        });
      }
      continue;
    }
    */ // END: MONEY rule generation disabled — AI-only

    // Semantic type-based override for rating columns
    if (p.semanticType === "RATING") {
      let ratingIssues = 0;
      const ratingExamples: string[] = [];
      for (const row of data) {
        const val = row[p.name];
        if (val == null || isNullValue(val)) continue;
        const str = String(val).trim();
        if (str === "") continue;
        if (typeof val === "number" || /^[\d.]+$/.test(str)) {
          // Domain check for ratings
          const num = typeof val === "number" ? val : parseFloat(str);
          if (!isNaN(num) && domainRules && num > domainRules.max) {
            ratingIssues++;
            if (ratingExamples.length < 2) ratingExamples.push(`"${str}" → ⚠ outlier (rating: ${domainRules.label})`);
          }
          continue;
        }
        // Non-numeric rating: "4★", "5/5", "four"
        ratingIssues++;
        if (ratingExamples.length < 2) ratingExamples.push(`"${str}" → normalize (confidence: 0.90 | HIGH)`);
      }
      if (ratingIssues > 0) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 3,
          stepName: "Rating Normalization",
          section: "numeric_normalization",
          column: p.name,
          columnClass: "rating",
          expectedType: "Numeric (Float)",
          method: "numeric_normalize",
          transformation: `Normalize rating formats in ${p.name} (detected as RATING, confidence: ${(p.semanticConfidence ?? 0).toFixed(2)})`,
          condition: `Strip rating noise (★, /5, /10), convert word numbers`,
          severity: ratingExamples.some((e) => e.includes("outlier")) ? "warning" : "info",
          riskLevel: "medium",
          confidence_score: p.semanticConfidence ?? 0.90,
          confidence_label: "HIGH",
          exampleConversions: ratingExamples.slice(0, 3),
          reason: `Semantic detection identified ${p.name} as RATING column (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
          applied: false,
          issueType: "type_mismatch",
          params: { semanticType: "RATING" },
        });
      }
      continue;
    }

    // Semantic type-based override for experience columns
    if (p.semanticType === "EXPERIENCE") {
      let expIssues = 0;
      const expExamples: string[] = [];
      for (const row of data) {
        const val = row[p.name];
        if (val == null || isNullValue(val)) continue;
        const str = String(val).trim();
        if (str === "") continue;
        // Already a clean number — just check domain
        if (typeof val === "number" || /^[\d.]+$/.test(str)) {
          const num = typeof val === "number" ? val : parseFloat(str);
          if (!isNaN(num) && domainRules && num > domainRules.max) {
            expIssues++;
            if (expExamples.length < 2) expExamples.push(`"${str}" → ⚠ outlier (experience: ${domainRules.label})`);
          }
          continue;
        }
        // Try to extract number from text-mixed experience values
        // Same noise-stripping logic as applyRules for consistency
        let cleaned = str
          .replace(/^(?:about|approximately|around|over|more than|less than|nearly|almost|exactly|roughly|circa|~)\s*/i, "")
          .replace(/(?:\s*of\s*experience|\s*(?:in|total|working|approximately|plus)\s*(?:experience|years?|yrs?)?)\s*$/i, "")
          .replace(/\+$/, "")
          .replace(/\s*(?:years?|yrs?|yr)\b/gi, "")
          .trim();

        let extractedNum: number | null = null;
        // Pure digit after stripping
        if (/^[\d.]+$/.test(cleaned)) {
          const n = parseFloat(cleaned);
          if (!isNaN(n)) extractedNum = n;
        }
        // Word number or compound
        if (extractedNum === null) {
          const cr = extractCompoundWordNumber(cleaned.toLowerCase());
          if (cr !== null) extractedNum = cr;
        }
        // Embedded digit in noise
        if (extractedNum === null) {
          const m = cleaned.match(/([\d]+(?:\.\d+)?)/);
          if (m) { const n = parseFloat(m[1]); if (!isNaN(n)) extractedNum = n; }
        }
        // Embedded word number in noise
        if (extractedNum === null) {
          for (const t of cleaned.toLowerCase().split(/\s+/)) {
            if (WORD_NUMBERS[t] !== undefined) { extractedNum = WORD_NUMBERS[t]; break; }
          }
        }

        if (extractedNum !== null) {
          expIssues++;
          if (expExamples.length < 2) expExamples.push(`"${str}" → ${extractedNum} (confidence: 0.90 | HIGH)`);
        } else {
          expIssues++;
          if (expExamples.length < 2) expExamples.push(`"${str}" → ⚠ non_numeric`);
        }
      }
      if (expIssues > 0) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 3,
          stepName: "Experience Normalization",
          section: "numeric_normalization",
          column: p.name,
          columnClass: "experience",
          expectedType: "Numeric (Float)",
          method: "numeric_normalize",
          transformation: `Normalize experience values in ${p.name} (detected as EXPERIENCE, confidence: ${(p.semanticConfidence ?? 0).toFixed(2)}): strip noise text, convert word numbers to digits, extract numbers`,
          condition: `Strip "years"/"yrs"/"yr" suffix, strip noise words ("about", "of experience", etc.), convert word numbers (five → 5), extract embedded numbers`,
          severity: expExamples.some((e) => e.includes("outlier") || e.includes("non_numeric")) ? "warning" : "info",
          riskLevel: expExamples.some((e) => e.includes("non_numeric")) ? "high" : "medium",
          confidence_score: p.semanticConfidence ?? 0.90,
          confidence_label: "HIGH",
          exampleConversions: expExamples.slice(0, 3),
          reason: `Semantic detection identified ${p.name} as EXPERIENCE column (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
          applied: false,
          issueType: "type_mismatch",
          params: { semanticType: "EXPERIENCE" },
          suggestedActions: [
            "Noise text stripped: 'about', 'approximately', 'of experience', 'working'",
            "Word numbers converted: five → 5, twenty → 20, twenty five → 25",
            "Suffixes stripped: years, yrs, yr, +",
          ],
        });
      }
      continue;
    }

    // ── Standard numeric normalization (no semantic override) ──
    // Scan column values to classify issues
    const stdDomainRules = getNumericDomainRules(p.name, p.semanticType);

    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) continue;
      const str = String(val).trim();
      if (str === "") continue;

      // Skip already-numeric values
      if (typeof val === "number" || /^[\d.]+$/.test(str)) {
        // Check domain validation even for valid numbers
        const num = parseFloat(str);
        if (!isNaN(num) && stdDomainRules) {
          if (num < stdDomainRules.min) {
            domainViolationCount++;
            if (domainExamples.length < 2) domainExamples.push(`"${str}" → ⚠ invalid_negative (domain: ${stdDomainRules.label})`);
          } else if (num > stdDomainRules.max) {
            domainViolationCount++;
            if (domainExamples.length < 2) domainExamples.push(`"${str}" → ⚠ outlier (domain: ${stdDomainRules.label})`);
          }
        }
        continue;
      }

      // Check unit-based: "7 years", "2 yrs", "4years"
      const unitMatch = str.match(/^([\d.]+)\s*(?:years?|yrs?|yr|months?|mons?|days?|hrs?|hours?)$/i);
      if (unitMatch && !isNaN(parseFloat(unitMatch[1]))) {
        unitBasedCount++;
        if (unitExamples.length < 2) unitExamples.push(`"${str}" → ${parseFloat(unitMatch[1])} (confidence: 0.95 | HIGH)`);
        continue;
      }

      // Check exact word-to-number
      const wordLower = str.toLowerCase();
      if (WORD_NUMBERS[wordLower] !== undefined) {
        wordNumberCount++;
        if (wordExamples.length < 2) wordExamples.push(`"${str}" → ${WORD_NUMBERS[wordLower]} (confidence: 0.70 | MEDIUM)`);
        continue;
      }

      // Check fuzzy/typo word numbers
      const fuzzyMatch = fuzzyMatchWordNumber(str);
      if (fuzzyMatch) {
        typoCount++;
        if (typoExamples.length < 2) typoExamples.push(`"${str}" → ⚠ possible_typo ("${fuzzyMatch}")`);
        continue;
      }

      // Qualitative / non-numeric text → flag
      qualitativeCount++;
      if (qualitativeExamples.length < 2) qualitativeExamples.push(`"${str}" → ⚠ non_numeric_category`);
    }

    const totalIssues = unitBasedCount + wordNumberCount + typoCount + domainViolationCount + qualitativeCount;
    if (totalIssues === 0) continue;

    // Build the transformation description
    const parts: string[] = [];
    if (unitBasedCount > 0) parts.push(`${unitBasedCount} unit-based → auto-fix`);
    if (wordNumberCount > 0) parts.push(`${wordNumberCount} word numbers → convert (MEDIUM)`);
    if (typoCount > 0) parts.push(`${typoCount} typos → flag only`);
    if (domainViolationCount > 0) parts.push(`${domainViolationCount} domain violations`);
    if (qualitativeCount > 0) parts.push(`${qualitativeCount} non-numeric → flag`);

    const exampleConversions: string[] = [
      ...unitExamples.slice(0, 2),
      ...wordExamples.slice(0, 2),
      ...typoExamples.slice(0, 2),
      ...domainExamples.slice(0, 2),
      ...qualitativeExamples.slice(0, 2),
    ];

    rules.push({
      id: `rule-${ruleId++}`,
      step: 3,
      stepName: "Numeric Normalization",
      section: "numeric_normalization",
      column: p.name,
      columnClass: p.detectedType === "numeric_integer" ? "numeric" : p.detectedType === "numeric_float" ? "numeric" : "categorical",
      expectedType: p.detectedType === "numeric_float" ? "Numeric (Float)" : "Numeric (Integer)",
      method: "numeric_normalize",
      transformation: `Normalize numeric formats in ${p.name}${stdDomainRules ? ` (domain: ${stdDomainRules.label})` : ""}: ${parts.join("; ")}`,
      condition: `Priority: null → valid numeric → unit strip → word-to-number → typo detect → domain validate`,
      severity: typoCount > 0 || domainViolationCount > 0 || qualitativeCount > 0 ? "warning" : "info",
      riskLevel: wordNumberCount > 0 || qualitativeCount > 0 ? "high" : "medium",
      confidence_score: 0.90,
      confidence_label: "HIGH",
      exampleConversions,
      reason: `Strict mode — deterministic auto-fix only, ambiguous values flagged: ${parts.join(", ")}`,
      applied: false,
      issueType: "type_mismatch",
      params: { unitBasedCount, wordNumberCount, typoCount, domainViolationCount, qualitativeCount },
      suggestedActions: [
        "Unit-based values (e.g. '7 years') are auto-converted to numbers",
        "Word numbers (e.g. 'three') convert with MEDIUM confidence — review",
        "Typos and qualitative values are FLAGGED only — manual review required",
      ],
    });
  }

  // STEP 1a: NAME STANDARDIZATION — title case + validation
  // Names get standardized (trimmed, title-cased, proper casing) AND validated.
  //   - FULL_NAME/FIRST_NAME/LAST_NAME: trim whitespace, apply proper title case
  //     Numbers, special chars → flag RED (keep value)
  //   - LAST_NAME: single token only, no emojis/banned, same char rules
  //   - Only emojis, banned words, garbage tokens, special chars → flag RED (keep value)
  //   - Only N/A, NaN, null-like → null
  // LAST_NAME gets its own ai_lastname_validate rule
  for (const p of profiles) {
    if (p.semanticType !== "FULL_NAME" && p.semanticType !== "LAST_NAME" && p.semanticType !== "FIRST_NAME") continue;

    // ── LAST_NAME: dedicated validation rule ──
    if (p.semanticType === "LAST_NAME") {
      let invalidCount = 0;
      let nullCount = 0;
      const invalidExamples: string[] = [];
      const nullExamples: string[] = [];

      for (const row of data) {
        const val = row[p.name];
        if (val == null || isNullValue(val)) {
          nullCount++;
          if (nullExamples.length < 1) nullExamples.push(`"${String(val ?? "")}" → NULL`);
          continue;
        }
        const str = String(val).trim();
        if (str === "") {
          nullCount++;
          continue;
        }

        // Check for invalid patterns: emoji, garbage, banned, too short, multi-word, special chars
        const stripped = stripEmojis(str).trim();
        const isInvalid =
          containsEmoji(str) ||
          isGarbageToken(str) ||
          isBannedPattern(str) ||
          stripped.length < 2 ||
          stripped.split(/\s+/).filter((w) => w.length > 0).length > 1 ||
          /[^a-zA-Z'\-\p{L}]/u.test(stripped);

        if (!isInvalid) continue;

        invalidCount++;
        if (invalidExamples.length < 3) {
          let reason = "invalid";
          if (containsEmoji(str)) reason = "contains emoji";
          else if (isGarbageToken(str)) reason = "garbage token";
          else if (isBannedPattern(str)) reason = "banned pattern";
          else if (stripped.length < 2) reason = "too short (< 2 chars)";
          else if (stripped.split(/\s+/).filter((w) => w.length > 0).length > 1) reason = "multiple words (last name = single word)";
          else reason = "contains special characters";
          invalidExamples.push(`"${str}" → ⚠ RED flag (${reason}, value KEPT)`);
        }
      }

      if (invalidCount + nullCount > 0) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 1,
          stepName: "Last Name Validation",
          section: "text_cleaning",
          column: p.name,
          columnClass: "name",
          expectedType: "Single Word (2+ chars, letters only, no emojis/banned/special chars)",
          method: "ai_lastname_validate",
          transformation: `Validate last names in ${p.name}: ${nullCount} null-like → NULL, ${invalidCount} flagged RED (value kept)`,
          condition: `Only letters, apostrophes, hyphens allowed. 1 word=GREEN, 1 char=RED, 2+ words=RED, special chars=RED. No AI needed.`,
          severity: invalidCount > 0 ? "warning" : "info",
          riskLevel: invalidCount > 0 ? "high" : "medium",
          confidence_score: p.semanticConfidence ?? 0.90,
          confidence_label: "HIGH",
          exampleConversions: [...nullExamples, ...invalidExamples],
          reason: `Last names validated by rules only (no AI). 1 word with letters = valid. Special chars, numbers, multi-word, emoji, banned = RED. (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
          applied: false,
          issueType: "text_quality",
          params: { invalidCount, nullCount, semanticType: "LAST_NAME" },
          suggestedActions: [
            "1 word (2+ chars, letters only) → GREEN — valid, no change",
            "1 character → RED flag (value preserved)",
            "2+ words → RED flag (value preserved)",
            "Special characters (except ' and -) → RED flag (value preserved)",
            "Emoji, banned words, garbage → RED flag (value preserved)",
            "N/A, NaN, null → converted to NULL",
          ],
        });
      }
      continue; // Skip generic name_normalize for LAST_NAME
    }

    // ── FULL_NAME / FIRST_NAME: standardization + validation rule ──
    let invalidCount = 0;
    let nullCount = 0;
    let partialCount = 0;
    let standardizedCount = 0;
    const invalidExamples: string[] = [];
    const nullExamples: string[] = [];
    const partialExamples: string[] = [];
    const standardizedExamples: string[] = [];

    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) {
        nullCount++;
        if (nullExamples.length < 1) nullExamples.push(`"${String(val ?? "")}" → NULL`);
        continue;
      }
      const str = String(val).trim();
      if (str === "") {
        nullCount++;
        continue;
      }

      const isFullName = p.semanticType === "FULL_NAME";
      const stripped = stripEmojis(str).trim();

      // Check for invalid patterns
      const isInvalid =
        containsEmoji(str) ||
        isGarbageToken(str) ||
        isBannedPattern(str) ||
        stripped.length < 2;

      // FULL_NAME/FIRST_NAME: check for numbers and special characters
      const isFullNameOrFirst = isFullName || p.semanticType === "FIRST_NAME";
      const hasSpecialChars = isFullNameOrFirst && /[^\p{L}\s'\-.\u0300-\u036F]/u.test(stripped);
      const hasNumbers = isFullNameOrFirst && /\d/.test(stripped);

      if (isInvalid || hasSpecialChars || hasNumbers) {
        invalidCount++;
        if (invalidExamples.length < 2) {
          let reason = "invalid";
          if (containsEmoji(str)) reason = "contains emoji";
          else if (isGarbageToken(str)) reason = "garbage token";
          else if (isBannedPattern(str)) reason = "banned pattern";
          else if (stripped.length < 2) reason = "too short";
          else if (hasNumbers) reason = "contains numbers (names are text-only)";
          else if (hasSpecialChars) reason = "contains special characters (names are text-only)";
          invalidExamples.push(`"${str}" → ⚠ RED flag (${reason}, value KEPT)`);
        }
        continue;
      }

      // FULL_NAME: single word → partial (YELLOW flag, keep as-is)
      if (isFullName) {
        const words = stripped.split(/\s+/).filter((w) => w.length > 0);
        if (words.length === 1) {
          partialCount++;
          if (partialExamples.length < 2) partialExamples.push(`"${str}" → ⚠ YELLOW (partial full name, value KEPT)`);
          continue;
        }
      }

      // Valid — check if standardization (title case) is needed
      if (nameNeedsStandardization(str) && !isInvalid && !hasSpecialChars && !hasNumbers) {
        standardizedCount++;
        const standardized = nameTitleCase(str);
        if (standardizedExamples.length < 3) {
          standardizedExamples.push(`"${str}" → "${standardized}" (title cased + trimmed)`);
        }
      }
    }

    if (invalidCount + nullCount + partialCount + standardizedCount > 0) {
      const typeName = p.semanticType === "FULL_NAME" ? "Full Name" : "First Name";
      rules.push({
        id: `rule-${ruleId++}`,
        step: 1,
        stepName: `${typeName} Standardization`,
        section: "text_cleaning",
        column: p.name,
        columnClass: "name",
        expectedType: "Valid Text (letters only, 2+ chars, proper title case)",
        method: "name_standardize",
        transformation: `Standardize ${typeName.toLowerCase()} in ${p.name}: ${standardizedCount} title-cased, ${nullCount} → NULL, ${invalidCount} flagged RED, ${partialCount} flagged YELLOW`,
        condition: `N/A, NaN, null → NULL. Emoji/banned/garbage/numbers/special chars → RED flag (kept). Single-word FULL_NAME → YELLOW (kept). Inconsistent casing → proper title case (O'Brien, Mc, De La, hyphenated).`,
        severity: invalidCount > 0 ? "warning" : "info",
        riskLevel: invalidCount > 0 ? "high" : "medium",
        confidence_score: p.semanticConfidence ?? 0.90,
        confidence_label: "HIGH",
        exampleConversions: [...standardizedExamples, ...nullExamples, ...invalidExamples, ...partialExamples],
        reason: `${typeName}s are standardized to proper title case and validated. Handles: O'Brien, McDonald, Mary-Jane, De La Cruz, Mc prefix, Roman numerals. Invalid patterns flagged. (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
        applied: false,
        issueType: "text_quality",
        params: { invalidCount, nullCount, partialCount, standardizedCount, semanticType: p.semanticType },
        suggestedActions: [
          "Trim whitespace + normalize to proper title case",
          "Handles: O'Brien, McDonald, Mary-Jane, De La Cruz, van/von, Mc/Mac prefix",
          "Emoji, banned words, garbage tokens, numbers, special chars → flagged RED (value preserved)",
          "N/A, NaN, null → converted to NULL",
          "Full names can ONLY contain letters from any language, spaces, hyphens, apostrophes",
          p.semanticType === "FULL_NAME" ? "Single-word in FULL_NAME column → YELLOW flag (kept as partial)" : "All valid values are title-cased",
        ],
      });
    }
  }

  // STEP 1b: EMAIL VALIDATION — regex-first, lowercase MANDATORY, AI-fallback for complex issues
  // ALWAYS generate this rule for EMAIL columns — even if all emails pass regex,
  // we still need to lowercase them (e.g., "John@Gmail.COM" → "john@gmail.com")
  for (const p of profiles) {
    if (p.semanticType !== "EMAIL") continue;

    const emailRegex = EMAIL_REGEX;
    let validCount = 0;
    let needsLowercase = 0;
    let invalidCount = 0;
    let likelyFixable = 0;
    const invalidExamples: string[] = [];
    const fixableExamples: string[] = [];
    const lowercaseExamples: string[] = [];

    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) continue;
      const str = String(val).trim();
      if (str === "") continue;

      // Check if uppercase/mixed case (needs lowercase normalization)
      if (str !== str.toLowerCase()) {
        needsLowercase++;
        if (emailRegex.test(str) && lowercaseExamples.length < 2) {
          lowercaseExamples.push(`"${str}" → ${str.toLowerCase()} (regex: ✅ valid, case: needs lowercase)`);
        }
      }

      if (emailRegex.test(str.toLowerCase())) {
        validCount++;
        continue;
      }

      // Check if likely AI-fixable: has @ but formatting issues, or common patterns
      const hasAt = str.includes("@");
      const hasWords = /\b(at|dot)\b/i.test(str);
      const hasSpaces = /\s/.test(str);
      if (hasAt || hasWords || hasSpaces) {
        likelyFixable++;
        if (fixableExamples.length < 2) fixableExamples.push(`"${str}" → regex fix (confidence: 0.90 | HIGH)`);
      } else {
        invalidCount++;
        if (invalidExamples.length < 2) invalidExamples.push(`"${str}" → ⚠ needs AI review`);
      }
    }

    // ALWAYS generate the rule — even if all valid, we need lowercase normalization
    const totalIssues = invalidCount + likelyFixable + needsLowercase;
    const hasOnlyLowercase = needsLowercase > 0 && invalidCount === 0 && likelyFixable === 0;

    rules.push({
      id: `rule-${ruleId++}`,
      step: 1,
      stepName: "Email Validation",
      section: "text_cleaning",
      column: p.name,
      columnClass: "email",
      expectedType: "Valid Email (lowercase)",
      method: "ai_email_validate",
      transformation: `Validate & normalize emails in ${p.name} (detected as EMAIL, confidence: ${(p.semanticConfidence ?? 0).toFixed(2)}): ${validCount} valid, ${needsLowercase} need lowercase, ${likelyFixable} fixable, ${invalidCount} invalid`,
      condition: `Regex validate → lowercase MANDATORY → fix "at"/"dot" patterns → flag invalid for AI review`,
      severity: invalidCount > 0 ? "warning" : (hasOnlyLowercase ? "info" : "info"),
      riskLevel: invalidCount > 0 ? "high" : "medium",
      confidence_score: p.semanticConfidence ?? 0.90,
      confidence_label: "HIGH",
      exampleConversions: [
        ...lowercaseExamples.slice(0, 2),
        ...fixableExamples.slice(0, 2),
        ...invalidExamples.slice(0, 2),
      ],
      reason: `Email validation for ${p.name} — regex-first, lowercase mandatory, AI fallback only for complex cases (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
      applied: false,
      issueType: "text_quality",
      params: { needsLowercase, invalidCount, likelyFixable, validCount, semanticType: "EMAIL" },
      suggestedActions: [
        "ALL emails are lowercased (MANDATORY — emails are case-insensitive)",
        "Regex validates format: local@domain.tld",
        "Deterministic fixes: space removal, 'at'→'@', 'dot'→'.'",
        "Invalid emails FLAGGED — AI provides correction suggestions",
      ],
    });
  }

  // STEP 1b-additional: PERCENTAGE NORMALIZATION — "percent" → %, strip spaces, validate 0-100
  for (const p of profiles) {
    if (p.semanticType !== "PERCENTAGE") continue;

    let invalidCount = 0;
    let fixableCount = 0;
    const invalidExamples: string[] = [];
    const fixableExamples: string[] = [];

    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) continue;
      const str = String(val).trim();
      if (str === "") continue;

      // Already clean numeric
      if (/^[\d.]+$/.test(str)) {
        const num = parseFloat(str);
        if (num < 0 || num > 100) {
          invalidCount++;
          if (invalidExamples.length < 2) invalidExamples.push(`"${str}" → ⚠ out_of_range (0-100)`);
        }
        continue;
      }

      // Has % symbol or "percent" word
      const pctMatch = str.match(/^([\d.]+)\s*%?$/);
      if (pctMatch) {
        const num = parseFloat(pctMatch[1]);
        if (!isNaN(num) && num >= 0 && num <= 100) {
          fixableCount++;
          if (fixableExamples.length < 2) fixableExamples.push(`"${str}" → ${num} (confidence: 0.95 | HIGH)`);
        } else {
          invalidCount++;
          if (invalidExamples.length < 2) invalidExamples.push(`"${str}" → ⚠ invalid_percentage`);
        }
        continue;
      }

      // "percent" or "percentage" text
      if (/^\s*[\d.]+\s*percent/i.test(str)) {
        fixableCount++;
        if (fixableExamples.length < 2) fixableExamples.push(`"${str}" → numeric (confidence: 0.92 | HIGH)`);
        continue;
      }

      invalidCount++;
      if (invalidExamples.length < 2) invalidExamples.push(`"${str}" → ⚠ non_numeric`);
    }

    if (invalidCount + fixableCount > 0) {
      rules.push({
        id: `rule-${ruleId++}`,
        step: 1,
        stepName: "Percentage Normalization",
        section: "numeric_normalization",
        column: p.name,
        columnClass: "percentage",
        expectedType: "Numeric (0-100)",
        method: "percentage_normalize",
        transformation: `Normalize percentage values in ${p.name}: ${fixableCount} fixable, ${invalidCount} invalid`,
        condition: `Strip "%"/"percent", extract number, validate 0-100 range`,
        severity: invalidCount > 0 ? "warning" : "info",
        riskLevel: invalidCount > 0 ? "high" : "medium",
        confidence_score: p.semanticConfidence ?? 0.92,
        confidence_label: "HIGH",
        exampleConversions: [
          '"85%" → 85 (confidence: 0.95 | HIGH)',
          '"42 percent" → 42 (confidence: 0.95 | HIGH)',
          '"120" → ⚠ out_of_range (>100)',
          ...fixableExamples,
          ...invalidExamples,
        ],
        reason: `Semantic detection identified ${p.name} as PERCENTAGE column`,
        applied: false,
        issueType: "type_mismatch",
        params: { fixableCount, invalidCount, semanticType: "PERCENTAGE" },
        suggestedActions: [
          '"%" suffix and "percent" word are stripped automatically',
          "Values > 100 are FLAGGED as out-of-range",
          "Non-numeric values are FLAGGED for manual review",
        ],
      });
    }
  }

  // STEP 1c: PHONE — E.164 FORMAT STANDARDIZATION (rules only, NO AI)
  // Format: +<country_code> <subscriber_digits>
  // Rules: strip formatting, match 200+ country codes, validate per-country subscriber length
  // Cross-references location/region/country columns for country hint.
  for (const p of profiles) {
    if (p.semanticType !== "PHONE") continue;

    // Find geographic columns for cross-reference
    const geoColNames = ["location", "region", "country", "city", "state", "nation"];
    const geoColsByType: string[] = [];
    const geoColsByName: string[] = [];
    for (const gc of geoColNames) {
      const match = profiles.find((pp) => pp.name.toLowerCase().includes(gc));
      if (match && !geoColsByName.includes(match.name)) geoColsByName.push(match.name);
    }
    for (const pp of profiles) {
      if ((pp.semanticType === "LOCATION" || pp.semanticType === "REGION" || pp.semanticType === "COUNTRY") && !geoColsByName.includes(pp.name)) {
        geoColsByType.push(pp.name);
      }
    }
    const geoCols = [...geoColsByName, ...geoColsByType];

    let validCount = 0;
    let needsFormat = 0;
    let invalidCount = 0;
    const fixableExamples: string[] = [];
    const invalidExamples: string[] = [];
    const sampleFormats: string[] = [];

    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) continue;
      const str = String(val).trim();
      if (str === "") continue;

      const result = formatPhoneNumber(str);

      // Try with country hint if initial result is invalid
      let finalResult = result;
      if (!result.isValid && geoCols.length > 0) {
        let hint: string | null = null;
        for (const gc of geoCols) {
          const geoVal = row[gc];
          if (geoVal != null && typeof geoVal === "string" && geoVal.trim() !== "") {
            hint = geoVal.trim();
            break;
          }
        }
        if (hint) {
          const hintedResult = formatPhoneNumber(str, hint);
          if (hintedResult.isValid) finalResult = hintedResult;
        }
      }

      if (finalResult.isValid) {
        if (finalResult.formatted !== str) {
          needsFormat++;
          if (fixableExamples.length < 3) fixableExamples.push(`"${str}" → "${finalResult.formatted}"${finalResult.country ? ` (${finalResult.country})` : ""}`);
        } else {
          validCount++;
        }
        if (sampleFormats.length < 1 && finalResult.formatted !== str) {
          sampleFormats.push(finalResult.formatted);
        }
      } else {
        invalidCount++;
        if (invalidExamples.length < 2) invalidExamples.push(`"${str}" → ⚠ RED (${finalResult.digits} digits${finalResult.country ? `, ${finalResult.country}` : ""})`);
      }
    }

    if (needsFormat + invalidCount > 0) {
      rules.push({
        id: `rule-${ruleId++}`,
        step: 1,
        stepName: "E.164 Phone Format",
        section: "text_cleaning",
        column: p.name,
        columnClass: "phone",
        expectedType: "E.164 Phone (+country_code)",
        method: "e164_phone_format",
        transformation: `Normalize ${needsFormat} phone(s) to E.164 format in ${p.name} (detected as PHONE, confidence: ${(p.semanticConfidence ?? 0).toFixed(2)}): ${validCount} already valid, ${needsFormat} need reformat, ${invalidCount} invalid`,
        condition: `Strip all formatting (spaces, dashes, parens, dots) → match country code (200+ codes) → validate subscriber digits per-country → output +<CC> <subscriber>`,
        severity: invalidCount > 0 ? "warning" : "info",
        riskLevel: invalidCount > 0 ? "high" : "medium",
        confidence_score: p.semanticConfidence ?? 0.95,
        confidence_label: "HIGH",
        exampleConversions: [
          '"9876543210" → "+91 9876543210" (India +91)',
          '"(123) 456-7890" → "+1 1234567890" (US +1)',
          '"+44 20 7946 0958" → "+44 2079460958" (UK +44)',
          ...fixableExamples,
          ...invalidExamples,
        ],
        reason: `E.164 international phone format: +<country_code><national_number> — no spaces, no dashes, no parens. Max 15 digits after +. Used by telecom systems globally. (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
        applied: false,
        issueType: "text_quality",
        params: { needsFormat, invalidCount, validCount, semanticType: "PHONE" },
        suggestedActions: [
          "All numbers converted to E.164: +<country_code><number>",
          "India 10-digit numbers (6-9 start) → +91 prefix added",
          "US 10-digit numbers → +1 prefix added",
          "Cross-references location/region/country column to determine correct country code",
          "Leading 00 replaced with +, leading 0 stripped",
          "Numbers with letters or <7 digits flagged RED",
        ],
      });
    }
  }

  // STEP 1d: LOCATION — Rules-first pipeline with AI for semantic parts.
  // Rules handle: noise removal (numbers, symbols, suffix noise), title case.
  // AI handles: abbreviation resolution (blr→Bangalore), fuzzy matching (banglore→Bangalore),
  //   context-aware resolution, RED_FLAG for invalids.
  // Both triggered by the same wrench button — rules run first, AI overlays semantic results.
  for (const p of profiles) {
    if (p.semanticType !== "LOCATION") continue;

    // Collect unique non-empty values
    const allValues: string[] = [];
    let noiseCount = 0;
    let shortFormCount = 0;
    let mixedCaseCount = 0;
    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) continue;
      const str = String(val).trim();
      if (str === "") continue;
      allValues.push(str);
      // Detect noise: trailing numbers, symbols, suffix noise
      if (/\d{2,}$/.test(str) || /[!@#$%^&*()_+=\[\]{}|\\<>~`?/"]/.test(str)) noiseCount++;
      if (/\b(city|area|zone|district|region|state)\b$/i.test(str)) noiseCount++;
      if (str.length <= 4 && /^[a-zA-Z]+$/.test(str)) shortFormCount++;
      if (str !== str.toLowerCase() && str !== str.toUpperCase() && str !== str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()) mixedCaseCount++;
    }
    if (allValues.length === 0) continue;

    const uniqueValues = [...new Set(allValues)];
    const hasIssues = noiseCount > 0 || shortFormCount > 0 || mixedCaseCount > 0;

    // Always generate the rule — rules do preprocessing, AI does semantic normalization
    rules.push({
      id: `rule-${ruleId++}`,
      step: 1,
      stepName: "Location Normalization",
      section: "text_cleaning",
      column: p.name,
      columnClass: "location",
      expectedType: "Canonical Location (proper case, no noise)",
      method: "location_normalize",
      transformation: `Location normalization in ${p.name} (${uniqueValues.length} unique values): ${noiseCount} noisy, ${shortFormCount} abbreviations, ${mixedCaseCount} case issues`,
      condition: `Rules: strip noise (numbers, symbols, "city"/"area"/"zone"), title case. AI: abbreviation resolution, fuzzy matching, RED_FLAG for invalids`,
      severity: hasIssues ? "info" : "info",
      riskLevel: hasIssues ? "medium" : "low",
      confidence_score: p.semanticConfidence ?? 0.90,
      confidence_label: "HIGH",
      exampleConversions: [
        '"hyd123" → "hyd" → "Hyderabad" (noise strip + AI abbreviation)',
        '"banglore" → "Bangalore" (AI fuzzy match)',
        '"!!!" → RED_FLAG (noise only, no location)',
        '"BANGALORE" → "Bangalore" (title case)',
      ],
      reason: `Rules-based location normalization with AI semantic assist for ${p.name} (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
      applied: false,
      issueType: "text_quality",
      params: { uniqueCount: uniqueValues.length, noiseCount, shortFormCount, mixedCaseCount, semanticType: "LOCATION" },
      suggestedActions: [
        "Rules strip trailing numbers: hyd123 → hyd",
        "Rules strip symbols and suffix noise: mumbai city → mumbai",
        "Rules apply title case: bangalore → Bangalore",
        "AI resolves abbreviations: blr → Bangalore, mum → Mumbai, del → Delhi",
        "AI fuzzy matches misspellings: banglore → Bangalore, delihi → Delhi",
        "AI flags unrecoverable values as RED_FLAG",
      ],
    });
  }

  // STEP 1e: REGION & COUNTRY — Rules-first pipeline with AI for semantic parts.
  // Same pattern as LOCATION: rules handle noise/suffix/title case,
  // AI handles abbreviation resolution, fuzzy matching, entity type detection.
  for (const p of profiles) {
    if (p.semanticType !== "REGION" && p.semanticType !== "COUNTRY") continue;

    const geoType = p.semanticType === "COUNTRY" ? "Country" : "Region";

    // Collect unique non-empty values
    const allValues: string[] = [];
    let noiseCount = 0;
    let shortFormCount = 0;
    let mixedCaseCount = 0;
    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) continue;
      const str = String(val).trim();
      if (str === "") continue;
      allValues.push(str);
      // Detect noise: trailing numbers, symbols, suffix noise
      if (/\d{2,}$/.test(str) || /[!@#$%^&*()_+=\[\]{}|\\<>~`?/"]/.test(str)) noiseCount++;
      if (/\b(region|country|zone|area|territory|state|nation)\b$/i.test(str)) noiseCount++;
      if (str.length <= 4 && /^[a-zA-Z]+$/.test(str)) shortFormCount++;
      if (str !== str.toLowerCase() && str !== str.toUpperCase() && str !== str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()) mixedCaseCount++;
    }
    if (allValues.length === 0) continue;

    const uniqueValues = [...new Set(allValues)];
    const hasIssues = noiseCount > 0 || shortFormCount > 0 || mixedCaseCount > 0;

    rules.push({
      id: `rule-${ruleId++}`,
      step: 1,
      stepName: `${geoType} Normalization`,
      section: "text_cleaning",
      column: p.name,
      columnClass: p.semanticType === "COUNTRY" ? "categorical" : "categorical",
      expectedType: `Canonical ${geoType} (proper case, no noise)`,
      method: "location_normalize",
      transformation: `${geoType} normalization in ${p.name} (${uniqueValues.length} unique values): ${noiseCount} noisy, ${shortFormCount} abbreviations, ${mixedCaseCount} case issues`,
      condition: `Rules: strip noise (numbers, symbols, "region"/"country"/"zone"), title case. AI: abbreviation resolution, fuzzy matching, entity type detection, RED_FLAG for invalids`,
      severity: hasIssues ? "info" : "info",
      riskLevel: hasIssues ? "medium" : "low",
      confidence_score: p.semanticConfidence ?? 0.90,
      confidence_label: "HIGH",
      exampleConversions: p.semanticType === "COUNTRY"
        ? [
            '"ind" → "India" (AI abbreviation)',
            '"germny" → "Germany" (AI fuzzy match)',
            '"indai country" → "India" (suffix strip + AI)',
            '"!!!" → RED_FLAG (noise only)',
          ]
        : [
            '"APAC" → "Asia-Pacific" (AI region standardization)',
            '"latm" → "Latin America" (AI abbreviation)',
            '"emea region" → "EMEA" (suffix strip)',
            '"!!!" → RED_FLAG (noise only)',
          ],
      reason: `Rules-based ${geoType.toLowerCase()} normalization with AI semantic assist for ${p.name} (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
      applied: false,
      issueType: "text_quality",
      params: { uniqueCount: uniqueValues.length, noiseCount, shortFormCount, mixedCaseCount, semanticType: p.semanticType },
      suggestedActions: p.semanticType === "COUNTRY"
        ? [
            "Rules strip trailing numbers and symbols",
            "Rules strip suffix noise: india country → india",
            "Rules apply title case: INDIA → India",
            "AI resolves abbreviations: ind → India, us → United States, uk → United Kingdom",
            "AI fuzzy matches misspellings: germny → Germany, brzl → Brazil",
            "AI flags unrecoverable values as RED_FLAG",
          ]
        : [
            "Rules strip trailing numbers and symbols",
            "Rules strip suffix noise: emea region → emea",
            "Rules preserve standard abbreviations: APAC, EMEA, LATAM",
            "AI resolves abbreviations: latm → Latin America, asisa → Asia",
            "AI fuzzy matches misspellings: europ → Europe",
            "AI flags unrecoverable values as RED_FLAG",
          ],
    });
  }

  // STEP 1e2: COUNTRY_CODE — ISO 3166-1 alpha-2 validation.
  // Country code columns MUST contain exactly 2 uppercase letters (IN, US, DE, etc.).
  // Flag non-compliant values RED. DO NOT convert codes to full country names.
  for (const p of profiles) {
    if (p.semanticType !== "COUNTRY_CODE") continue;

    const VALID_ISO_ALPHA2 = new Set([
      "AF","AX","AL","DZ","AS","AD","AO","AI","AQ","AG","AR","AM","AW","AU","AT","AZ",
      "BS","BH","BD","BB","BY","BE","BZ","BJ","BM","BT","BO","BQ","BA","BW","BR","IO",
      "BN","BG","BF","BI","CV","KH","CM","CA","KY","CF","TD","CL","CN","CX","CC","CO",
      "KM","CG","CD","CK","CR","CI","HR","CU","CW","CY","CZ","DK","DJ","DM","DO","EC",
      "EG","SV","GQ","ER","EE","SZ","ET","FK","FO","FJ","FI","FR","GF","PF","TF","GA",
      "GM","GE","DE","GH","GI","GR","GL","GD","GP","GU","GT","GG","GN","GW","GY","HT",
      "HM","VA","HN","HK","HU","IS","IN","ID","IR","IQ","IE","IM","IL","IT","JM","JE",
      "JO","JP","KE","KI","KP","KR","KW","KG","LA","LV","LB","LS","LR","LY","LI","LT",
      "LU","MO","MG","MW","MY","MV","ML","MT","MH","MQ","MR","MU","YT","MX","FM","MD",
      "MC","MN","ME","MS","MA","MZ","MM","NA","NR","NP","NL","NC","NZ","NI","NE","NG",
      "NU","NF","MK","MP","NO","OM","PK","PW","PS","PA","PG","PY","PE","PH","PN","PL",
      "PT","PR","QA","RE","RO","RU","RW","BL","SH","KN","LC","MF","PM","VC","WS","SM",
      "ST","SA","SN","RS","SC","SL","SG","SX","SK","SI","SB","SO","ZA","GS","SS","ES",
      "LK","SD","SR","SJ","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TK","TO","TT",
      "TN","TR","TM","TC","TV","UG","UA","AE","GB","US","UM","UY","UZ","VU","VE","VN",
      "VG","VI","WF","EH","YE","ZM","ZW",
    ]);

    let validCount = 0;
    let invalidCount = 0;
    const invalidExamples: string[] = [];
    const fixableExamples: string[] = [];

    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) continue;
      const str = String(val).trim().toUpperCase();
      if (str === "") continue;

      if (VALID_ISO_ALPHA2.has(str)) {
        validCount++;
        // If not uppercase or has spaces, suggest fix
        if (str !== val.trim() || val !== val.toUpperCase()) {
          fixableExamples.push(`"${val}" → "${str}" (uppercase ISO code)`);
        }
      } else if (/^[a-zA-Z]{2}$/.test(str)) {
        // 2 letters but not valid ISO code
        invalidCount++;
        if (invalidExamples.length < 3) invalidExamples.push(`"${val}" → ⚠ RED (not a valid ISO 3166-1 alpha-2 code)`);
      } else if (/^[a-zA-Z]{3}$/.test(str)) {
        // 3 letters — might be ISO alpha-3 (e.g., IND, USA, GBR)
        invalidCount++;
        if (invalidExamples.length < 3) invalidExamples.push(`"${val}" → ⚠ RED (ISO alpha-3, need alpha-2)`);
      } else {
        // Full country name or other text
        invalidCount++;
        if (invalidExamples.length < 3) invalidExamples.push(`"${val}" → ⚠ RED (not a 2-letter ISO code)`);
      }
    }

    if (invalidCount + fixableExamples.length > 0) {
      rules.push({
        id: `rule-${ruleId++}`,
        step: 1,
        stepName: "Country Code Validation",
        section: "text_cleaning",
        column: p.name,
        columnClass: "categorical",
        expectedType: "ISO 3166-1 alpha-2 (2 uppercase letters: IN, US, DE, etc.)",
        method: "country_code_validate",
        transformation: `Validate ${validCount} valid, ${invalidCount} invalid, ${fixableExamples.length} need uppercase fix in ${p.name}`,
        condition: `All values MUST be exactly 2 uppercase letters. Flag non-compliant as RED. DO NOT convert to full country names.`,
        severity: invalidCount > 0 ? "warning" : "info",
        riskLevel: invalidCount > 0 ? "high" : "medium",
        confidence_score: p.semanticConfidence ?? 0.95,
        confidence_label: "HIGH",
        exampleConversions: [
          ...fixableExamples.slice(0, 2),
          ...invalidExamples.slice(0, 2),
          '"IN" → valid ✓',
          '"US" → valid ✓',
        ],
        reason: `ISO 3166-1 alpha-2 strict format: exactly 2 uppercase letters. No conversion to full country names allowed. (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
        applied: false,
        issueType: "text_quality",
        params: { validCount, invalidCount, semanticType: "COUNTRY_CODE" },
        suggestedActions: [
          "All values must be exactly 2 uppercase letters (ISO 3166-1 alpha-2)",
          "Flag non-ISO codes as RED — DO NOT convert to full country names",
          "Lowercase codes → uppercase (in → IN, us → US)",
          "Full country names (India, USA, Germany) → flag RED, not convert",
          "3-letter ISO codes (IND, GBR) → flag RED, need alpha-2",
        ],
      });
    }
  }

  // STEP 1d: USERNAME — NULL CHECK ONLY, never modify values.
  // Usernames can contain ANY characters (special chars, Unicode, etc.).
  // Only flag null/empty values. Never validate format or modify content.
  for (const p of profiles) {
    if (p.semanticType !== "USERNAME") continue;

    let nullCount = 0;
    const nullExamples: string[] = [];

    for (const row of data) {
      const val = row[p.name];
      if (val == null || isNullValue(val)) {
        nullCount++;
        if (nullExamples.length < 2) nullExamples.push(`"${val ?? "null"}" → null (confidence: 1.00 | HIGH)`);
      }
    }

    rules.push({
      id: `rule-${ruleId++}`,
      step: 1,
      stepName: "Username Null Check",
      section: "text_cleaning",
      column: p.name,
      columnClass: "username",
      expectedType: "Username (any characters allowed)",
      method: "username_null_check",
      transformation: `Null detection for ${p.name} (detected as USERNAME, confidence: ${(p.semanticConfidence ?? 0).toFixed(2)}): ${nullCount} null/empty, ${data.length - nullCount} present`,
      condition: `Only check for null/empty values. NEVER modify usernames — they can contain any characters.`,
      severity: nullCount > 0 ? "info" : "info",
      riskLevel: nullCount > 0 ? "medium" : "low",
      confidence_score: p.semanticConfidence ?? 0.95,
      confidence_label: "HIGH",
      exampleConversions: nullExamples.length > 0 ? nullExamples : [`"user_123" → "user_123" (no change — username preserved)`],
      reason: `Username null check for ${p.name} — values are never modified, only null/empty flagged (signals: ${p.semanticSignals?.join(", ") ?? "none"})`,
      applied: false,
      issueType: "null_detection",
      params: { nullCount, totalCount: data.length, semanticType: "USERNAME" },
      suggestedActions: [
        "ONLY flag null/empty values — do NOT modify any username",
        "Usernames can contain ANY characters: special chars, Unicode, numbers, spaces",
        "No format validation, no regex check, no case normalization",
      ],
    });
  }

  // STEP 1: TEXT CLEANING — per text/categorical/ID column ONLY
  // NEVER apply text rules to numeric, range, date, or boolean columns
  // NEVER apply generic text rules to columns with semantic-specific validators
  // (EMAIL, PHONE, PERCENTAGE, DATE, FULL_NAME, LAST_NAME, USERNAME have their own dedicated rules)
  const SEMANTIC_TYPED = new Set(["FULL_NAME", "LAST_NAME", "FIRST_NAME", "USERNAME", "EMAIL", "PHONE", "PERCENTAGE", "DATE", "LOCATION", "REGION", "COUNTRY", "MONEY"]);
  for (const p of profiles) {
    if (p.detectedType !== "text" && p.detectedType !== "categorical" && p.detectedType !== "id") continue;
    if (p.semanticType && SEMANTIC_TYPED.has(p.semanticType)) continue;
    if (!p.isConsistentCase || p.uniqueCount <= 30 || p.detectedType === "id") {
      const isId = p.detectedType === "id" || p.isIdColumn;
      rules.push({
        id: `rule-${ruleId++}`,
        step: 1,
        stepName: "Text Cleaning",
        section: "text_cleaning",
        column: p.name,
        columnClass: isId ? "id" : p.detectedType,
        expectedType: isId ? "Text (ID)" : (p.detectedType === "categorical" ? "Categorical" : "Text"),
        method: isId ? "trim" : "trim_titlecase",
        transformation: isId
          ? `Trim whitespace for ${p.name} (ID — no case change)`
          : `Trim whitespace and normalize casing for ${p.name}`,
        condition: isId
          ? `When value has extra spaces (IDs are never title-cased)`
          : `When value has extra spaces or inconsistent case`,
        severity: "info",
        riskLevel: "medium",
        confidence_score: 0.95,
        confidence_label: "HIGH",
        exampleConversions: isId
          ? [`"  ${p.sampleValues[0] || "E101"}  " → "${(p.sampleValues[0] || "E101").trim()}" (confidence: 0.95 | HIGH)`]
          : [`"  ${(p.sampleValues[0] || "john doe")}  " → "${titleCase(p.sampleValues[0] || "john doe")}" (confidence: 0.95 | HIGH)`],
        reason: isId ? "Trim only — IDs must preserve original casing" : "Safe formatting — no semantic change",
        applied: false,
        issueType: "text_quality",
      });
    }
  }

  // STEP 3c: SALARY PRE-NORMALIZATION — normalize ALL salary formats to INTEGER
  // Handles: "50K", "fortyk", "thirtyfivek", "₹60000", "1.2M", "50K-60K" (avg),
  // "approx 40k", "salary 70K", "70k+", ranges, word numbers, merged words
  // Output: INTEGER only (no symbols, no text)
  // Also detects MONEY semantic type columns (not just name-based)
  for (const p of profiles) {
    // Match by column name OR semantic type
    const isSalaryByName = isSalaryRangeColumn(p.name);
    const isSalaryByType = p.semanticType === "MONEY";
    if (!isSalaryByName && !isSalaryByType) continue;
    if (p.detectedType !== "range" && p.detectedType !== "semi_structured_numeric"
        && p.detectedType !== "numeric_integer" && p.detectedType !== "numeric_float") {
      // MONEY semantic type might have text detected — still generate rule
      if (!isSalaryByType) continue;
    }

    // Count extended salary patterns to see if pre-normalization helps
    const totalValid = p.totalCount - p.missingCount;
    let extendedMatchCount = 0;
    for (const row of data) {
      const val = row[p.name];
      if (val == null || (typeof val === "string" && val.trim() === "")) continue;
      const str = String(val).trim();
      if (looksLikeSalaryExtended(str)) extendedMatchCount++;
    }
    const strictRangeCount = data.filter((r) => {
      const v = r[p.name];
      return v != null && typeof v === "string" && v.trim() !== "" && looksLikeRange(v.trim());
    }).length;
    const extendedPct = totalValid > 0 ? (extendedMatchCount / totalValid) * 100 : 0;
    const strictPct = totalValid > 0 ? (strictRangeCount / totalValid) * 100 : 0;

    // Always generate for salary columns with mixed formats
    if (extendedPct > strictPct || p.detectedType === "semi_structured_numeric") {
      rules.push({
        id: `rule-${ruleId++}`,
        step: 4,
        stepName: "Range Parsing",
        section: "range_parsing",
        column: p.name,
        columnClass: "structured_numeric",
        expectedType: p.detectedType === "semi_structured_numeric" ? "Semi-Structured Numeric" : "normalized_numeric_range",
        method: "salary_pre_normalization",
        transformation: `Normalize ALL salary values in ${p.name} to base integer format: strict ranges (${strictPct.toFixed(0)}%) + approx/single/word/K-suffix values (${extendedPct.toFixed(0)}%)`,
        condition: `Strip symbols → lowercase → remove noise (INR, rs, approx, per month) → word→number → detect multiplier (K/M/B) → ranges → average → output INTEGER`,
        severity: "info",
        riskLevel: "medium",
        confidence_score: 0.95,
        confidence_label: "HIGH",
        exampleConversions: [
          '"50K" → 50000 (K suffix × 1000)',
          '"fortyk" → 40000 (word → 40 × K)',
          '"thirtyfivek" → 35000 (merged word → 35 × K)',
          '"₹60000" → 60000 (strip ₹ symbol)',
          '"1.2M" → 1200000 (M suffix × 1000000)',
          '"50K-60K" → 55000 (range → average)',
          '"approx 40k" → 40000 (strip noise → parse)',
          '"salary 70K" → 70000 (embedded value extraction)',
          '"null" → NULL (null-like → NULL)',
        ],
        reason: `Salary column ${p.name} is ${p.detectedType === "semi_structured_numeric" ? "semi-structured" : "range"} type with mixed formats: only ${strictPct.toFixed(0)}% are strict ranges; ${extendedPct.toFixed(0)}% are parsable salary values — pre-normalization converts ALL formats to numeric, boosting confidence from ${strictPct.toFixed(0)}% → ${extendedPct.toFixed(0)}%`,
        applied: false,
        issueType: "type_mismatch",
        params: { strictPct, extendedPct, totalValid, extendedMatchCount },
        suggestedActions: [
          "ALL formats converted to INTEGER: no symbols, no text, no currency",
          "Ranges (50K-60K) → average (55000)",
          "Word numbers (fortyK, thirtyfivek) → numeric (40000, 35000)",
          "Currency symbols (₹, $) stripped before parsing",
          "Noise words (INR, rs, approx, per month) stripped",
          "Unparseable values flagged RED — needs manual review",
          "Output: ONLY integers, same row order preserved",
        ],
      });
    }
  }

  // STEP 4: RANGE PARSING — ONLY for explicitly-detected range columns
  // NEVER apply range rules to text columns (e.g. Work_Location)
  // BUG FIX #1: Triple guard — type check + name check + confidence threshold
  for (const p of profiles) {
    if (p.detectedType !== "range") continue;
    if (isLocationLike(p.name)) continue;
    rules.push({
      id: `rule-${ruleId++}`,
      step: 4,
      stepName: "Range Parsing",
      section: "range_parsing",
      column: p.name,
      columnClass: "structured_numeric",
      expectedType: "Numeric (Float)",
      method: "range_average",
      transformation: `Parse min-max ranges to average in ${p.name}`,
      condition: `When value contains a range (e.g. "50000-70000", "50K-70K")`,
      severity: "info",
      riskLevel: "medium",
      confidence_score: 0.92,
      confidence_label: "HIGH",
      exampleConversions: [
        '"50000-70000" → 60000 (confidence: 0.92 | HIGH)',
        '"50K-70K" → 60000 (confidence: 0.92 | HIGH)',
        '"50,000 to 70,000" → 60000 (confidence: 0.92 | HIGH)',
        '"approx 60k" → 60000 ⚠ partial (confidence: 0.75 | MEDIUM)',
        '"70k+" → 70000 ⚠ partial_range (confidence: 0.60 | LOW)',
      ],
      reason: "Range averaging preserves central tendency",
      applied: false,
      issueType: "type_mismatch",
    });
  }

  // STEP 5: DATE STANDARDIZATION — per date column
  for (const p of profiles) {
    if (p.detectedType === "date") {
      rules.push({
        id: `rule-${ruleId++}`,
        step: 5,
        stepName: "Date Standardization",
        section: "date_standardization",
        column: p.name,
        columnClass: "date",
        expectedType: "Date",
        method: "format_standardize",
        transformation: `Convert all date formats to YYYY-MM-DD in ${p.name}`,
        condition: `When value is a valid date in any format`,
        severity: "info",
        riskLevel: "medium",
        confidence_score: 0.95,
        confidence_label: "HIGH",
        exampleConversions: generateDateExamples(p.sampleValues),
        reason: "Standardized date format for analytical consistency",
        applied: false,
        issueType: "type_mismatch",
      });
    }
  }

  // STEP 6: CANONICAL CASE NORMALIZATION — normalize to most frequent casing per unique value
  // Applies to: categorical + boolean columns with inconsistent casing
  for (const p of profiles) {
    if ((p.detectedType === "categorical" || p.detectedType === "boolean") && !p.isConsistentCase && p.uniqueCount > 1) {
      // Build case-frequency map: lowercase → { "originalCase1": count, "originalCase2": count }
      const caseFreq: Record<string, Record<string, number>> = {};
      for (const row of data) {
        const v = row[p.name];
        if (v == null || String(v).trim() === "") continue;
        const trimmed = String(v).trim();
        const key = trimmed.toLowerCase();
        if (!caseFreq[key]) caseFreq[key] = {};
        caseFreq[key][trimmed] = (caseFreq[key][trimmed] || 0) + 1;
      }
      // Pick most frequent original casing for each value
      const canonicalCaseMap: Record<string, string> = {};
      for (const [lower, variants] of Object.entries(caseFreq)) {
        let best = lower;
        let bestCount = 0;
        for (const [original, count] of Object.entries(variants)) {
          if (count > bestCount) { bestCount = count; best = original; }
        }
        canonicalCaseMap[lower] = best;
      }
      // Build example conversions (show values that will change)
      const examples: string[] = [];
      for (const row of data) {
        const v = row[p.name];
        if (v == null || String(v).trim() === "") continue;
        const trimmed = String(v).trim();
        const key = trimmed.toLowerCase();
        const canonical = canonicalCaseMap[key];
        if (canonical && canonical !== trimmed && examples.length < 4) {
          examples.push(`"${trimmed}" → ${canonical} (confidence: 0.92 | HIGH)`);
        }
      }
      if (examples.length === 0) continue; // All values already in canonical form
      // Only add if not already added in step 1
      const alreadyHas = rules.some((r) => r.column === p.name && (r.step === 1 || r.step === 6));
      if (!alreadyHas) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 6,
          stepName: p.detectedType === "boolean" ? "Boolean Normalization" : "Categorical Normalization",
          section: "categorical_normalization",
          column: p.name,
          columnClass: p.detectedType === "boolean" ? "categorical" : "categorical",
          expectedType: p.detectedType === "boolean" ? "Boolean" : "Categorical",
          method: "canonical_case",
          transformation: `Normalize case to most frequent form for ${p.name} — dynamic, no hardcoding`,
          condition: `When casing is inconsistent across values`,
          severity: "info",
          riskLevel: "medium",
          confidence_score: 0.92,
          confidence_label: "HIGH",
          exampleConversions: examples,
          reason: `Format-only — uses most frequent casing per value from data (dynamic, not hardcoded)`,
          applied: false,
          issueType: "inconsistent_categories",
          params: { canonicalCaseMap },
        });
      }
    }
  }

  // STEP 7: CATEGORY CLUSTERING — frequency-based canonical mapping
  // Applies to: categorical + boolean columns with multiple unique values
  for (const p of profiles) {
    if ((p.detectedType === "categorical" || p.detectedType === "boolean") && p.uniqueCount > 1 && p.uniqueCount <= 25) {
      // ── Build frequency map of all values ──
      const valCount: Record<string, number> = {};
      const valOriginalCase: Record<string, string> = {}; // lowercase → first-seen original casing
      const caseVariants: Record<string, Record<string, number>> = {}; // lowercase → { "OriginalCase": count }
      for (const row of data) {
        const v = row[p.name];
        if (v == null || String(v).trim() === "") continue;
        const trimmed = String(v).trim();
        const key = trimmed.toLowerCase();
        valCount[key] = (valCount[key] || 0) + 1;
        if (!valOriginalCase[key]) valOriginalCase[key] = trimmed;
        // Track case variants: "Delivered", "DELIVERED", "delivered" → all under key "delivered"
        if (!caseVariants[key]) caseVariants[key] = {};
        caseVariants[key][trimmed] = (caseVariants[key][trimmed] || 0) + 1;
      }

      // ══════════════════════════════════════════════════════════════════
      // DYNAMIC CATEGORY CLUSTERING — No hardcoded value lists
      // ══════════════════════════════════════════════════════════════════
      // All canonical forms are discovered from data + memory engine.
      // Pipeline: Memory → Frequency clustering → Similarity → Canonical selection

      // TYPE SAFETY: exclude purely numeric values from categorical grouping
      const textOnlyKeys = Object.keys(valCount).filter((k) => !/^\d+\.?\d*$/.test(k));
      if (textOnlyKeys.length === 0) continue;

      // ── Step 1: MEMORY ENGINE — inject learned mappings (highest priority) ──
      // Previously-seen columns have mappings stored in localStorage
      const learnedExact = memoryEngine.getLearnedMappings(p.name);
      const learnedFuzzy = memoryEngine.findSimilarColumnMappings(p.name);
      const mergedMap: Record<string, string> = { ...learnedFuzzy, ...learnedExact };
      let memoryLearnedCount = Object.keys(mergedMap).length;

      // ── Step 1.5: CASE VARIANT DETECTION ──
      // Keys with multiple original casings (e.g. "Delivered"/"DELIVERED"/"delivered") → canonical = most frequent casing
      // This ensures these values are recognized as "known" and NOT flagged as unknown_category
      for (const [lower, variants] of Object.entries(caseVariants)) {
        if (Object.keys(variants).length > 1 && !mergedMap[lower]) {
          // Multiple casings exist — pick most frequent original casing as canonical
          let best = lower;
          let bestCount = 0;
          for (const [original, count] of Object.entries(variants)) {
            if (count > bestCount) { bestCount = count; best = original; }
          }
          mergedMap[lower] = best; // Maps to itself (canonical) — prevents unknown flagging
        }
      }

      // ── Step 2: FREQUENCY-BASED CLUSTERING ──
      // Group values that share a common root/pattern and appear together
      // e.g. "p" (6x) + "pending" (3x) → same cluster, canonical = "Pending"
      // Build inverted map: canonical → [variants] using longest-common-substring
      const frequencyInferences: Record<string, string> = {};
      // Sort keys by length (longest first) — longest string becomes the canonical
      const sortedTextKeys = [...textOnlyKeys].sort((a, b) => b.length - a.length);

      // Cluster: group short values with longer values they are a substring of
      // "p" starts with "pending" → same cluster, canonical = "Pending"
      // PRIORITY: starts-with (abbreviation) > contains (substring) > similarity
      const clusterMap: Record<string, string> = {}; // variant → cluster anchor (lowercase longest)
      for (const shortKey of sortedTextKeys.filter((k) => k.length <= 5)) {
        let bestAnchor = shortKey;
        let bestLen = shortKey.length;

        // Pass 1: Find longest key that STARTS WITH short key (strong abbreviation signal)
        // "p" → "pending" ✓, but "p" inside "shipped" is coincidental ✗
        for (const longKey of sortedTextKeys) {
          if (longKey === shortKey) continue;
          if (longKey.startsWith(shortKey) && longKey.length > bestLen) {
            bestAnchor = longKey;
            bestLen = longKey.length;
          }
        }

        // Pass 2: Only if no starts-with match, try substring contains and similarity
        if (bestAnchor === shortKey) {
          for (const longKey of sortedTextKeys) {
            if (longKey === shortKey) continue;
            if (longKey.includes(shortKey) && longKey.length > bestLen) {
              bestAnchor = longKey;
              bestLen = longKey.length;
            }
            if (substringSimilarity(shortKey, longKey) >= 0.6 && longKey.length > bestLen) {
              bestAnchor = longKey;
              bestLen = longKey.length;
            }
          }
        }

        if (bestAnchor !== shortKey) {
          clusterMap[shortKey] = bestAnchor;
          frequencyInferences[shortKey] = titleCase(valOriginalCase[bestAnchor] || bestAnchor);
        }
      }

      // Merge frequency inferences into mergedMap (don't override memory)
      // CRITICAL: This must run BEFORE self-mapping so "p" → "Pending" isn't blocked
      for (const [variant, canonical] of Object.entries(frequencyInferences)) {
        if (!mergedMap[variant]) {
          mergedMap[variant] = canonical;
        }
      }

      // Also check user corrections — highest confidence signals
      const userCorrections = memoryEngine.getUserCorrections(p.name);
      for (const corr of userCorrections) {
        if (corr.count >= 2) {
          mergedMap[corr.fromValue] = corr.toValue;
        }
      }

      // ── Step 2.5: SELF-MAPPING — ensure every remaining text value is recognized ──
      // Must run AFTER frequency inference merge so abbreviations aren't self-mapped first.
      // Values with a single casing variant (e.g., "Fashion", "Gaming") need self-mapping.
      for (const key of textOnlyKeys) {
        if (!mergedMap[key]) {
          mergedMap[key] = valOriginalCase[key] || titleCase(key);
        }
      }

      // ── v4 DYNAMIC CANONICAL SELECTION ──
      // For each group of variants sharing a canonical target, pick the best form.
      // Priority: grammatically correct > meaningful (frequency) > longest
      const invertedFinal: Record<string, string[]> = {};
      for (const [k, target] of Object.entries(mergedMap)) {
        if (!invertedFinal[target]) invertedFinal[target] = [];
        invertedFinal[target].push(k);
      }
      const dynamicCanonicalMap: Record<string, string> = {};
      for (const [originalTarget, sources] of Object.entries(invertedFinal)) {
        // Filter to only sources that actually appear in the data
        const appearingSources = sources.filter((s) => valCount[s] > 0);
        if (appearingSources.length === 0) continue;
        // Pick best form using grammatical quality > frequency > longest
        const best = appearingSources.reduce((a, b) =>
          pickBetterCanonical(valOriginalCase[a] || a, valOriginalCase[b] || b, valCount[a] || 0, valCount[b] || 0)
        );
        const canonical = titleCase(best);
        for (const src of appearingSources) {
          dynamicCanonicalMap[src] = canonical;
        }
      }

      // ── Step 2.7: CROSS-CANONICAL SIMILARITY MERGE ──
      // After dynamic canonical selection, some canonical targets may be very similar
      // to each other (e.g., "Delivered" vs "Delivrd", "Cancelled" vs "Canceld").
      // Merge similar canonical targets: keep the GRAMMATICALLY CORRECT form.
      // Priority: grammatically correct > meaningful (frequency) > longest.
      // The most frequent form is almost always the grammatically correct one.
      const CROSS_SIMILARITY_THRESHOLD = 0.7;
      const allCanonicalTargets = [...new Set(Object.values(dynamicCanonicalMap))];
      const canonicalMerges: Record<string, string> = {}; // old canonical → merged canonical
      for (let i = 0; i < allCanonicalTargets.length; i++) {
        for (let j = i + 1; j < allCanonicalTargets.length; j++) {
          const a = allCanonicalTargets[i];
          const b = allCanonicalTargets[j];
          const aLower = a.toLowerCase();
          const bLower = b.toLowerCase();
          if (aLower === bLower) continue;
          const sim = substringSimilarity(aLower, bLower);
          if (sim >= CROSS_SIMILARITY_THRESHOLD) {
            // Pick winner using grammatical quality > frequency > longest
            const aCount = valCount[aLower] || 0;
            const bCount = valCount[bLower] || 0;
            const winner = pickBetterCanonical(a, b, aCount, bCount);
            const loser = winner === a ? b : a;
            canonicalMerges[loser] = winner;
          }
        }
      }
      // Apply merges: remap any source that pointed to a loser canonical
      if (Object.keys(canonicalMerges).length > 0) {
        for (const [src, target] of Object.entries(dynamicCanonicalMap)) {
          if (canonicalMerges[target]) {
            dynamicCanonicalMap[src] = canonicalMerges[target];
          }
        }
      }

      // ── Build conversion examples from actual data ──
      const conversionExamples: string[] = [];
      const conversionReasons: string[] = [];
      for (const [k, target] of Object.entries(dynamicCanonicalMap)) {
        if (valCount[k] > 0 && k !== target.toLowerCase()) {
          const freqNote = frequencyInferences[k] ? ` (freq: ${valCount[k]}×)` : "";
          const mergedNote = canonicalMerges[target] ? " (merged)" : "";
          const conf = frequencyInferences[k] ? "0.85" : "0.95";
          const label = frequencyInferences[k] ? "MEDIUM ⚠" : "HIGH";
          conversionExamples.push(`"${valOriginalCase[k]}" → ${target}${mergedNote} (confidence: ${conf} | ${label})`);
          conversionReasons.push(`"${valOriginalCase[k]}"${freqNote}`);
        }
      }

      // ── Substring similarity grouping: try to match unknowns to canonical forms ──
      // e.g. "passsed" → similar to "passed" which maps to "Completed"
      // e.g. "absnt" → similar to "absent" → "Absent"
      const SIMILARITY_THRESHOLD = 0.7;
      const canonicalTargets = new Set(Object.values(dynamicCanonicalMap).map((v) => v.toLowerCase()));
      const similarityInferences: Record<string, string> = {};
      const unknownValues: string[] = [];
      for (const k of textOnlyKeys) {
        if (dynamicCanonicalMap[k]) continue;
        // SKIP: This value IS already a canonical target — e.g. "delivered" IS the canonical for its cluster
        if (canonicalTargets.has(k)) continue;
        // Try substring similarity against all canonical target values
        let bestMatch = "";
        let bestScore = 0;
        for (const target of canonicalTargets) {
          const score = substringSimilarity(k, target);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = target;
          }
          // Also check against all source keys in dynamic map (e.g. "absnt" vs "absent")
          for (const src of Object.keys(dynamicCanonicalMap)) {
            const srcScore = substringSimilarity(k, src);
            if (srcScore > bestScore) {
              bestScore = srcScore;
              bestMatch = dynamicCanonicalMap[src];
            }
          }
        }
        if (bestScore >= SIMILARITY_THRESHOLD && bestMatch) {
          similarityInferences[k] = bestMatch;
          conversionExamples.push(`"${valOriginalCase[k]}" → ${bestMatch} (confidence: 0.70 | MEDIUM ⚠ similarity)`);
          conversionReasons.push(`"${valOriginalCase[k]}" (similarity: ${(bestScore * 100).toFixed(0)}%)`);
        } else {
          unknownValues.push(valOriginalCase[k]);
        }
      }

      // Build final map: dynamic canonical + similarity-inferred
      const finalMap: Record<string, string> = { ...dynamicCanonicalMap };
      for (const [k, v] of Object.entries(similarityInferences)) {
        finalMap[k] = v;
      }

      // ── LAYER 3: STORE learned mappings to memory ──
      // This makes the system self-improving — next dataset reuses these mappings
      let storeResult: { newCount: number; skipped: number; protected: number; driftDetected: number } | null = null;
      if (Object.keys(finalMap).length > 0) {
        try {
          storeResult = memoryEngine.storeLearnedMappings(p.name, finalMap);
        } catch {
          // Memory engine may fail in SSR — silently ignore
        }
      }

      // ── LAYER 3: DRIFT DETECTION ──
      // Check if unknown values represent NEW patterns (drift) in a column we've seen before
      let driftAlerts: DriftAlert[] = [];
      if (unknownValues.length > 0) {
        try {
          const uniqueUnknowns = unknownValues.map((v) => v.toLowerCase().trim());
          const unknownFreqs: Record<string, number> = {};
          for (const u of uniqueUnknowns) {
            unknownFreqs[u] = valCount[u] ?? 1;
          }
          driftAlerts = memoryEngine.detectDrift(p.name, uniqueUnknowns, unknownFreqs);
        } catch {
          // SSR guard
        }
      }

      const totalConversions = conversionExamples.length;
      if (totalConversions === 0 && unknownValues.length === 0) continue;

      // ── Generate rule(s) ──
      if (totalConversions > 0) {
        // Pass params to execution handler for frequency-based confidence
        rules.push({
          id: `rule-${ruleId++}`,
          step: 7,
          stepName: "Category Clustering",
          section: "category_clustering",
          column: p.name,
          columnClass: "categorical",
          expectedType: "Categorical",
          method: "canonical_map",
          transformation: `Standardize ${totalConversions} variant(s) in ${p.name} → canonical forms${unknownValues.length > 0 ? `; flag ${unknownValues.length} unknown value(s)` : ""}${memoryLearnedCount > 0 ? ` 🧠 ${memoryLearnedCount} from memory` : ""}${driftAlerts.length > 0 ? ` 🚨 ${driftAlerts.length} drift alert(s)` : ""}${storeResult?.protected ? ` 🛡️ ${storeResult.protected} ACTIVE mapping(s) protected` : ""}`,
          condition: `When value matches canonical mapping (static + frequency + similarity${memoryLearnedCount > 0 ? " + memory" : ""}); unknown → flag; drift → alert`,
          severity: unknownValues.length > 0 ? "warning" : "info",
          riskLevel: Object.values(frequencyInferences).length > 0 || Object.values(similarityInferences).length > 0 ? "high" : "medium",
          confidence_score: 0.90,
          confidence_label: "HIGH",
          exampleConversions: conversionExamples.slice(0, 4),
          reason: `Mapping: ${conversionReasons.slice(0, 5).join(", ")}${unknownValues.length > 0 ? `; ${unknownValues.length} unknown: ${unknownValues.slice(0, 3).join(", ")}` : ""}`,
          applied: false,
          issueType: "inconsistent_categories",
          params: {
            canonicalMap: finalMap,
            frequencyInferences,
            similarityInferences,
            unknownValues,
            memoryReused: memoryLearnedCount,
            driftAlerts: driftAlerts.map((d) => ({ value: d.newValue, similarTo: d.similarTo, severity: d.severity })),
            protectedCount: storeResult?.protected ?? 0,
          },
          suggestedActions: [
            "Abbreviations (P, A, WFH) expand to full forms (Present, Absent, Work From Home)",
            "Frequency-inferred mappings flagged for review (e.g. 'p' appears 6× alongside 'Present' 3×)",
            "Similarity-matched values (≥70% match) flagged for review — may be typos of known categories",
            "Unknown values outside mapping are FLAGGED — not auto-converted",
            ...(driftAlerts.length > 0 ? [`🚨 DRIFT: ${driftAlerts.length} new pattern(s) detected — check Memory panel for details`] : []),
            ...(storeResult?.protected ? [`🛡️ ${storeResult.protected} ACTIVE mapping(s) protected from overwrite — user edit needed to change`] : []),
          ],
        });
      }

      // ── Separate rule for unknown-only columns (no conversions, just flags) ──
      // FIX: Only generate if the column has SOME known categories (at least 1 canonical mapping exists).
      // If ALL values are unknown, the engine has no knowledge of this column's categories,
      // so flagging everything as "unknown" is useless and would make every valid value show RED.
      // Guard: skip when unknownValues covers ALL unique text values in the column.
      const allTextValues = textOnlyKeys.filter((k) => valCount[k] > 0);
      const unknownPct = allTextValues.length > 0 ? (unknownValues.length / allTextValues.length) * 100 : 0;
      if (totalConversions === 0 && unknownValues.length > 0 && unknownPct < 100) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 7,
          stepName: "Category Clustering",
          section: "category_clustering",
          column: p.name,
          columnClass: "categorical",
          expectedType: "Categorical",
          method: "categorical_semantic_check",
          transformation: `Flag ${unknownValues.length} unmapped value(s) in ${p.name}`,
          condition: `When value has no known canonical mapping → flag ⚠ unknown_category`,
          severity: "warning",
          riskLevel: "high",
          confidence_score: 0.95,
          confidence_label: "HIGH",
          exampleConversions: unknownValues.slice(0, 3).map((v) => `"${v}" → ⚠ unknown_category (confidence: 0.95 | HIGH)`),
          reason: `${unknownValues.length} unmapped value(s): ${unknownValues.slice(0, 3).join(", ")}`,
          applied: false,
          issueType: "inconsistent_categories",
          params: { unknownValues },
        });
      }
    }
  }

  // STEP 9: ID INTEGRITY — uniqueness + pattern consistency + non-null
  // SKIP COUNTRY_CODE columns — same ISO code (e.g., "IN") for multiple rows is VALID, not a duplicate.
  for (const p of profiles) {
    if (p.detectedType === "id" && p.semanticType !== "COUNTRY_CODE") {
      // Check uniqueness
      const values = data.map((r) => String(r[p.name] ?? "")).filter((v) => v !== "");
      const seen = new Map<string, number[]>();
      let duplicateCount = 0;
      let duplicateExamples: string[] = [];
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (seen.has(v)) {
          duplicateCount++;
          if (duplicateExamples.length < 3) duplicateExamples.push(v);
        } else {
          seen.set(v, [i]);
        }
      }

      // Check pattern consistency
      const patterns = [...new Set(values.map((v) => {
        if (/^[A-Za-z]\d+$/.test(v)) return "alpha_numeric";
        if (/^\d+$/.test(v)) return "pure_numeric";
        return "mixed";
      }))];
      const patternInconsistent = patterns.length > 1;

      // Always check missing
      if (p.missingCount > 0) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 9,
          stepName: "ID Validation",
          section: "id_validation",
          column: p.name,
          columnClass: "id",
          expectedType: "Text",
          method: "id_integrity_check",
          transformation: `Flag missing IDs in ${p.name} — do NOT modify`,
          condition: `When ID value is null or empty`,
          severity: "critical",
          riskLevel: "high",
          confidence_score: 1.0,
          confidence_label: "HIGH",
          exampleConversions: [`null → NULL ⚠ critical_missing_id (confidence: 1.00 | HIGH)`],
          reason: "ID columns must never be null — flag for user action",
          applied: false,
          issueType: "missing_values",
        });
      }

      // Uniqueness check
      if (duplicateCount > 0) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 9,
          stepName: "ID Validation",
          section: "id_validation",
          column: p.name,
          columnClass: "id",
          expectedType: "Text",
          method: "id_integrity_check",
          transformation: `Flag ${duplicateCount} duplicate ID(s) in ${p.name} — do NOT auto-modify`,
          condition: `When ID appears more than once → flag ⚠ duplicate_id`,
          severity: "critical",
          riskLevel: "high",
          confidence_score: 1.0,
          confidence_label: "HIGH",
          exampleConversions: duplicateExamples.map((v) => `"${v}" → ⚠ duplicate_id (confidence: 1.00 | HIGH)`),
          reason: `${duplicateCount} duplicate(s) found: ${duplicateExamples.join(", ")}`,
          applied: false,
          issueType: "duplicate_values",
          suggestedActions: [
            `Keep first occurrence — remove ${duplicateCount} subsequent duplicate row(s)`,
            `Merge duplicate rows — combine non-null fields from all duplicates`,
            `Re-assign new IDs — append suffix to duplicates (e.g., E109→E109-1)`,
          ],
        });
      }

      // Pattern consistency check
      if (patternInconsistent) {
        rules.push({
          id: `rule-${ruleId++}`,
          step: 9,
          stepName: "ID Validation",
          section: "id_validation",
          column: p.name,
          columnClass: "id",
          expectedType: "Text",
          method: "id_integrity_check",
          transformation: `Flag inconsistent ID patterns in ${p.name}: ${patterns.join(", ")}`,
          condition: `When ID format varies (e.g., mixed alpha-numeric vs pure numeric)`,
          severity: "warning",
          riskLevel: "medium",
          confidence_score: 0.85,
          confidence_label: "MEDIUM",
          exampleConversions: [`"Inconsistent patterns: ${patterns.join(", ")}" → ⚠ malformed_id (confidence: 0.85 | MEDIUM)`],
          reason: `ID patterns: ${patterns.join(", ")} — should be consistent`,
          applied: false,
          issueType: "text_quality",
        });
      }
    }
  }

  // ── STEP 9: ANOMALY DETECTION — deterministic emoji/garbage/banned detection ──
  // Scans ALL text/categorical/boolean columns for values that are clearly anomalous.
  // This runs BEFORE AI scan — provides deterministic RED flags for obvious issues.
  // AI scan then runs ON TOP to catch subtler patterns.
  for (const p of profiles) {
    if (p.detectedType !== "text" && p.detectedType !== "categorical" && p.detectedType !== "boolean") continue;

    let emojiCount = 0;
    let garbageCount = 0;
    let bannedCount = 0;
    const emojiExamples: string[] = [];
    const garbageExamples: string[] = [];
    const bannedExamples: string[] = [];

    for (const row of data) {
      const val = row[p.name];
      if (val == null) continue;
      const str = String(val).trim();
      if (str === "") continue;

      if (containsEmoji(str)) {
        emojiCount++;
        if (emojiExamples.length < 3) emojiExamples.push(str);
      }
      if (isGarbageToken(str)) {
        garbageCount++;
        if (garbageExamples.length < 3) garbageExamples.push(str);
      }
      if (isBannedPattern(str)) {
        bannedCount++;
        if (bannedExamples.length < 3) bannedExamples.push(str);
      }
    }

    const totalAnomalies = emojiCount + garbageCount + bannedCount;
    if (totalAnomalies === 0) continue;

    const parts: string[] = [];
    const examples: string[] = [];
    if (emojiCount > 0) { parts.push(`${emojiCount} emoji value(s)`); examples.push(...emojiExamples.map((v) => `"${v}" → ⚠ RED emoji_detected (confidence: 1.00 | HIGH)`)); }
    if (garbageCount > 0) { parts.push(`${garbageCount} garbage token(s)`); examples.push(...garbageExamples.map((v) => `"${v}" → ⚠ RED garbage_token (confidence: 1.00 | HIGH)`)); }
    if (bannedCount > 0) { parts.push(`${bannedCount} banned pattern(s)`); examples.push(...bannedExamples.map((v) => `"${v}" → ⚠ RED banned_word (confidence: 1.00 | HIGH)`)); }

    rules.push({
      id: `rule-${ruleId++}`,
      step: 10,
      stepName: "Anomaly Detection",
      section: "anomaly_detection",
      column: p.name,
      columnClass: p.detectedType,
      expectedType: p.detectedType === "categorical" ? "Categorical" : p.detectedType === "boolean" ? "Boolean" : "Text",
      method: "anomaly_detected",
      transformation: `Detect ${totalAnomalies} anomalous value(s) in ${p.name}: ${parts.join(", ")}`,
      condition: `Flag emoji values, garbage tokens (???, !!!), and banned patterns (hack_mode, inject)`,
      severity: "critical",
      riskLevel: "high",
      confidence_score: 1.0,
      confidence_label: "HIGH",
      exampleConversions: examples.slice(0, 5),
      reason: `Deterministic anomaly detection: ${parts.join("; ")} found — flagged RED for manual review`,
      applied: false,
      issueType: "inconsistent_categories",
      params: { emojiCount, garbageCount, bannedCount },
      suggestedActions: [
        "Emoji values will be FLAGGED RED — review and replace with valid text",
        "Garbage tokens (???, !!!) will be FLAGGED RED — replace with NULL or valid value",
        "Banned patterns (hack_mode, etc.) will be FLAGGED RED — security risk, remove immediately",
      ],
    });
  }

  // Sort by step order
  rules.sort((a, b) => a.step - b.step);

  // Re-assign IDs after sorting
  rules.forEach((r, i) => { r.id = `rule-${i}`; });

  return rules;
}

// ── Rule Application Engine ────────────────────────────

export interface CleaningResult {
  data: RawDataRow[];
  flagMap: Map<string, CellFlag>;
  transformationLog: TransformationLogEntry[];
}

export interface TransformationLogEntry {
  id: string;
  timestamp: number;
  step: number;
  stepName: string;
  column: string;
  row: number;
  originalValue: unknown;
  cleanedValue: unknown;
  rule: string;
  confidence: number;
  label: "HIGH" | "MEDIUM" | "LOW";
  status: "applied" | "flagged" | "skipped";
  severity: FlagSeverity;
}

// CANONICAL_MAPS removed — all categorical mapping is now dynamic.
// Canonical forms are discovered from data frequency + similarity + memory engine.
// No predefined value lists for any column type.

// BUG FIX #4: Date normalization returns ambiguity metadata
function tryNormalizeDate(value: string): { result: string | null; isAmbiguous: boolean } {
  const trimmed = value.trim();
  if (!trimmed) return { result: null, isAmbiguous: false };

  // Already YYYY-MM-DD — pass through unchanged
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { result: trimmed, isAmbiguous: false };

  // YYYY/MM/DD — format change only, NEVER value change (use UTC to avoid timezone shift)
  const ymdSlashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (ymdSlashMatch) {
    const year = ymdSlashMatch[1];
    const month = ymdSlashMatch[2].padStart(2, "0");
    const day = ymdSlashMatch[3].padStart(2, "0");
    return { result: `${year}-${month}-${day}`, isAmbiguous: false };
  }

  // YYYY.MM.DD
  const ymdDotMatch = trimmed.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (ymdDotMatch) {
    const year = ymdDotMatch[1];
    const month = ymdDotMatch[2].padStart(2, "0");
    const day = ymdDotMatch[3].padStart(2, "0");
    return { result: `${year}-${month}-${day}`, isAmbiguous: false };
  }

  // DD-MM-YYYY or DD/MM/YYYY (DEFAULT — assume DD-MM for locales like India/UK)
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];
    // If first number > 12, unambiguous: must be DD/MM/YYYY
    if (a > 12) return { result: `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`, isAmbiguous: false };
    // If second > 12, unambiguous: must be MM/DD/YYYY
    if (b > 12) return { result: `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`, isAmbiguous: false };
    // Ambiguous (both ≤ 12): flag as ambiguous_date, default to DD-MM-YYYY (India locale)
    return { result: `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`, isAmbiguous: true };
  }

  // DD-MM-YYYY or DD.MM.YYYY (DEFAULT — assume DD-MM for India locale)
  const dashMatch = trimmed.match(/^(\d{1,2})[-.]([\d]{1,2})[-.](\d{4})$/);
  if (dashMatch) {
    const a = parseInt(dashMatch[1], 10);
    const b = parseInt(dashMatch[2], 10);
    const year = dashMatch[3];
    // If first number > 12, unambiguous: must be DD-MM-YYYY
    if (a > 12) return { result: `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`, isAmbiguous: false };
    // If second > 12, unambiguous: must be MM-DD-YYYY
    if (b > 12) return { result: `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`, isAmbiguous: false };
    // Ambiguous (both ≤ 12): default to DD-MM-YYYY, FLAG for review
    return { result: `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`, isAmbiguous: true };
  }

  // Fallback: parse string manually using UTC to avoid timezone shift
  // "Jan 15, 2024", "15 Jan 2024", etc.
  const d = new Date(trimmed);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
    // Use UTC methods to prevent timezone offset from changing the date
    const utcYear = d.getUTCFullYear();
    const utcMonth = String(d.getUTCMonth() + 1).padStart(2, "0");
    const utcDay = String(d.getUTCDate()).padStart(2, "0");
    return { result: `${utcYear}-${utcMonth}-${utcDay}`, isAmbiguous: false };
  }

  return { result: null, isAmbiguous: false };
}

function confidenceToSeverity(conf: number): FlagSeverity {
  if (conf >= 0.90) return "clean";
  if (conf >= 0.70) return "warning";
  return "high_risk";
}

export function applyRules(
  rawData: RawDataRow[],
  appliedRuleIds: Set<string>,
  plan: CleaningRule[],
  profiles: ColumnProfile[]
): CleaningResult {
  const appliedRules = plan.filter((r) => appliedRuleIds.has(r.id));

  // ── ALWAYS: Auto-lowercase ANY column that looks like emails ──
  // Emails are case-insensitive by spec (RFC 5321). ALWAYS lowercase them.
  // This runs ALWAYS — even if no rules are applied.
  let data = rawData.map((row) => ({ ...row }));
  const hasAnyEmailCol = rawData.length > 0 && Object.keys(rawData[0] || {}).some((col) => {
    const colValues = rawData.map((r) => r[col]).filter((v) => v != null && String(v).trim() !== "");
    if (colValues.length === 0) return false;
    const emailCount = colValues.filter((v) => EMAIL_REGEX.test(String(v).trim().toLowerCase())).length;
    return emailCount / colValues.length >= 0.7;
  });
  if (hasAnyEmailCol) {
    for (const col of Object.keys(rawData[0] || {})) {
      const colValues = data.map((r) => r[col]).filter((v) => v != null && String(v).trim() !== "");
      if (colValues.length === 0) continue;
      const emailCount = colValues.filter((v) => EMAIL_REGEX.test(String(v).trim().toLowerCase())).length;
      if (emailCount / colValues.length >= 0.7) {
        data = data.map((row) => {
          const val = row[col];
          if (val == null) return row;
          const str = String(val).trim();
          if (str === "" || str === str.toLowerCase()) return row;
          return { ...row, [col]: str.toLowerCase() };
        });
      }
    }
  }

  if (appliedRules.length === 0) {
    return { data, flagMap: new Map(), transformationLog: [] };
  }

  const flagMap = new Map<string, CellFlag>();
  const transformationLog: TransformationLogEntry[] = [];
  let logIdx = 0;

  for (const rule of appliedRules) {
    const cols = rule.column.split(",").map((c) => c.trim()).filter(Boolean);
    const profileMap = new Map(profiles.map((p) => [p.name, p]));

    switch (rule.method) {
      // ── EMOJI REJECT: Flag ALL emoji-containing values as RED ──
      // Skip FEEDBACK columns — sentiment-appropriate emojis are valid there.
      case "emoji_reject": {
        const feedbackCols = new Set(profiles.filter((p) => p.semanticType === "FEEDBACK").map((p) => p.name));
        for (const col of cols) {
          if (feedbackCols.has(col)) continue; // Skip FEEDBACK columns
          data = data.map((row, idx) => {
            const val = row[col];
            if (val == null || isNullValue(val)) return row;
            const str = String(val);
            if (str.trim() === "") return row;

            if (containsEmoji(str)) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                column: col, row: idx, originalValue: str, cleanedValue: str,
                rule: "emoji_reject", confidence: 1.0, label: "HIGH",
                status: "flagged", severity: "high_risk",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str, flag: "emoji_detected", confidence: 1.0, severity: "high_risk",
                reason: `emoji_detected ("${str}" — emojis never allowed in data)`,
                suggestedValue: str,
              });
            }
            return row; // Keep original value always
          });
        }
        break;
      }

      // ── LOCATION NORMALIZE: Deterministic preprocessing (noise removal, title case) ──
      // Handles LOCATION, REGION, COUNTRY columns.
      // AI handles semantic parts (abbreviation, fuzzy) via wrench in the UI layer.
      // "unknown" and similar invalid values → flagged RED deterministically.
      case "location_normalize": {
        // Invalid geographic values — always RED_FLAG (deterministic, no AI needed)
        // NOTE: "na" removed — legitimate abbreviation for "North America" in REGION columns
        const GEO_INVALID = /^(?:unknown|unk|n\/a|none|nil|tbd|undefined|not\s*available|not_a_value)$/i;

        for (const col of cols) {
          data = data.map((row, idx) => {
            const val = row[col];
            if (val == null || isNullValue(val)) return row;
            let str = String(val).trim();
            if (str === "") return row;

            const original = str;

            // 0. Check for known invalid geographic values → RED_FLAG immediately
            if (GEO_INVALID.test(str)) {
              flagMap.set(`${idx}-${col}`, {
                raw: original, flag: "unrecoverable_location" as FlagType, confidence: 1.0,
                severity: "high_risk",
                reason: `unrecoverable_location ("${original}" — not a valid geographic entity)`,
              });
              return row; // Keep original value
            }

            // 1. Strip trailing/inline numbers (hyd123 → hyd, delhi2 → delhi)
            str = str.replace(/\d+/g, "").trim();

            // 2. Strip symbols (keep letters, spaces, hyphens, commas, periods)
            str = str.replace(/[^a-zA-Z\s,.\-]/g, "").trim();

            // 3. Strip suffix noise: "city", "area", "zone", "district", "region", "state", "country"
            str = str.replace(/\s+(city|area|zone|district|region|state|country|territory|nation|market)\b/gi, "").trim();

            if (str === "") {
              // Pure noise → flag RED, keep original
              flagMap.set(`${idx}-${col}`, {
                raw: original, flag: "unrecoverable_location" as FlagType, confidence: 1.0,
                severity: "high_risk",
                reason: `unrecoverable_location ("${original}" — noise/symbols only after preprocessing)`,
              });
              return row;
            }

            // 4. Title case (only if not already title-cased)
            const titleCased = str.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
            if (titleCased !== str) {
              str = titleCased;
            }

            if (str !== original) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                column: col, row: idx, originalValue: original, cleanedValue: str,
                rule: "location_normalize", confidence: 0.85,
                label: "HIGH", status: "applied", severity: "warning",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: original, flag: "location_standardized" as FlagType, confidence: 0.85,
                severity: "clean",
                reason: `location_normalized ("${original}" → "${str}" — noise stripped, title cased)`,
              });
              return { ...row, [col]: str };
            }

            // No change needed (already clean)
            return row;
          });
        }
        break;
      }

      case "null_standardize": {
        for (const col of cols) {
          const colSemType = profileMap.get(col)?.semanticType;
          const isGeographicCol = colSemType === "REGION" || colSemType === "COUNTRY" || colSemType === "LOCATION";
          data = data.map((row, idx) => {
            const val = row[col];
            if (val == null) return row;
            // ── GEOGRAPHIC EXCEPTION: "na" is a legitimate abbreviation (North America) ──
            // Skip null conversion for "na" in REGION/COUNTRY/LOCATION columns.
            // The post-processor will expand "NA" → "North America" when appropriate.
            if (isGeographicCol && typeof val === "string" && val.trim().toLowerCase() === "na") {
              return row; // Keep "NA" as-is for geographic columns
            }
            // ── UNIVERSAL "unknown" → NULL ──
            // "unknown"/"unk" is NEVER a valid value in any column.
            // Convert to NULL immediately with a RED flag for traceability.
            if (typeof val === "string") {
              const trimmedVal = val.trim().toLowerCase();
              if (trimmedVal === "unknown" || trimmedVal === "unk") {
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: null,
                  rule: "null_standardize",
                  confidence: 1.0,
                  label: "HIGH",
                  status: "applied",
                  severity: "high_risk",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "garbage_token" as FlagType,
                  confidence: 1.0,
                  severity: "high_risk",
                  reason: `unknown_value ("${val}" → NULL — "unknown" is not a valid value in any column)`,
                });
                return { ...row, [col]: null }; // Set to NULL
              }
            }
            if (isNullValue(val)) {
              const wasNotNull = val !== null && val !== undefined && String(val).trim() !== "";
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: val,
                cleanedValue: null,
                rule: "null_standardize",
                confidence: 1.0,
                label: "HIGH",
                status: wasNotNull ? "flagged" : "skipped",
                severity: "warning",
              });
              if (wasNotNull) {
                flagMap.set(`${idx}-${col}`, {
                  raw: String(val),
                  flag: "missing_value",
                  confidence: 1.0,
                  severity: "warning",
                  reason: "missing_value",
                });
              }
              return { ...row, [col]: null };
            }
            return row;
          });
        }
        break;
      }

      case "numeric_normalize": {
        for (const col of cols) {
          const domainRules = getNumericDomainRules(col, profileMap.get(cols[0])?.semanticType);
          const colSemanticType = profileMap.get(col)?.semanticType;
          // ── SKIP non-numeric semantic types — they have dedicated handlers ──
          // PHONE, EMAIL, LOCATION, REGION, COUNTRY, USERNAME, FULL_NAME, LAST_NAME, FIRST_NAME, DATE
          // should NEVER go through numeric normalization (would strip phone digits, mangle names, etc.)
          const NON_NUMERIC_SEMANTIC = new Set(["PHONE", "EMAIL", "LOCATION", "REGION", "COUNTRY", "USERNAME", "FULL_NAME", "LAST_NAME", "FIRST_NAME", "DATE", "IDENTIFIER"]);
          if (colSemanticType && NON_NUMERIC_SEMANTIC.has(colSemanticType)) continue;
          data = data.map((row, idx) => {
            const val = row[col];
            if (val == null || isNullValue(val)) return row;
            const str = String(val).trim();
            if (str === "") return row;

            // ── SEMANTIC TYPE OVERRIDE: MONEY — rule-based salary parsing ──
            if (colSemanticType === "MONEY") {
              const salaryResult = parseSalaryValue(val);

              if (salaryResult.value !== null && !salaryResult.needsAI) {
                const intValue = Math.round(salaryResult.value);
                const strChanged = String(intValue) !== str;
                if (strChanged) {
                  transformationLog.push({
                    id: `log-${logIdx++}`,
                    timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                    column: col, row: idx, originalValue: str, cleanedValue: intValue,
                    rule: "salary_unified_parse", confidence: salaryResult.confidence,
                    label: salaryResult.confidence >= 0.85 ? "HIGH" : "MEDIUM",
                    status: "applied", severity: "warning",
                  });
                  flagMap.set(`${idx}-${col}`, {
                    raw: str, flag: "salary_parsed" as FlagType, confidence: salaryResult.confidence,
                    severity: "warning",
                    reason: `salary_parsed ("${str}" → ${intValue}, steps: ${salaryResult.steps.join("; ")})`,
                  });
                  return { ...row, [col]: intValue };
                }
                return row;
              }

              if (salaryResult.needsAI) {
                if (salaryResult.value !== null) {
                  const aiIntValue = Math.round(salaryResult.value);
                  transformationLog.push({
                    id: `log-${logIdx++}`,
                    timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                    column: col, row: idx, originalValue: str, cleanedValue: aiIntValue,
                    rule: "salary_unified_parse", confidence: salaryResult.confidence,
                    label: "LOW", status: "flagged", severity: "warning",
                  });
                  flagMap.set(`${idx}-${col}`, {
                    raw: str, flag: "salary_needs_ai" as FlagType, confidence: salaryResult.confidence,
                    severity: "warning",
                    reason: `salary_needs_ai ("${str}" → ${aiIntValue}, low confidence — AI review recommended)`,
                    suggestedValue: aiIntValue,
                  });
                  return { ...row, [col]: aiIntValue };
                }
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                  column: col, row: idx, originalValue: str, cleanedValue: str,
                  rule: "salary_unified_parse", confidence: 0.20,
                  label: "LOW", status: "flagged", severity: "high_risk",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: str, flag: "invalid_salary" as FlagType, confidence: 0.20,
                  severity: "high_risk",
                  reason: `invalid_salary ("${str}" — unparseable, needs AI review)`,
                  suggestedValue: str,
                });
                return row;
              }
            }

            // ── SEMANTIC TYPE OVERRIDE: Rating normalization ──
            if (colSemanticType === "RATING" && !/^[\d.]+$/.test(str)) {
              // Strip rating noise: "3★" → 3, "5/5" → 5, "four" → 4
              const ratingClean = str.replace(/[★☆⭐]/g, "").replace(/\/\d+(\.\d+)?/g, "").trim();
              const wordNum = WORD_NUMBERS[ratingClean.toLowerCase()];
              const num = wordNum !== undefined ? wordNum : parseFloat(ratingClean);
              if (!isNaN(num) && (wordNum !== undefined || !isNaN(parseFloat(ratingClean)))) {
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: str,
                  cleanedValue: num,
                  rule: "rating_normalize",
                  confidence: 0.90,
                  label: "HIGH",
                  status: "applied",
                  severity: "clean",
                });
                return { ...row, [col]: num };
              }
            }

            // ── SEMANTIC TYPE OVERRIDE: Experience normalization ──
            // Rules only: strip noise text → convert word numbers → extract number
            // NO AI needed. Handles: "five years of experience", "about 3 yrs",
            // "approximately twenty", "10+ years", "3 yrs experience", "twenty"
            if (colSemanticType === "EXPERIENCE" && !/^[\d.]+$/.test(str)) {
              // Step 1: Strip noise prefixes
              let cleaned = str
                .replace(/^(?:about|approximately|around|over|more than|less than|nearly|almost|exactly|roughly|circa|~)\s*/i, "")
                .trim();
              // Step 2: Strip noise suffixes
              cleaned = cleaned
                .replace(/(?:\s*of\s*experience|\s*(?:in|total|working|approximately|plus)\s*(?:experience|years?|yrs?)?)\s*$/i, "")
                .trim();
              // Step 3: Strip "+" suffix (e.g., "10+" → "10")
              cleaned = cleaned.replace(/\+$/, "").trim();
              // Step 4: Strip remaining "years/yrs/yr" words anywhere
              cleaned = cleaned.replace(/\s*(?:years?|yrs?|yr)\b/gi, "").trim();

              let extractedNum: number | null = null;
              let confidence = 0.90;
              const logEntry = (original: string, value: number, conf: number, r: string) =>
                transformationLog.push({
                  id: `log-${logIdx++}`, timestamp: Date.now(),
                  step: rule.step, stepName: rule.stepName,
                  column: col, row: idx, originalValue: original, cleanedValue: value,
                  rule: r, confidence: conf, label: conf >= 0.85 ? "HIGH" : "MEDIUM",
                  status: "applied", severity: "clean",
                });

              // Try 1: Pure digit after noise stripping (e.g., "about 3" → 3, "10" → 10)
              if (/^[\d.]+$/.test(cleaned)) {
                const num = parseFloat(cleaned);
                if (!isNaN(num)) {
                  extractedNum = num;
                  confidence = 0.95;
                }
              }

              // Try 2: Word number or compound word number (e.g., "five" → 5, "twenty five" → 25)
              if (extractedNum === null) {
                const compoundResult = extractCompoundWordNumber(cleaned.toLowerCase());
                if (compoundResult !== null) {
                  extractedNum = compoundResult;
                  confidence = compoundResult >= 10 ? 0.90 : 0.85;
                }
              }

              // Try 3: Digit number still embedded with noise (e.g., "3 experience" → 3)
              if (extractedNum === null) {
                const anyNum = cleaned.match(/([\d]+(?:\.\d+)?)/);
                if (anyNum) {
                  const num = parseFloat(anyNum[1]);
                  if (!isNaN(num)) {
                    extractedNum = num;
                    confidence = 0.85;
                  }
                }
              }

              // Try 4: Word number still embedded in noise (e.g., "five experience" → 5)
              if (extractedNum === null) {
                // Extract all word-number tokens from the cleaned string
                const tokens = cleaned.toLowerCase().split(/\s+/);
                for (const t of tokens) {
                  if (WORD_NUMBERS[t] !== undefined) {
                    extractedNum = WORD_NUMBERS[t];
                    confidence = 0.80;
                    break;
                  }
                }
              }

              // Try 5: Last resort — check original string for embedded digit
              if (extractedNum === null) {
                const origNum = str.match(/([\d]+(?:\.\d+)?)/);
                if (origNum) {
                  const num = parseFloat(origNum[1]);
                  if (!isNaN(num)) {
                    extractedNum = num;
                    confidence = 0.70;
                  }
                }
              }

              if (extractedNum !== null) {
                logEntry(str, extractedNum, confidence, "experience_normalize");
                return { ...row, [col]: extractedNum };
              }
            }

            // ── SEMANTIC TYPE OVERRIDE: Percentage normalization ──
            // Strips % symbol and "percent"/"percentage" word, keeps only the number
            if (colSemanticType === "PERCENTAGE" && !/^[\d.]+$/.test(str)) {
              // Handle "85%", "85 percent", "42 percentage", "85 %" etc.
              const pctMatch = str.match(/^([\d.]+)\s*(?:%|percent|percentage)?$/i);
              if (pctMatch) {
                const num = parseFloat(pctMatch[1]);
                if (!isNaN(num)) {
                  transformationLog.push({
                    id: `log-${logIdx++}`,
                    timestamp: Date.now(),
                    step: rule.step,
                    stepName: rule.stepName,
                    column: col,
                    row: idx,
                    originalValue: str,
                    cleanedValue: num,
                    rule: "percentage_normalize",
                    confidence: 0.95,
                    label: "HIGH",
                    status: "applied",
                    severity: "clean",
                  });
                  return { ...row, [col]: num };
                }
              }
              // Also handle "percent 85" or word before number
              const pctWordMatch = str.match(/^(?:percent|percentage)\s*([\d.]+)$/i);
              if (pctWordMatch) {
                const num = parseFloat(pctWordMatch[1]);
                if (!isNaN(num)) {
                  transformationLog.push({
                    id: `log-${logIdx++}`,
                    timestamp: Date.now(),
                    step: rule.step,
                    stepName: rule.stepName,
                    column: col,
                    row: idx,
                    originalValue: str,
                    cleanedValue: num,
                    rule: "percentage_normalize",
                    confidence: 0.95,
                    label: "HIGH",
                    status: "applied",
                    severity: "clean",
                  });
                  return { ...row, [col]: num };
                }
              }
            }

            // ── Step 1: Already valid numeric — universal negative check + domain validate ──
            if (typeof val === "number" || /^-?[\d.]+$/.test(str)) {
              const num = typeof val === "number" ? val : parseFloat(str);
              if (isNaN(num)) return row;
              // UNIVERSAL RULE: Any negative number in a numeric column is invalid
              // In a normal database, columns like years, ratings, salary, age etc. never have negatives
              if (num < 0) {
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: val,
                  rule: "numeric_normalize",
                  confidence: 0.30,
                  label: "LOW",
                  status: "flagged",
                  severity: "high_risk",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: str,
                  flag: "invalid_negative",
                  confidence: 0.30,
                  severity: "high_risk",
                  reason: domainRules
                    ? `invalid_negative (${num} < domain min ${domainRules.min})`
                    : `invalid_negative (${num} — negative values are invalid in numeric columns)`,
                });
                return row;
              }
              // Domain-specific upper bound check
              if (domainRules && num > domainRules.max) {
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: val,
                  rule: "numeric_normalize",
                  confidence: 0.50,
                  label: "LOW",
                  status: "flagged",
                  severity: "warning",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: str,
                  flag: "outlier",
                  confidence: 0.50,
                  severity: "warning",
                  reason: `outlier (${num} > domain max ${domainRules.max})`,
                });
              }
              return row;
            }

            // ── Step 2: FULLY DYNAMIC text stripping — extract number from ANY text ──
            // Strategy: 1) Word number anywhere in string, 2) First digit number anywhere
            // "three pcs" → 3, "approx 7.5 kg" → 7.5, "10 items" → 10, "~5" → 5, "five" → 5

            // Step 2a: Try word number embedded in text (e.g., "three pcs", "ten items")
            const textWords = str.toLowerCase().split(/[\s,_\-\.]+/);
            let wordNumberExtracted: number | null = null;
            for (const w of textWords) {
              if (WORD_NUMBERS[w] !== undefined) {
                wordNumberExtracted = WORD_NUMBERS[w];
                break;
              }
            }
            if (wordNumberExtracted !== null) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: str,
                cleanedValue: wordNumberExtracted,
                rule: "numeric_normalize",
                confidence: 0.85,
                label: "HIGH",
                status: "applied",
                severity: "clean",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str,
                flag: "word_number",
                confidence: 0.85,
                severity: "clean",
                reason: `word_number ("${str}" → ${wordNumberExtracted}, text stripped)`,
              });
              return { ...row, [col]: wordNumberExtracted };
            }

            // Step 2b: Extract first digit number from anywhere in string
            // "approx 7.5 kg" → 7.5, "3 pcs" → 3, "~10" → 10, "value:42" → 42
            const anyNumberMatch = str.match(/([\d]+(?:\.\d+)?)/);
            if (anyNumberMatch) {
              const num = parseFloat(anyNumberMatch[1]);
              if (!isNaN(num)) {
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: str,
                  cleanedValue: num,
                  rule: "numeric_normalize",
                  confidence: 0.92,
                  label: "HIGH",
                  status: "applied",
                  severity: "clean",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: str,
                  flag: "mixed_unit",
                  confidence: 0.92,
                  severity: "clean",
                  reason: `unit_stripped ("${str}" → ${num}, text removed)`,
                });
                return { ...row, [col]: num };
              }
            }

            // ── Step 3: Exact word-to-number — full string match (safety net) ──
            // Already covered by Step 2a for embedded words; this handles edge cases
            const wordLower = str.toLowerCase();
            if (WORD_NUMBERS[wordLower] !== undefined) {
              const converted = WORD_NUMBERS[wordLower];
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: str,
                cleanedValue: converted,
                rule: "numeric_normalize",
                confidence: 0.85,
                label: "HIGH",
                status: "applied",
                severity: "clean",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str,
                flag: "word_number",
                confidence: 0.85,
                severity: "clean",
                reason: `word_number ("${str}" → ${converted}, successfully converted)`,
              });
              return { ...row, [col]: converted };
            }

            // ── Step 4: Typo / fuzzy detection (FLAG ONLY — no auto-fix) ──
            const fuzzyMatch = fuzzyMatchWordNumber(str);
            if (fuzzyMatch) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: str,
                cleanedValue: str,
                rule: "numeric_normalize",
                confidence: 0.30,
                label: "LOW",
                status: "flagged",
                severity: "high_risk",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str,
                flag: "possible_typo",
                confidence: 0.30,
                severity: "high_risk",
                reason: `possible_typo ("${str}" ≈ "${fuzzyMatch}" — NOT auto-converted)`,
              });
              return row;
            }

            // ── Step 5: Qualitative / non-numeric text (FLAG ONLY) ──
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: str,
              cleanedValue: str,
              rule: "numeric_normalize",
              confidence: 0.20,
              label: "LOW",
              status: "flagged",
              severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str,
              flag: "non_numeric_category",
              confidence: 0.20,
              severity: "high_risk",
              reason: `non_numeric_category ("${str}" in numeric column — review required)`,
            });
            return row;
          });
        }
        break;
      }

      case "name_normalize":
      case "name_standardize": {
        const col = cols[0];
        const fullNameMode = rule.params?.semanticType === "FULL_NAME";
        const firstNameMode = rule.params?.semanticType === "FIRST_NAME";
        // Note: LAST_NAME now uses ai_lastname_validate, not name_normalize
        //
        // Names are STANDARDIZED (title-cased) AND validated.
        //   - FULL_NAME/FIRST_NAME: trim whitespace, apply proper title case (O'Brien, Mc, hyphenated)
        //     Numbers, special chars → flag RED (keep value)
        //   - Invalid → flag RED but KEEP the value (never convert to null)
        //   - Only actual N/A, NaN, null-like → null
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || isNullValue(val)) return { ...row, [col]: null };
          const str = String(val).trim();
          if (str === "") return { ...row, [col]: null };

          // ── EMOJI CHECK: flag RED but keep value ──
          if (containsEmoji(str)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: rule.method, confidence: 0.20, label: "LOW",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 0.20, severity: "high_risk",
              reason: `invalid_name ("${str}" — contains emoji)`,
              suggestedValue: str,
            });
            return row; // Keep original — flagged RED
          }

          // ── GARBAGE CHECK: ???, ---, ∞, etc. → flag RED but keep value ──
          if (isGarbageToken(str)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: rule.method, confidence: 0.20, label: "LOW",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 0.20, severity: "high_risk",
              reason: `invalid_name ("${str}" — garbage/symbol-only token)`,
              suggestedValue: str,
            });
            return row; // Keep original — flagged RED
          }

          // ── BANNED PATTERN CHECK: injection, system tokens → flag RED but keep value ──
          if (isBannedPattern(str)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: rule.method, confidence: 0.20, label: "LOW",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 0.20, severity: "high_risk",
              reason: `invalid_name ("${str}" — contains banned/injection pattern)`,
              suggestedValue: str,
            });
            return row; // Keep original — flagged RED
          }

          // ── SINGLE CHARACTER CHECK: flag RED but keep value ──
          const stripped = stripEmojis(str).trim();
          if (stripped.length < 2) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: rule.method, confidence: 0.25, label: "LOW",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 0.25, severity: "high_risk",
              reason: `invalid_name ("${str}" — too short, must be at least 2 characters)`,
              suggestedValue: str,
            });
            return row; // Keep original — flagged RED
          }

          // ── FULL_NAME/FIRST_NAME: SPECIAL CHARACTER CHECK ──
          if (fullNameMode || firstNameMode) {
            // Check for numbers in name
            if (/\d/.test(stripped)) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                column: col, row: idx, originalValue: str, cleanedValue: str,
                rule: rule.method, confidence: 0.20, label: "LOW",
                status: "flagged", severity: "high_risk",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str, flag: "special_char_name", confidence: 0.20, severity: "high_risk",
                reason: `special_char_name ("${str}" — names cannot contain numbers)`,
                suggestedValue: str,
              });
              return row; // Keep original — flagged RED
            }
            // Check for disallowed special characters (only allow letters, spaces, hyphens, apostrophes, periods)
            const hasDisallowedChars = /[^\p{L}\s'\-.\u0300-\u036F]/u.test(stripped);
            if (hasDisallowedChars) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                column: col, row: idx, originalValue: str, cleanedValue: str,
                rule: rule.method, confidence: 0.20, label: "LOW",
                status: "flagged", severity: "high_risk",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str, flag: "special_char_name", confidence: 0.20, severity: "high_risk",
                reason: `special_char_name ("${str}" — names cannot contain special characters like @#$%^&* etc.)`,
                suggestedValue: str,
              });
              return row; // Keep original — flagged RED
            }
          }

          // ── FULL_NAME specific: word count validation ──
          if (fullNameMode) {
            const words = stripped.split(/\s+/).filter((w) => w.length > 0);
            // 1 word (2+ chars) → YELLOW (partial_full_name) — but STILL title-case it
            if (words.length === 1) {
              const standardizedName = nameTitleCase(str);
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
                column: col, row: idx, originalValue: str, cleanedValue: standardizedName,
                rule: rule.method, confidence: 0.60, label: "MEDIUM",
                status: "flagged", severity: "warning",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str, flag: "partial_full_name", confidence: 0.60, severity: "warning",
                reason: `partial_full_name ("${str}" → "${standardizedName}" — only one word in FULL_NAME column, title-cased but likely incomplete)`,
                suggestedValue: standardizedName,
              });
              return { ...row, [col]: standardizedName }; // Title-case even partial names
            }
          }

          // ── VALID: apply title case standardization ──
          if (nameNeedsStandardization(str)) {
            const standardizedName = nameTitleCase(str);
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: standardizedName,
              rule: "name_standardize", confidence: 0.95, label: "HIGH",
              status: "applied", severity: "clean",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "name_standardized", confidence: 0.95, severity: "clean",
              reason: `name_standardized ("${str}" → "${standardizedName}" — proper title case applied)`,
            });
            return { ...row, [col]: standardizedName };
          }

          // Already properly formatted — no change needed
          return row;
        });
        break;
      }

      case "percentage_normalize": {
        const col = cols[0];
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || isNullValue(val)) return row;
          const str = String(val).trim();
          if (str === "") return row;

          // Already a clean number
          if (/^[\d.]+$/.test(str)) {
            const num = parseFloat(str);
            if (num < 0 || num > 100) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: str,
                cleanedValue: str,
                rule: "percentage_normalize",
                confidence: 0.30,
                label: "LOW",
                status: "flagged",
                severity: "high_risk",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str,
                flag: "outlier",
                confidence: 0.30,
                severity: "high_risk",
                reason: `invalid_percentage ("${str}" — out of range 0-100)`,
              });
            }
            return row;
          }

          // Extract number from "85%" or "42 percent"
          const pctMatch = str.match(/^([\d.]+)\s*(?:%|percent(?:age)?)\s*$/i);
          if (pctMatch) {
            const num = parseFloat(pctMatch[1]);
            if (!isNaN(num)) {
              const isOutOfRange = num < 0 || num > 100;
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: str,
                cleanedValue: num,
                rule: "percentage_normalize",
                confidence: isOutOfRange ? 0.30 : 0.95,
                label: isOutOfRange ? "LOW" : "HIGH",
                status: isOutOfRange ? "flagged" : "applied",
                severity: isOutOfRange ? "high_risk" : "clean",
              });
              if (isOutOfRange) {
                flagMap.set(`${idx}-${col}`, {
                  raw: str,
                  flag: "outlier",
                  confidence: 0.30,
                  severity: "high_risk",
                  reason: `invalid_percentage ("${str}" — ${num} is out of range 0-100)`,
                });
              }
              return { ...row, [col]: num };
            }
          }

          // Non-numeric → flag
          transformationLog.push({
            id: `log-${logIdx++}`,
            timestamp: Date.now(),
            step: rule.step,
            stepName: rule.stepName,
            column: col,
            row: idx,
            originalValue: str,
            cleanedValue: str,
            rule: "percentage_normalize",
            confidence: 0.30,
            label: "LOW",
            status: "flagged",
            severity: "high_risk",
          });
          flagMap.set(`${idx}-${col}`, {
            raw: str,
            flag: "invalid_numeric",
            confidence: 0.30,
            severity: "high_risk",
            reason: `invalid_percentage ("${str}" — non-numeric value in percentage column)`,
          });
          return row;
        });
        break;
      }

      case "ai_email_validate": {
        const col = cols[0];
        const emailRegex = EMAIL_REGEX;
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || isNullValue(val)) return row;
          const str = String(val).trim();
          if (str === "") return row;

          // ── MANDATORY: Always lowercase emails first ──
          const lowered = str.toLowerCase();

          // Already valid after lowercase → apply normalization
          if (emailRegex.test(lowered)) {
            if (lowered !== str) {
              // Was uppercase/mixed case → normalize to lowercase
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: str,
                cleanedValue: lowered,
                rule: "ai_email_validate",
                confidence: 0.95,
                label: "HIGH",
                status: "applied",
                severity: "clean",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str,
                flag: "email_fixed",
                confidence: 0.95,
                severity: "clean",
                reason: `email_normalized ("${str}" → "${lowered}" — lowercased)`,
              });
              return { ...row, [col]: lowered };
            }
            // Already valid + already lowercase — no change needed
            return row;
          }

          // Phase 1: Deterministic fixes (remove spaces, fix "at"/"dot")
          let cleaned = lowered.replace(/\s+/g, "");
          cleaned = cleaned.replace(/\bat\b/g, "@");
          cleaned = cleaned.replace(/\bdot\b/g, ".");

          if (emailRegex.test(cleaned)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: str,
              cleanedValue: cleaned,
              rule: "ai_email_validate",
              confidence: 0.90,
              label: "HIGH",
              status: "applied",
              severity: "clean",
            });
            return { ...row, [col]: cleaned };
          }

          // Phase 2: Still invalid → FLAG RED (regex-only, no AI needed)
          transformationLog.push({
            id: `log-${logIdx++}`,
            timestamp: Date.now(),
            step: rule.step,
            stepName: rule.stepName,
            column: col,
            row: idx,
            originalValue: str,
            cleanedValue: str,
            rule: "ai_email_validate",
            confidence: 0.30,
            label: "LOW",
            status: "flagged",
            severity: "high_risk",
          });
          flagMap.set(`${idx}-${col}`, {
            raw: str,
            flag: "invalid_email",
            confidence: 0.30,
            severity: "high_risk",
            reason: `invalid_email ("${str}" — failed regex validation)`,
            suggestedValue: str,
          });
          return row;
        });
        break;
      }

      case "username_null_check": {
        // KEY PRINCIPLE: Usernames are NEVER modified. Only null/empty → flagged.
        // Usernames can contain ANY characters (special chars, Unicode, numbers, spaces).
        // No format validation, no regex, no case normalization.
        for (const col of cols) {
          data = data.map((row, idx) => {
            const val = row[col];
            if (val == null || isNullValue(val)) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: val ?? "",
                cleanedValue: "",
                rule: "username_null_check",
                confidence: 1.0,
                label: "HIGH",
                status: "flagged",
                severity: "warning",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: val ?? "",
                flag: "null_detected" as FlagType,
                confidence: 1.0,
                severity: "warning",
                reason: `null_username ("${val ?? "null"}" — null/empty username)`,
              });
              return { ...row, [col]: "" };
            }
            // Non-null username → NO CHANGE, keep as-is
            return row;
          });
        }
        break;
      }

      case "ai_lastname_validate": {
        const col = cols[0];
        // KEY PRINCIPLE: Last names are VALIDATED only, never standardized. NO AI needed.
        //   Rules:
        //     1 word (2+ chars, only letters/apostrophe/hyphen) → GREEN (valid)
        //     1 character → RED flag (keep value)
        //     2+ words → RED flag (keep value)
        //     Special characters (except ' and -) → RED flag (keep value)
        //     Emoji/garbage/banned → RED flag (keep value)
        //     N/A, NaN, null-like → null
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || isNullValue(val)) return { ...row, [col]: null };
          const str = String(val).trim();
          if (str === "") return { ...row, [col]: null };

          // ── EMOJI CHECK: flag RED but keep value ──
          if (containsEmoji(str)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: "ai_lastname_validate", confidence: 1.0, label: "HIGH",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 1.0, severity: "high_risk",
              reason: `invalid_name ("${str}" — contains emoji)`,
              suggestedValue: str,
            });
            return row;
          }

          // ── GARBAGE CHECK: ???, ---, etc. → flag RED but keep value ──
          if (isGarbageToken(str)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: "ai_lastname_validate", confidence: 1.0, label: "HIGH",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 1.0, severity: "high_risk",
              reason: `invalid_name ("${str}" — garbage/symbol-only token)`,
              suggestedValue: str,
            });
            return row;
          }

          // ── BANNED PATTERN CHECK: injection, system tokens → flag RED but keep value ──
          if (isBannedPattern(str)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: "ai_lastname_validate", confidence: 1.0, label: "HIGH",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 1.0, severity: "high_risk",
              reason: `invalid_name ("${str}" — contains banned/injection pattern)`,
              suggestedValue: str,
            });
            return row;
          }

          // ── SINGLE CHARACTER CHECK: flag RED but keep value ──
          const stripped = stripEmojis(str).trim();
          if (stripped.length < 2) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: "ai_lastname_validate", confidence: 0.90, label: "HIGH",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 0.90, severity: "high_risk",
              reason: `invalid_name ("${str}" — last name too short, must be at least 2 characters)`,
              suggestedValue: str,
            });
            return row;
          }

          // ── MULTI-WORD CHECK: last name must be single token → flag RED but keep value ──
          const parts = stripped.split(/\s+/).filter((w) => w.length > 0);
          if (parts.length > 1) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: "ai_lastname_validate", confidence: 0.90, label: "HIGH",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 0.90, severity: "high_risk",
              reason: `invalid_name ("${str}" — last name must be single word, found ${parts.length} words)`,
              suggestedValue: str,
            });
            return row;
          }

          // ── SPECIAL CHARACTER CHECK: only letters, apostrophes, hyphens allowed ──
          if (/[^a-zA-Z'\-\p{L}]/u.test(stripped)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: str,
              rule: "ai_lastname_validate", confidence: 0.90, label: "HIGH",
              status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "invalid_name", confidence: 0.90, severity: "high_risk",
              reason: `invalid_name ("${str}" — contains special characters, only letters allowed)`,
              suggestedValue: str,
            });
            return row;
          }

          // ── VALID: single word (2+ chars), only letters/apostrophe/hyphen → title case + GREEN ──
          if (nameNeedsStandardization(str)) {
            const standardizedName = nameTitleCase(str);
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: standardizedName,
              rule: "name_standardize", confidence: 0.95, label: "HIGH",
              status: "applied", severity: "clean",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "name_standardized", confidence: 0.95, severity: "clean",
              reason: `name_standardized ("${str}" → "${standardizedName}" — proper title case applied)`,
            });
            return { ...row, [col]: standardizedName };
          }
          return row;
        });
        break;
      }

      case "location_standardize": {
        const col = cols[0];
        // Deterministic: title case only. NO flagging abbreviations.
        // Abbreviation expansion (blr→Bangalore, mum→Mumbai) is handled by
        // the "AI Verify Locations" button — user-triggered, not automatic.
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || isNullValue(val)) return row;
          const str = String(val).trim();
          if (str === "") return row;

          // Title case standardization
          const titleCased = str.trim().split(/[\s,]+/).map((word) =>
            word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word
          ).join(", ");

          if (titleCased !== str) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: str,
              cleanedValue: titleCased,
              rule: "location_standardize",
              confidence: 0.92,
              label: "HIGH",
              status: "applied",
              severity: "warning",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str,
              flag: "location_standardized",
              confidence: 0.92,
              severity: "warning",
              reason: `location_standardized ("${str}" → "${titleCased}" — title cased)`,
              suggestedValue: titleCased,
            });
            return { ...row, [col]: titleCased };
          }

          return row;
        });
        break;
      }

      case "e164_phone_format": {
        const col = cols[0];
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || isNullValue(val)) return row;
          const str = String(val).trim();
          if (str === "") return row;

          // Skip if contains letters (not a phone number)
          if (/[a-zA-Z]{2,}/.test(str.replace(/\s/g, ""))) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: str,
              cleanedValue: null,
              rule: "e164_phone_format",
              confidence: 0.30,
              label: "LOW",
              status: "applied",
              severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str,
              flag: "invalid_phone",
              confidence: 0.30,
              severity: "high_risk",
              reason: `invalid_phone ("${str}" — contains letters, not a phone number → NULL)`,
            });
            return { ...row, [col]: null };
          }

          // ── Use comprehensive phone formatting ──
          // ── Cross-reference location/region/country columns for country hint ──
          let countryHint: string | null = null;
          const geoColNames = ["location", "region", "country", "city", "state", "nation"];
          for (const gc of geoColNames) {
            // Check if any column name contains the geographic keyword
            const matchingCol = profiles.find((p) => p.name.toLowerCase().includes(gc));
            if (matchingCol) {
              const geoVal = row[matchingCol.name];
              if (geoVal != null && typeof geoVal === "string" && geoVal.trim() !== "") {
                countryHint = geoVal.trim();
                break;
              }
            }
          }
          // Also check all profile columns for LOCATION/REGION/COUNTRY semantic types
          if (!countryHint) {
            for (const p of profiles) {
              if (p.semanticType === "LOCATION" || p.semanticType === "REGION" || p.semanticType === "COUNTRY") {
                const geoVal = row[p.name];
                if (geoVal != null && typeof geoVal === "string" && geoVal.trim() !== "") {
                  countryHint = geoVal.trim();
                  break;
                }
              }
            }
          }
          const result = formatPhoneNumber(str, countryHint);
          const isChanged = result.formatted !== str;

          if (result.isValid) {
            if (isChanged) {
              // Value was modified → YELLOW flag (warning), not RED
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: str,
                cleanedValue: result.formatted,
                rule: "e164_phone_format",
                confidence: 0.92,
                label: "HIGH",
                status: "applied",
                severity: "warning", // YELLOW — modified value
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str,
                flag: "phone_formatted",
                confidence: 0.92,
                severity: "warning",
                reason: `phone_formatted ("${str}" → "${result.formatted}"${result.country ? ` — ${result.country}` : ""}, country code added/formatted)`,
                suggestedValue: result.formatted,
              });
              return { ...row, [col]: result.formatted };
            }
            // Already valid — clean, no flag
            return row;
          }

          // ── Invalid — FLAG RED + set to NULL ──
          transformationLog.push({
            id: `log-${logIdx++}`,
            timestamp: Date.now(),
            step: rule.step,
            stepName: rule.stepName,
            column: col,
            row: idx,
            originalValue: str,
            cleanedValue: null,
            rule: "ai_phone_validate",
            confidence: 0.30,
            label: "LOW",
            status: "applied",
            severity: "high_risk",
          });
          flagMap.set(`${idx}-${col}`, {
            raw: str,
            flag: "invalid_phone",
            confidence: 0.30,
            severity: "high_risk",
            reason: `invalid_phone ("${str}" — ${result.digits} digits, ${result.country ? `detected ${result.country}` : "no country code detected"} → NULL)`,
          });
          return { ...row, [col]: null };
        });
        break;
      }

      case "trim": {
        // Trim only — no case change (used for ID columns).
        // FLAG emojis RED — do NOT silently strip them.
        for (const col of cols) {
          data = data.map((row, idx) => {
            const val = row[col];
            if (typeof val === "string") {
              let cleaned = val.trim().replace(/\s+/g, " ");
              // Check for emojis BEFORE stripping — flag them RED
              if (containsEmoji(val)) {
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "emoji_detected",
                  confidence: 1.0,
                  severity: "high_risk",
                  reason: `emoji_detected ("${val}" contains emoji — FLAGGED RED, not stripped)`,
                });
              }
              // DON'T strip emojis in initial pass — flagged RED but preserved.
              // Emojis are handled when cleaning specific columns (wrench).
              let cleanedNoEmoji = cleaned; // just whitespace-trimmed, no emoji removal
              if (cleanedNoEmoji !== val && !containsEmoji(val)) {
                // Only flag as clean trim if it was just whitespace (not emoji)
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: cleanedNoEmoji,
                  rule: "trim",
                  confidence: 0.95,
                  label: "HIGH",
                  status: "applied",
                  severity: "clean",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "text_trimmed",
                  confidence: 0.95,
                  severity: "clean",
                  reason: `text_trimmed ("${val}" → "${cleanedNoEmoji}", whitespace trimmed)`,
                });
                return { ...row, [col]: cleanedNoEmoji };
              } else if (false && cleanedNoEmoji !== val && containsEmoji(val)) {
                // Emoji NOT stripped in initial pass — RED flag set above, value preserved
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: cleanedNoEmoji || null,
                  rule: "trim",
                  confidence: 0.90,
                  label: "HIGH",
                  status: "flagged",
                  severity: "high_risk",
                });
                // After stripping emoji, if empty → null
                if (cleanedNoEmoji === "") cleanedNoEmoji = null as unknown as string;
                return { ...row, [col]: cleanedNoEmoji };
              }
            }
            return row;
          });
        }
        break;
      }

      case "canonical_case": {
        // Normalize to most frequent original casing per unique value (dynamic, no hardcoding)
        const caseMap = (rule.params?.canonicalCaseMap as Record<string, string> | undefined) ?? null;
        if (!caseMap) break;
        for (const col of cols) {
          data = data.map((row, idx) => {
            const val = row[col];
            if (typeof val === "string" && val.trim() !== "") {
              let cleaned = val.trim().replace(/\s+/g, " ");
              // DON'T strip emojis in initial pass — flagged RED but preserved.
              if (containsEmoji(val)) {
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "emoji_detected",
                  confidence: 1.0,
                  severity: "high_risk",
                  reason: `emoji_detected ("${val}" contains emoji — FLAGGED RED, not stripped)`,
                });
              }
              const key = cleaned.toLowerCase();
              const canonical = caseMap[key];
              if (canonical && canonical !== cleaned) {
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: canonical,
                  rule: "canonical_case",
                  confidence: 0.92,
                  label: "HIGH",
                  status: "applied",
                  severity: "clean",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "canonical_mapped",
                  confidence: 0.92,
                  severity: "clean",
                  reason: `canonical_case ("${cleaned}" → "${canonical}", most frequent casing)`,
                });
                return { ...row, [col]: canonical };
              }
            }
            return row;
          });
        }
        break;
      }

      case "trim_titlecase": {
        const profile = profileMap.get(cols[0]);
        const isCategorical = profile?.detectedType === "categorical";
        for (const col of cols) {
          data = data.map((row, idx) => {
            const val = row[col];
            if (typeof val === "string" && val.trim() !== "") {
              // FLAG emojis RED — do NOT silently strip
              if (containsEmoji(val)) {
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "emoji_detected",
                  confidence: 1.0,
                  severity: "high_risk",
                  reason: `emoji_detected ("${val}" contains emoji — FLAGGED RED, not stripped)`,
                });
              }
              let cleaned = val.trim().replace(/\s+/g, " ");
              // DON'T strip emojis in initial pass — flagged RED but preserved.
              const titleCased = titleCase(cleaned);
              if (cleaned !== val || titleCased !== val) {
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: titleCased,
                  rule: "trim_titlecase",
                  confidence: 0.95,
                  label: "HIGH",
                  status: "applied",
                  severity: "clean",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "text_normalized",
                  confidence: 0.95,
                  severity: "clean",
                  reason: `text_normalized ("${val}" → "${titleCased}", trimmed + title case${containsEmoji(val) ? ", emojis flagged RED (not stripped)" : ""})`,
                });
                return { ...row, [col]: titleCased };
              }
            }
            return row;
          });
        }
        break;
      }

      case "range_average": {
        const col = cols[0];
        data = data.map((row, idx) => {
          const val = row[col];
          const parsed = parseRangeValue(val);
          if (parsed.wasRange || !parsed.isValid) {
            // For partial/invalid ranges: KEEP original value + RED flag for manual edit
            // Do NOT convert to null — the user needs to see and edit the original value
            const isPartial = !parsed.isValid;
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: val,
              cleanedValue: isPartial ? val : parsed.value, // keep original for partial ranges
              rule: "range_average",
              confidence: parsed.wasSwapped ? 0.85 : 0.92,
              label: parsed.wasSwapped ? "MEDIUM" : "HIGH",
              status: isPartial ? "flagged" : "applied",
              severity: isPartial ? "high_risk" : confidenceToSeverity(parsed.wasSwapped ? 0.85 : 0.92),
            });
            if (parsed.wasSwapped && !isPartial) {
              flagMap.set(`${idx}-${col}`, {
                raw: String(val),
                flag: "reversed_range",
                confidence: 0.85,
                severity: "warning",
                reason: "reversed_range",
                suggestedValue: parsed.value,
              });
            }
            if (isPartial) {
              flagMap.set(`${idx}-${col}`, {
                raw: String(val),
                flag: "partial_range",
                confidence: 0.40,
                severity: "high_risk",
                reason: `partial_range ("${val}" could not be fully parsed — needs manual edit)`,
                suggestedValue: parsed.value, // suggest parsed value even though we don't apply it
              });
              // KEEP original value — don't convert to null
              return row;
            }
            return { ...row, [col]: parsed.value };
          }
          return row;
        });
        break;
      }

      // ── salary_pre_normalization: RULES-BASED salary cleaning ──
      // Deterministic parse using parseSalaryValue() — handles ALL formats:
      // "50K", "fortyk", "thirtyfivek", "₹60000", "1.2M", "50K-60K" (avg),
      // "approx 40k", "salary 70K", "70k+", ranges, word numbers, merged words
      // Output: INTEGER only (no symbols, no text)
      // AI fallback: only for truly unparseable values via /api/ai-salary-parse
      case "salary_pre_normalization": {
        const col = cols[0];
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null) return row;
          const str = String(val).trim();
          if (str === "") return row;

          const result = parseSalaryValue(val);

          if (result.value !== null) {
            // Always output INTEGER — per user ruleset
            const intValue = Math.round(result.value);
            // Check if the string representation changed (e.g., "₹60000" → "60000", "50K INR" → "50000")
            const strChanged = String(intValue) !== str;
            if (!strChanged && !result.needsAI) return row;

            const conf = result.needsAI ? 0.75 : (result.confidence >= 0.90 ? 0.95 : 0.85);
            const reason = result.steps.length > 0 ? result.steps.join("; ") : `salary_normalized ("${str}" → ${intValue})`;

            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
              column: col, row: idx, originalValue: str, cleanedValue: intValue,
              rule: "salary_pre_normalization", confidence: conf,
              label: conf >= 0.85 ? "HIGH" : "MEDIUM",
              status: result.needsAI ? "flagged" : "applied",
              severity: result.needsAI ? "warning" : "clean",
            });

            if (result.needsAI || result.confidence < 0.90) {
              flagMap.set(`${idx}-${col}`, {
                raw: str, flag: (result.needsAI ? "salary_needs_ai" : "salary_parsed") as FlagType,
                confidence: conf, severity: "warning", reason,
                suggestedValue: intValue,
              });
            } else {
              flagMap.set(`${idx}-${col}`, {
                raw: str, flag: "salary_parsed" as FlagType,
                confidence: conf, severity: "clean", reason,
                suggestedValue: intValue,
              });
            }

            return { ...row, [col]: intValue };
          }

          // Unparseable → RED flag
          transformationLog.push({
            id: `log-${logIdx++}`,
            timestamp: Date.now(), step: rule.step, stepName: rule.stepName,
            column: col, row: idx, originalValue: str, cleanedValue: str,
            rule: "salary_pre_normalization", confidence: 0.20,
            label: "LOW", status: "flagged", severity: "high_risk",
          });
          flagMap.set(`${idx}-${col}`, {
            raw: str, flag: "invalid_salary" as FlagType, confidence: 0.20,
            severity: "high_risk",
            reason: `invalid_salary ("${str}" — unparseable, no numeric value found)`,
            suggestedValue: str,
          });

          return row;
        });
        break;
      }

      case "format_standardize": {
        const col = cols[0];
        data = data.map((row, idx) => {
          const val = row[col];
          if (typeof val === "string" && val.trim() !== "") {
            const { result: normalized, isAmbiguous } = tryNormalizeDate(val);
            if (!normalized) {
              // Non-date value in a date column → flag as invalid_date (RED — needs attention)
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: val,
                cleanedValue: val,
                rule: "format_standardize",
                confidence: 0.20,
                label: "LOW",
                status: "flagged",
                severity: "high_risk",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: val,
                flag: "invalid_date",
                confidence: 0.20,
                severity: "high_risk",
                reason: `invalid_date ("${val}" is not a recognizable date format — needs manual attention)`,
              });
              return row; // Keep original
            }
            if (normalized) {
              // v3 DATE VALIDATION: check if normalized date is valid
              const dateParts = normalized.split("-").map(Number);
              const hasInvalidDate = dateParts.length === 3 && (
                dateParts[1] < 1 || dateParts[1] > 12 ||
                dateParts[2] < 1 || dateParts[2] > 31
              );

              if (hasInvalidDate) {
                // Invalid date — flag but don't convert
                transformationLog.push({
                  id: `log-${logIdx++}`,
                  timestamp: Date.now(),
                  step: rule.step,
                  stepName: rule.stepName,
                  column: col,
                  row: idx,
                  originalValue: val,
                  cleanedValue: val,
                  rule: "format_standardize",
                  confidence: 0.30,
                  label: "LOW",
                  status: "flagged",
                  severity: "high_risk",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "invalid_date",
                  confidence: 0.30,
                  severity: "high_risk",
                  reason: `invalid_date ("${val}" → "${normalized}" — month=${dateParts[1]}, day=${dateParts[2]} out of valid range)`,
                });
                return row; // Keep original
              }

              // Additional: check days in month
              if (dateParts.length === 3) {
                const daysInMonth = new Date(dateParts[0], dateParts[1], 0).getDate();
                if (dateParts[2] > daysInMonth) {
                  transformationLog.push({
                    id: `log-${logIdx++}`,
                    timestamp: Date.now(),
                    step: rule.step,
                    stepName: rule.stepName,
                    column: col,
                    row: idx,
                    originalValue: val,
                    cleanedValue: val,
                    rule: "format_standardize",
                    confidence: 0.30,
                    label: "LOW",
                    status: "flagged",
                    severity: "high_risk",
                  });
                  flagMap.set(`${idx}-${col}`, {
                    raw: val,
                    flag: "invalid_date",
                    confidence: 0.30,
                    severity: "high_risk",
                    reason: `invalid_date ("${val}" → "${normalized}" — day ${dateParts[2]} exceeds ${daysInMonth} days in month ${dateParts[1]})`,
                  });
                  return row; // Keep original
                }
              }

              // BUG FIX #4: Flag ambiguous dates (both parts ≤ 12)
              if (isAmbiguous) {
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "ambiguous_date",
                  confidence: 0.75,
                  severity: "warning",
                  reason: "ambiguous_date (DD/MM vs MM/DD — assumed DD-MM for India locale)",
                });
              } else if (normalized !== val) {
                // Clean date standardization → GREEN flag
                flagMap.set(`${idx}-${col}`, {
                  raw: val,
                  flag: "date_standardized",
                  confidence: 0.95,
                  severity: "clean",
                  reason: `date_standardized ("${val}" → "${normalized}")`,
                });
              }
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: val,
                cleanedValue: normalized,
                rule: "format_standardize",
                confidence: isAmbiguous ? 0.75 : 0.95,
                label: isAmbiguous ? "MEDIUM" : "HIGH",
                status: isAmbiguous ? "flagged" : "applied",
                severity: isAmbiguous ? "warning" : "clean",
              });
              return { ...row, [col]: normalized };
            }
          }
          return row;
        });
        break;
      }

      case "canonical_map": {
        const col = cols[0];
        // Use final map from rule params (static + frequency-inferred + similarity)
        const ruleMap = (rule.params?.canonicalMap as Record<string, string> | undefined) ?? null;
        const freqInferences = (rule.params?.frequencyInferences as Record<string, string> | undefined) ?? {};
        const simInferences = (rule.params?.similarityInferences as Record<string, string> | undefined) ?? {};

        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || String(val).trim() === "") return row;
          const trimmed = String(val).trim();
          const key = trimmed.toLowerCase();

          // TYPE SAFETY: Do NOT remap numeric values to text categories
          // "0", "1", "42" etc. must not be auto-mapped to text like "Yes"/"No"
          // Instead, FLAG them as unknown_category in a categorical column
          if (/^\d+\.?\d*$/.test(key)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: val,
              cleanedValue: val,
              rule: "canonical_map",
              confidence: 0.50,
              label: "LOW",
              status: "flagged",
              severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: trimmed,
              flag: "unknown_category",
              confidence: 0.50,
              severity: "high_risk",
              reason: `unknown_category (numeric value "${trimmed}" in categorical column — no valid mapping, needs attention)`,
            });
            return row;
          }

          // Step 1: Try rule-provided final map (includes frequency-based + similarity + memory)
          let mapped: string | null = null;
          let confidence = 0.95;
          let isFreqBased = false;
          let isSimilarityBased = false;
          let isMemoryBased = false;

          if (ruleMap && ruleMap[key]) {
            mapped = ruleMap[key];
            isFreqBased = freqInferences[key] !== undefined;
            isSimilarityBased = simInferences[key] !== undefined;
            isMemoryBased = !isFreqBased && !isSimilarityBased;
            confidence = isSimilarityBased ? 0.70 : isFreqBased ? 0.85 : 0.95;
          }
          // No fallback to hardcoded maps — only dynamic clustering + memory

          if (mapped !== null && mapped !== trimmed) {
            const needsFlag = isFreqBased || isSimilarityBased;
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: val,
              cleanedValue: mapped,
              rule: "canonical_map",
              confidence,
              label: needsFlag ? "MEDIUM" : "HIGH",
              status: needsFlag ? "flagged" : "applied",
              severity: needsFlag ? "warning" : "clean",
            });
            if (isSimilarityBased) {
              flagMap.set(`${idx}-${col}`, {
                raw: trimmed,
                flag: "similarity_inferred",
                confidence,
                severity: "warning",
                reason: `similarity_inferred ("${trimmed}" → ${mapped} — ≥70% string similarity, review recommended)`,
              });
            } else if (isFreqBased) {
              flagMap.set(`${idx}-${col}`, {
                raw: trimmed,
                flag: "frequency_inferred",
                confidence,
                severity: "warning",
                reason: `frequency_inferred ("${trimmed}" → ${mapped} — inferred from co-occurrence with full form, review recommended)`,
              });
            } else {
              // Memory/frequency mapping — value successfully remapped → GREEN
              const mapSource = isMemoryBased ? "memory" : isFreqBased ? "frequency" : "dynamic";
              flagMap.set(`${idx}-${col}`, {
                raw: trimmed,
                flag: "canonical_mapped",
                confidence: 0.95,
                severity: "clean",
                reason: `canonical_mapped ("${trimmed}" → ${mapped}, ${mapSource} clustering)`,
              });
            }
            return { ...row, [col]: mapped };
          }

          // Step 2: Value IS in the canonical map but is already correct (mapped === trimmed)
          // This means the value is already the canonical form — NEVER flag as unknown
          if (ruleMap && ruleMap[key]) {
            return row;
          }

          // Step 3: Flag unknown values (outside mapping)
          // FIX: Do NOT overwrite existing clean/green flags from earlier rules (e.g. text_normalized)
          const existingFlag = flagMap.get(`${idx}-${col}`);
          if (existingFlag && existingFlag.severity === "clean") return row;
          const unknownList = (rule.params?.unknownValues as string[] | undefined) ?? [];
          if (ruleMap && !ruleMap[key] && unknownList.some((u) => u.toLowerCase() === key)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: val,
              cleanedValue: val,
              rule: "canonical_map",
              confidence: 0.50,
              label: "LOW",
              status: "flagged",
              severity: "warning",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: trimmed,
              flag: "unknown_category",
              confidence: 0.50,
              severity: "warning",
              reason: `unknown_category ("${trimmed}" not in canonical mapping)`,
            });
          }

          return row;
        });
        break;
      }

      case "categorical_semantic_check": {
        // Flag unmapped values (no canonical mapping exists)
        const col = cols[0];
        const unknownList = (rule.params?.unknownValues as string[]) ?? [];
        const allowedSet = (rule.params?.allowedSet as string[]) ?? []; // legacy fallback
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || String(val).trim() === "") return row;
          const trimmed = String(val).trim();
          const key = trimmed.toLowerCase();

          // FIX: Do NOT overwrite existing clean/green flags from earlier rules
          const existingFlag = flagMap.get(`${idx}-${col}`);
          if (existingFlag && existingFlag.severity === "clean") return row;

          // New mode: flag if value is in unknownList
          if (unknownList.length > 0 && unknownList.some((u) => u.toLowerCase() === key)) {
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: val,
              cleanedValue: val,
              rule: "categorical_semantic_check",
              confidence: 0.95,
              label: "HIGH",
              status: "flagged",
              severity: "warning",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: trimmed,
              flag: "unknown_category",
              confidence: 0.95,
              severity: "warning",
              reason: `unknown_category ("${trimmed}" has no canonical mapping)`,
            });
          }
          // Legacy mode removed — dynamic clustering replaces allowed-set checking
          return row;
        });
        break;
      }

      case "id_integrity_check": {
        // Flag duplicates and malformed IDs
        const col = cols[0];
        const seen = new Map<string, number>();
        data = data.map((row, idx) => {
          const val = row[col];
          if (val == null || String(val).trim() === "") {
            // Missing ID
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: val,
              cleanedValue: val,
              rule: "id_integrity_check",
              confidence: 1.0,
              label: "HIGH",
              status: "flagged",
              severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: String(val ?? "null"),
              flag: "critical_missing_id",
              confidence: 1.0,
              severity: "high_risk",
              reason: "critical_missing_id",
            });
            return row;
          }
          const strVal = String(val).trim();
          if (seen.has(strVal)) {
            // Duplicate ID
            transformationLog.push({
              id: `log-${logIdx++}`,
              timestamp: Date.now(),
              step: rule.step,
              stepName: rule.stepName,
              column: col,
              row: idx,
              originalValue: val,
              cleanedValue: val,
              rule: "id_integrity_check",
              confidence: 1.0,
              label: "HIGH",
              status: "flagged",
              severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: strVal,
              flag: "duplicate_id",
              confidence: 1.0,
              severity: "high_risk",
              reason: `duplicate_id (first seen at row ${seen.get(strVal)})`,
            });
          } else {
            seen.set(strVal, idx);
          }
          return row;
        });
        break;
      }

      case "anomaly_detected": {
        // Deterministic anomaly detection — flag emojis RED, garbage RED, banned RED
        // This is the KEY handler that catches emojis, garbage tokens, and banned patterns
        // and flags them with high_risk severity (RED) — NOT green, NOT yellow.
        //
        // EXCEPTION: Feedback columns (feedback, review, comment, response, etc.) allow
        // feedback-appropriate emojis (thumbs up/down, stars, hearts, sentiment faces).
        // Non-feedback emojis in feedback columns are still flagged RED.
        for (const col of cols) {
          const colIsFeedback = isFeedbackColumn(col);
          data = data.map((row, idx) => {
            const val = row[col];
            if (val == null) return row;
            const str = String(val).trim();
            if (str === "") return row;

            let anomalyType: string | null = null;
            let anomalyReason = "";

            if (containsEmoji(str)) {
              // FEEDBACK COLUMN: only flag if emojis are NOT feedback-appropriate
              if (colIsFeedback) {
                if (hasNonFeedbackEmoji(str)) {
                  anomalyType = "emoji_detected";
                  anomalyReason = `non_feedback_emoji ("${str}" contains non-feedback emoji — FLAGGED RED)`;
                }
                // else: feedback-appropriate emojis → skip, not flagged
              } else {
                // NON-FEEDBACK COLUMN: all emojis flagged RED
                anomalyType = "emoji_detected";
                anomalyReason = `emoji_detected ("${str}" contains emoji — FLAGGED RED)`;
              }
            } else if (isGarbageToken(str)) {
              anomalyType = "garbage_token";
              anomalyReason = `garbage_token ("${str}" is a garbage token — FLAGGED RED)`;
            } else if (isBannedPattern(str)) {
              anomalyType = "banned_word";
              anomalyReason = `banned_word ("${str}" matches banned pattern — FLAGGED RED)`;
            }

            if (anomalyType) {
              transformationLog.push({
                id: `log-${logIdx++}`,
                timestamp: Date.now(),
                step: rule.step,
                stepName: rule.stepName,
                column: col,
                row: idx,
                originalValue: val,
                cleanedValue: val, // Keep original — DON'T auto-clean
                rule: "anomaly_detected",
                confidence: 1.0,
                label: "HIGH",
                status: "flagged",
                severity: "high_risk",
              });
              flagMap.set(`${idx}-${col}`, {
                raw: str,
                flag: anomalyType,
                confidence: 1.0,
                severity: "high_risk", // RED
                reason: anomalyReason,
              });
            }
            return row;
          });
        }
        break;
      }

      // ── COUNTRY CODE VALIDATION — ISO 3166-1 alpha-2 ──
      // Strict 2-letter uppercase format. Flag non-compliant RED. Never convert to full names.
      case "country_code_validate": {
        const VALID_ISO = new Set([
          "AF","AX","AL","DZ","AS","AD","AO","AI","AQ","AG","AR","AM","AW","AU","AT","AZ",
          "BS","BH","BD","BB","BY","BE","BZ","BJ","BM","BT","BO","BQ","BA","BW","BR","IO",
          "BN","BG","BF","BI","CV","KH","CM","CA","KY","CF","TD","CL","CN","CX","CC","CO",
          "KM","CG","CD","CK","CR","CI","HR","CU","CW","CY","CZ","DK","DJ","DM","DO","EC",
          "EG","SV","GQ","ER","EE","SZ","ET","FK","FO","FJ","FI","FR","GF","PF","TF","GA",
          "GM","GE","DE","GH","GI","GR","GL","GD","GP","GU","GT","GG","GN","GW","GY","HT",
          "HM","VA","HN","HK","HU","IS","IN","ID","IR","IQ","IE","IM","IL","IT","JM","JE",
          "JO","JP","KE","KI","KP","KR","KW","KG","LA","LV","LB","LS","LR","LY","LI","LT",
          "LU","MO","MG","MW","MY","MV","ML","MT","MH","MQ","MR","MU","YT","MX","FM","MD",
          "MC","MN","ME","MS","MA","MZ","MM","NA","NR","NP","NL","NC","NZ","NI","NE","NG",
          "NU","NF","MK","MP","NO","OM","PK","PW","PS","PA","PG","PY","PE","PH","PN","PL",
          "PT","PR","QA","RE","RO","RU","RW","BL","SH","KN","LC","MF","PM","VC","WS","SM",
          "ST","SA","SN","RS","SC","SL","SG","SX","SK","SI","SB","SO","ZA","GS","SS","ES",
          "LK","SD","SR","SJ","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TK","TO","TT",
          "TN","TR","TM","TC","TV","UG","UA","AE","GB","US","UM","UY","UZ","VU","VE","VN",
          "VG","VI","WF","EH","YE","ZM","ZW",
        ]);
        for (const col of cols) {
          data = data.map((row, idx) => {
            const val = row[col];
            if (val == null || isNullValue(val)) return row;
            const str = String(val).trim();
            if (str === "") return row;

            const upper = str.toUpperCase();
            if (VALID_ISO.has(upper)) {
              // Valid ISO code — fix case if needed (in → IN)
              if (upper !== str) {
                transformationLog.push({
                  id: `log-${logIdx++}`, timestamp: Date.now(),
                  step: rule.step, stepName: rule.stepName,
                  column: col, row: idx,
                  originalValue: str, cleanedValue: upper,
                  rule: "country_code_validate", confidence: 0.95,
                  label: "HIGH", status: "applied", severity: "warning",
                });
                flagMap.set(`${idx}-${col}`, {
                  raw: str, flag: "text_normalized" as FlagType, confidence: 0.95,
                  severity: "warning",
                  reason: `country_code_uppercase ("${str}" → "${upper}" — ISO 3166-1 alpha-2 uppercase)`,
                  suggestedValue: upper,
                });
                return { ...row, [col]: upper };
              }
              return row; // Already valid
            }

            // Invalid — flag RED, keep original
            let reasonDetail = "";
            if (/^[a-zA-Z]{2}$/.test(upper)) {
              reasonDetail = "not a valid ISO 3166-1 alpha-2 code";
            } else if (/^[a-zA-Z]{3}$/.test(upper)) {
              reasonDetail = "ISO alpha-3 format, need alpha-2";
            } else {
              reasonDetail = "not a 2-letter ISO country code";
            }
            transformationLog.push({
              id: `log-${logIdx++}`, timestamp: Date.now(),
              step: rule.step, stepName: rule.stepName,
              column: col, row: idx,
              originalValue: str, cleanedValue: str,
              rule: "country_code_validate", confidence: 1.0,
              label: "HIGH", status: "flagged", severity: "high_risk",
            });
            flagMap.set(`${idx}-${col}`, {
              raw: str, flag: "garbage_token" as FlagType, confidence: 1.0,
              severity: "high_risk",
              reason: `invalid_country_code ("${str}" — ${reasonDetail})`,
              suggestedValue: str,
            });
            return row;
          });
        }
        break;
      }

      default:
        break;
    }
  }

  // ════════════════════════════════════════════════════════════
  // FINAL CLEANUP PASS — safety net, runs AFTER all rules.
  // Only converts these specific types to NULL:
  //   1. invalid_phone — letters in phone, wrong digit count, no country code
  //   2. garbage_token — "unknown"/"unk" strings that somehow survived
  //   3. unknown_category — values with no canonical mapping in categorical columns
  //
  // Everything else (emojis, locations, country codes)
  // is preserved as-is with their flags intact.
  // ════════════════════════════════════════════════════════════
  const FINAL_NULL_FLAGS: Set<string> = new Set([
    "invalid_phone",
    "garbage_token",
    "unknown_category",
  ]);

  let finalCleanupCount = 0;
  data = data.map((row, idx) => {
    let modified = false;
    const newRow = { ...row };
    for (const col of Object.keys(newRow)) {
      const cellKey = `${idx}-${col}`;
      const flag = flagMap.get(cellKey);
      if (!flag || flag.severity !== "high_risk") continue;
      if (!FINAL_NULL_FLAGS.has(flag.flag)) continue;

      // Don't NULL out numeric values that happen to have a high_risk flag
      // (e.g., an outlier number should stay as a number, just flagged)
      if (typeof newRow[col] === "number") continue;

      // NULL it out, log the transformation
      const originalVal = newRow[col];
      newRow[col] = null;
      modified = true;
      finalCleanupCount++;

      transformationLog.push({
        id: `log-${logIdx++}`,
        timestamp: Date.now(),
        step: 10,
        stepName: "final_cleanup",
        column: col,
        row: idx,
        originalValue: originalVal,
        cleanedValue: null,
        rule: "final_null_cleanup",
        confidence: 1.0,
        label: "HIGH",
        status: "applied",
        severity: "high_risk",
      });
    }
    return newRow;
  });

  return { data, flagMap, transformationLog };
}

// ── Column Analysis JSON Schema ────────────────────────
// Generates strict JSON analysis for each column matching the spec:
// {column_name, semantic_type, confidence, validation_regex, normalization_steps[], ai_fallback_required, canonical_output_format}

export interface ColumnAnalysisJson {
  column_name: string;
  semantic_type: string;
  confidence: number;
  validation_regex: string;
  normalization_steps: string[];
  ai_fallback_required: boolean;
  ai_fallback_prompt?: string;
  canonical_output_format: string;
}

// Validation regex patterns per semantic type (dynamic, not hardcoded)
const SEMANTIC_VALIDATION_REGEX: Record<string, string> = {
  FULL_NAME: "^[A-Za-z]+(?:\\s[A-Za-z]+)+$",
  FIRST_NAME: "^[A-Za-z]{2,}$",
  LAST_NAME: "^[A-Za-z]{2,}$",
  EMAIL: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
  MONEY: "^\\d+(\\.\\d+)?$",
  RATING: "^\\d+(\\.\\d+)?$",
  AGE: "^\\d{1,3}$",
  EXPERIENCE: "^\\d+(\\.\\d+)?$",
  DATE: "^\\d{4}-\\d{2}-\\d{2}$",
  PHONE: "^\\+\\d{7,15}$",  // E.164: +CC subscriber (max 15 total digits)
  LOCATION: "^[A-Za-z\\s,.-]+$",
  PERCENTAGE: "^\\d+(\\.\\d+)?$",
  IDENTIFIER: "^[A-Za-z0-9_-]+$",
  BOOLEAN: "^(true|false|yes|no|0|1|Y|N)$",
  CATEGORICAL: "^[A-Za-z0-9_\\s-]+$",
  TEXT: "^[A-Za-z0-9_\\s.,'-]*$",
  UNKNOWN: ".*",
};

const SEMANTIC_CANONICAL_FORMAT: Record<string, string> = {
  FULL_NAME: "Proper Case (e.g., John Doe)",
  FIRST_NAME: "Proper Case (e.g., John)",
  LAST_NAME: "Proper Case (e.g., Doe)",
  EMAIL: "lowercase (e.g., john@example.com)",
  MONEY: "Integer (base unit, e.g., 50000)",
  RATING: "Float 0-10 (e.g., 4.5)",
  AGE: "Integer 0-120",
  EXPERIENCE: "Float 0-50 (e.g., 3.5)",
  DATE: "ISO YYYY-MM-DD (e.g., 2024-01-15)",
  PHONE: "+<country_code> <subscriber> (e.g., +91 9876543210)",
  LOCATION: "Title Case (e.g., New York)",
  PERCENTAGE: "Number 0-100 (e.g., 85)",
  IDENTIFIER: "String (preserved case)",
  BOOLEAN: "Boolean (true/false)",
  CATEGORICAL: "String (canonical case)",
  TEXT: "String (trimmed, no emojis)",
  UNKNOWN: "Auto-detected",
};

const SEMANTIC_NORMALIZATION_STEPS: Record<string, string[]> = {
  FULL_NAME: ["Remove numbers & special chars", "Trim spaces", "Convert to Proper Case", "Flag single-word as partial"],
  LAST_NAME: ["Single word only", "Alphabets only", "Proper case"],
  EMAIL: ["Remove spaces", "Convert to lowercase (MANDATORY)", "Validate structure strictly"],
  MONEY: ["Convert to lowercase", "Remove symbols (₹, $, commas)", "Remove words (INR, rs, rupees)", "Convert word-numbers (fortyK → 40K)", "Detect multiplier (K/M/B)", "Extract numeric", "Compute final value"],
  RATING: ["Strip ★ symbols", "Parse fraction notation", "Convert word numbers", "Extract float"],
  AGE: ["Extract integer", "Validate range 0-120"],
  EXPERIENCE: ["Strip yrs/years suffix", "Convert word numbers", "Extract number"],
  DATE: ["Detect format (DD/MM/YYYY, YYYY-MM-DD)", "Convert ALL to YYYY-MM-DD", "Validate calendar date"],
  PHONE: ["Strip all formatting (spaces, dashes, parens)", "Match country code from 200+ world codes", "Validate subscriber digits per-country (subMin/subMax)", "Output +<CC> <subscriber>", "Max 15 total digits (E.164)"],
  PERCENTAGE: ['Convert "percent" → "%"', "Remove spaces", "Extract numeric", "Validate 0-100", "Flag >100 as anomaly"],
  LOCATION: ["Trim", "Title case"],
  IDENTIFIER: ["Trim", "Validate uniqueness"],
  BOOLEAN: ["Map yes/no/true/false to boolean"],
  CATEGORICAL: ["Trim", "Standardize case", "Fix spelling via similarity"],
  TEXT: ["Trim", "Remove emojis", "Flag garbage"],
  UNKNOWN: ["Auto-detect from patterns"],
};

/**
 * Generate column analysis JSON for all columns.
 * Returns strict JSON schema matching the spec format.
 */
export function generateColumnAnalysis(
  profiles: ColumnProfile[],
  columns: ColumnMeta[],
  data: RawDataRow[]
): ColumnAnalysisJson[] {
  return profiles.map((p) => {
    const semanticType = p.semanticType || "UNKNOWN";
    const confidence = p.semanticConfidence ?? 0;

    // Determine if AI fallback is needed by scanning for problematic values
    let aiFallbackRequired = false;
    let invalidCount = 0;

    for (const row of data) {
      const val = row[p.name];
      if (val == null) continue;
      const str = String(val).trim();
      if (!str) continue;

      switch (semanticType) {
        case "EMAIL": {
          if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(str)) {
            aiFallbackRequired = true;
            invalidCount++;
          }
          break;
        }
        case "PHONE": {
          const digits = str.replace(/\D/g, "");
          if (digits.length < 10 || digits.length > 15) {
            aiFallbackRequired = true;
            invalidCount++;
          }
          break;
        }
        case "MONEY": {
          const cleaned = cleanMonetaryValue(val);
          if (cleaned.value === null && !/^(na|n\/a|null|none|-|nan|nil|tbd)$/i.test(str)) {
            aiFallbackRequired = true;
            invalidCount++;
          }
          break;
        }
        case "FULL_NAME": {
          if (/[0-9!@#$%^&*()]/.test(str)) {
            aiFallbackRequired = true;
            invalidCount++;
          }
          break;
        }
        case "PERCENTAGE": {
          const num = parseFloat(str.replace(/[%\s]/g, ""));
          if (isNaN(num)) {
            aiFallbackRequired = true;
            invalidCount++;
          }
          break;
        }
      }
    }

    const result: ColumnAnalysisJson = {
      column_name: p.name,
      semantic_type: semanticType,
      confidence: Math.round(confidence * 100),
      validation_regex: SEMANTIC_VALIDATION_REGEX[semanticType] || ".*",
      normalization_steps: SEMANTIC_NORMALIZATION_STEPS[semanticType] || [],
      ai_fallback_required: aiFallbackRequired,
      canonical_output_format: SEMANTIC_CANONICAL_FORMAT[semanticType] || "auto-detected",
    };

    if (aiFallbackRequired) {
      result.ai_fallback_prompt = `You are a data correction assistant.\nColumn: ${p.name}\nValue: {value}\nTask:\n1. Check if valid\n2. If fixable → return corrected value\n3. Else → return NULL\nOutput:\n{"valid": true/false, "corrected_value": ""}`;
    }

    return result;
  });
}

// ── Summary Generation ────────────────────────────────

export function generateSummary(
  profiles: ColumnProfile[],
  ruleCount: number,
  rawDataLength: number,
  cleanedDataLength: number
): string {
  const typeBreakdown = profiles.reduce((acc, p) => {
    acc[p.detectedType] = (acc[p.detectedType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const parts: string[] = [];
  if (ruleCount === 0) {
    return `Dataset looks clean — ${rawDataLength} rows, no transformations needed.`;
  }
  parts.push(`Detected ${ruleCount} cleaning rules across ${rawDataLength} rows.`);
  if (typeBreakdown.numeric_integer) parts.push(`${typeBreakdown.numeric_integer} numeric, ${typeBreakdown.numeric_float || 0} float column(s).`);
  if (typeBreakdown.categorical) parts.push(`${typeBreakdown.categorical} categorical column(s).`);
  if (typeBreakdown.range) parts.push(`${typeBreakdown.range} range column(s).`);
  if (typeBreakdown.date) parts.push(`${typeBreakdown.date} date column(s).`);
  if (typeBreakdown.text) parts.push(`${typeBreakdown.text} text column(s).`);
  const missingCols = profiles.filter((p) => p.missingCount > 0).length;
  if (missingCols > 0) parts.push(`${missingCols} column(s) have missing values.`);

  return parts.join(" ");
}
