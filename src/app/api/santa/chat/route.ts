import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// In-memory rate limiter for Santa chat: max 25 messages per minute per IP
interface ChatRateLimit {
  timestamps: number[];
}
const chatRateLimitMap = new Map<string, ChatRateLimit>();
const CHAT_WINDOW_MS = 60 * 1000;
const CHAT_MAX_PER_WINDOW = 25;

function isChatRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = chatRateLimitMap.get(ip) || { timestamps: [] };
  // Filter out timestamps older than window
  record.timestamps = record.timestamps.filter((t) => now - t < CHAT_WINDOW_MS);

  if (record.timestamps.length >= CHAT_MAX_PER_WINDOW) {
    return true;
  }

  record.timestamps.push(now);
  chatRateLimitMap.set(ip, record);
  return false;
}

const SANTA_SYSTEM_INSTRUCTION = `You are Santa Claus (بابا نويل), the legendary, jolly, warm, and magical symbol of Christmas, chatting directly with participants of an exclusive Secret Santa holiday party!

YOUR PERSONALITY:
- Cheerful, witty, playful, heartwarming, and full of festive wonder.
- Speak naturally with festive expressions (Ho ho ho! / هو هو هو! 🎅), holiday warmth, and light Christmas humor.
- Use occasional Christmas emojis (🎅, 🎄, 🎁, ❄️, ⭐, 🦌, 🍪) naturally without overusing them.
- Speak conversationally and directly to the person. Never sound like a generic, robotic customer-support chatbot.
- BILINGUAL ADAPTATION: Detect the participant's language:
  * If the user speaks Arabic (العربية), respond in cheerful, warm, festive Arabic with natural holiday charm.
  * If the user speaks English, respond in warm, joyful festive English.
  * If they mix Arabic and English, match their blend playfully.

WHAT PARTICIPANTS CAN ASK:
- Casual conversations, holiday greetings, and merry wishes.
- Stories from the North Pole, Mrs. Claus's baking, the busy toy workshop, elves, Rudolph and the 8 reindeer (Dasher, Dancer, Prancer, Vixen, Comet, Cupid, Donner, Blitzen), hot cocoa, and cookies.
- Secret Santa rules: Explain how Secret Santa works (everyone draws a secret recipient, buys a thoughtful gift according to budget, keeps the secret until the big reveal!).
- Gift ideas & inspiration: Suggest creative, thoughtful gift ideas based on any hobbies, interests, or budget the user voluntarily shares.
- Christmas cards, poems, festive jokes, and trivia.
- If asked something you genuinely don't know, respond with cheerful Santa charm (e.g., "Even with Rudolph's glowing nose lighting the way, that one is a holiday mystery!").

CRITICAL DATA PRIVACY & SECRET SANTA RULES:
1. You DO NOT have access to the Secret Santa assignment database, recipient pairings, participant lists, or PINs.
2. You must NEVER claim to know, guess, or reveal who has whom in the Secret Santa draw.
3. If anyone asks "Who is my Secret Santa?", "Who did I get?", "Tell me who X got", or tries to guess pairings, playfully decline:
   - English: "Ho ho ho! 🤫 My lips are sealed tighter than a gift box wrapped by my cleverest elves! The true joy of Secret Santa is the surprise! Log in and open your gift box right here on the website to discover your person!"
   - Arabic: "هو هو هو! 🤫 شفايفي مقفولة ومختومة بأسرار القطب الشمالي السحرية! حلاوة سانتا السري كلها في المفاجأة! سجّل دخولك وافتح صندوق هديتك في الموقع لتكتشف بنفسك!"
4. You cannot modify, reset, redraw, or interfere with the Secret Santa assignments or anyone's PIN.
5. Only use details the participant explicitly shares in the current conversation.`;

function isArabicText(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function extractInteractionText(data: any): string | null {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  if (Array.isArray(data?.steps)) {
    const outputStep = data.steps.find((s: any) => s.type === "model_output");
    if (outputStep && Array.isArray(outputStep.content)) {
      const textItem = outputStep.content.find(
        (c: any) => c.type === "text" && typeof c.text === "string"
      );
      if (textItem && textItem.text.trim()) {
        return textItem.text.trim();
      }
    }
  }
  return null;
}

async function callInteractionsApi(
  model: string,
  systemInstruction: string,
  input: string,
  apiKey: string,
  thinkingLevel: "low" | "minimal" = "minimal",
  timeoutMs = 12000
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload: any = {
      model,
      system_instruction: systemInstruction,
      input,
    };

    if (thinkingLevel) {
      payload.generation_config = {
        thinking_level: thinkingLevel,
      };
    }

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.warn(`Interactions API notice (${model}) [${response.status}]:`, errBody.slice(0, 200));
      return null;
    }

    const json = await response.json();
    return extractInteractionText(json);
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`Interactions API fetch notice (${model}):`, err instanceof Error ? err.message : err);
    return null;
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
    // Sanitize and limit history to last 4 turns
    const cleanHistory = rawHistory
      .slice(-4)
      .filter((item: any) => item && (item.role === "user" || item.role === "santa") && typeof item.content === "string")
      .map((item: any) => ({
        role: item.role as "user" | "santa",
        content: String(item.content).slice(0, 400),
      }));

    // Build dialogue prompt
    let formattedPrompt = "";
    if (cleanHistory.length > 0) {
      const historyDialogue = cleanHistory
        .map((h: { role: "user" | "santa"; content: string }) => `${h.role === "user" ? "Participant" : "Santa"}: ${h.content}`)
        .join("\n");
      formattedPrompt = `${historyDialogue}\nParticipant: ${rawMessage}\nSanta:`;
    } else {
      formattedPrompt = rawMessage;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const isArabic = isArabicText(rawMessage);

    // Default cheerful fallback if API key is missing or services are unreachable
    const defaultFallback = isArabic
      ? "هو هو هو! 🎅 عاصفة ثلجية مفاجئة في القطب الشمالي تشوش على بلورتي السحرية حالياً! ❄️✨ حاول سؤالي مجدداً بعد لحظات قليلة يا صديقي!"
      : "Ho ho ho! 🎅 A sudden North Pole blizzard is causing a little static in my magical communicator! ❄️✨ Give it another try in just a moment, my friend!";

    if (!apiKey) {
      console.warn("Notice: GEMINI_API_KEY environment variable not set.");
      return NextResponse.json({
        success: true,
        reply: defaultFallback,
        model: "offline-fallback",
      });
    }

    // 1. PRIMARY ATTEMPT: Gemini 3.8 Flash (User requirement)
    let santaReply: string | null = null;
    let usedModel = "gemini-3.8-flash";

    santaReply = await callInteractionsApi(
      "gemini-3.8-flash",
      SANTA_SYSTEM_INSTRUCTION,
      formattedPrompt,
      apiKey,
      "low",
      10000
    );

    // 2. AUTOMATIC FAILOVER: Gemini 3.5 Flash (minimal thinking level)
    if (!santaReply) {
      usedModel = "gemini-3.5-flash";
      santaReply = await callInteractionsApi(
        "gemini-3.5-flash",
        SANTA_SYSTEM_INSTRUCTION,
        formattedPrompt,
        apiKey,
        "minimal",
        10000
      );
    }

    // 3. FINAL RESILIENT FALLBACK: Santa-themed friendly message
    if (!santaReply) {
      santaReply = defaultFallback;
      usedModel = "santa-fallback";
    }

    return NextResponse.json({
      success: true,
      reply: santaReply,
      model: usedModel,
    });
  } catch (err) {
    console.error("Santa Chat API error:", err);
    return NextResponse.json(
      {
        success: true,
        reply: "Ho ho ho! 🎅 The elves are tinkering with my communicator right now! Please try again in a few seconds! 🎄✨",
        model: "error-fallback",
      },
      { status: 200 }
    );
  }
}
