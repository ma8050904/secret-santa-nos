import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// In-memory rate limiter for Santa chat: max 30 messages per minute per IP
interface ChatRateLimit {
  timestamps: number[];
}
const chatRateLimitMap = new Map<string, ChatRateLimit>();
const CHAT_WINDOW_MS = 60 * 1000;
const CHAT_MAX_PER_WINDOW = 30;

function isChatRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = chatRateLimitMap.get(ip) || { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => now - t < CHAT_WINDOW_MS);

  if (record.timestamps.length >= CHAT_MAX_PER_WINDOW) {
    return true;
  }

  record.timestamps.push(now);
  chatRateLimitMap.set(ip, record);
  return false;
}

const SANTA_SYSTEM_INSTRUCTION = `You are Santa Claus, the legendary, jolly, warm, and magical symbol of Christmas, chatting directly with guests of an exclusive Secret Santa holiday party!

YOUR PERSONALITY & TONE:
- Cheerful, witty, playful, heartwarming, and full of festive wonder.
- Speak naturally with festive expressions (Ho ho ho! 🎅), holiday warmth, and light Christmas humor.
- Use occasional Christmas emojis (🎅, 🎄, 🎁, ❄️, ⭐, 🦌, 🍪) naturally without overusing them.
- Speak conversationally and directly to the person in warm, joyful festive English.

WHAT PARTICIPANTS CAN ASK:
- Casual conversations, holiday greetings, and merry wishes.
- Stories from the North Pole, Mrs. Claus's baking, the busy toy workshop, elves, Rudolph and the 8 reindeer, hot cocoa, and cookies.
- Secret Santa rules: Explain how Secret Santa works (everyone draws a secret recipient, buys a thoughtful gift according to budget, keeps the secret until the big reveal!).
- Gift ideas & inspiration: When asked for gift suggestions, provide creative, thoughtful, practical, and fun suggestions matching that budget!
- Christmas cards, poems, festive jokes, and trivia.
- If asked something you genuinely don't know, respond with cheerful Santa charm.

CRITICAL DATA PRIVACY & SECRET SANTA RULES:
1. You DO NOT have access to the Secret Santa assignment database, recipient pairings, participant lists, or PINs.
2. You must NEVER claim to know, guess, or reveal who has whom in the Secret Santa draw.
3. If anyone asks "Who is my Secret Santa?", "Who did I get?", "Tell me who X got", or tries to guess pairings, playfully decline:
   "Ho ho ho! 🤫 My lips are sealed tighter than a gift box wrapped by my cleverest elves! The true joy of Secret Santa is the surprise! Log in and open your gift box right here on the website to discover your person!"
4. You cannot modify, reset, redraw, or interfere with the Secret Santa assignments or anyone's PIN.
5. Only use details the participant explicitly shares in the current conversation.`;

function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function categorizeError(status: number, message: string): string {
  const lowerMsg = (message || "").toLowerCase();
  if (status === 401 || status === 403 || lowerMsg.includes("api key") || lowerMsg.includes("credential")) {
    return "Authentication failure";
  }
  if (status === 404 || lowerMsg.includes("not found") || lowerMsg.includes("no longer available")) {
    return "Invalid model";
  }
  if (status === 429 && (lowerMsg.includes("quota") || lowerMsg.includes("resource_exhausted") || lowerMsg.includes("per day"))) {
    return "Quota exceeded";
  }
  if (status === 429) {
    return "Rate limit";
  }
  if (status >= 500 && status <= 504) {
    return `Server error (${status})`;
  }
  return `API error (${status})`;
}

// Ordered list of models to try (primary requested model first, followed by high-speed failovers)
const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];

const MODEL_TIMEOUTS: Record<string, number> = {
  "gemini-3.8-flash": 3000,
  "gemini-3.5-flash": 3000,
  "gemini-3.5-flash-lite": 8000,
  "gemini-3.1-flash-lite": 8000,
};

const MODEL_THINKING_LEVELS: Record<string, string> = {
  "gemini-3.8-flash": "LOW",
  "gemini-3.5-flash": "LOW",
  "gemini-3.5-flash-lite": "MINIMAL",
  "gemini-3.1-flash-lite": "MINIMAL",
};

async function callGenerateContent(
  model: string,
  systemInstruction: string,
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>,
  apiKey: string,
  timeoutMs = 6000
): Promise<{ text: string | null; errorCategory?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 450,
          thinkingConfig: {
            thinkingLevel: MODEL_THINKING_LEVELS[model] || "LOW",
          },
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      const rawMsg = errJson?.error?.message || res.statusText || "";
      const category = categorizeError(res.status, rawMsg);
      console.warn(`[Santa AI] ${model} failed -> ${category} (${res.status}): ${rawMsg.slice(0, 100)}`);
      return { text: null, errorCategory: category };
    }

    const data = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof candidateText === "string" && candidateText.trim().length > 0) {
      return { text: candidateText.trim() };
    }

    console.warn(`[Santa AI] ${model} returned empty or invalid response format.`);
    return { text: null, errorCategory: "Invalid response format" };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isTimeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    const category = isTimeout ? "Timeout" : "Network error";
    console.warn(`[Santa AI] ${model} call error -> ${category}: ${err instanceof Error ? err.message : String(err)}`);
    return { text: null, errorCategory: category };
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";

    if (isChatRateLimited(ip)) {
      return NextResponse.json(
        {
          success: false,
          error: "Whoa there, enthusiastic elf! 🦌 Even the reindeer need a moment to catch their breath. Please wait a few seconds before sending another message!",
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Invalid request payload." }, { status: 400 });
    }

    const rawMessage = typeof body.message === "string" ? body.message.trim() : "";
    if (!rawMessage || rawMessage.length === 0) {
      return NextResponse.json({ success: false, error: "Please enter a message for Santa." }, { status: 400 });
    }

    if (rawMessage.length > 600) {
      return NextResponse.json(
        { success: false, error: "Message is too long. Please keep your message under 600 characters." },
        { status: 400 }
      );
    }

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    // Build structured Gemini contents turns: user -> model -> user -> ...
    const formattedContents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

    // Include last 4 turns for rich context
    const cleanHistory = rawHistory
      .slice(-4)
      .filter((item: any) => item && (item.role === "user" || item.role === "santa") && typeof item.content === "string");

    for (const h of cleanHistory) {
      formattedContents.push({
        role: h.role === "santa" ? "model" : "user",
        parts: [{ text: String(h.content).slice(0, 400) }],
      });
    }

    // Add current user turn
    formattedContents.push({
      role: "user",
      parts: [{ text: rawMessage }],
    });

    const apiKey = process.env.GEMINI_API_KEY;
    const defaultFallback =
      "Ho ho ho! 🎅 A sudden North Pole blizzard is causing a little static in my magical communicator! ❄️✨ Give it another try in just a moment, my friend!";

    if (!apiKey) {
      console.warn("[Santa AI] Authentication failure: GEMINI_API_KEY environment variable not set.");
      return NextResponse.json({
        success: true,
        reply: defaultFallback,
        model: "offline-fallback",
      });
    }

    // Cascading failover loop: tries candidate models in order
    let generatedReply: string | null = null;
    let selectedModel = "";
    const failureLog: Array<{ model: string; category: string }> = [];

    for (const candidate of CANDIDATE_MODELS) {
      const timeoutMs = MODEL_TIMEOUTS[candidate] || 6000;
      const result = await callGenerateContent(
        candidate,
        SANTA_SYSTEM_INSTRUCTION,
        formattedContents,
        apiKey,
        timeoutMs
      );

      if (result.text) {
        generatedReply = result.text;
        selectedModel = candidate;
        break;
      } else {
        failureLog.push({ model: candidate, category: result.errorCategory || "Unknown error" });
      }
    }

    if (generatedReply) {
      return NextResponse.json({
        success: true,
        reply: generatedReply,
        model: selectedModel,
      });
    }

    // If all models failed, log the full categorized failure summary
    console.error("[Santa AI] All model attempts failed:", JSON.stringify(failureLog));

    return NextResponse.json({
      success: true,
      reply: defaultFallback,
      model: "all-fallback",
      errorDetails: failureLog.map((f) => `${f.model}: ${f.category}`).join(", "),
    });
  } catch (err) {
    console.error("[Santa AI] Unexpected server error in /api/santa/chat:", err);
    return NextResponse.json(
      {
        success: true,
        reply: "Ho ho ho! 🎅 The toy workshop is bustling with activity right now! Give me just a second and try asking again! 🎄✨",
        model: "error-fallback",
      },
      { status: 200 }
    );
  }
}
