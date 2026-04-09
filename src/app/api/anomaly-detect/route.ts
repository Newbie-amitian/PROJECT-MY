import { NextRequest, NextResponse } from "next/server";
import ZAI, { type ZAIInstance } from "@/lib/ai-provider";

// ── ZAI instance (reuse across requests) ──────────────
let zaiInstance: ZAIInstance | null = null;

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// ============================================================
// AI-Powered Anomaly Detection — EMOJI & BANNED WORDS ONLY
// ============================================================
// Uses LLM to detect ONLY emoji values and banned/dangerous patterns.
// The deterministic rule engine handles ALL other cleaning (trim, null,
// numeric, categorical clustering, canonical mapping, etc.).
//
// This API is a SUPPLEMENT to rules, NOT a replacement.
// It ONLY flags: emoji, garbage tokens, banned/injection patterns.
// It does NOT detect abbreviations, misspellings, or replace values.

interface AnomalyRequest {
  columnName: string;
  columnType: string;
  values: string[];
}

interface AnomalyResult {
  value: string;
  flagged: boolean;
  reason: string; // "none" | "emoji" | "garbage" | "banned_word"
}

export async function POST(request: NextRequest) {
  try {
    const body: AnomalyRequest = await request.json();
    const { columnName, columnType, values } = body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Filter out empty/null values before sending to AI
    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    if (nonEmpty.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Build the prompt with ALL values and context
    const valueList = nonEmpty.map((v, i) => `${i + 1}. "${v}"`).join("\n");

    const systemPrompt = `You are an anomaly detection engine for tabular data. Your ONLY job is to flag EMOJI values and BANNED/DANGEROUS patterns. You must NOT flag abbreviations, misspellings, or valid categorical values.

═════════════════════════════
RULE 1: EMOJI ANOMALY (RED FLAG)
═════════════════════════════
If a value contains ANY emoji (😀, 🧠, 🔥, ✅, ❌, etc.) or Unicode symbols that are not normal text → FLAG it.
- Pure emoji values (e.g., "👍", "🔥") → FLAG
- Text mixed with emojis (e.g., "Pending👍", "Done ✅") → FLAG
- Values that are ONLY emoji or symbols → FLAG

═════════════════════════════
RULE 2: GARBAGE TOKENS (RED FLAG)
═════════════════════════════
Flag values that are clearly garbage/random symbols:
- "???", "!!!", "---", "~~~", "????"
- Pure symbol strings with no letters or numbers

═════════════════════════════
RULE 3: BANNED/DANGEROUS PATTERNS (RED FLAG)
═════════════════════════════
Flag if value contains suspicious/injection content:
- "hack", "inject", "override", "system", "root", "admin"
- "malware", "script", "sql", "drop", "delete", "truncate"
- "eval", "exec", "cmd", "<script>", etc.

═════════════════════════════
RULE 4: NORMAL VALUES — DO NOT FLAG
═════════════════════════════
DO NOT flag:
- Normal text values (even if short like "P", "A", "WFH")
- Valid categories (even if misspelled)
- Abbreviations or shortened forms
- Numbers or dates
- Any value that is real text data

═════════════════════════════
OUTPUT FORMAT
═════════════════════════════
Return ONLY valid JSON array. No markdown, no explanation outside JSON.
Each element:
{
  "value": "the original value string",
  "flagged": true/false,
  "reason": "emoji | garbage | banned_word | none"
}

CRITICAL:
- Be CONSERVATIVE — only flag what is clearly emoji, garbage, or dangerous.
- Normal abbreviations ("P", "A", "C") are NOT anomalies.
- Misspelled words ("Delivrd") are NOT anomalies — the rule engine handles those.
- A value is ONLY anomalous if it contains emoji/symbols/banned patterns.`;

    const userMessage = `Analyze these values from column "${columnName}" (type: ${columnType}):\n\n${valueList}\n\nReturn JSON array of anomaly results. Only flag emoji, garbage tokens, and banned patterns.`;

    const zai = await getZAI();
    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 2048,
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content || "";
    let results: AnomalyResult[];

    // Parse JSON from response (handle markdown code blocks)
    try {
      results = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[1].trim());
      } else {
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          results = JSON.parse(arrayMatch[0]);
        } else {
          results = nonEmpty.map((v) => ({
            value: v,
            flagged: false,
            reason: "none" as const,
          }));
        }
      }
    }

    // Validate and normalize results — only allow emoji/garbage/banned_word reasons
    const ALLOWED_REASONS = new Set(["emoji", "garbage", "banned_word", "none"]);
    const validated: AnomalyResult[] = results.map((r) => ({
      value: String(r.value ?? ""),
      flagged: Boolean(r.flagged) && ALLOWED_REASONS.has(String(r.reason ?? "")),
      reason: ALLOWED_REASONS.has(String(r.reason ?? "")) ? String(r.reason) : "none",
    }));

    return NextResponse.json({ results: validated });
  } catch (error) {
    console.error("[anomaly-detect] Error:", error);
    return NextResponse.json(
      { error: "Anomaly detection failed", results: [] },
      { status: 500 }
    );
  }
}
