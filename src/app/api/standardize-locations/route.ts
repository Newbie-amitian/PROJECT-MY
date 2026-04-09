import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";

// ============================================================
// AI-Powered Location Standardization — Semantic Only
// ============================================================
// RULES (noise removal, title case, suffix stripping) are already
// applied client-side via location-normalizer.ts BEFORE calling this.
//
// This API handles ONLY the semantic tasks that rules cannot:
//   1. Abbreviation resolution (mum → Mumbai, blr → Bangalore)
//   2. Fuzzy spelling matching (banglore → Bangalore, delihi → Delhi)
//   3. Context-aware resolution (ambiguous abbreviations)
//   4. Invalid detection (RED_FLAG for unresolvable garbage)
//
// Pipeline: Rules (client) → AI (this API) → Final values

interface LocationStandardizeRequest {
  columnName: string;
  values: string[];
  // Pre-rule-cleaned values (from client-side location-normalizer.ts)
  // If provided, AI uses these cleaned values for semantic resolution
  ruleCleanedValues?: string[];
}

interface LocationStandardizeResult {
  original: string;        // The original raw value from the dataset
  ruleCleaned: string;     // After deterministic rules (noise removal, title case)
  standardized: string | null;  // After AI semantic resolution (or null if unchanged)
  wasChanged: boolean;     // true if standardized differs from ruleCleaned
  confidence: number;
  reason: string;          // "rules_only" | "ai_abbreviation" | "ai_fuzzy" | "ai_red_flag" | "rules_sufficient"
}

// ── EXACT USER PROMPT — no modifications ──────────────

const SYSTEM_PROMPT = `You are an intelligent LOCATION normalization engine.

Your task is to convert raw location inputs into their correct canonical real-world location names using semantic understanding, not hardcoded mappings.

---

## CORE PRINCIPLE

DO NOT use fixed mappings.

Instead:

* Infer meaning from abbreviation
* Use real-world geographic knowledge
* Resolve to the most widely accepted official/canonical location name

---

## OUTPUT RULES

* Return ONLY canonical location names
* Same order as input
* Proper Case formatting
* If the value is already a correct canonical location name → return it UNCHANGED (wasChanged: false)
* Invalid/unresolvable → RED_FLAG

---

## INTELLIGENCE RULES

### 1. MISSPELLING CORRECTION (CRITICAL — HIGHEST PRIORITY)

⚠️ THIS IS THE MOST IMPORTANT STEP. Every input MUST be checked for misspellings.

If a value is a misspelled city/location name, you MUST correct the spelling.
A misspelling is when a value differs by 1-3 characters from a real location name.

CRITICAL RULE: Title-casing a misspelling is NOT correction.
- "Delihi" is NOT a valid city. The correct spelling is "Delhi". → wasChanged: true
- "Banglore" is NOT a valid city. The correct spelling is "Bangalore". → wasChanged: true
- "Madird" is NOT a valid city. The correct spelling is "Madrid". → wasChanged: true
- "Mumabi" is NOT a valid city. The correct spelling is "Mumbai". → wasChanged: true

If you recognize the intended location, ALWAYS correct the spelling.
Set wasChanged: true for ALL spelling corrections.

### 2. ABBREVIATION RESOLUTION (DYNAMIC)

If input is an abbreviation:

* infer full form using context + geography knowledge
* choose the most commonly recognized city/region

Examples (DO NOT hardcode):

* "mum" → infer most likely major city → Mumbai
* "blr" → infer → Bangalore (Bengaluru acceptable, choose one canonical form)
* "hyd" → Hyderabad
* "del" → Delhi

⚠️ Do NOT rely on fixed dictionary mapping. Use semantic reasoning.

---

### 2. FUZZY MATCHING

If input is misspelled:

* correct using closest real-world location
* prioritize population, popularity, and country context

Examples:

* "banglore" → Bangalore
* "delihi" → Delhi

---

### 3. MULTI-WORD PATTERN RESOLUTION

If input contains an abbreviation followed by a word (e.g., "hyd india", "blr karnataka"):

* Resolve the abbreviation to its full city name
* Drop redundant geographic qualifiers (country names, state names after city)
* Return ONLY the canonical city name

Examples:
* "hyd india" → Hyderabad
* "blr karnataka" → Bangalore
* "mum maharashtra" → Mumbai

---

### 4. CONTEXT-AWARE RESOLUTION

If ambiguity exists:

* choose the most globally recognized city
* if still unclear → RED_FLAG

---

### 4. SEMANTIC PRESERVATION

DO NOT merge distinct entities:

* Delhi ≠ Delhi NCR
* New Delhi ≠ Delhi NCR

---

### 5. NOISE REMOVAL

Remove:

* numbers
* symbols
* suffix noise ("city", "area", "zone")

---

### 6. INVALID HANDLING

Return RED_FLAG if:

* no real-world match exists
* abbreviation is ambiguous with no dominant meaning
* pure noise or symbols

---

## EXAMPLES

Input:
mum, blr, banglore, delihi, hyd123, delhi ncr, !!!

Output:
Mumbai
Bangalore
Bangalore
Delhi
Hyderabad
Delhi NCR
RED_FLAG

---

## STRICT RULES

* DO NOT use hardcoded mapping tables
* DO NOT output abbreviations
* ALWAYS infer from real-world knowledge
* ALWAYS return canonical names only`;

export async function POST(request: NextRequest) {
  try {
    const body: LocationStandardizeRequest = await request.json();
    const { columnName, values, ruleCleanedValues } = body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    if (nonEmpty.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Build pairs: original + rule-cleaned (use ruleCleanedValues if provided)
    const pairs = nonEmpty.map((v, i) => ({
      original: String(v).trim(),
      ruleCleaned: ruleCleanedValues?.[i] ? String(ruleCleanedValues[i]).trim() : String(v).trim(),
    }));

    // Client already pre-filtered to only send values needing semantic resolution.
    // Send ALL received values to AI — no additional server-side filtering needed.
    const aiInputValues = pairs.map((p) => p.ruleCleaned);
    const uniqueAIValues = [...new Set(aiInputValues)];
    const valueList = uniqueAIValues.map((v, i) => `${i + 1}. "${v}"`).join("\n");

    const userMessage = `Standardize these location values from column "${columnName}":\n\n${valueList}\n\nCRITICAL INSTRUCTIONS:
1. Check EVERY value for misspellings — if it looks like a real location but is misspelled, CORRECT IT and set wasChanged: true
2. "Delihi" → "Delhi" (misspelling), "Banglore" → "Bangalore" (misspelling), "Madird" → "Madrid" (misspelling)
3. Look at ALL values together for consistency. If multiple values refer to the same location, standardize ALL to the SAME canonical form.
4. Do NOT just title-case — verify the actual spelling is correct
5. "hyd india" → Hyderabad (resolve abbreviation + drop country qualifier)
6. "unknown", "n/a", "none" → RED_FLAG\n\nReturn JSON array: [{"original": "...", "standardized": "... or RED_FLAG", "wasChanged": true/false, "confidence": 0.0-1.0, "reason": "..."}]`;

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

    // Build final results: apply AI resolution only where needed
    const fullResults: LocationStandardizeResult[] = pairs.map((p) => {
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
    console.error("[standardize-locations] Error:", error);
    return NextResponse.json(
      { error: "Location standardization failed", results: [] },
      { status: 500 }
    );
  }
}
