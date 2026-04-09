import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";

// ============================================================
// AI Text Understanding & Standardization — Survey/Questionnaire Responses
// ============================================================
// Handles open-ended text responses (feedback, reviews, survey answers).
// Does NOT convert to numbers or fixed labels — structures and normalizes
// meaning from natural language.
//
// Pipeline: Client collects unique responses → sends here → AI structures
// ============================================================

interface TextNormalizeRequest {
  columnName: string;
  values: string[];
}

interface TextNormalizeResult {
  original: string;
  normalized: string | null;  // null = no change, "RED_FLAG" = invalid
  wasChanged: boolean;
  confidence: number;
  reason: string;
  intent?: string;           // Optional: inferred intent (positive sentiment, negative sentiment, etc.)
}

const SYSTEM_PROMPT = `You are an advanced TEXT UNDERSTANDING AND STANDARDIZATION ENGINE for open-ended survey or questionnaire responses.

Your task is NOT to convert values into numbers or fixed labels, but to STRUCTURE and NORMALIZE meaning from natural language answers.

---

# 🎯 OBJECTIVE

Convert free-text responses into:

* clean, structured semantic form
* consistent phrasing style
* optional categorized intent (if possible)

WITHOUT losing meaning.

---

# 🧠 STEP 1: LANGUAGE CLEANING

* fix grammar lightly (do NOT over-correct)
* remove emojis and noise symbols
* remove filler words (um, like, basically)
* normalize spacing and casing

---

# 🧠 STEP 2: SEMANTIC COMPRESSION (IMPORTANT)

Rewrite responses into a:
→ concise, clear statement
→ preserving full intent

DO NOT shorten meaning.

Example:
Input:
"I really liked the product because it was super easy to use and fast"

Output:
"Liked product for ease of use and speed"

---

# 🧠 STEP 3: INTENT NORMALIZATION

If possible, infer category:

Examples:

* positive sentiment
* negative sentiment
* feature complaint
* pricing issue
* support issue
* general feedback

But DO NOT force classification if unclear.

---

# 🧠 STEP 4: CONSISTENCY RULE

Ensure all responses follow SAME style:

* short structured sentence OR
* normalized phrase format

DO NOT mix formats within output.

---

# 🚨 STEP 5: INVALID / NON-SENSE

Return RED_FLAG if:

* no meaningful sentence exists
* random characters
* pure spam

---

# 🧪 EXAMPLES

Input:
"I think the app is really good and user friendly 😊"

Output:
"Positive feedback on usability and user experience"

---

Input:
"bad very bad worst!!!"

Output:
"Negative feedback"

---

Input:
"um idk maybe it's fine I guess"

Output:
"Uncertain feedback on product"

---

Input:
"!!!!!###"

Output:
RED_FLAG

---

# ⚠️ STRICT RULES

* DO NOT convert to numbers
* DO NOT hardcode sentiment words mapping
* DO NOT lose meaning
* DO NOT over-summarize
* PRESERVE intent ALWAYS
* If value is already clean and structured → return UNCHANGED (wasChanged: false)`;

export async function POST(request: NextRequest) {
  try {
    const body: TextNormalizeRequest = await request.json();
    const { columnName, values } = body;

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

    const userMessage = `Structure and normalize these survey/questionnaire responses from column "${columnName}":\n\n${valueList}\n\nCRITICAL INSTRUCTIONS:
1. Clean each response: remove emojis, filler words, fix light grammar
2. Compress into concise structured form WITHOUT losing meaning
3. Infer intent if possible (positive sentiment, negative sentiment, etc.)
4. Keep ALL responses in consistent style (short structured sentence)
5. "unknown", "n/a", "none", "tbd", "!!!!!" → RED_FLAG
6. Already clean responses → return UNCHANGED (wasChanged: false)
7. Preserve intent ALWAYS — do NOT over-summarize\n\nReturn JSON array: [{"original": "...", "normalized": "... or RED_FLAG", "wasChanged": true/false, "confidence": 0.0-1.0, "reason": "...", "intent": "..."}]`;

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
    let aiResults: Array<{
      original: string; normalized: string | null; wasChanged: boolean;
      confidence: number; reason: string; intent?: string;
    }>;

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
          return NextResponse.json({
            results: cleanedValues.map((v) => ({
              original: v, normalized: null, wasChanged: false,
              confidence: 1.0, reason: "ai_parse_failed",
            })),
            summary: { total: cleanedValues.length, changed: 0, redFlagged: 0, unchanged: cleanedValues.length },
          });
        }
      }
    }

    const aiLookup = new Map<string, { normalized: string; confidence: number; reason: string; intent?: string }>();
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
          intent: r.intent ? String(r.intent) : undefined,
        });
      }
    }

    const fullResults: TextNormalizeResult[] = cleanedValues.map((v) => {
      const lookupKey = v.toLowerCase();

      if (aiRedFlags.has(lookupKey)) {
        return { original: v, normalized: "RED_FLAG", wasChanged: false, confidence: 1.0, reason: "ai_red_flag" };
      }

      const aiMatch = aiLookup.get(lookupKey);
      if (aiMatch) {
        return {
          original: v, normalized: aiMatch.normalized, wasChanged: true,
          confidence: aiMatch.confidence, reason: aiMatch.reason, intent: aiMatch.intent,
        };
      }

      return { original: v, normalized: null, wasChanged: false, confidence: 1.0, reason: "unchanged" };
    });

    const summary = {
      total: fullResults.length,
      changed: fullResults.filter((r) => r.wasChanged).length,
      redFlagged: fullResults.filter((r) => r.normalized === "RED_FLAG").length,
      unchanged: fullResults.filter((r) => !r.wasChanged && r.normalized !== "RED_FLAG").length,
    };

    return NextResponse.json({ results: fullResults, summary });
  } catch (error) {
    console.error("[normalize-text-response] Error:", error);
    return NextResponse.json(
      { error: "Text normalization failed", results: [] },
      { status: 500 }
    );
  }
}
