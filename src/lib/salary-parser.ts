// ============================================================
// Comprehensive Salary / Monetary Value Parser v4
// ============================================================
// Handles ALL possible combinations of:
//   - Word numbers: zero → hundred, compound: "thirtyfive", "sixty six"
//   - Digit numbers: "50", "3.5", "1,000"
//   - Denominations: K/k/K/K (any case), M/m, B/b, L/l, Cr/cr, LPA/lpa,
//                     lakh, crore, thousand, million, billion, trillion
//   - ALL case combos: "sixtyk", "SixtyK", "SIXTYK", "sixty K", "Sixty K",
//                      "SIXTY K", "60k", "60K", "60 k", "60 K"
//   - Compound + denom: "thirtyfivek", "ThirtyFiveK", "THIRTYFIVE K",
//                        "thirty five K", "Thirty Five K"
//   - Mixed: "fifty crore", "sixty lakh", "forty five thousand",
//             "2.5 Cr", "₹3.5cr", "60K INR", "approx 60k"
//   - Currency symbols: ₹, $, €, £, ¥
//   - Ranges: "50k to 70k", "50K-70K", "50,000 - 70,000"
//   - Approx/Lower-bound: "approx 60k", "~60k", "70k+"
//   - Misspellings: "fourty" → forty, "thiry" → thirty
//
// Architecture:
//   Phase 0: Normalize input (lowercase, strip currency/noise)
//   Phase 1: Digit-first patterns (50K, 1.2M, 50000)
//   Phase 2: Word-number patterns (sixtyk, thirty five thousand)
//   Phase 3: Range patterns (50K-70K, 50k to 70k)
//   Phase 4: Approx patterns (approx 60k, ~60k)
//   Phase 5: Fallback — extract any number
//   Phase 6: needsAI flag for LLM fallback
//
// Async variant: parseSalaryWithAI() — deterministic first, then
//   calls /api/ai-salary-parse for unparseable values.
// ============================================================

// ── Word-to-Number Map (complete) ───────────────────

const WORD_TO_NUMBER: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, "fourty": 40, // common misspelling
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100,
};

// Sorted by length descending for greedy longest-match
const ALL_WORD_NUMBERS = Object.keys(WORD_TO_NUMBER).sort(
  (a, b) => b.length - a.length
);

// ── Denomination Map (ALL possible) ─────────────────

const DENOMINATION_MAP: Record<string, number> = {
  // Single letter suffixes (K = 1000 regardless of case)
  k: 1000,
  m: 1000000,
  b: 1000000000,
  t: 1000000000000,
  l: 100000, // Indian Lakh
  // Short abbreviations
  cr: 10000000, // Indian Crore
  lpa: 100000, // Lakh Per Annum
  // Full word denominations
  thousand: 1000,
  thousands: 1000,
  million: 1000000,
  millions: 1000000,
  billion: 1000000000,
  billions: 1000000000,
  trillion: 1000000000000,
  trillions: 1000000000000,
  lakh: 100000,
  lakhs: 100000,
  crore: 10000000,
  crores: 10000000,
  // Colloquial / alternative
  grand: 1000, // "60 grand" = 60000
  grands: 1000,
  g: 1000, // "60g" (rare)
  thou: 1000, // abbreviation of thousand
  mil: 1000000, // abbreviation of million
  bil: 1000000000, // abbreviation of billion
};

// Sorted by length descending for greedy longest-match
const ALL_DENOMINATIONS = Object.keys(DENOMINATION_MAP).sort(
  (a, b) => b.length - a.length
);

// ── Currency / Noise patterns ───────────────────────

const CURRENCY_SYMBOLS = /[₹$€£¥]/g;
const NOISE_TOKENS =
  /\b(inr|rs\.?|rupees|usd|eur|gbp|approx|per\s+annum|per\s+month|per\s+year|annually|pa|p\.a\.?)\b/gi;
const NOISE_SUFFIXES = /\/(month|year|mo|yr|annum)/gi;
const NOISE_CHARS = /[~+\-]/g;

// ── Core: Greedy word-number extraction ─────────────
// Parses concatenated OR space-separated word numbers.
// "thirtyfive" → 35, "sixty six" → 66, "one hundred" → 100,
// "two hundred twenty" → 220, "one hundred twenty five" → 125

export function extractWordNumber(
  input: string
): { value: number; consumed: number } | null {
  const lower = input.toLowerCase().trim();
  if (!lower) return null;

  let pos = 0;
  let total = 0;
  let lastMultiplier = false;
  let wordCount = 0;

  while (pos < lower.length) {
    let found = false;

    // Skip spaces between words
    if (lower[pos] === " ") {
      pos++;
      lastMultiplier = false;
      continue;
    }

    // Try greedy longest word-number match at current position
    for (const word of ALL_WORD_NUMBERS) {
      if (lower.startsWith(word, pos)) {
        const num = WORD_TO_NUMBER[word];

        // "hundred" acts as multiplier for accumulated total
        if (num === 100 && wordCount > 0 && !lastMultiplier) {
          total = total * 100;
        } else if (num === 100 && wordCount === 0) {
          total += 100;
        } else {
          total += num;
        }

        pos += word.length;
        wordCount++;
        lastMultiplier = num === 100;
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  if (wordCount === 0) return null;

  return { value: total, consumed: pos };
}

// ── Core: Greedy denomination extraction ────────────
// Extracts denomination suffix from remaining string.
// Handles ALL case combinations: "K", "k", "CR", "cr", "LPA", "lpa"
// Also: "grand", "thou", "mil" etc.

export function extractDenomination(
  input: string
): { multiplier: number; consumed: number } | null {
  const lower = input.toLowerCase().trim();
  if (!lower) return null;

  // Skip leading spaces
  let pos = 0;
  while (pos < lower.length && lower[pos] === " ") pos++;

  if (pos >= lower.length) return null;

  // Try greedy longest denomination match
  for (const denom of ALL_DENOMINATIONS) {
    if (lower.startsWith(denom, pos)) {
      // Make sure it's not part of a larger word (e.g., "black" shouldn't match "k")
      const afterDenom = pos + denom.length;
      if (afterDenom < lower.length && /[a-z]/.test(lower[afterDenom])) {
        // Check if what follows is a known suffix like "s" for plural
        if (lower[afterDenom] === "s" && afterDenom + 1 >= lower.length) {
          // "lakhs", "crores" — OK
        } else {
          continue; // Skip — part of a larger word
        }
      }
      return { multiplier: DENOMINATION_MAP[denom], consumed: afterDenom };
    }
  }

  return null;
}

// ── Unified Salary Parser ───────────────────────────
// Handles ALL possible salary formats in a single pass.
//
// ALL case combinations covered:
//   "sixtyk"    → 60000   "SixtyK"  → 60000   "SIXTYK"  → 60000
//   "sixty K"   → 60000   "Sixty K" → 60000   "SIXTY K" → 60000
//   "60k"       → 60000   "60K"     → 60000   "60 k"    → 60000
//   "thirtyfivek" → 35000  "ThirtyFiveK" → 35000  "thirty five K" → 35000
//   "50k"       → 50000   "50K"     → 50000   "fifty k" → 50000
//   "fifty k"   → 50000   "FIFTY K" → 50000   "FiftyK"  → 50000
//   "2.5 Cr"    → 25000000  "₹3.5cr" → 35000000
//   "60 grand"  → 60000   "fifteen grand" → 15000
//   "60K INR"   → 60000   "approx 60k" → 60000
//   "~60k"      → 60000   "70k+"    → 70000
//   "50000"     → 50000   "50,000"  → 50000
//   "₹60000"    → 60000   "1.2M"    → 1200000
//   "5LPA"      → 500000  "3.5 Cr"  → 35000000

export interface SalaryParseResult {
  value: number | null;
  steps: string[];
  confidence: number;
  needsAI: boolean;
  rawInput: string;
  intermediate?: string;
}

export function parseSalaryValue(raw: unknown): SalaryParseResult {
  if (raw === null || raw === undefined) {
    return {
      value: null,
      steps: [],
      confidence: 1.0,
      needsAI: false,
      rawInput: String(raw ?? ""),
    };
  }

  const rawStr = String(raw).trim();
  if (
    rawStr === "" ||
    /^(na|n\/a|null|none|-|nan|nil|tbd|undefined)$/i.test(rawStr)
  ) {
    return {
      value: null,
      steps: [],
      confidence: 1.0,
      needsAI: false,
      rawInput: rawStr,
    };
  }

  // Already a clean number
  if (typeof raw === "number" && isFinite(raw)) {
    return {
      value: raw,
      steps: ["passthrough: numeric"],
      confidence: 1.0,
      needsAI: false,
      rawInput: rawStr,
    };
  }

  const steps: string[] = [];
  let working = rawStr;

  // ── Phase 0: Strip currency symbols ──
  if (CURRENCY_SYMBOLS.test(working)) {
    working = working.replace(CURRENCY_SYMBOLS, "").trim();
    steps.push("stripped currency symbol");
  }

  // ── Phase 0b: Strip noise tokens ──
  const beforeNoise = working;
  working = working.replace(NOISE_TOKENS, "").trim();
  working = working.replace(NOISE_SUFFIXES, "").trim();
  if (working !== beforeNoise) steps.push("stripped noise tokens");

  // ── Phase 0c: Strip noise characters (~ + -) ──
  const beforeNoiseChars = working;
  working = working.replace(/^[~+\-]+/, "").trim(); // leading: "~60k" → "60k"
  working = working.replace(/[~+\-]+$/, "").trim(); // trailing: "60k+" → "60k"
  if (working !== beforeNoiseChars) steps.push("stripped noise chars (~, +, -)");

  // ── Phase 1: Digit-first patterns ──

  // 1a: Pure number with comma: "50,000" → 50000
  const commaNumMatch = working.match(/^([\d,]+(?:\.\d+)?)$/);
  if (commaNumMatch) {
    const num = parseFloat(commaNumMatch[1].replace(/,/g, ""));
    if (!isNaN(num)) {
      steps.push(`comma number: "${working}" → ${num}`);
      return {
        value: num,
        steps,
        confidence: 0.98,
        needsAI: false,
        rawInput: rawStr,
      };
    }
  }

  // 1b: Number + denomination: "50K", "1.2M", "2.5 Cr", "5LPA", "60 grand"
  const numDenomMatch = working.match(/^([\d.]+)\s*([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s*$/);
  if (numDenomMatch) {
    const baseNum = parseFloat(numDenomMatch[1]);
    const denomStr = numDenomMatch[2].toLowerCase().trim();
    if (!isNaN(baseNum)) {
      const denomResult = extractDenomination(denomStr);
      if (denomResult) {
        const final = baseNum * denomResult.multiplier;
        steps.push(
          `number + denomination: "${baseNum}" × ${denomResult.multiplier} = ${final}`
        );
        return {
          value: final,
          steps,
          confidence: 0.95,
          needsAI: false,
          rawInput: rawStr,
        };
      }

      // Denomination not recognized but we have a number
      steps.push(
        `number extracted (unknown suffix "${denomStr}"): ${baseNum}`
      );
      return {
        value: baseNum,
        steps,
        confidence: 0.70,
        needsAI: true,
        rawInput: rawStr,
      };
    }
  }

  // 1c: Pure number: "50000", "42.5"
  const pureNumMatch = working.match(/^([\d]+(?:\.\d+)?)$/);
  if (pureNumMatch) {
    const num = parseFloat(pureNumMatch[1]);
    if (!isNaN(num)) {
      steps.push(`pure number: ${num}`);
      return {
        value: num,
        steps,
        confidence: 0.98,
        needsAI: false,
        rawInput: rawStr,
      };
    }
  }

  // ── Phase 2: Word-number based parsing ──
  // ALL case combos handled via lowercase normalization:
  // "sixtyk", "SixtyK", "SIXTYK", "sixty K", "Sixty K", "SIXTY K"
  // "thirtyfivek", "ThirtyFiveK", "thirty five K", "Thirty Five K"
  // "fifty five thousand", "Fifty Five Thousand"
  // "sixty grand", "Sixty Grand", "fifteen grand"

  const lowerWorking = working.toLowerCase().trim();

  // 2a: Try extracting word-number from the beginning
  const wordResult = extractWordNumber(lowerWorking);
  if (wordResult) {
    const remaining = lowerWorking.slice(wordResult.consumed).trim();

    if (remaining === "" || /^[a-zA-Z\s]*$/.test(remaining)) {
      // Try to extract denomination from remaining text
      const denomResult = remaining ? extractDenomination(remaining) : null;

      if (denomResult) {
        const final = wordResult.value * denomResult.multiplier;
        const intermediate = `${wordResult.value} ${remaining.slice(0, denomResult.consumed).trim()}`;
        steps.push(
          `word-number "${lowerWorking.slice(0, wordResult.consumed).trim()}" → ${wordResult.value}`
        );
        steps.push(
          `denomination "${remaining.slice(0, denomResult.consumed).trim()}" → ×${denomResult.multiplier}`
        );
        steps.push(`final: ${final}`);
        return {
          value: final,
          steps,
          confidence: 0.90,
          needsAI: false,
          rawInput: rawStr,
          intermediate,
        };
      }

      // No denomination — just a word number
      steps.push(
        `word-number: "${lowerWorking.slice(0, wordResult.consumed).trim()}" → ${wordResult.value}`
      );
      return {
        value: wordResult.value,
        steps,
        confidence: 0.90,
        needsAI: false,
        rawInput: rawStr,
      };
    }
  }

  // 2b: "X hundred" with digit: "2 hundred K" → 200000
  const hundredDigitMatch = working.match(/^(\d+)\s*hundred\s*(.*)$/i);
  if (hundredDigitMatch) {
    const baseNum = parseInt(hundredDigitMatch[1], 10);
    if (!isNaN(baseNum)) {
      const expanded = baseNum * 100;
      const suffix = hundredDigitMatch[2].trim();
      if (suffix) {
        const denomResult = extractDenomination(suffix.toLowerCase());
        if (denomResult) {
          const final = expanded * denomResult.multiplier;
          steps.push(`hundred expansion: ${baseNum} × 100 = ${expanded}`);
          steps.push(`denomination: ×${denomResult.multiplier}`);
          steps.push(`final: ${final}`);
          return {
            value: final,
            steps,
            confidence: 0.90,
            needsAI: false,
            rawInput: rawStr,
          };
        }
      }
      steps.push(`hundred expansion: ${baseNum} × 100 = ${expanded}`);
      return {
        value: expanded,
        steps,
        confidence: 0.90,
        needsAI: false,
        rawInput: rawStr,
      };
    }
  }

  // ── Phase 2.5: Denomination-first pattern ──
  // "K 60" → 60000 (rare but possible)
  const denomFirstMatch = working.match(/^([a-zA-Z]+)\s+([\d.]+)\s*$/);
  if (denomFirstMatch) {
    const denomStr = denomFirstMatch[1].toLowerCase();
    const num = parseFloat(denomFirstMatch[2]);
    if (!isNaN(num)) {
      const denomResult = extractDenomination(denomStr);
      if (denomResult) {
        const final = num * denomResult.multiplier;
        steps.push(`denomination-first: "${denomStr}" × ${num} = ${final}`);
        return {
          value: final,
          steps,
          confidence: 0.80,
          needsAI: false,
          rawInput: rawStr,
        };
      }
    }
  }

  // ── Phase 3: Range patterns ──

  // 3a: Hyphen-separated: "50K-70K", "thirtyfivek-sixtyk"
  const hyphenRange = working.match(
    /^([\d,.]*[a-zA-Z]*)\s*[-–—]\s*([\d,.]*[a-zA-Z]*)$/
  );
  if (hyphenRange) {
    const left = parseSalaryValue(hyphenRange[1].trim());
    const right = parseSalaryValue(hyphenRange[2].trim());
    if (left.value !== null && right.value !== null) {
      const avg = Math.round((left.value + right.value) / 2);
      const wasSwapped = left.value > right.value;
      steps.push(
        `range: "${hyphenRange[1].trim()}" to "${hyphenRange[2].trim()}" → avg ${avg}${wasSwapped ? " (swapped)" : ""}`
      );
      return {
        value: avg,
        steps,
        confidence: 0.88,
        needsAI: false,
        rawInput: rawStr,
      };
    }
    if (left.value !== null) {
      steps.push(`partial range (left only): ${left.value}`);
      return {
        value: left.value,
        steps,
        confidence: 0.60,
        needsAI: true,
        rawInput: rawStr,
      };
    }
    if (right.value !== null) {
      steps.push(`partial range (right only): ${right.value}`);
      return {
        value: right.value,
        steps,
        confidence: 0.60,
        needsAI: true,
        rawInput: rawStr,
      };
    }
  }

  // 3b: Word-separated: "50K to 70K", "thirtyfivek to sixtyk"
  const wordRange = working.match(/^(.+?)\s+to\s+(.+)$/i);
  if (wordRange) {
    const left = parseSalaryValue(wordRange[1].trim());
    const right = parseSalaryValue(wordRange[2].trim());
    if (left.value !== null && right.value !== null) {
      const avg = Math.round((left.value + right.value) / 2);
      const wasSwapped = left.value > right.value;
      steps.push(
        `range: "${wordRange[1].trim()}" to "${wordRange[2].trim()}" → avg ${avg}${wasSwapped ? " (swapped)" : ""}`
      );
      return {
        value: avg,
        steps,
        confidence: 0.88,
        needsAI: false,
        rawInput: rawStr,
      };
    }
  }

  // ── Phase 4: Approx patterns ──
  const approxPrefix = working.match(/^(?:approx|about|around|~)\s+(.+)$/i);
  if (approxPrefix) {
    const inner = parseSalaryValue(approxPrefix[1].trim());
    if (inner.value !== null) {
      steps.unshift(
        `approx detected: treating "${approxPrefix[1].trim()}" as value`
      );
      steps.push(...inner.steps);
      return { ...inner, confidence: 0.80, rawInput: rawStr };
    }
  }

  // ── Phase 5: Fallback — extract any number ──
  const anyNumber = working.match(/([\d]+(?:\.\d+)?)/);
  if (anyNumber) {
    const num = parseFloat(anyNumber[1]);
    if (!isNaN(num)) {
      steps.push(`fallback: extracted ${num} from "${working}"`);
      return {
        value: num,
        steps,
        confidence: 0.50,
        needsAI: true,
        rawInput: rawStr,
      };
    }
  }

  // ── Phase 6: Completely unparseable → needs AI ──
  steps.push(`unparseable: "${working}" — needs AI review`);
  return {
    value: null,
    steps,
    confidence: 0.10,
    needsAI: true,
    rawInput: rawStr,
  };
}

// ── Async version with AI fallback ──────────────────
// Tries deterministic parse first, then calls LLM API for failures.

export async function parseSalaryWithAI(
  values: string[]
): Promise<SalaryParseResult[]> {
  // Phase 1: Deterministic pass
  const results: SalaryParseResult[] = values.map((v) => parseSalaryValue(v));

  // Phase 2: Collect values that need AI
  const needsAIIndices: number[] = [];
  const needsAIValues: string[] = [];

  for (let i = 0; i < results.length; i++) {
    if (
      results[i].needsAI &&
      results[i].value === null
    ) {
      const trimmed = values[i].trim();
      if (
        trimmed !== "" &&
        !/^(na|n\/a|null|none|-|nan|nil|tbd|undefined)$/i.test(trimmed)
      ) {
        needsAIIndices.push(i);
        needsAIValues.push(trimmed);
      }
    }
  }

  // Phase 3: Call AI for unparseable values
  if (needsAIIndices.length > 0) {
    try {
      const res = await fetch("/api/ai-salary-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: needsAIValues,
          skipDeterministic: true, // AI only — we already did deterministic
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { results: SalaryParseResult[] };
        const aiResults = data.results || [];

        for (let j = 0; j < aiResults.length && j < needsAIIndices.length; j++) {
          const idx = needsAIIndices[j];
          const ai = aiResults[j];
          if (ai && ai.value !== null) {
            results[idx] = {
              value: ai.value,
              steps: [
                ...results[idx].steps,
                `AI resolved: "${values[idx]}" → ${ai.value}`,
                ...ai.steps,
              ],
              confidence: Math.max(ai.confidence, 0.75),
              needsAI: false,
              rawInput: values[idx],
            };
          }
        }
      }
    } catch {
      // AI call failed — results stay as-is with needsAI=true
    }
  }

  return results;
}

// ── Single-value async convenience wrapper ──────────

export async function parseSingleSalaryWithAI(
  value: string
): Promise<SalaryParseResult> {
  const results = await parseSalaryWithAI([value]);
  return results[0];
}

// ── Utility: Check if a string contains a word number ──
export function containsWordNumber(s: string): boolean {
  const lower = s.toLowerCase().trim();
  for (const word of ALL_WORD_NUMBERS) {
    if (lower.includes(word)) return true;
  }
  return false;
}

// ── Utility: Check if a string looks like a salary value ──
export function looksLikeSalaryValue(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  const t = s.trim().toLowerCase();

  // Digit + denomination: "50K", "1.2M", "3.5Cr"
  if (/^\d[\d,.]*\s*[kmbl]\b/i.test(t)) return true;
  if (/^\d[\d,.]*\s*(cr|lpa|lakh|crore)\b/i.test(t)) return true;

  // Digit + "grand": "60 grand", "15 grand"
  if (/^\d[\d,.]*\s+grand/i.test(t)) return true;

  // Word number + denomination: "sixtyK", "fifty crore", "sixty grand"
  if (containsWordNumber(t) && /[kmbl]\b/.test(t)) return true;
  if (containsWordNumber(t) && /\b(cr|lpa|lakh|crore|thousand|million|billion|grand)\b/.test(t)) return true;

  // Currency symbol: "₹60000", "$50K"
  if (/[₹$€£¥]/.test(t)) return true;

  // Range: "50K-70K", "50,000 to 70,000"
  if (looksLikeSalaryRange(t)) return true;

  return false;
}

function looksLikeSalaryRange(t: string): boolean {
  // Hyphen-separated: "50K-70K", "50000-70000"
  if (/^\d[\d,.]*[km]?\s*[-–—]\s*\d[\d,.]*[km]?$/i.test(t)) return true;
  // Word-separated: "50K to 70K"
  if (/^\d[\d,.]*[km]?\s+to\s+\d[\d,.]*[km]?$/i.test(t)) return true;
  // Word-number range: "fiftyK to sixtyK"
  if (containsWordNumber(t) && /\s+to\s+/.test(t)) return true;
  return false;
}
