import { NextRequest, NextResponse } from "next/server";
import ZAI, { type ZAIInstance } from "@/lib/ai-provider";

// ============================================================
// AI-Powered Phone Number Formatting (E.164 Universal Format)
// ============================================================
// After validation, formats all valid phone numbers into
// a consistent universal format with country code detection.
//
// E.164 format: +CCNNNNNNNNNNN
// Examples:
//   "9876543210" → "+919876543210"
//   "(123) 456-7890" → "+11234567890"
//   "+44 20 7946 0958" → "+442079460958" (already formatted, keep)
//
// POST body: { columnName: string, values: string[] }
// Returns: { results: Array<{ original, formatted, wasChanged }> }

interface PhoneFormatRequest {
  columnName: string;
  values: string[];
}

let zaiInstance: ZAIInstance | null = null;

async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

export async function POST(request: NextRequest) {
  try {
    const body: PhoneFormatRequest = await request.json();
    const { columnName, values } = body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    if (nonEmpty.length === 0) return NextResponse.json({ results: [] });

    const valueList = nonEmpty.map((v, i) => `${i + 1}. "${v}"`).join("\n");

    const systemPrompt = `You are a phone number formatting engine. Your ONLY job is to convert phone numbers to standard E.164 international format (+XXXXXXXXXXX).

RULES:
1. Strip ALL formatting: spaces, dashes, parentheses, dots
2. Add country code if missing:
   - 10 digits starting with 6-9 (India mobile) → add +91 prefix
   - 10 digits (US pattern) → add +1 prefix  
   - If already has + prefix and looks valid → keep as-is
   - If starts with "00" → replace with "+"
3. Output format: +XXXXXXXXXXXXX (no spaces, no dashes, just + and digits)
4. If a value doesn't look like a phone number → return it unchanged with wasChanged=false
5. Do NOT flag or change invalid phone numbers — only format valid ones

EXAMPLES:
- "9876543210" → "+919876543210"
- "(123) 456-7890" → "+11234567890"
- "+44 20 7946 0958" → "+442079460958"
- "98765 43210" → "+919876543210"
- "+1-800-555-1234" → "+18005551234"

RESPOND WITH VALID JSON ONLY. No markdown. No explanation.
Format: {"results": [{"original": "the original", "formatted": "+XXXXXXXXX", "wasChanged": true/false}]}

CRITICAL: The "results" array MUST have the same length as the input "values" array.`;

    const userMessage = `Format these phone numbers from column "${columnName}" to E.164 international format:\n\n${valueList}\n\nReturn JSON with "results" array.`;

    const zai = await getZAI();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content || "";
    let results: Array<{ original: string; formatted: string; wasChanged: boolean }>;

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      const parsed = JSON.parse(jsonMatch[0]);
      results = parsed.results || [];
    } catch {
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        results = JSON.parse(arrayMatch[0]);
      } else {
        results = nonEmpty.map((v) => ({ original: v, formatted: v, wasChanged: false }));
      }
    }

    // Pad or trim to match input length
    while (results.length < nonEmpty.length) {
      results.push({ original: nonEmpty[results.length], formatted: nonEmpty[results.length], wasChanged: false });
    }

    return NextResponse.json({
      results: results.slice(0, nonEmpty.length),
      summary: {
        total: nonEmpty.length,
        changed: results.filter((r) => r.wasChanged).length,
        unchanged: results.filter((r) => !r.wasChanged).length,
      },
    });
  } catch (error) {
    console.error("[format-phones] Error:", error);
    return NextResponse.json({ error: "Phone formatting failed", results: [] }, { status: 500 });
  }
}
