// ============================================================
// Groq API Client — Drop-in replacement for z-ai-web-dev-sdk
// ============================================================
// Uses the user's Groq API key directly.
// 100% compatible with z-ai-web-dev-sdk's `ZAI.create()` shape.
//
// To use: set GROQ_API_KEY in .env.local and set
//   AI_PROVIDER=groq   (or leave unset / set to "zai" for Z.ai SDK)

import type { ColClass } from "./data-utils";

const GROQ_BASE = "https://api.groq.com/openai/v1";

// ── Type definitions (match z-ai-web-dev-sdk shape) ──────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionParams {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface ChatCompletionChoice {
  message?: { content?: string; role?: string };
  finish_reason?: string;
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ── Helper functions (low-level) ────────────────────────

/**
 * Send a raw chat completion request to Groq API.
 * Returns the full response object (same shape as OpenAI).
 */
export async function groqRawChat(
  params: ChatCompletionParams
): Promise<ChatCompletionResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to your .env.local file.\n" +
      "Get a free key at https://console.groq.com/keys"
    );
  }

  const {
    model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    messages,
    max_tokens = 4096,
    temperature = 0.1,
  } = params;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, max_tokens, temperature }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq API ${res.status}: ${errText.slice(0, 300)}`);
  }

  return res.json();
}

/**
 * Send a chat completion and return only the content string.
 */
export async function groqChat(
  options: ChatCompletionParams
): Promise<string> {
  const data = await groqRawChat(options);
  return data.choices?.[0]?.message?.content || "";
}

/**
 * Send a chat completion and parse JSON response.
 * Strips markdown code blocks automatically.
 */
export async function groqChatJSON<T>(
  options: ChatCompletionParams
): Promise<T> {
  const raw = await groqChat(options);
  const cleaned = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);

    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);

    throw new Error(`Failed to parse Groq JSON: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Column classification types for smart merge (returned by Groq).
 */
export interface MergeClassifyResult {
  header: string;
  mergeClass: ColClass;
  reasoning: string;
}

// ── SDK-compatible `create()` — drop-in replacement ──────
//
// This is the key function.  It returns an object with the
// EXACT same shape as `await ZAI.create()`, so every route
// can use it identically:
//
//   import ZAI from "@/lib/ai-provider";
//   const zai = await ZAI.create();
//   const completion = await zai.chat.completions.create({...});

interface ZAIInstance {
  chat: {
    completions: {
      create(
        params: ChatCompletionParams
      ): Promise<ChatCompletionResponse>;
    };
  };
}

/**
 * Create a Groq-backed ZAI-compatible instance.
 * Mirrors `ZAI.create()` from z-ai-web-dev-sdk exactly.
 */
export async function create(): Promise<ZAIInstance> {
  // Pre-validate the key so errors surface early
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "[groq] GROQ_API_KEY is not set. Add it to .env.local\n" +
      "Get a free key at https://console.groq.com/keys"
    );
  }

  return {
    chat: {
      completions: {
        create: (params: ChatCompletionParams) => groqRawChat(params),
      },
    },
  };
}

// ── Default export matches `import ZAI from "z-ai-web-dev-sdk"` ──
const GroqProvider = { create };
export default GroqProvider;
