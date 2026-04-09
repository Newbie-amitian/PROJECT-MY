import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";

// ============================================================
// Universal AI Data Normalization — Dynamic Column Understanding
// ============================================================
// This endpoint handles ANY column type dynamically:
//   - PRODUCT (toys, gadgets, furniture, electronics, fashion)
//   - PERSON (names, usernames)
//   - LOCATION (cities, countries, regions)
//   - CONTACT (phone, email)
//   - MONEY (salary, price, revenue)
//   - RATING (stars, scores)
//   - IDENTIFIER (IDs, codes, serial numbers)
//   - STATUS (active/inactive, labels)
//   - And ANY new/unseen domain
//
// Pipeline: Client collects unique values → sends here → AI normalizes
// AI handles: dynamic type detection, semantic normalization, fuzzy matching,
//   misspelling correction, noise removal, canonical form resolution.
// ============================================================

interface NormalizeRequest {
  columnName: string;
  values: string[];
  semanticType?: string;    // Optional hint from classifier (e.g., "CATEGORICAL", "text")
}

interface NormalizeResult {
  original: string;
  normalized: string | null;  // null = no change needed, "RED_FLAG" = invalid
  wasChanged: boolean;
  confidence: number;
  reason: string;
}

const SYSTEM_PROMPT = `You are an advanced DATA NORMALIZATION ENGINE with ZERO dependency on predefined column schemas.

Your task is to dynamically understand ANY column type (including unseen or new domains such as toys, gadgets, furniture, electronics, fashion, etc.) and normalize values intelligently.

---

# 🎯 CORE OBJECTIVE

For ANY input column:

1. Detect what the data represents (semantic column understanding)
2. Infer its real-world category dynamically
3. Normalize values into canonical forms
4. Handle noise, typos, emojis, and mixed formats
5. Flag unrecoverable values

---

# 🧠 STEP 1: DYNAMIC COLUMN TYPE DETECTION (CRITICAL)

You MUST infer the column meaning using semantic clustering.

Possible inferred categories (NOT fixed list):

* PERSON (names, usernames)
* LOCATION (cities, countries, regions)
* CONTACT (phone, email)
* MONEY (salary, price, revenue)
* RATING (stars, scores, text ratings)
* PRODUCT (toys, gadgets, furniture, electronics, appliances, clothing)
* IDENTIFIER (IDs, codes, serial numbers)
* DATE/TIME
* STATUS (active/inactive, labels)
* UNKNOWN / MIXED

⚠️ You are NOT limited to this list. New categories may emerge — infer them dynamically.

---

# 🧠 STEP 2: SEMANTIC UNDERSTANDING (NO HARD LIMITS)

If column is PRODUCT-type, further infer subdomain dynamically:

Examples:

* toy → "Action Figure", "Educational Toy", "Plush Toy"
* gadget → "Smartphone", "Wearable", "Accessory"
* furniture → "Chair", "Table", "Sofa"
* electronics → "Laptop", "Camera", "Headphones"

DO NOT use predefined mappings. Infer from context.

---

# 🧹 STEP 3: NORMALIZATION RULES (GENERIC)

Apply universally:

* lowercase for processing
* remove emojis, noise symbols
* fix typos using semantic similarity
* extract meaningful tokens
* standardize spelling to most common real-world form

---

# 🧠 STEP 4: FUZZY + SEMANTIC RESOLUTION

Use:

* contextual meaning
* real-world popularity
* product/domain knowledge
* similarity to known entities

Examples:

* "iphnoe" → iPhone
* "soffa" → Sofa
* "plushy toy" → Plush Toy
* "tablt" → Tablet

---

# 🚨 STEP 5: INVALID HANDLING

Return:
RED_FLAG

if:

* no semantic meaning
* pure noise
* cannot map to any known real-world concept
* random symbols or corrupted text
* "unknown", "n/a", "none", "tbd", "undefined"

---

# 📦 STEP 6: CANONICAL OUTPUT RULE

* Always return CLEAN canonical form
* Preserve category meaning
* Do NOT hallucinate new entities
* Keep format consistent across column

---

# 🧪 EXAMPLES

Input:
iphnoe, sofaa, teddy bear!!, gaming lptop, blr, 123###, wooden chare

Output:
iPhone
Sofa
Teddy Bear
Gaming Laptop
RED_FLAG
RED_FLAG
Wooden Chair

---

# ⚠️ STRICT RULES

* DO NOT rely on predefined schema
* DO NOT assume column meaning beforehand
* ALWAYS infer dynamically from data distribution
* ALWAYS prioritize semantic correctness over literal matching
* NEVER guess when uncertain → use RED_FLAG
* If value is already correct → return it UNCHANGED (wasChanged: false)`;

export async function POST(request: NextRequest) {
  try {
    const body: NormalizeRequest = await request.json();
    const { columnName, values, semanticType } = body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    if (nonEmpty.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const cleanedValues = nonEmpty.map((v) => String(v).trim());
    const uniqueValues = [...new Set(cleanedValues)];
    const valueList = uniqueValues.map((v, i) => `${i + 1}. "${v}"`).join("\n");

    const typeHint = semanticType
      ? `\n\nHint: The column was classified as "${semanticType}". Use this as context but DO NOT rely on it exclusively — always verify against the actual data.`
      : "";

    const userMessage = `Normalize these values from column "${columnName}":\n\n${valueList}${typeHint}\n\nCRITICAL INSTRUCTIONS:
1. First infer what this column represents from the data distribution
2. Check EVERY value for misspellings — correct them (set wasChanged: true)
3. Remove noise: emojis, trailing numbers, symbols, exclamation marks
4. "unknown", "n/a", "none", "tbd", "undefined" → RED_FLAG
5. Pure noise/symbols (e.g., "123###") → RED_FLAG
6. Already-correct values → return UNCHANGED (wasChanged: false)
7. Keep consistent canonical form across all values in the column\n\nReturn JSON array: [{"original": "...", "normalized": "... or RED_FLAG", "wasChanged": true/false, "confidence": 0.0-1.0, "reason": "..."}]`;

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
    let aiResults: Array<{ original: string; normalized: string | null; wasChanged: boolean; confidence: number; reason: string }>;

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
          // AI parsing failed — return unchanged
          return NextResponse.json({
            results: cleanedValues.map((v) => ({
              original: v,
              normalized: null,
              wasChanged: false,
              confidence: 1.0,
              reason: "ai_parse_failed",
            })),
            summary: { total: cleanedValues.length, changed: 0, redFlagged: 0, unchanged: cleanedValues.length },
          });
        }
      }
    }

    // Build AI lookup map (case-insensitive)
    const aiLookup = new Map<string, { normalized: string; confidence: number; reason: string }>();
    const aiRedFlags = new Set<string>();

    for (const r of aiResults) {
      const key = String(r.original || "").trim().toLowerCase();
      if (r.normalized === "RED_FLAG") {
        aiRedFlags.add(key);
      } else if (r.normalized && r.wasChanged) {
        aiLookup.set(key, {
          normalized: String(r.normalized),
          confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
          reason: String(r.reason || "ai_normalized"),
        });
      }
    }

    // Build final results for ALL original values (preserving duplicates)
    const fullResults: NormalizeResult[] = cleanedValues.map((v) => {
      const lookupKey = v.toLowerCase();

      // Check RED_FLAG
      if (aiRedFlags.has(lookupKey)) {
        return {
          original: v,
          normalized: "RED_FLAG",
          wasChanged: false,
          confidence: 1.0,
          reason: "ai_red_flag",
        };
      }

      // Check AI lookup
      const aiMatch = aiLookup.get(lookupKey);
      if (aiMatch) {
        return {
          original: v,
          normalized: aiMatch.normalized,
          wasChanged: true,
          confidence: aiMatch.confidence,
          reason: aiMatch.reason,
        };
      }

      // No change needed
      return {
        original: v,
        normalized: null,
        wasChanged: false,
        confidence: 1.0,
        reason: "unchanged",
      };
    });

    const summary = {
      total: fullResults.length,
      changed: fullResults.filter((r) => r.wasChanged).length,
      redFlagged: fullResults.filter((r) => r.normalized === "RED_FLAG").length,
      unchanged: fullResults.filter((r) => !r.wasChanged && r.normalized !== "RED_FLAG").length,
    };

    return NextResponse.json({ results: fullResults, summary });
  } catch (error) {
    console.error("[normalize-values] Error:", error);
    return NextResponse.json(
      { error: "Normalization failed", results: [] },
      { status: 500 }
    );
  }
}
