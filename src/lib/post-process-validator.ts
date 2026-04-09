// ============================================================
// Post-Processing Column Validator — Semantic Consistency Engine
// ============================================================
// Runs AFTER rules + AI standardization to catch:
//   1. Remaining "unknown" / invalid values → flag RED
//   2. Near-duplicates → merge to canonical form (Europ → Europe)
//   3. Abbreviations → expand when expanded form exists (NA → North America)
//
// This is a SECOND PASS — a safety net that catches what rules and AI missed.
// ============================================================

// Invalid values that should ALWAYS be flagged RED (case-insensitive)
const INVALID_VALUES = new Set([
  "unknown", "unk", "n/a", "none", "na", "nil", "tbd",
  "undefined", "not available", "not_available", "not_a_value",
  "?", "!", "-", "???", "!!!", "? ? ?", "! ! !",
]);

// Common geographic abbreviation → expansion pairs
// (Only used when the expanded form EXISTS in the same column)
const REGION_ABBREVIATIONS: Record<string, string[]> = {
  "na": ["North America"],
  "sa": ["South America"],
  "ea": ["East Asia", "Eastern Asia"],
  "wa": ["West Asia", "Western Asia"],
  "eu": ["Europe", "European Union"],
  "sea": ["Southeast Asia", "South East Asia"],
  "me": ["Middle East"],
  "la": ["Latin America"],
  "laam": ["Latin America"],
  "carib": ["Caribbean"],
  "apac": ["Asia-Pacific"],
  "latam": ["Latin America"],
};

const COUNTRY_ABBREVIATIONS: Record<string, string[]> = {
  // ── 2-letter ISO country codes (common ones) ──
  "in": ["India"],
  "us": ["United States"],
  "usa": ["United States"],
  "uk": ["United Kingdom"],
  "uae": ["United Arab Emirates"],
  "au": ["Australia"],
  "ca": ["Canada"],
  "de": ["Germany"],
  "fr": ["France"],
  "it": ["Italy"],
  "es": ["Spain"],
  "jp": ["Japan"],
  "cn": ["China"],
  "br": ["Brazil"],
  "mx": ["Mexico"],
  "ru": ["Russia"],
  "kr": ["South Korea"],
  "ng": ["Nigeria"],
  "za": ["South Africa"],
  "nz": ["New Zealand"],
  "sg": ["Singapore"],
  "se": ["Sweden"],
  "no": ["Norway"],
  "dk": ["Denmark"],
  "fi": ["Finland"],
  "nl": ["Netherlands"],
  "be": ["Belgium"],
  "ch": ["Switzerland"],
  "at": ["Austria"],
  "pt": ["Portugal"],
  "pl": ["Poland"],
  "ie": ["Ireland"],
  "gr": ["Greece"],
  "tr": ["Turkey"],
  "eg": ["Egypt"],
  "ke": ["Kenya"],
  "gh": ["Ghana"],
  "ar": ["Argentina"],
  "co": ["Colombia"],
  "cl": ["Chile"],
  "pe": ["Peru"],
  "th": ["Thailand"],
  "vn": ["Vietnam"],
  "my": ["Malaysia"],
  "id": ["Indonesia"],
  "ph": ["Philippines"],
  "pk": ["Pakistan"],
  "bd": ["Bangladesh"],
  "lk": ["Sri Lanka"],
  "np": ["Nepal"],
  "sa": ["Saudi Arabia"],
  "ir": ["Iran"],
  "iq": ["Iraq"],
  "il": ["Israel"],
  "jo": ["Jordan"],
  "ae": ["United Arab Emirates"],
  "qa": ["Qatar"],
  "kw": ["Kuwait"],
  "om": ["Oman"],
  "bh": ["Bahrain"],
  // ── 3-letter ISO country codes ──
  "aus": ["Australia"],
  "ger": ["Germany"],
  "chn": ["China"],
  "jpn": ["Japan"],
  "ind": ["India"],
  "bra": ["Brazil"],
  "fra": ["France"],
  "ita": ["Italy"],
  "esp": ["Spain"],
  "can": ["Canada"],
  "mex": ["Mexico"],
  "rus": ["Russia"],
  "kor": ["South Korea"],
  "ngl": ["Nigeria"],
};

export interface PostProcessAction {
  type: "flag_invalid" | "merge_duplicate" | "expand_abbreviation";
  from: string;        // Current value in column
  to: string | null;   // Replacement value (null = keep original, flag only)
  reason: string;
  rowIndices: number[];
}

/**
 * Compute Levenshtein edit distance between two strings.
 * Used for near-duplicate detection.
 */
function editDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,  // substitution
          matrix[i][j - 1] + 1,       // insertion
          matrix[i - 1][j] + 1,       // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Get all unique non-empty values currently in a column (after rules + AI).
 * Uses the overlay map (which has the latest values) with fallback to rawData.
 */
function getCurrentColumnValues(
  rawData: Record<string, unknown>[],
  colName: string,
  overlay: Map<string, { value: string; col: string; reason: string }>,
): Map<string, number[]> {
  const valueToIndices = new Map<string, number[]>();
  rawData.forEach((row, idx) => {
    // Check overlay first (has AI + rule corrections)
    const overlayEntry = overlay.get(`${idx}-${colName}`);
    const val = overlayEntry
      ? overlayEntry.value
      : (row[colName] != null ? String(row[colName]).trim() : "");
    if (val === "") return;
    const existing = valueToIndices.get(val) || [];
    existing.push(idx);
    valueToIndices.set(val, existing);
  });
  return valueToIndices;
}

/**
 * Post-process a geographic column (REGION, COUNTRY, or LOCATION) after
 * rules + AI have been applied. Catches remaining issues.
 *
 * Returns a list of actions to apply.
 */
export function postProcessGeographicColumn(
  rawData: Record<string, unknown>[],
  colName: string,
  overlay: Map<string, { value: string; col: string; reason: string }>,
  semanticType: "REGION" | "COUNTRY" | "LOCATION",
): PostProcessAction[] {
  const actions: PostProcessAction[] = [];
  const currentValues = getCurrentColumnValues(rawData, colName, overlay);
  const allValueNames = [...currentValues.keys()];

  // ── PASS 1: Flag remaining "unknown" / invalid values ──
  for (const [val, indices] of currentValues) {
    const lower = val.toLowerCase();
    // "na" is a legitimate REGION abbreviation (North America) — don't flag for REGION columns
    if (lower === "na" && semanticType === "REGION") continue;
    if (INVALID_VALUES.has(lower)) {
      actions.push({
        type: "flag_invalid",
        from: val,
        to: null, // keep original, flag RED
        reason: `post_process: "${val}" is not a valid ${semanticType.toLowerCase()} — flagged RED`,
        rowIndices: indices,
      });
    }
  }

  // ── PASS 2: Expand abbreviations when expanded form exists in column ──
  const abbreviations = semanticType === "REGION"
    ? REGION_ABBREVIATIONS
    : semanticType === "COUNTRY"
      ? COUNTRY_ABBREVIATIONS
      : { ...REGION_ABBREVIATIONS, ...COUNTRY_ABBREVIATIONS };

  const allValuesLower = new Set(allValueNames.map((v) => v.toLowerCase()));
  const alreadyExpanded = new Set<string>();

  for (const [val, indices] of currentValues) {
    const lower = val.toLowerCase();
    const expansions = abbreviations[lower];
    if (!expansions) continue;

    // Check if ANY expansion exists in the column
    const matchingExpansion = expansions.find((exp) =>
      allValuesLower.has(exp.toLowerCase())
    );

    if (matchingExpansion) {
      actions.push({
        type: "expand_abbreviation",
        from: val,
        to: matchingExpansion,
        reason: `post_process: "${val}" expanded to "${matchingExpansion}" (abbreviation resolved — expanded form exists in column)`,
        rowIndices: indices,
      });
      alreadyExpanded.add(lower);
    }
  }

  // ── PASS 2b: COUNTRY columns — auto-expand ISO 2-letter codes to full names ──
  // For COUNTRY columns, 2-letter codes are unambiguous (ISO 3166-1 alpha-2).
  // Expand them even when the full name doesn't exist in the column.
  // Examples: "In" → "India", "Us" → "United States", "Uk" → "United Kingdom"
  if (semanticType === "COUNTRY") {
    for (const [val, indices] of currentValues) {
      const lower = val.toLowerCase();
      if (alreadyExpanded.has(lower)) continue;
      if (lower.length !== 2) continue; // Only 2-letter codes

      const expansions = COUNTRY_ABBREVIATIONS[lower];
      if (!expansions || expansions.length === 0) continue;

      // Use the first expansion (most common full name)
      const targetName = expansions[0];

      actions.push({
        type: "expand_abbreviation",
        from: val,
        to: targetName,
        reason: `post_process: "${val}" expanded to "${targetName}" (ISO 2-letter country code — auto-standardized)`,
        rowIndices: indices,
      });
    }
  }

  // ── PASS 3: Merge near-duplicates (edit distance ≤ 2, prefer longer/more common) ──
  // Build pairs of near-duplicates
  const alreadyMerged = new Set<string>();
  const validValues = allValueNames.filter((v) => !INVALID_VALUES.has(v.toLowerCase()));

  for (let i = 0; i < validValues.length; i++) {
    for (let j = i + 1; j < validValues.length; j++) {
      const a = validValues[i];
      const b = validValues[j];
      if (a.toLowerCase() === b.toLowerCase()) continue; // exact dup
      if (alreadyMerged.has(a) || alreadyMerged.has(b)) continue;

      const dist = editDistance(a, b);
      if (dist <= 2 && dist > 0) {
        // Near-duplicate found — pick the LONGER one as canonical (more likely correct)
        // If same length, pick the one that appears more frequently
        const countA = currentValues.get(a)?.length ?? 0;
        const countB = currentValues.get(b)?.length ?? 0;
        let canonical: string, duplicate: string;
        if (a.length > b.length) {
          canonical = a; duplicate = b;
        } else if (b.length > a.length) {
          canonical = b; duplicate = a;
        } else if (countA >= countB) {
          canonical = a; duplicate = b;
        } else {
          canonical = b; duplicate = a;
        }

        const dupIndices = currentValues.get(duplicate) || [];
        actions.push({
          type: "merge_duplicate",
          from: duplicate,
          to: canonical,
          reason: `post_process: "${duplicate}" merged with "${canonical}" (edit distance ${dist} — near-duplicate)`,
          rowIndices: dupIndices,
        });
        alreadyMerged.add(duplicate);
      }
    }
  }

  return actions;
}
