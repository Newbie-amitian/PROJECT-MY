import { NextRequest, NextResponse } from "next/server";
import ZAI from "@/lib/ai-provider";

// ============================================================
// AI-Powered Country Code Resolution
// ============================================================
// Resolves city names, state names, country names, and other
// geographic references to their ISO 3166-1 alpha-2 codes.
//
// Examples:
//   "Delhi" → "IN" (India)
//   "California" → "US" (United States)
//   "Mumbai" → "IN" (India)
//   "New York" → "US" (United States)
//   "Bavaria" → "DE" (Germany)
//   "Queensland" → "AU" (Australia)
//
// Values already valid ISO alpha-2 → unchanged (wasChanged: false)
// Unresolvable → RED_FLAG
// ============================================================

interface ResolveRequest {
  columnName: string;
  values: string[];
}

interface ResolveResult {
  original: string;
  resolved: string | null; // null = no change, "RED_FLAG" = invalid
  wasChanged: boolean;
  confidence: number;
  reason: string;
}

const VALID_ISO_ALPHA2 = new Set([
  "AF","AX","AL","DZ","AS","AD","AO","AI","AQ","AG","AR","AM","AW","AU","AT","AZ",
  "BS","BH","BD","BB","BY","BE","BZ","BJ","BM","BT","BO","BQ","BA","BW","BR","IO",
  "BN","BG","BF","BI","CV","KH","CM","CA","KY","CF","TD","CL","CN","CX","CC","CO",
  "KM","CG","CD","CK","CR","CI","HR","CU","CW","CY","CZ","DK","DJ","DM","DO","EC",
  "EG","SV","GQ","ER","EE","SZ","ET","FK","FO","FJ","FI","FR","GF","PF","TF","GA",
  "GM","GE","DE","GH","GI","GR","GL","GD","GP","GU","GT","GG","GN","GW","GY","HT",
  "HM","VA","HN","HK","HU","IS","IN","ID","IR","IQ","IE","IM","IL","IT","JM","JE",
  "JO","JP","KE","KI","KP","KR","KW","KG","LA","LV","LB","LS","LR","LY","LI","LT",
  "LU","MO","MG","MW","MY","MV","ML","MT","MH","MQ","MR","MU","YT","MX","FM","MD",
  "MC","MN","ME","MS","MA","MZ","MM","NA","NR","NP","NL","NC","NZ","NI","NE","NG",
  "NU","NF","MK","MP","NO","OM","PK","PW","PS","PA","PG","PY","PE","PH","PN","PL",
  "PT","PR","QA","RE","RO","RU","RW","BL","SH","KN","LC","MF","PM","VC","WS","SM",
  "ST","SA","SN","RS","SC","SL","SG","SX","SK","SI","SB","SO","ZA","GS","SS","ES",
  "LK","SD","SR","SJ","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TK","TO","TT",
  "TN","TR","TM","TC","TV","UG","UA","AE","GB","US","UM","UY","UZ","VU","VE","VN",
  "VG","VI","WF","EH","YE","ZM","ZW",
]);

const SYSTEM_PROMPT = `You are a COUNTRY CODE RESOLUTION engine. Your ONLY job is to map geographic references to ISO 3166-1 alpha-2 country codes.

STRICT RULES:
1. Output MUST be exactly 2 uppercase letters (ISO 3166-1 alpha-2)
2. If input is already a valid ISO code → return it UNCHANGED (wasChanged: false)
3. If input is a city, state, province, or territory → find the country it belongs to
4. If input is a full country name (e.g., "India", "Germany") → convert to ISO code
5. If input is an abbreviation (e.g., "UK", "USA") → convert to ISO code (UK→GB, USA→US)
6. "unknown", "n/a", "none", "null", "", "?", "!" → RED_FLAG
7. If the value CANNOT be resolved to any country → RED_FLAG
8. NEVER guess — if ambiguous (e.g., "Georgia" could be US state or country), prefer the COUNTRY (GE)

EXAMPLES:
- "Delhi" → "IN" (city in India)
- "Mumbai" → "IN" (city in India)
- "California" → "US" (state in USA)
- "New York" → "US" (state in USA)
- "Bavaria" → "DE" (state in Germany)
- "Queensland" → "AU" (state in Australia)
- "Ontario" → "CA" (province in Canada)
- "India" → "IN"
- "United States" → "US"
- "Germany" → "DE"
- "UK" → "GB"
- "USA" → "US"
- "IN" → "IN" (already valid, wasChanged: false)
- "US" → "US" (already valid, wasChanged: false)
- "xyz123" → RED_FLAG
- "unknown" → RED_FLAG

Return JSON array: [{"original": "...", "resolved": "XX or RED_FLAG", "wasChanged": true/false, "confidence": 0.0-1.0, "reason": "..."}]`;

export async function POST(request: NextRequest) {
  try {
    const body: ResolveRequest = await request.json();
    const { columnName, values } = body;

    if (!values || !Array.isArray(values) || values.length === 0) {
      return NextResponse.json({ results: [] });
    }

    // Pre-filter: skip values already valid ISO codes
    const needsResolution: string[] = [];
    const alreadyValid: Map<string, string> = new Map(); // original → uppercase

    for (const v of values) {
      const trimmed = String(v ?? "").trim();
      if (trimmed === "") continue;
      const upper = trimmed.toUpperCase();
      if (VALID_ISO_ALPHA2.has(upper)) {
        alreadyValid.set(trimmed, upper);
      } else {
        needsResolution.push(trimmed);
      }
    }

    if (needsResolution.length === 0) {
      // All values already valid
      return NextResponse.json({
        results: [...alreadyValid.entries()].map(([orig, upper]) => ({
          original: orig,
          resolved: orig !== upper ? upper : null,
          wasChanged: orig !== upper,
          confidence: 1.0,
          reason: orig !== upper ? "uppercase_fix" : "already_valid",
        })),
        summary: { total: values.length, resolved: 0, alreadyValid: alreadyValid.size, redFlagged: 0 },
      });
    }

    const uniqueNeeds = [...new Set(needsResolution)];
    const valueList = uniqueNeeds.map((v, i) => `${i + 1}. "${v}"`).join("\n");

    const userMessage = `Resolve these values from column "${columnName}" to ISO 3166-1 alpha-2 country codes:\n\n${valueList}\n\nRemember: Output must be exactly 2 uppercase letters. If a value is a city/state/province, find which country it belongs to.`;

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
    let aiResults: Array<{ original: string; resolved: string | null; wasChanged: boolean; confidence: number; reason: string }>;

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
            results: [...alreadyValid.entries()].map(([orig, upper]) => ({
              original: orig,
              resolved: orig !== upper ? upper : null,
              wasChanged: orig !== upper,
              confidence: 1.0,
              reason: "already_valid",
            })),
            summary: { total: values.length, resolved: 0, alreadyValid: alreadyValid.size, redFlagged: 0 },
          });
        }
      }
    }

    // Build AI lookup
    const aiLookup = new Map<string, { resolved: string; confidence: number; reason: string }>();
    const aiRedFlags = new Set<string>();

    for (const r of aiResults) {
      const key = String(r.original || "").trim().toLowerCase();
      if (r.resolved === "RED_FLAG") {
        aiRedFlags.add(key);
      } else if (r.resolved && r.wasChanged) {
        // Validate that AI returned a valid ISO code
        const upper = String(r.resolved).toUpperCase().trim();
        if (VALID_ISO_ALPHA2.has(upper)) {
          aiLookup.set(key, {
            resolved: upper,
            confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0.7)),
            reason: String(r.reason || "ai_resolved"),
          });
        }
        // If AI returned non-ISO code, ignore (don't trust it)
      }
    }

    // Build final results combining already-valid + AI-resolved
    const fullResults: ResolveResult[] = [];

    // Add already-valid entries
    for (const [orig, upper] of alreadyValid) {
      fullResults.push({
        original: orig,
        resolved: orig !== upper ? upper : null,
        wasChanged: orig !== upper,
        confidence: 1.0,
        reason: orig !== upper ? "uppercase_fix" : "already_valid",
      });
    }

    // Add AI-resolved entries
    for (const v of needsResolution) {
      const key = v.toLowerCase();
      const aiMatch = aiLookup.get(key);
      if (aiMatch) {
        fullResults.push({
          original: v,
          resolved: aiMatch.resolved,
          wasChanged: true,
          confidence: aiMatch.confidence,
          reason: aiMatch.reason,
        });
      } else if (aiRedFlags.has(key)) {
        fullResults.push({
          original: v,
          resolved: "RED_FLAG",
          wasChanged: false,
          confidence: 1.0,
          reason: "invalid_unresolvable",
        });
      } else {
        // AI didn't match this value — keep as-is, flag for review
        fullResults.push({
          original: v,
          resolved: null,
          wasChanged: false,
          confidence: 0.5,
          reason: "no_ai_match",
        });
      }
    }

    const summary = {
      total: fullResults.length,
      resolved: fullResults.filter((r) => r.wasChanged && r.resolved !== "RED_FLAG").length,
      alreadyValid: alreadyValid.size,
      redFlagged: fullResults.filter((r) => r.resolved === "RED_FLAG").length,
    };

    return NextResponse.json({ results: fullResults, summary });
  } catch (error) {
    console.error("[resolve-country-codes] Error:", error);
    return NextResponse.json(
      { error: "Country code resolution failed", results: [] },
      { status: 500 }
    );
  }
}
