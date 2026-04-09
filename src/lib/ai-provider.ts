// ============================================================
// AI Provider — Single switch between Z.ai SDK and Groq API
// ============================================================
//
// HOW TO USE ON YOUR LAPTOP (Groq-only, local mode):
//
//   1. Get a free Groq API key: https://console.groq.com/keys
//   2. In your .env.local file, add:
//
//        AI_PROVIDER=groq
//        GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxx
//
//   3. That's it!  All 19 API routes will use Groq directly.
//
// HOW TO USE WITH Z.AI SDK (cloud/deployed):
//
//   1. Set in .env.local:
//
//        AI_PROVIDER=zai
//
//   2. Or just leave AI_PROVIDER unset — defaults to "zai".
//
// ============================================================

import type { ChatCompletionResponse } from "./groq";

const PROVIDER = (process.env.AI_PROVIDER || "zai").toLowerCase().trim();

let providerLog = false;

function logOnce(msg: string) {
  if (!providerLog) {
    console.log(`\n🤖 [ai-provider] Using: ${msg}\n`);
    providerLog = true;
  }
}

// ── Instance type — matches the return shape of ZAI.create() ──

export interface ZAIInstance {
  chat: {
    completions: {
      create(params: {
        model?: string;
        messages: { role: string; content: string }[];
        max_tokens?: number;
        temperature?: number;
      }): Promise<ChatCompletionResponse>;
    };
  };
}

/**
 * Create an AI instance with the exact same shape as `ZAI.create()`.
 *
 * All routes do:
 *   import ZAI from "@/lib/ai-provider";
 *   const zai = await ZAI.create();
 *   const completion = await zai.chat.completions.create({...});
 *
 * The provider is chosen once at server startup via AI_PROVIDER env var.
 */
async function create(): Promise<ZAIInstance> {
  if (PROVIDER === "groq") {
    logOnce("🟢 Groq API (direct — requires GROQ_API_KEY)");
    // Dynamic import — only loads groq.ts when needed
    const { default: GroqProvider } = await import("./groq");
    return GroqProvider.create() as Promise<ZAIInstance>;
  }

  // Default: z-ai-web-dev-sdk
  logOnce("🔵 Z.ai SDK (z-ai-web-dev-sdk)");
  const ZAI = await import("z-ai-web-dev-sdk");
  return ZAI.default.create() as Promise<ZAIInstance>;
}

const AIBridge = { create };
export default AIBridge;
