// ============================================================
// Range Parser & Cleaning Plan Executor
// ============================================================
// Salary_Range Cleaning Rule (Final Spec):
//   Parse range values and compute average for numeric analysis.
//   Supports: "50000-70000", "50K-70K", "0.5M-0.7M",
//   "50,000 - 70,000", single values, null/invalid/NA
//   Output: single float value or null

import { applyNumericNormalization, normalizeWithFlags, type CellFlag } from "./numeric-normalizer";
import type { RawDataRow } from "./dashboard-types";

const SUFFIX_MULTIPLIERS: Record<string, number> = {
  k: 1000,
  m: 1000000,
};

// ── Range Value Parser ──────────────────────────────

interface ParseResult {
  value: number | null;
  wasRange: boolean;
  wasSwapped: boolean;
  isValid: boolean;
}

/**
 * Step 1: Normalize string — remove commas, standardize separators
 * NOTE: Keeps spaces around "to" separator for detection
 */
function normalizeRangeStr(raw: string): string {
  return raw
    .replace(/,/g, "")           // Remove commas: "50,000" → "50000"
    .replace(/–/g, "-")          // en-dash → -
    .replace(/—/g, "-")          // em-dash → -
    .replace(/\u2013/g, "-")     // unicode en-dash
    .replace(/\u2014/g, "-")     // unicode em-dash
    .trim();
}

/**
 * Step 2: Convert suffixes (K, M, LPA, L, CR)
 * "50K" → 50000, "0.5M" → 500000, "5LPA" → 500000
 */
function convertSuffix(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();

  // Match number followed by optional suffix
  const match = trimmed.match(/^([\d.]+)\s*(k|m)?$/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  const suffix = match[2];
  if (!suffix) return num; // No suffix, just a plain number

  const multiplier = SUFFIX_MULTIPLIERS[suffix];
  return multiplier ? num * multiplier : null;
}

/**
 * Step 3: Extract numeric bounds from a range string
 * Step 4: Validate — both must be valid, reversed → swap
 * Step 5: Compute average as float
 *
 * Edge cases:
 *   null / "NA" / "" → NULL
 *   partial range (only one bound) → NULL + invalid flag
 *   malformed text → NULL + invalid flag
 *   reversed range → auto-swap before computing mean
 */
export function parseRangeValue(rawValue: unknown): ParseResult {
  // ── Null / undefined → NULL ──
  if (rawValue === null || rawValue === undefined) {
    return { value: null, wasRange: false, wasSwapped: false, isValid: true };
  }

  const str = String(rawValue).trim();

  // ── Empty, NA, N/A, undefined, dash → NULL ──
  if (str === "" || /^(na|n\/a|null|undefined|-)$/i.test(str)) {
    return { value: null, wasRange: false, wasSwapped: false, isValid: true };
  }

  // ── Already a number → return as float ──
  if (typeof rawValue === "number" && isFinite(rawValue)) {
    return { value: rawValue, wasRange: false, wasSwapped: false, isValid: true };
  }

  // Plain numeric string → float
  if (/^[\d.]+$/.test(str) && !isNaN(Number(str))) {
    return { value: Number(str), wasRange: false, wasSwapped: false, isValid: true };
  }

  const cleaned = normalizeRangeStr(str);

  // ── "approx 60k", "~60k", "about 60k" → single value with warning ──
  const approxMatch = cleaned.match(/^(?:approx(?:imate)?|about|around|~)\s*([\d.]+)(k|m)?$/i);
  if (approxMatch) {
    const num = parseFloat(approxMatch[1]);
    const suffix = (approxMatch[2] || "").toLowerCase();
    if (!isNaN(num)) {
      const mult = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : 1;
      return { value: num * mult, wasRange: true, wasSwapped: false, isValid: true };
    }
  }

  // ── "70k+", "50000+", "70k+" → lower bound only, flag partial ──
  const plusMatch = cleaned.match(/^([\d.]+)(k|m)?\s*\+$/i);
  if (plusMatch) {
    const num = parseFloat(plusMatch[1]);
    const suffix = (plusMatch[2] || "").toLowerCase();
    if (!isNaN(num)) {
      const mult = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : 1;
      return { value: num * mult, wasRange: true, wasSwapped: false, isValid: false };
    }
  }

  // ── "50,000 to 70,000", "50K to 70K" — word separator "to" ──
  const toRangeMatch = cleaned.match(/^([\d.]+)(k|m)?\s+to\s+([\d.]+)(k|m)?$/i);
  if (toRangeMatch) {
    const num1 = parseFloat(toRangeMatch[1]);
    const num2 = parseFloat(toRangeMatch[3]);
    const mult1 = (toRangeMatch[2] || "").toLowerCase();
    const mult2 = (toRangeMatch[4] || "").toLowerCase();
    const val1 = num1 * (mult1 === "k" ? 1000 : mult1 === "m" ? 1000000 : 1);
    const val2 = num2 * (mult2 === "k" ? 1000 : mult2 === "m" ? 1000000 : 1);
    if (!isNaN(val1) && !isNaN(val2)) {
      let lo = val1, hi = val2, swapped = false;
      if (lo > hi) { [lo, hi] = [hi, lo]; swapped = true; }
      return { value: (lo + hi) / 2, wasRange: true, wasSwapped: swapped, isValid: true };
    }
  }

  // ── Try to parse as range (original patterns) ──
  // Match range: "50000-70000", "50K-70K", "0.5M-0.7M"
  const rangeMatch = cleaned.match(
    /^([\d.]+(?:k|m)?)\s*-\s*([\d.]+(?:k|m)?)$/i
  );

  if (rangeMatch) {
    const lower = convertSuffix(rangeMatch[1]);
    const upper = convertSuffix(rangeMatch[2]);

    // Validation: both bounds must be valid numbers
    if (lower === null || upper === null) {
      // Partial or invalid range → NULL + critical flag
      return { value: null, wasRange: true, wasSwapped: false, isValid: false };
    }

    // Check for reversed range → swap before processing
    let low = lower;
    let high = upper;
    let swapped = false;
    if (low > high) {
      [low, high] = [high, low];
      swapped = true;
    }

    // Final output: single float value (average of bounds)
    const mean = (low + high) / 2;
    return { value: mean, wasRange: true, wasSwapped: swapped, isValid: true };
  }

  // Single value with suffix: "50K", "0.5M"
  const singleMatch = cleaned.match(/^([\d.]+)(k|m)$/i);
  if (singleMatch) {
    const val = convertSuffix(cleaned);
    if (val !== null) {
      return { value: val, wasRange: false, wasSwapped: false, isValid: true };
    }
  }

  // Malformed text → NULL + critical flag
  return { value: null, wasRange: false, wasSwapped: false, isValid: false };
}

// ── Cleaning Plan Executor ──────────────────────────

interface PlanItem {
  id: string;
  column: string;
  columnClass: string;
  method: string;
  severity: string;
  riskLevel: string;
  transformation: string;
  condition: string;
  applied: boolean;
}

// CANONICAL_MAPS removed — categorical mapping is now dynamic (cleaning-engine.ts)
// range-parser only does title-case normalization for categorical values

/**
 * Try to parse a date string into YYYY-MM-DD format.
 * Handles: "01/15/2024", "Jan 15, 2024", "2024-01-15", "15-01-2024", etc.
 */
function tryNormalizeDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // MM/DD/YYYY or DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];
    // If first number > 12, assume DD/MM/YYYY
    if (a > 12) {
      return `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    }
    // Otherwise assume MM/DD/YYYY
    return `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }

  // DD-MM-YYYY or DD.MM.YYYY (DEFAULT — assume DD-MM for India locale)
  const dashMatch = trimmed.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/);
  if (dashMatch) {
    const a = parseInt(dashMatch[1], 10);
    const b = parseInt(dashMatch[2], 10);
    const year = dashMatch[3];
    // BUG FIX #4: Consistent with cleaning-engine — DD-MM default
    if (a > 12) {
      return `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    }
    if (b > 12) {
      return `${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
    }
    // Ambiguous: default to DD-MM-YYYY (India locale)
    return `${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
  }

  // Try native Date parsing as last resort
  const d = new Date(trimmed);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2100) {
    return d.toISOString().split("T")[0];
  }

  return null;
}

export interface CleaningResult {
  data: RawDataRow[];
  flagMap: Map<string, CellFlag>;
}

export function applyCleaningPlan(
  rawData: RawDataRow[],
  appliedPlanIds: Set<string>,
  plan: PlanItem[]
): CleaningResult {
  const appliedItems = plan.filter((item) => appliedPlanIds.has(item.id));
  const mergedFlagMap = new Map<string, CellFlag>();
  if (appliedItems.length === 0) return { data: rawData, flagMap: mergedFlagMap };

  let result = rawData.map((row) => ({ ...row }));

  for (const item of appliedItems) {
    const col = item.column;
    if (!col) continue;

    switch (item.method) {
      case "range_average":
      case "salary_pre_normalization":
        // Salary_Range rule: parse range → single float (with flag for reversed)
        result = result.map((row, idx) => {
          const raw = row[col];
          const parsed = parseRangeValue(raw);
          if (parsed.wasSwapped) {
            mergedFlagMap.set(`${idx}-${col}`, {
              raw: String(raw),
              flag: "reversed_range",
              confidence: 0.85,
              severity: "warning",
              reason: `reversed_range`,
              suggestedValue: parsed.value,
            });
          }
          if (!parsed.isValid) {
            mergedFlagMap.set(`${idx}-${col}`, {
              raw: String(raw),
              flag: "partial_range",
              confidence: 0.40,
              severity: "high_risk",
              reason: `partial_range`,
            });
          }
          return { ...row, [col]: parsed.value };
        });
        break;

      case "trim":
        result = result.map((row) => {
          const val = row[col];
          if (typeof val === "string") {
            return { ...row, [col]: val.trim().replace(/\s+/g, " ") };
          }
          return row;
        });
        break;

      case "title_case":
        result = result.map((row) => {
          const val = row[col];
          if (typeof val === "string") {
            const titleCased = val
              .trim()
              .split(/\s+/)
              .map((word) =>
                word.length > 0
                  ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                  : word
              )
              .join(" ");
            return { ...row, [col]: titleCased };
          }
          return row;
        });
        break;

      case "convert":
        // Numeric conversion: string → number
        // Categorical format standardization: normalize case (present → Present)
        result = result.map((row) => {
          const val = row[col];
          if (typeof val === "string" && val.trim() !== "") {
            const cleaned = val.replace(/,/g, "").trim();
            const num = Number(cleaned);
            if (!isNaN(num) && cleaned !== "") {
              return { ...row, [col]: num };
            }
            // Dynamic: only title-case normalization (no hardcoded semantic maps)
            const titleCased = val.trim().split(/\s+/).map((word) =>
              word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word
            ).join(" ");
            if (titleCased !== val.trim()) {
              return { ...row, [col]: titleCased };
            }
            // Non-numeric, non-mappable text → keep as-is
            return row;
          }
          return row;
        });
        break;

      case "null_if_invalid":
        // Null out NA / N/A / null strings / empty
        result = result.map((row) => {
          const val = row[col];
          if (typeof val === "string") {
            const trimmed = val.trim();
            if (
              trimmed === "" ||
              /^(na|n\/a|null|undefined|-|none|nan|nil|tbd)$/i.test(trimmed)
            ) {
              return { ...row, [col]: null };
            }
          }
          return row;
        });
        break;

      case "format_standardize":
        // Date format: try to normalize to YYYY-MM-DD
        result = result.map((row) => {
          const val = row[col];
          if (typeof val === "string") {
            const normalized = tryNormalizeDate(val);
            if (normalized) {
              return { ...row, [col]: normalized };
            }
            // Fallback: just trim spaces
            return { ...row, [col]: val.trim().replace(/\s+/g, " ") };
          }
          return row;
        });
        break;

      case "canonical_map":
        // Standardize categorical values — title case normalization (dynamic engine handles actual mapping)
        result = result.map((row) => {
          const val = row[col];
          if (typeof val === "string") {
            const titleCased = val.trim().split(/\s+/).map((word) =>
              word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word
            ).join(" ");
            if (titleCased !== val.trim()) {
              return { ...row, [col]: titleCased };
            }
          }
          return row;
        });
        break;

      case "numeric_normalize":
        // Full numeric normalization with confidence-based flags
        {
          const { data: normalizedData, flagMap } = applyNumericNormalization(result, col);
          result = normalizedData;
          flagMap.forEach((flag, key) => mergedFlagMap.set(key, flag));
        }
        break;

      case "flag":
        // Flag only — no transformation
        break;

      case "median_impute":
        // Median imputation for numeric columns (only if missing < 20%)
        {
          const colValues = result.map((r) => r[col]);
          const nonNull = colValues.filter(
            (v) => v !== null && v !== undefined && typeof v === "number" && isFinite(v)
          ) as number[];
          const missingCount = colValues.length - nonNull.length;
          const missingRate = missingCount / colValues.length;

          if (missingRate < 0.2 && nonNull.length > 0) {
            const sorted = [...nonNull].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            const median =
              sorted.length % 2 !== 0
                ? sorted[mid]
                : (sorted[mid - 1] + sorted[mid]) / 2;

            result = result.map((row) => {
              if (
                row[col] === null ||
                row[col] === undefined
              ) {
                return { ...row, [col]: median };
              }
              return row;
            });
          }
        }
        break;

      default:
        break;
    }
  }

  return { data: result, flagMap: mergedFlagMap };
}
