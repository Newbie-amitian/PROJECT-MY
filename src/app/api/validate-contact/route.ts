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
// AI-Powered Contact Validation — Email + Phone via Groq
// ============================================================
// Uses LLM to intelligently validate and fix email addresses
// and phone numbers. Goes beyond simple regex — understands
// context, common patterns, and suggests fixes dynamically.
//
// Features:
//   - Email: typo detection, domain suggestions, format fixes
//   - Phone: country code detection, digit count validation,
//     format standardization based on country context

interface ContactValidationRequest {
  columnName: string;
  contactType: "email" | "phone" | "lastname" | "auto"; // auto-detect from column name + values
  values: string[];
}

interface ContactValidationResult {
  original: string;
  validated: string | null; // null = keep original (valid or unfixable)
  isValid: boolean;
  confidence: number; // 0.0–1.0
  issue: string; // "none" | "missing_at" | "invalid_domain" | "typo" | "missing_digits" | "too_short" | "too_long" | "wrong_format" | "non_numeric"
  suggestion: string | null; // AI-suggested fix
  ai_fallback_required?: boolean; // true if AI was needed because regex/rules failed
}

export async function POST(request: NextRequest) {
  try {
    const body: ContactValidationRequest = await request.json();
    const { columnName, contactType, values } = body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Filter out null/empty values
    const nonEmpty = values.filter((v) => v != null && String(v).trim() !== "");
    if (nonEmpty.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Auto-detect contact type if not specified
    let detectedType = contactType;
    if (contactType === "auto") {
      const emailCount = nonEmpty.filter((v) => /@/.test(v)).length;
      const phoneDigits = nonEmpty.filter((v) => /^\+?[\d\s\-()]{7,}$/.test(v.trim())).length;
      const colLower = columnName.toLowerCase();
      const emailHint = /email|e_mail|mail/.test(colLower);
      const phoneHint = /phone|mobile|tel|cell|contact/.test(colLower);
      const lastNameHint = /last_name|lastname|lname|surname|family_name/.test(colLower);

      if (lastNameHint) {
        detectedType = "lastname";
      } else if (emailHint || emailCount > nonEmpty.length * 0.5) {
        detectedType = "email";
      } else if (phoneHint || phoneDigits > nonEmpty.length * 0.5) {
        detectedType = "phone";
      } else {
        detectedType = emailCount > phoneDigits ? "email" : "phone";
      }
    }

    // Build the value list for the prompt
    const valueList = nonEmpty.map((v, i) => `${i + 1}. "${v}"`).join("\n");

    const systemPrompt = detectedType === "email"
      ? `You are a FALLBACK email validation engine. You are ONLY called when regex/rules failed to handle the value.

═════════════════════════════
FALLBACK PRINCIPLES
═════════════════════════════
- You are a FALLBACK validator. Only process values that regex couldn't handle.
- Prefer correction over deletion. DO NOT lose useful data.
- If you can identify a plausible email, fix it. Only mark invalid if truly unfixable.

═════════════════════════════
VALIDATION RULES
═════════════════════════════

A VALID email MUST have:
1. Exactly one "@" symbol
2. A local part (before @) that is not empty
3. A domain part (after @) with at least one dot
4. No spaces in the email
5. MANDATORY: Final output email MUST always be lowercase

COMMON FIXES (auto-apply if confident):
- Remove spaces: "john doe@gmail.com" → "johndoe@gmail.com"
- Lowercase: "John@Gmail.COM" → "john@gmail.com"
- Fix "at" → "@": "john at gmail.com" → "john@gmail.com"
- Fix "dot" → ".": "john dot doe at gmail dot com" → "john.doe@gmail.com"
- Fix trailing/leading whitespace
- Common domain typos: "gmail.co" → "gmail.com", "yahooo.com" → "yahoo.com", "gmial.com" → "gmail.com"
- Missing TLD: "john@gmail" → "john@gmail.com"

DO NOT suggest fixes for:
- Completely garbled strings that don't resemble emails
- Values that are clearly not email addresses (names, numbers, etc.)

═════════════════════════════
OUTPUT FORMAT
═══════════════════════════
Return ONLY valid JSON array. No markdown, no explanation outside JSON.
Each element:
{
  "original": "the original value string",
  "validated": "the corrected email or null if valid as-is",
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "issue": "none|missing_at|invalid_domain|typo|wrong_format|non_email",
  "suggestion": "brief explanation of fix or null",
  "ai_fallback_required": true
}

CRITICAL: Be precise with fixes. If unsure, set isValid=false and confidence<0.5.
CRITICAL: Always set ai_fallback_required to true since you are the fallback validator.`
      : detectedType === "lastname"
      ? `You are an AI last name validation engine. You validate and correct last name values intelligently.

VALIDATION PRINCIPLES:
- A last name is a SINGLE word — family name / surname
- Strip numbers, special characters, emojis
- Apply proper case (capitalize first letter, lowercase rest)
- Prefer correction over deletion. DO NOT lose useful data.

RULES:

VALID last name:
- Single alphabetic word: "Smith", "Patel", "Nakamura"
- May contain apostrophes: "O'Connor", "D'Angelo"
- May contain hyphens: "Smith-Jones", "Garcia-Lopez"
- Proper case output: "smith" → "Smith", "SMITH" → "Smith"

INVALID (flag, do NOT correct):
- Multiple separate words: "Van Der Berg" → flag as invalid (too many words, not a single last name)
- Pure numbers: "12345" → flag
- Gibberish: "xyzabc" → flag
- Emails/phones in last name column → flag

FIXABLE:
- Has numbers attached: "Smith123" → "Smith" (strip digits)
- Has special chars: "Smith!" → "Smith"
- Wrong case: "SMITH" → "Smith"
- Has trailing/leading spaces

OUTPUT FORMAT:
Return ONLY valid JSON array. No markdown, no explanation outside JSON.
Each element:
{
  "original": "the original value string",
  "validated": "the corrected last name or null if valid as-is",
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "issue": "none|multiple_words|non_alpha|gibberish|too_short|contains_numbers",
  "suggestion": "brief explanation of fix or null",
  "ai_fallback_required": true
}

CRITICAL: validated output must be proper case. Always set ai_fallback_required to true.`
      : `You are a FALLBACK phone number validation engine. You are ONLY called when regex/rules failed to handle the value.

═════════════════════════════
FALLBACK PRINCIPLES
═════════════════════════════
- You are a FALLBACK validator. Only process values that regex couldn't handle.
- Prefer correction over deletion. DO NOT lose useful data.
- If you can identify a plausible phone number, fix it. Only mark invalid if truly unfixable.
- CRITICAL: Each column uses ONLY its own validation logic. NEVER apply phone regex to email columns or vice versa.

═════════════════════════════
VALIDATION RULES
═════════════════════════════

A VALID phone number has:
1. 7-15 digits (international standard ITU-T E.164)
2. Optional leading "+" for country code
3. May contain formatting: spaces, dashes, parens, dots
4. No letters (except possible "x" for extension)

COUNTRY CODE NORMALIZATION (apply in this exact order):
1. "00XXXXXXXXXX" → "+XXXXXXXXXX" (replace leading 00 with +)
2. "0XXXXXXXXXX" (leading zero with 9+ digits after stripping zero) → "+91XXXXXXXXX" (assume India)
3. 10 digits starting with 6-9 → add +91 prefix (India mobile)

ADDITIONAL COUNTRY CODE DETECTION:
- India: +91, 10-digit numbers starting with 6-9
- US/Canada: +1, 10-digit numbers
- UK: +44, 10-11 digit numbers
- If no country code and 10 digits → likely US/India (infer from context)
- If no country code and >10 digits → likely includes country code

COMMON FIXES:
- Strip all non-digit characters (except leading +)
- Remove extensions: "12345 x123" → "12345"
- Fix double-spaces, misplaced dashes
- Normalize: "(123) 456-7890" → "+11234567890" or "1234567890"
- If digits < 7: FLAG as too_short
- If digits > 15: FLAG as too_long
- If contains letters (not extension): FLAG as non_numeric

DO NOT suggest fixes for:
- Completely garbled strings
- Values clearly not phone numbers

═════════════════════════════
OUTPUT FORMAT
═════════════════════════════
Return ONLY valid JSON array. No markdown, no explanation outside JSON.
Each element:
{
  "original": "the original value string",
  "validated": "the corrected phone or null if valid as-is",
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "issue": "none|missing_digits|too_short|too_long|wrong_format|non_numeric|invalid_country_code",
  "suggestion": "brief explanation of fix or null",
  "ai_fallback_required": true
}

CRITICAL: Preserve all valid digits. Be conservative — when unsure, flag but don't change.
CRITICAL: Always set ai_fallback_required to true since you are the fallback validator.`;

    const userMessage = `Validate these ${detectedType} values from column "${columnName}":\n\n${valueList}\n\nReturn JSON array of validation results.`;

    const zai = await getZAI();
    const completion = await zai.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 4096,
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content || "";
    let results: ContactValidationResult[];

    // Parse JSON from response
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
            original: v,
            validated: null,
            isValid: detectedType === "email"
              ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
              : v.trim().replace(/\D/g, "").length >= 7 && v.trim().replace(/\D/g, "").length <= 15,
            confidence: 0.5,
            issue: "none" as const,
            suggestion: null,
          }));
        }
      }
    }

    // Validate and normalize results
    const validated: ContactValidationResult[] = results.map((r) => ({
      original: String(r.original ?? ""),
      validated: r.validated !== null && r.validated !== undefined ? String(r.validated) : null,
      isValid: Boolean(r.isValid),
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.5)),
      issue: String(r.issue || "none"),
      suggestion: r.suggestion ? String(r.suggestion) : null,
      ai_fallback_required: Boolean(r.ai_fallback_required),
    }));

    return NextResponse.json({
      contactType: detectedType,
      results: validated,
      summary: {
        total: validated.length,
        valid: validated.filter((r) => r.isValid).length,
        invalid: validated.filter((r) => !r.isValid).length,
        fixable: validated.filter((r) => r.validated !== null).length,
      },
    });
  } catch (error) {
    console.error("[validate-contact] Error:", error);
    return NextResponse.json(
      { error: "Contact validation failed", results: [] },
      { status: 500 }
    );
  }
}
