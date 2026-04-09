// ============================================================
// Semantic Column Intelligence Engine
// ============================================================
// Multi-signal column type detection with confidence scoring.
// Combines: header analysis, value patterns, range intelligence,
// token signals, and structure analysis.
//
// Semantic Types: FULL_NAME, MONEY, RATING, AGE, EXPERIENCE,
//   DATE, EMAIL, PHONE, LOCATION, REGION, COUNTRY,
//   CATEGORICAL, TEXT, IDENTIFIER, BOOLEAN, PERCENTAGE, UNKNOWN
//
// NO hardcoded value lists. ALL detection is signal-based.

import { parseSalaryValue } from "./salary-parser";

export type SemanticType =
  | "FULL_NAME"
  | "FIRST_NAME"
  | "LAST_NAME"
  | "USERNAME"
  | "MONEY"
  | "RATING"
  | "AGE"
  | "EXPERIENCE"
  | "DATE"
  | "EMAIL"
  | "PHONE"
  | "LOCATION"
  | "REGION"
  | "COUNTRY"
  | "COUNTRY_CODE"
  | "FEEDBACK"
  | "CATEGORICAL"
  | "TEXT"
  | "IDENTIFIER"
  | "BOOLEAN"
  | "PERCENTAGE"
  | "DEPARTMENT"
  | "FIELD"
  | "UNKNOWN";

// ── Multiplier + Unit Removal Engine ─────────────────
// Converts: "50K", "₹60000", "1.2M", "40K INR" → pure numbers
// Handles: K, M, B, T, Cr, L, LPA, INR, $, ₹, etc.

const CURRENCY_SYMBOLS = /[₹$€£¥]/g;
// NOTE: "lakh" and "crore" are NOT noise — they are multipliers handled below
const NOISE_TOKENS = /\b(inr|rs\.?|rupees|usd|eur|gbp|approx|per\s+annum|per\s+month|per\s+year|annually|pa|p\.a\.?)\b/gi;
const NOISE_SUFFIXES = /\/(month|year|mo|yr|annum)/gi;
const NOISE_CHARS = /[~+]/g;

// Multiplier patterns — ORDER MATTERS: longer words first
// CRITICAL: All patterns use lookbehind `(?<=[\d.])` to ensure the multiplier
// is attached to a number, preventing false matches in words like "descry" or "email"
const MULTIPLIER_PATTERNS: { pattern: RegExp; replace: RegExp; multiplier: number; label: string }[] = [
  { pattern: /(?<=[\d.])trillion\b/i, replace: /(?<=[\d.])trillion\b/gi, multiplier: 1e12, label: "trillion (×1e12)" },
  { pattern: /(?<=[\d.])billion\b/i, replace: /(?<=[\d.])billion\b/gi, multiplier: 1e9, label: "billion (×1e9)" },
  { pattern: /(?<=[\d.])crore\b/i, replace: /(?<=[\d.])crore\b/gi, multiplier: 1e7, label: "crore (×10000000)" },
  { pattern: /(?<=[\d.])\s*cr\b/i, replace: /(?<=[\d.])\s*cr\b/gi, multiplier: 1e7, label: "Cr (×10000000)" },
  { pattern: /(?<=[\d.])million\b/i, replace: /(?<=[\d.])million\b/gi, multiplier: 1e6, label: "million (×1e6)" },
  { pattern: /(?<=[\d.])lakh\b/i, replace: /(?<=[\d.])lakh\b/gi, multiplier: 1e5, label: "lakh (×100000)" },
  { pattern: /(?<=[\d.])\s*lpa\b/i, replace: /(?<=[\d.])\s*lpa\b/gi, multiplier: 1e5, label: "LPA (×100000)" },
  { pattern: /(?<=[\d.])thousand\b/i, replace: /(?<=[\d.])thousand\b/gi, multiplier: 1e3, label: "thousand (×1e3)" },
  // Single letter suffixes: lookbehind ensures digit precedes, no letter follows
  // "50K" → removes K, "MARK" → no match (no digit before K), "email" → no match
  { pattern: /(?<=\d)[kK](?![a-zA-Z])\b/i, replace: /(?<=\d)[kK](?![a-zA-Z])\b/gi, multiplier: 1e3, label: "K (×1000)" },
  { pattern: /(?<=\d)[mM](?![a-zA-Zino])\b/i, replace: /(?<=\d)[mM](?![a-zA-Zino])\b/gi, multiplier: 1e6, label: "M (×1000000)" },
  { pattern: /(?<=\d)[bB](?![a-zA-Zino])\b/i, replace: /(?<=\d)[bB](?![a-zA-Zino])\b/gi, multiplier: 1e9, label: "B (×1000000000)" },
  { pattern: /(?<=\d)[lL](?![a-zA-Zpa])\b/i, replace: /(?<=\d)[lL](?![a-zA-Zpa])\b/gi, multiplier: 1e5, label: "L (×100000)" },
];

// ── Word-Number Conversion ─────────────────────────
// Handles word numbers like "fortyK" → 40000, "fiftyM" → 50000000
const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, "fourty": 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

/**
 * Extract a compound word-number from a string.
 * - "forty five" → 45
 * - "twenty three" → 23
 * - "one hundred" → 100
 * - "two hundred twenty" → 220
 * Returns null if the string is not a valid word-number.
 */
function extractCompoundWordNumber(str: string): number | null {
  const tokens = str.trim().split(/\s+/);
  if (tokens.length === 0 || tokens.length > 3) return null;

  const allWordNumbers = Object.keys(WORD_NUMBERS);
  const validTokens = tokens.every((t) => allWordNumbers.includes(t));
  if (!validTokens) return null;

  if (tokens.length === 1) {
    return WORD_NUMBERS[tokens[0]] ?? null;
  }

  if (tokens.length === 2) {
    // "twenty one" → 20 + 1 = 21
    const a = WORD_NUMBERS[tokens[0]];
    const b = WORD_NUMBERS[tokens[1]];
    if (a !== undefined && b !== undefined) {
      // Handle "X hundred"
      if (tokens[1] === "hundred") return a * 100;
      // Handle compound: "twenty three" (both < 100)
      if (a < 100 && b < 100) return a + b;
    }
    return null;
  }

  if (tokens.length === 3) {
    // "two hundred twenty" → 2*100 + 20 = 220
    const a = WORD_NUMBERS[tokens[0]];
    const b = WORD_NUMBERS[tokens[1]];
    const c = WORD_NUMBERS[tokens[2]];
    if (a !== undefined && b !== undefined && c !== undefined) {
      if (tokens[1] === "hundred") {
        return a * 100 + c;
      }
    }
    return null;
  }

  return null;
}

export interface MonetaryResult {
  value: number | null;
  steps: string[];
  multiplier?: number;
  multiplierLabel?: string;
  original?: string;
  flag?: string;
}

/**
 * Clean monetary/compensation values — removes currency, noise, applies multipliers.
 * "50K" → 50000, "₹60000" → 60000, "1.2M" → 1200000, "5LPA" → 500000
 */
// ── Word-Number Conversion ─────────────────────────
// Delegates to the unified salary parser for comprehensive word-number handling.

export function cleanMonetaryValue(value: unknown): MonetaryResult {
  if (value === null || value === undefined) return { value: null, steps: [] };

  const raw = String(value).trim();
  if (raw === "" || /^(na|n\/a|null|none|-|nan|nil|tbd|undefined)$/i.test(raw)) {
    return { value: null, steps: [] };
  }

  // Already a clean number
  if (typeof value === "number" && isFinite(value)) {
    return { value, steps: ["passthrough: already numeric"], original: raw };
  }

  // Delegate to unified salary parser for ALL formats
  // Handles: "sixtyk", "SixtyK", "60K", "60 k", "thirtyfivek",
  // "fifty crore", "sixty lakh", "forty five thousand", etc.
  const result = parseSalaryValue(value);
  return {
    value: result.value,
    steps: result.steps,
    original: raw,
    flag: result.needsAI ? "needs_ai_review" : undefined,
  };
}

// ── Signal Detection Helpers ─────────────────────────

// Header pattern matching — returns array of matched semantic hints
function analyzeHeader(columnName: string): Map<string, number> {
  const scores = new Map<string, number>();
  const n = columnName.toLowerCase().replace(/[_\s-]+/g, " ");

  // MONEY signals (strongest → weakest)
  if (/\b(salary|income|ctc|compensation|pay|wage|stipend|remuneration|earnings|package)\b/.test(n)) {
    scores.set("MONEY", (scores.get("MONEY") || 0) + 4);
  }
  if (/\b(cost|price|fee|budget|expense|revenue|amount|charge|rate_card)\b/.test(n)) {
    scores.set("MONEY", (scores.get("MONEY") || 0) + 3);
  }

  // RATING signals
  if (/\b(rating|rate|score|grade|gpa|mark|points?|ranking|stars?)\b/.test(n)) {
    scores.set("RATING", (scores.get("RATING") || 0) + 4);
  }

  // EXPERIENCE signals
  if (/\b(experience|exp|tenure|years_exp|yrs_exp|work_exp|exp_yrs)\b/.test(n)) {
    scores.set("EXPERIENCE", (scores.get("EXPERIENCE") || 0) + 4);
  }
  if (/\b(years?|yr|duration)\b/.test(n)) {
    scores.set("EXPERIENCE", (scores.get("EXPERIENCE") || 0) + 2);
  }

  // AGE signals
  if (/\bage\b/.test(n) && !/\b(average|range|group|band)\b/.test(n)) {
    scores.set("AGE", (scores.get("AGE") || 0) + 4);
  }

  // DATE signals
  if (/\b(date|dob|birth|join|start|end|created|updated|timestamp|dt)\b/i.test(n)) {
    scores.set("DATE", (scores.get("DATE") || 0) + 4);
  }

  // EMAIL signals
  if (/\b(email|e_mail|mail|email_address)\b/i.test(n)) {
    scores.set("EMAIL", (scores.get("EMAIL") || 0) + 5);
  }

  // PHONE signals
  if (/\b(phone|mobile|tel|telephone|cell|contact_no|contact_num)\b/i.test(n)) {
    scores.set("PHONE", (scores.get("PHONE") || 0) + 5);
  }

  // NAME signals
  if (/\b(full_name|fullname|name|employee_name|person_name|customer_name)\b/i.test(n)) {
    if (/\b(first_name|fname|forename)\b/i.test(n)) {
      scores.set("FIRST_NAME", (scores.get("FIRST_NAME") || 0) + 4);
    } else if (/\b(last_name|lname|surname|family_name)\b/i.test(n)) {
      scores.set("LAST_NAME", (scores.get("LAST_NAME") || 0) + 4);
    } else {
      scores.set("FULL_NAME", (scores.get("FULL_NAME") || 0) + 4);
    }
  }

  // USERNAME signals — detect before LOCATION to avoid "user" matching
  if (/\b(username|user_name|usr|login|handle|screen_name|display_name|nickname|nick)\b/i.test(n)) {
    scores.set("USERNAME", (scores.get("USERNAME") || 0) + 5);
  }

  // LOCATION signals
  if (/\b(city|address|pincode|zip|postal|district|area|locality|town|village)\b/.test(n)) {
    scores.set("LOCATION", (scores.get("LOCATION") || 0) + 4);
  }

  // REGION signals
  if (/\b(region|zone|area_group|market|territory|business_area)\b/.test(n)) {
    scores.set("REGION", (scores.get("REGION") || 0) + 4);
  }

  // COUNTRY signals
  if (/\b(country|nation|nation code)\b/.test(n) && !/\b(country code|iso|alpha 2)\b/.test(n)) {
    scores.set("COUNTRY", (scores.get("COUNTRY") || 0) + 4);
  }

  // COUNTRY_CODE signals — column name indicates ISO country code (2-letter)
  // After normalization: underscores/spaces/dashes → single space, lowercase
  if (/\b(country code|countrycode|iso code|iso alpha|alpha 2|ccode|nat code|country iso)\b/.test(n)) {
    scores.set("COUNTRY_CODE", (scores.get("COUNTRY_CODE") || 0) + 5);
  }
  // Also match if column name is just "code" AND values look like ISO codes (handled in value tokens)

  // FEEDBACK signals
  if (/\b(feedback|review|comment|response|remark|note|opinion|survey_response|sentiment|rating_text|experience_text|testimonial)\b/i.test(n)) {
    scores.set("FEEDBACK", (scores.get("FEEDBACK") || 0) + 4);
  }

  // DEPARTMENT signals
  if (/\b(department|dept|division|team|function|unit|specialization|branch)\b/.test(n)) {
    scores.set("DEPARTMENT", (scores.get("DEPARTMENT") || 0) + 4);
  }

  // FIELD signals
  if (/\b(field|domain|specialization|major|stream|discipline|subject|industry|sector)\b/.test(n) && !/\b(field_of_study)\b/.test(n)) {
    scores.set("FIELD", (scores.get("FIELD") || 0) + 3);
  }

  // PERCENTAGE signals
  if (/\b(percent|percentage|pct|ratio|proportion|share)\b/.test(n)) {
    scores.set("PERCENTAGE", (scores.get("PERCENTAGE") || 0) + 4);
  }

  // IDENTIFIER signals
  if (/\b(id|uuid|emp_id|employee_id|code|serial|ref|reference)\b/.test(n)) {
    scores.set("IDENTIFIER", (scores.get("IDENTIFIER") || 0) + 3);
  }

  // BOOLEAN signals
  if (/\b(is_|has_|can_|will_|should_|active|verified|flag|enabled|visible|available)\b/.test(n)) {
    scores.set("BOOLEAN", (scores.get("BOOLEAN") || 0) + 2);
  }

  return scores;
}

// Token signals — patterns found IN values
function analyzeValueTokens(values: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  let sampleCount = 0;

  for (const v of values.slice(0, 50)) {
    const t = v.trim().toLowerCase();
    if (!t) continue;
    sampleCount++;

    // MONEY tokens
    if (/[₹$€£¥]/.test(v)) scores.set("MONEY", (scores.get("MONEY") || 0) + 1);
    if (/\b\d+[km]\b/i.test(t) || /\b\d+[,.]?\d*\s*[km]\b/i.test(t)) scores.set("MONEY", (scores.get("MONEY") || 0) + 0.5);
    if (/\b(lpa|lakh|crore|cr)\b/i.test(t)) scores.set("MONEY", (scores.get("MONEY") || 0) + 1);
    if (/\b(inr|rs|rupees|usd|salary|compensation)\b/i.test(t)) scores.set("MONEY", (scores.get("MONEY") || 0) + 0.5);

    // RATING tokens
    if (/[★☆]/.test(v)) scores.set("RATING", (scores.get("RATING") || 0) + 1);
    if (/\/\s*\d+/.test(v)) scores.set("RATING", (scores.get("RATING") || 0) + 1); // "5/5", "3/10"
    if (/\b(out of|out_of)\b/i.test(t)) scores.set("RATING", (scores.get("RATING") || 0) + 0.5);

    // EXPERIENCE tokens — match yr/yrs/years AND word numbers commonly used for experience
    if (/\b(yr|yrs|years?)\b/i.test(t)) scores.set("EXPERIENCE", (scores.get("EXPERIENCE") || 0) + 0.5);
    // Word numbers that are common in experience columns (without any other strong signal)
    if (/^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)$/i.test(t.trim())) {
      scores.set("EXPERIENCE", (scores.get("EXPERIENCE") || 0) + 0.3);
    }

    // PERCENTAGE tokens
    if (/%/.test(v)) scores.set("PERCENTAGE", (scores.get("PERCENTAGE") || 0) + 1.5);
    if (/\bpercent\b/i.test(t)) scores.set("PERCENTAGE", (scores.get("PERCENTAGE") || 0) + 1);

    // EMAIL tokens — strict: requires proper TLD (≥2 alpha chars)
    if (/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(v)) scores.set("EMAIL", (scores.get("EMAIL") || 0) + 3);

    // DATE tokens — detect common date patterns in values
    if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(t) || /^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(t)) {
      scores.set("DATE", (scores.get("DATE") || 0) + 3);
    }
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t) && t.length >= 8) {
      scores.set("DATE", (scores.get("DATE") || 0) + 2);
    }

    // PHONE tokens — BUT exclude date-like patterns to prevent cross-column misclassification
    // Dates like "15-05-2021" or "2024/01/15" should NOT boost PHONE score
    const isDateLike = /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(t) || /^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(t);
    if (!isDateLike && /^[\d\s\-+()]{7,15}$/.test(t)) scores.set("PHONE", (scores.get("PHONE") || 0) + 2);
    if (!isDateLike && /^\+?\d[\d\s\-]{8,14}$/.test(t)) scores.set("PHONE", (scores.get("PHONE") || 0) + 2);

    // NAME tokens — alphabetic strings with spaces, 2-4 parts
    if (/^[a-zA-Z\s.'-]{2,50}$/.test(v) && v.split(/\s+/).length >= 2 && v.split(/\s+/).length <= 4) {
      scores.set("FULL_NAME", (scores.get("FULL_NAME") || 0) + 0.5);
    }
    if (/^[a-zA-Z]{2,20}$/.test(v) && v.length >= 2) {
      scores.set("FIRST_NAME", (scores.get("FIRST_NAME") || 0) + 0.3);
    }

    // USERNAME tokens — can contain ANY characters (letters, numbers, symbols)
    // Username pattern: any non-empty string (1+ chars)
    if (v.length >= 1 && v.length <= 50) {
      scores.set("USERNAME", (scores.get("USERNAME") || 0) + 0.3);
    }

    // LOCATION tokens
    if (/\b(city|state|country|street|road|avenue|blvd|lane|drive)\b/i.test(t)) {
      scores.set("LOCATION", (scores.get("LOCATION") || 0) + 0.5);
    }

    // COUNTRY_CODE tokens — 2-letter strings that are valid ISO 3166-1 alpha-2 codes
    // Strong signal: if >50% of values are valid ISO codes, this is likely a COUNTRY_CODE column
    if (/^[A-Za-z]{2}$/.test(t)) {
      // Exclude common English words that happen to be 2 letters
      const COMMON_2LETTER_WORDS = new Set([
        "an","as","at","be","by","do","go","if","in","is","it","me","my","no","of","ok","on","or","so","to","up","us",
        "am","he","we","hi","oh","ah","yo","ox","ex",
      ]);
      if (!COMMON_2LETTER_WORDS.has(t)) {
        scores.set("COUNTRY_CODE", (scores.get("COUNTRY_CODE") || 0) + 1.5);
      }
    }
  }

  return scores;
}

// Range-based intelligence — analyze numeric distribution
function analyzeRange(values: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  const nums: number[] = [];

  // Extract numbers from values (handle K/M/B multipliers for money detection)
  for (const v of values.slice(0, 100)) {
    const t = v.trim();
    if (!t) continue;
    // Try monetary extraction for large numbers
    const monetary = cleanMonetaryValue(t);
    if (monetary.value !== null && monetary.value > 0) {
      nums.push(monetary.value);
      continue;
    }
    // Plain numeric extraction
    const match = t.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const n = parseFloat(match[1]);
      if (!isNaN(n)) nums.push(n);
    }
  }

  if (nums.length < 3) return scores;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const allPositive = nums.every((n) => n >= 0);

  // RATING range: mostly 0-5 or 0-10
  if (max <= 5 && min >= 0) {
    scores.set("RATING", (scores.get("RATING") || 0) + 3);
  } else if (max <= 10 && min >= 0) {
    scores.set("RATING", (scores.get("RATING") || 0) + 2);
  }

  // MONEY range: large values
  if (min > 5000) {
    scores.set("MONEY", (scores.get("MONEY") || 0) + 3);
  } else if (avg > 10000) {
    scores.set("MONEY", (scores.get("MONEY") || 0) + 2);
  } else if (max > 100000) {
    scores.set("MONEY", (scores.get("MONEY") || 0) + 1.5);
  }

  // EXPERIENCE range: 0-40
  if (allPositive && max <= 45 && min >= 0 && max > 0) {
    scores.set("EXPERIENCE", (scores.get("EXPERIENCE") || 0) + 2);
  }

  // AGE range: 16-100
  if (min >= 16 && max <= 100) {
    scores.set("AGE", (scores.get("AGE") || 0) + 3);
  } else if (min >= 0 && max <= 120 && avg > 15 && avg < 80) {
    scores.set("AGE", (scores.get("AGE") || 0) + 1.5);
  }

  // PERCENTAGE range: 0-100
  if (allPositive && max <= 100 && min >= 0) {
    scores.set("PERCENTAGE", (scores.get("PERCENTAGE") || 0) + 1);
  }

  // Has decimals? (ratings commonly have decimals like 4.5)
  const hasDecimals = nums.some((n) => n !== Math.floor(n));
  if (hasDecimals && max <= 5) {
    scores.set("RATING", (scores.get("RATING") || 0) + 2);
  }

  return scores;
}

// Structure analysis — cardinality, patterns, consistency
function analyzeStructure(columnName: string, values: string[]): Map<string, number> {
  const scores = new Map<string, number>();
  const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
  if (nonEmpty.length < 2) return scores;

  const unique = new Set(nonEmpty.map((v) => String(v).trim().toLowerCase()));
  const cardinality = unique.size / nonEmpty.length;

  // Low cardinality + few unique → likely CATEGORICAL or BOOLEAN
  if (unique.size <= 8 && nonEmpty.length >= 5) {
    scores.set("CATEGORICAL", (scores.get("CATEGORICAL") || 0) + 2);
  }
  if (unique.size <= 2 && nonEmpty.length >= 3) {
    scores.set("BOOLEAN", (scores.get("BOOLEAN") || 0) + 3);
  }

  // High cardinality + all look like emails → EMAIL (strict regex: requires proper TLD)
  const emailCount = nonEmpty.filter((v) => /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(v.trim())).length;
  if (emailCount / nonEmpty.length >= 0.8) {
    scores.set("EMAIL", (scores.get("EMAIL") || 0) + 5);
  }

  // High cardinality + phone pattern → PHONE (exclude date-like values)
  const datePattern = /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$|^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/;
  const phoneCount = nonEmpty.filter((v) => {
    const trimmed = v.trim();
    return !datePattern.test(trimmed) && /^[\d\s\-+()]{7,15}$/.test(trimmed);
  }).length;
  if (phoneCount / nonEmpty.length >= 0.8) {
    scores.set("PHONE", (scores.get("PHONE") || 0) + 5);
  }

  // High cardinality + date-like pattern → DATE
  const dateCount = nonEmpty.filter((v) => {
    const t = v.trim();
    return /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(t) || /^\d{1,2}[-\/]\d{1,2}[-\/]\d{4}$/.test(t) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(t);
  }).length;
  if (dateCount / nonEmpty.length >= 0.6) {
    scores.set("DATE", (scores.get("DATE") || 0) + 5);
  }

  // ── AI-style Name Structure Analysis ──
  // Distinguish FULL_NAME vs LAST_NAME by looking at word count patterns
  const n = columnName.toLowerCase();
  const isNameLike = /\b(name|fullname|full_name|employee_name|person_name|customer_name|first_name|fname|last_name|lname|surname|family_name)\b/i.test(n);
  if (isNameLike || unique.size / nonEmpty.length > 0.7) {
    // Analyze word counts in values to distinguish FULL_NAME from LAST_NAME
    let singleWordCount = 0;
    let twoWordCount = 0;
    let multiWordCount = 0;
    const alphaOnly = nonEmpty.map((v) => v.trim().replace(/[^A-Za-z\s]/g, "").trim()).filter((v) => v.length > 0);
    for (const v of alphaOnly) {
      const wCount = v.split(/\s+/).filter((w) => w.length > 0).length;
      if (wCount === 1) singleWordCount++;
      else if (wCount === 2) twoWordCount++;
      else if (wCount > 2) multiWordCount++;
    }
    const total = alphaOnly.length || 1;
    const twoOrMorePct = (twoWordCount + multiWordCount) / total;
    const singlePct = singleWordCount / total;

    // FULL_NAME signal: ≥40% have 2+ words (like "John Smith", "Jane Doe")
    if (twoOrMorePct >= 0.4) {
      scores.set("FULL_NAME", (scores.get("FULL_NAME") || 0) + 6);
    }
    // LAST_NAME signal: ≥80% are single words AND header hints at last name
    if (singlePct >= 0.8 && /\b(last_name|lname|surname|family_name)\b/i.test(n)) {
      scores.set("LAST_NAME", (scores.get("LAST_NAME") || 0) + 6);
    }
    // LAST_NAME signal: ≥90% single words (very strong indicator even without header hint)
    if (singlePct >= 0.9 && twoOrMorePct < 0.1) {
      scores.set("LAST_NAME", (scores.get("LAST_NAME") || 0) + 3);
      // But if header says full_name, boost FULL_NAME instead
      if (/\b(full_name|fullname|name)\b/i.test(n) && !/\b(last|surname|family)\b/i.test(n)) {
        scores.set("FULL_NAME", (scores.get("FULL_NAME") || 0) + 3);
      }
    }
  }

  // High cardinality + numeric IDs → IDENTIFIER
  if (/\b(id|code|no|num)\b/.test(n) && unique.size / nonEmpty.length > 0.9) {
    scores.set("IDENTIFIER", (scores.get("IDENTIFIER") || 0) + 3);
  }

  return scores;
}

// ── Main Semantic Detection ─────────────────────────

export interface SemanticDetection {
  type: SemanticType;
  confidence: number; // 0–100
  scores: Record<string, number>;
  signals: string[];
  understanding: string;
  validationRules: {
    allowedPattern: string;
    constraints: string[];
    disallowedExamples: string[];
  };
  normalizationPlan: {
    targetDatatype: string;
    steps: string[];
    unitHandling: string;
  };
}

/**
 * Detect the semantic type of a column using multi-signal analysis.
 * Combines header analysis, value tokens, range intelligence, and structure analysis.
 * Returns confidence score and full detection metadata.
 */
export function detectSemanticType(
  columnName: string,
  values: string[]
): SemanticDetection {
  const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
  const signals: string[] = [];

  // ── Collect scores from all 4 signal sources ──
  const headerScores = analyzeHeader(columnName);
  const tokenScores = analyzeValueTokens(nonEmpty);
  const rangeScores = analyzeRange(nonEmpty);
  const structureScores = analyzeStructure(columnName, nonEmpty);

  // ── Aggregate scores ──
  const aggregated = new Map<string, number>();

  for (const [key, score] of headerScores) {
    aggregated.set(key, (aggregated.get(key) || 0) + score);
    if (score >= 3) signals.push(`header: ${key.toLowerCase()}`);
  }
  for (const [key, score] of tokenScores) {
    aggregated.set(key, (aggregated.get(key) || 0) + score * 0.7); // tokens weighted lower
  }
  for (const [key, score] of rangeScores) {
    aggregated.set(key, (aggregated.get(key) || 0) + score);
  }
  for (const [key, score] of structureScores) {
    aggregated.set(key, (aggregated.get(key) || 0) + score);
  }

  // ── Pick highest scoring type ──
  let bestType: SemanticType = "UNKNOWN";
  let bestScore = 0;

  for (const [type, score] of aggregated) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type as SemanticType;
    }
  }

  // If NAME types scored high, promote FULL_NAME over FIRST/LAST when both present
  if (bestType === "FIRST_NAME" && aggregated.get("LAST_NAME")) {
    bestType = "FULL_NAME";
    bestScore = (aggregated.get("FIRST_NAME") || 0) + (aggregated.get("LAST_NAME") || 0);
  }

  // Minimum threshold — if score too low, fallback
  if (bestScore < 2) {
    // Try generic numeric/text classification
    const numericPct = nonEmpty.filter((v) => /^-?[\d,.]+$/.test(v.trim()) || typeof v === "number").length / Math.max(nonEmpty.length, 1);
    if (numericPct >= 0.6) {
      bestType = "UNKNOWN"; // will be refined by cleaning engine
      signals.push(`numeric_pattern: ${Math.round(numericPct * 100)}% numeric`);
    } else {
      bestType = cardinalityCheck(nonEmpty) ? "CATEGORICAL" : "TEXT";
      signals.push(bestType === "CATEGORICAL" ? "structure: low cardinality" : "fallback: generic text");
    }
  }

  // ── Calculate confidence (normalize to 0–100) ──
  // Max possible score ≈ 12 (header 4 + tokens ~3 + range 3 + structure 2)
  const maxPossible = 12;
  const confidence = Math.min(100, Math.round((bestScore / maxPossible) * 100));

  // ── Build validation + normalization based on type ──
  const profile = buildTypeProfile(bestType, columnName, nonEmpty);

  const scoresRecord: Record<string, number> = {};
  for (const [k, v] of aggregated) scoresRecord[k] = Math.round(v * 100) / 100;

  return {
    type: bestType,
    confidence,
    scores: scoresRecord,
    signals,
    understanding: profile.understanding,
    validationRules: profile.validationRules,
    normalizationPlan: profile.normalizationPlan,
  };
}

// ── Type Profiles ───────────────────────────────────
// Each semantic type has: understanding, validation rules, normalization plan

interface TypeProfile {
  understanding: string;
  validationRules: {
    allowedPattern: string;
    constraints: string[];
    disallowedExamples: string[];
  };
  normalizationPlan: {
    targetDatatype: string;
    steps: string[];
    unitHandling: string;
  };
}

function buildTypeProfile(type: SemanticType, columnName: string, values: string[]): TypeProfile {
  const profiles: Record<string, TypeProfile> = {
    FULL_NAME: {
      understanding: `Represents a person's full name in column "${columnName}"`,
      validationRules: {
        allowedPattern: "alphabets, spaces, hyphens, periods only",
        constraints: ["no numbers", "no special characters (!@#$%)", "no emojis", "2-5 name parts"],
        disallowedExamples: detectDisallowedNameExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["remove numbers", "remove special characters", "trim whitespace", "title case"],
        unitHandling: "none",
      },
    },
    FIRST_NAME: {
      understanding: `Represents a person's first/given name in column "${columnName}"`,
      validationRules: {
        allowedPattern: "alphabets only, single word",
        constraints: ["no numbers", "no spaces (typically)", "no special characters"],
        disallowedExamples: detectDisallowedNameExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["remove numbers", "remove special characters", "trim", "title case"],
        unitHandling: "none",
      },
    },
    USERNAME: {
      understanding: `Represents a username/handle in column "${columnName}"`,
      validationRules: {
        allowedPattern: "ANY characters allowed (letters, numbers, special chars, symbols)",
        constraints: ["no validation — usernames can contain anything"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim whitespace only", "keep all characters as-is"],
        unitHandling: "none",
      },
    },
    LAST_NAME: {
      understanding: `Represents a person's last/family name in column "${columnName}"`,
      validationRules: {
        allowedPattern: "alphabets only, single word",
        constraints: ["no numbers", "no special characters"],
        disallowedExamples: detectDisallowedNameExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["remove numbers", "remove special characters", "trim", "title case"],
        unitHandling: "none",
      },
    },
    MONEY: {
      understanding: `Represents monetary/compensation value in column "${columnName}"`,
      validationRules: {
        allowedPattern: "numeric with optional K/M/B/Cr/L multipliers and currency symbols",
        constraints: ["no random text", "no negative values", "must be parseable as number"],
        disallowedExamples: detectDisallowedNumericExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "FLOAT",
        steps: ["remove currency symbols", "remove noise tokens", "detect multiplier", "extract numeric", "multiply"],
        unitHandling: "K=×1000, M=×1M, B=×1B, Cr=×10M, L=×100K, LPA=×100K",
      },
    },
    RATING: {
      understanding: `Represents a rating or score in column "${columnName}"`,
      validationRules: {
        allowedPattern: "numeric 0–10, optionally with decimals or ★",
        constraints: ["range: 0–10", "no random text", "word numbers allowed (four → 4)"],
        disallowedExamples: detectDisallowedNumericExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "FLOAT",
        steps: ["strip ★ symbols", "parse fraction notation (5/5 → 5)", "convert word numbers", "extract float"],
        unitHandling: "none",
      },
    },
    AGE: {
      understanding: `Represents a person's age in column "${columnName}"`,
      validationRules: {
        allowedPattern: "integer, range 0–120",
        constraints: ["no decimals", "no negative", "range: 0–120", "no text"],
        disallowedExamples: detectDisallowedNumericExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "INTEGER",
        steps: ["extract integer", "validate range 0–120", "flag out-of-range"],
        unitHandling: "none",
      },
    },
    EXPERIENCE: {
      understanding: `Represents work experience duration in column "${columnName}"`,
      validationRules: {
        allowedPattern: "numeric with optional yrs/years suffix",
        constraints: ["no negative", "range: 0–50", "word numbers allowed"],
        disallowedExamples: detectDisallowedNumericExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "FLOAT",
        steps: ["strip yrs/years suffix", "convert word numbers", "extract number", "validate range"],
        unitHandling: "strip 'yrs', 'years', 'yr' suffixes",
      },
    },
    DATE: {
      understanding: `Represents a date value in column "${columnName}"`,
      validationRules: {
        allowedPattern: "ISO date (YYYY-MM-DD) or common formats",
        constraints: ["must be parseable", "no random text", "no future dates for birth dates"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING (ISO)",
        steps: ["detect format", "parse to Date", "convert to YYYY-MM-DD", "flag ambiguous (DD/MM vs MM/DD)"],
        unitHandling: "none",
      },
    },
    EMAIL: {
      understanding: `Represents an email address in column "${columnName}"`,
      validationRules: {
        allowedPattern: "standard email format: local@domain.tld",
        constraints: ["must contain @", "must contain domain", "no spaces"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "lowercase", "validate format"],
        unitHandling: "none",
      },
    },
    PHONE: {
      understanding: `Represents a phone number in column "${columnName}"`,
      validationRules: {
        allowedPattern: "digits, spaces, hyphens, parentheses, optional + prefix",
        constraints: ["7-15 digits", "no letters", "no special chars beyond +-()"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["strip non-digit except +", "validate digit count", "standardize format"],
        unitHandling: "none",
      },
    },
    LOCATION: {
      understanding: `Represents a geographic location in column "${columnName}"`,
      validationRules: {
        allowedPattern: "text, may contain commas for city, state",
        constraints: ["no numbers (except pin codes)", "no emojis"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "title case", "standardize separators"],
        unitHandling: "none",
      },
    },
    CATEGORICAL: {
      understanding: `Represents a categorical value (limited set of options) in column "${columnName}"`,
      validationRules: {
        allowedPattern: "consistent text values from a finite set",
        constraints: ["case-consistent", "no emojis in values", "no null-like strings in valid set"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "standardize case", "fix spelling via similarity clustering", "map canonical forms"],
        unitHandling: "none",
      },
    },
    BOOLEAN: {
      understanding: `Represents a boolean (true/false) value in column "${columnName}"`,
      validationRules: {
        allowedPattern: "true/false, yes/no, 1/0, Y/N, active/inactive",
        constraints: ["exactly 2 distinct values", "no other values"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "BOOLEAN",
        steps: ["map yes/no/true/false/1/0/Y/N to boolean", "standardize"],
        unitHandling: "none",
      },
    },
    PERCENTAGE: {
      understanding: `Represents a percentage value in column "${columnName}"`,
      validationRules: {
        allowedPattern: "numeric 0–100, optionally with %",
        constraints: ["no negative", "no values > 100"],
        disallowedExamples: detectDisallowedNumericExamples(values),
      },
      normalizationPlan: {
        targetDatatype: "FLOAT",
        steps: ["strip % symbol", "extract numeric", "validate range 0–100", "flag > 100"],
        unitHandling: "strip % suffix",
      },
    },
    IDENTIFIER: {
      understanding: `Represents a unique identifier in column "${columnName}"`,
      validationRules: {
        allowedPattern: "unique alphanumeric code or number",
        constraints: ["must be unique per row", "no nulls allowed"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "validate uniqueness", "flag duplicates"],
        unitHandling: "none",
      },
    },
    TEXT: {
      understanding: `Represents free-form text in column "${columnName}"`,
      validationRules: {
        allowedPattern: "any text content",
        constraints: ["no emojis", "no garbage tokens"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "remove emojis", "flag garbage tokens"],
        unitHandling: "none",
      },
    },
    REGION: {
      understanding: `Represents a geographic region or business area in column "${columnName}"`,
      validationRules: {
        allowedPattern: "region name or abbreviation (e.g., APAC, EMEA, North America, South Asia)",
        constraints: ["no numbers", "no emojis"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "title case", "expand abbreviations (NA → North America)"],
        unitHandling: "none",
      },
    },
    COUNTRY: {
      understanding: `Represents a country name in column "${columnName}"`,
      validationRules: {
        allowedPattern: "full country name (e.g., India, United States, Germany)",
        constraints: ["no numbers", "no ISO codes — use COUNTRY_CODE type for that"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "title case", "standardize country names"],
        unitHandling: "none",
      },
    },
    COUNTRY_CODE: {
      understanding: `Represents ISO 3166-1 alpha-2 country code in column "${columnName}"`,
      validationRules: {
        allowedPattern: "exactly 2 uppercase letters (e.g., IN, US, DE, BR, UK)",
        constraints: ["MUST be exactly 2 letters", "no numbers", "no spaces", "no special characters"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING (ISO 3166-1 alpha-2)",
        steps: ["trim", "uppercase", "validate 2-letter ISO code", "flag non-ISO values RED"],
        unitHandling: "none",
      },
    },
    FEEDBACK: {
      understanding: `Represents user feedback, review, or survey response in column "${columnName}"`,
      validationRules: {
        allowedPattern: "free text, may include sentiment-appropriate emojis (👍❤️⭐🔥🎉 etc.)",
        constraints: ["sentiment-appropriate emojis allowed", "flag non-feedback emojis RED"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "keep sentiment-appropriate emojis", "flag non-feedback emojis RED"],
        unitHandling: "none",
      },
    },
    DEPARTMENT: {
      understanding: `Represents a department or team in column "${columnName}"`,
      validationRules: {
        allowedPattern: "department/team name (e.g., Engineering, Sales, HR, Marketing)",
        constraints: ["no numbers", "no emojis"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "title case", "standardize abbreviations"],
        unitHandling: "none",
      },
    },
    FIELD: {
      understanding: `Represents a field of study, domain, or industry in column "${columnName}"`,
      validationRules: {
        allowedPattern: "field/domain name (e.g., Computer Science, Finance, Engineering)",
        constraints: ["no numbers", "no emojis"],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "STRING",
        steps: ["trim", "title case", "standardize abbreviations"],
        unitHandling: "none",
      },
    },
    UNKNOWN: {
      understanding: `Column "${columnName}" — semantic meaning unclear, needs more analysis`,
      validationRules: {
        allowedPattern: "auto-detected from data patterns",
        constraints: [],
        disallowedExamples: [],
      },
      normalizationPlan: {
        targetDatatype: "auto-detected",
        steps: ["detect from value patterns"],
        unitHandling: "none",
      },
    },
  };

  return profiles[type] || profiles.UNKNOWN;
}

// ── Helper: detect disallowed name examples ──
function detectDisallowedNameExamples(values: string[]): string[] {
  const examples: string[] = [];
  for (const v of values.slice(0, 20)) {
    const t = String(v).trim();
    if (/\d/.test(t)) { examples.push(t); if (examples.length >= 2) break; }
    if (/[!@#$%^&*()_+=\[\]{};:'"<>?/\\|`~]/.test(t)) { examples.push(t); if (examples.length >= 2) break; }
  }
  return examples;
}

// ── Helper: detect disallowed numeric examples ──
function detectDisallowedNumericExamples(values: string[]): string[] {
  const examples: string[] = [];
  for (const v of values.slice(0, 20)) {
    const t = String(v).trim();
    if (!t) continue;
    // Contains text that isn't a known word number
    if (/[a-zA-Z]{3,}/.test(t) && !/^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred)$/i.test(t)) {
      examples.push(t);
      if (examples.length >= 2) break;
    }
  }
  return examples;
}

// ── Helper: cardinality check for CATEGORICAL ──
function cardinalityCheck(nonEmpty: string[]): boolean {
  if (nonEmpty.length < 5) return false;
  const unique = new Set(nonEmpty.map((v) => v.trim().toLowerCase()));
  return unique.size <= 20 && unique.size / nonEmpty.length < 0.5;
}

// ── Batch Analysis (all columns at once) ────────────

export interface ColumnSemanticReport {
  columnName: string;
  semanticType: SemanticType;
  confidence: number;
  signals: string[];
  understanding: string;
  validationRules: {
    allowedPattern: string;
    constraints: string[];
    disallowedExamples: string[];
  };
  normalizationPlan: {
    targetDatatype: string;
    steps: string[];
    unitHandling: string;
  };
  scores: Record<string, number>;
}

/**
 * Analyze ALL columns in a dataset and return semantic reports.
 * This is the main entry point for the cleaning engine.
 */
export function analyzeAllColumns(
  columns: { name: string }[],
  data: Record<string, unknown>[]
): ColumnSemanticReport[] {
  return columns.map((col) => {
    const values = data
      .map((r) => r[col.name])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v));

    const detection = detectSemanticType(col.name, values);

    return {
      columnName: col.name,
      semanticType: detection.type,
      confidence: detection.confidence,
      signals: detection.signals,
      understanding: detection.understanding,
      validationRules: detection.validationRules,
      normalizationPlan: detection.normalizationPlan,
      scores: detection.scores,
    };
  });
}
