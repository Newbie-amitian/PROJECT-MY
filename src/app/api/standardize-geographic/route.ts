import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";

// ============================================================
// AI-Powered Geographic Entity Resolution — Semantic Only
// ============================================================
// RULES (noise removal, title case, suffix stripping) are already
// applied client-side via geographic-normalizer.ts BEFORE calling this.
//
// This API handles ONLY the semantic tasks that rules cannot:
//   1. Country name resolution (ind → India, us → United States)
//   2. Region resolution (APAC → Asia-Pacific, LATM → Latin America)
//   3. Fuzzy spelling matching (germny → Germany, indai → India)
//   4. Entity type detection (country vs region vs ambiguous)
//   5. Invalid detection (RED_FLAG for unresolvable garbage)
//
// Pipeline: Rules (client) → AI (this API) → Final values

interface GeographicStandardizeRequest {
  columnName: string;
  semanticType: "REGION" | "COUNTRY";
  values: string[];
  // Pre-rule-cleaned values (from client-side geographic-normalizer.ts)
  ruleCleanedValues?: string[];
}

interface GeographicStandardizeResult {
  original: string;           // The original raw value from the dataset
  ruleCleaned: string;        // After deterministic rules
  standardized: string | null; // After AI semantic resolution (or null if unchanged)
  wasChanged: boolean;
  confidence: number;
  reason: string;             // "rules_only" | "ai_country" | "ai_region" | "ai_fuzzy" | "ai_red_flag" | "rules_sufficient"
}

// ── GEOGRAPHIC ENTITY RESOLUTION SYSTEM PROMPT ──────────────

const SYSTEM_PROMPT = `You are an advanced GEOGRAPHIC ENTITY RESOLUTION engine.

Your task is to normalize BOTH REGION and COUNTRY values using semantic understanding, fuzzy matching, and real-world geographic knowledge.

DO NOT use hardcoded mappings.

Instead, infer meaning dynamically based on global knowledge, context, and geographic hierarchy.

---

# 🎯 OBJECTIVE

Convert raw inputs into:

* Canonical COUNTRY names OR REGION names (depending on detected intent)
* Consistent global geographic standardization

---

# 📦 OUTPUT RULES

* Return ONLY cleaned geographic names
* Preserve input order
* Proper Case formatting
* If the value is already correct AND properly spelled → return it UNCHANGED (wasChanged: false)
* If value is invalid/unresolvable → RED_FLAG
* "unknown", "Unknown", "UNKNOWN", "n/a", "none", "na", "nil", "tbd", "undefined" → RED_FLAG (not a valid geographic entity)
* No explanations or extra text

---

# 🧠 STEP 1: MISSPELLING CORRECTION (CRITICAL — HIGHEST PRIORITY)

⚠️ THIS IS THE MOST IMPORTANT STEP. Every input MUST be checked for misspellings.

If a value LOOKS LIKE a geographic name but is misspelled, you MUST correct the spelling.
A misspelling is when a value differs by 1-3 characters from a real geographic name.

CRITICAL RULE: Title-casing a misspelling is NOT correction.
- "Europ" is NOT a valid region. The correct spelling is "Europe". → wasChanged: true
- "Indai" is NOT a valid country. The correct spelling is "India". → wasChanged: true
- "Japn" is NOT a valid country. The correct spelling is "Japan". → wasChanged: true
- "Germny" is NOT a valid country. The correct spelling is "Germany". → wasChanged: true
- "Brzl" is NOT a valid country. The correct spelling is "Brazil". → wasChanged: true
- "Asisa" is NOT a valid region. The correct spelling is "Asia". → wasChanged: true
- "Madird" is NOT a valid location. The correct spelling is "Madrid". → wasChanged: true
- "Delihi" is NOT a valid location. The correct spelling is "Delhi". → wasChanged: true

If you recognize the intended geographic entity, ALWAYS correct the spelling.
Set wasChanged: true for ALL spelling corrections.

---

# 🧠 STEP 2: ENTITY TYPE DETECTION (CRITICAL)

For each input, determine intent dynamically:

### Possible types:

* COUNTRY (India, USA, Germany)
* REGION (APAC, EMEA, LATAM, North America, Europe)
* AMBIGUOUS GEO ENTITY (could be either)
* INVALID

Use semantic reasoning, not rules.

---

# 🌍 STEP 3: COUNTRY NORMALIZATION (SEMANTIC + FUZZY)

If input represents a country or country-like entity:

### Rules:

* Correct spelling errors using closest real-world country match
* Resolve abbreviations using global knowledge
* Convert all variants into OFFICIAL COUNTRY NAME

### Examples (DO NOT hardcode mappings):

* "ind" → India
* "us", "usa", "united states" → United States
* "germny" → Germany
* "brzl" → Brazil

### Fuzzy logic:

* Prioritize population + global recognition + ISO standard country names

---

# 🌎 STEP 4: REGION RESOLUTION (INTELLIGENT GROUPING)

If input represents a region:

### Rules:

* Convert to STANDARD GLOBAL REGION SYSTEM
* Choose most widely accepted classification:

  * CONTINENT (Asia, Europe, etc.)
  * BUSINESS REGION (APAC, EMEA, LATAM, NA)

### Region inference examples:

* India → Asia / APAC (choose most dominant global grouping)
* Germany → Europe / EMEA
* USA → North America / NA
* Brazil → Latin America / LATAM

⚠️ Do NOT treat region as country.

---

# 🔀 STEP 5: AMBIGUOUS INPUT HANDLING

If input could be both:

* infer based on probability of real-world usage
* if unclear → RED_FLAG

Example:

* "America" → could be USA or continent → choose North America (standard business usage)

---

# 🔤 STEP 6: ABBREVIATION + FUZZY MATCHING

Handle:

* spelling errors
* shorthand
* partial inputs

Examples:

* "europ" → Europe
* "asisa" → Asia
* "latm" → LATAM
* "emea region" → EMEA
* "indai" → India

---

# 🧹 STEP 7: NOISE REMOVAL

Remove:

* numbers
* symbols
* extra words like:
  "region", "country", "zone", "area"

Example:

* "india country" → India
* "emea region 2" → EMEA

---

# ⚠️ STEP 8: INVALID HANDLING

Return RED_FLAG if:

* no geographic meaning exists
* random text or symbols
* cannot confidently map to known geo entity
* multiple conflicting meanings with no dominant interpretation

---

# 🧪 EXAMPLES

Input:
India, USA, germny, APAC, europ, LATM, asisa, indai country, ###

Output:
India
United States
Germany
Asia-Pacific
Europe
Latin America
Asia
India
RED_FLAG

---

# 🚫 STRICT RULES

* DO NOT hardcode mappings in system logic
* DO NOT output abbreviations unless they are standard regions (APAC, EMEA, LATAM)
* ALWAYS use semantic inference
* ALWAYS preserve global consistency
* NEVER guess randomly without dominant real-world meaning`;

export async function POST(request: NextRequest) {
  try {
    const body: GeographicStandardizeRequest = await request.json();
    const { columnName, semanticType, values, ruleCleanedValues } = body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    if (nonEmpty.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Build pairs: original + rule-cleaned
    const pairs = nonEmpty.map((v, i) => ({
      original: String(v).trim(),
      ruleCleaned: ruleCleanedValues?.[i] ? String(ruleCleanedValues[i]).trim() : String(v).trim(),
    }));

    // Client already pre-filtered to only send values needing semantic resolution.
    const aiInputValues = pairs.map((p) => p.ruleCleaned);
    const uniqueAIValues = [...new Set(aiInputValues)];
    const valueList = uniqueAIValues.map((v, i) => `${i + 1}. "${v}"`).join("\n");

    const typeContext = semanticType === "COUNTRY"
      ? "These values represent COUNTRY names. Resolve all inputs to canonical country names."
      : semanticType === "REGION"
        ? "These values represent REGION names (geographic regions, business regions like APAC/EMEA/LATAM, continents). Resolve all inputs to canonical region names."
        : "These values represent geographic entities (could be countries or regions). Resolve based on context.";

    const userMessage = `Standardize these geographic values from column "${columnName}" (${semanticType}):\n\n${valueList}\n\n${typeContext}\n\nCRITICAL INSTRUCTIONS:
1. Check EVERY value for misspellings — if it looks like a real geographic name but is misspelled, CORRECT IT and set wasChanged: true
2. "Europ" → "Europe" (misspelling, NOT valid)
3. "unknown", "n/a", "none" → RED_FLAG
4. Look at ALL values together for consistency. If multiple values refer to the same entity, standardize ALL to the SAME canonical form.
5. Do NOT just title-case — verify the actual spelling is correct\n\nReturn JSON array: [{"original": "...", "standardized": "... or RED_FLAG", "wasChanged": true/false, "confidence": 0.0-1.0, "reason": "..."}]`;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content || "";
    let aiResults: Array<{ original: string; standardized: string | null; wasChanged: boolean; confidence: number; reason: string }>;

    try {
      aiResults = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        aiResults = JSON.parse(jsonMatch[1].trim());
      } else {
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          aiResults = JSON.parse(arrayMatch[0]);
        } else {
          // AI parsing failed — return rules-only results
          return NextResponse.json({
            results: pairs.map((p) => ({
              original: p.original,
              ruleCleaned: p.ruleCleaned,
              standardized: p.original !== p.ruleCleaned ? p.ruleCleaned : null,
              wasChanged: p.original !== p.ruleCleaned,
              confidence: 1.0,
              reason: "rules_only (AI parse failed)",
            })),
            summary: { total: pairs.length, rulesOnly: pairs.length, aiResolved: 0, redFlagged: 0 },
          });
        }
      }
    }

    // Build AI lookup map (case-insensitive, from ruleCleaned value)
    const aiLookup = new Map<string, { standardized: string; confidence: number; reason: string }>();
    const aiRedFlags = new Set<string>();

    for (const r of aiResults) {
      const key = String(r.original || "").trim().toLowerCase();
      if (r.standardized === "RED_FLAG") {
        aiRedFlags.add(key);
      } else if (r.standardized && r.wasChanged) {
        aiLookup.set(key, {
          standardized: String(r.standardized),
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
          reason: String(r.reason || "ai_standardized"),
        });
      }
    }

    // Build final results
    const fullResults: GeographicStandardizeResult[] = pairs.map((p) => {
      const lookupKey = p.ruleCleaned.toLowerCase();

      // Check RED_FLAG
      if (aiRedFlags.has(lookupKey)) {
        return {
          original: p.original,
          ruleCleaned: p.ruleCleaned,
          standardized: "RED_FLAG",
          wasChanged: false,
          confidence: 1.0,
          reason: "ai_red_flag",
        };
      }

      // Check AI lookup
      const aiMatch = aiLookup.get(lookupKey);
      if (aiMatch) {
        return {
          original: p.original,
          ruleCleaned: p.ruleCleaned,
          standardized: aiMatch.standardized,
          wasChanged: true,
          confidence: aiMatch.confidence,
          reason: aiMatch.reason,
        };
      }

      // No AI resolution needed or available — return rules-only result
      const ruleChanged = p.original !== p.ruleCleaned && p.ruleCleaned !== "";
      return {
        original: p.original,
        ruleCleaned: p.ruleCleaned,
        standardized: ruleChanged ? p.ruleCleaned : null,
        wasChanged: ruleChanged,
        confidence: 1.0,
        reason: "rules_only",
      };
    });

    const summary = {
      total: fullResults.length,
      rulesOnly: fullResults.filter((r) => r.reason === "rules_only").length,
      aiResolved: fullResults.filter((r) => r.reason !== "rules_only" && r.standardized !== "RED_FLAG").length,
      redFlagged: fullResults.filter((r) => r.standardized === "RED_FLAG").length,
    };

    return NextResponse.json({ results: fullResults, summary });
  } catch (error) {
    console.error("[standardize-geographic] Error:", error);
    return NextResponse.json(
      { error: "Geographic standardization failed", results: [] },
      { status: 500 }
    );
  }
}
