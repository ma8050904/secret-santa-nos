"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { MessageSquare, Send, X, Sparkles, Gift, HelpCircle, Smile, RefreshCw, ChevronDown } from "lucide-react";

interface Message {
  id: string;
  role: "santa" | "user";
  content: string;
  timestamp: string;
}

const INITIAL_SANTA_MESSAGE: Message = {
  id: "msg-welcome",
  role: "santa",
  content:
    "Ho ho ho! 🎅 Merry Christmas, my friend! I’m Santa Claus, taking a warm cocoa break at the North Pole toy workshop! ❄️✨\n\nHow can I bring some holiday magic to your day? Need creative gift inspiration, festive jokes, or tips for Secret Santa? Ask me anything!",
  timestamp: "Just now",
};

const SUGGESTIONS = [
  { label: "Suggest a gift idea 🎁", text: "Can you give me creative gift ideas for someone who loves reading and cozy things?" },
  { label: "Tell me a Christmas joke! 😂", text: "Tell me a funny Christmas joke to share with my friends!" },
  { label: "How does Secret Santa work? 🎄", text: "How does the Secret Santa gift exchange work?" },
  { label: "اقترح لي فكرة هدية 🎁", text: "اقترح لي أفكار هدايا مميزة لزميلي في العمل بميزانية بسيطة" },
  { label: "احكيلي نكتة كريسماس 😂", text: "احكيلي نكتة لطيفة ومضحكة عن الكريسماس وسانتا!" },
  { label: "Who is your favorite reindeer? 🦌", text: "Who is your favorite reindeer and what is life like at the North Pole?" },
];

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function SantaChatModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([INITIAL_SANTA_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setHasUnread(false);
      setTimeout(() => {
        scrollToBottom();
        inputRef.current?.focus();
      }, 150);
    }
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isLoading, isOpen, scrollToBottom]);

  const handleSend = async (messageText?: string) => {
    const textToSend = (messageText || input).trim();
    if (!textToSend || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      // Build history for API (last 4 turns)
      const history = newMessages.slice(-5, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/santa/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          history,
        }),
      });

      const data = await res.json();
      const replyContent =
        data && data.success && typeof data.reply === "string"
          ? data.reply
          : isArabic(textToSend)
          ? "هو هو هو! 🎅 عاصفة ثلجية تشوش على بلورتي السحرية في القطب الشمالي! ❄️ حاول سؤالي مجدداً بعد لحظات يا صديقي!"
          : "Ho ho ho! 🎅 A little North Pole snowstorm is causing static in my communicator! ❄️✨ Please ask me again in just a moment!";

      const santaMessage: Message = {
        id: `santa-${Date.now()}`,
        role: "santa",
        content: replyContent,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, santaMessage]);
      if (!isOpen) {
        setHasUnread(true);
      }
    } catch {
      const fallbackMsg: Message = {
        id: `santa-${Date.now()}`,
        role: "santa",
        content: isArabic(textToSend)
          ? "هو هو هو! 🎅 ورشة الألعاب مشغولة جداً الآن! تفضل بسؤالي مرة أخرى بعد ثوانٍ قليلة! 🎄"
          : "Ho ho ho! 🎅 The toy workshop is bustling with activity right now! Give me just a second and try asking again! 🎄✨",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleResetChat = () => {
    setMessages([INITIAL_SANTA_MESSAGE]);
  };

  return (
    <>
      {/* =====================================================================
          FLOATING SANTA TRIGGER BUTTON (Bottom-Right)
         ===================================================================== */}
      <div className="fixed bottom-5 right-5 z-40">
        {!isOpen ? (
          <button
            onClick={() => setIsOpen(true)}
            type="button"
            className="group relative flex items-center gap-3 rounded-full border-2 border-amber-300/80 bg-gradient-to-r from-red-700 via-red-600 to-red-800 p-2 pr-5 shadow-[0_8px_32px_rgba(185,28,28,0.55)] transition-all duration-300 hover:scale-105 hover:shadow-[0_12px_40px_rgba(212,175,55,0.6)] cursor-pointer"
            aria-label="Open Santa Chat"
          >
            {/* Santa Avatar Icon with glowing pulse */}
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-red-600 to-amber-700 shadow-inner border border-amber-300/60">
              <span className="text-2xl select-none animate-bounce" style={{ animationDuration: "2.5s" }}>
                🎅
              </span>
              {/* Green online badge */}
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-400 border-2 border-red-800 ring-2 ring-emerald-400/40" />
            </div>

            <div className="text-left">
              <div className="flex items-center gap-1.5">
                <span className="font-serif text-sm font-extrabold tracking-wide text-white group-hover:text-amber-200 transition-colors">
                  Chat with Santa
                </span>
                <Sparkles className="h-3 w-3 text-amber-300 animate-pulse" />
              </div>
              <span className="block text-[10px] font-medium text-emerald-200/90 tracking-wider">
                North Pole AI • Online
              </span>
            </div>

            {hasUnread && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-4 w-4 rounded-full bg-amber-500 border border-white" />
              </span>
            )}
          </button>
        ) : null}
      </div>

      {/* =====================================================================
          SANTA CHAT POPUP WINDOW
         ===================================================================== */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 flex w-[calc(100vw-2.5rem)] max-w-[420px] h-[580px] max-h-[85vh] flex-col overflow-hidden rounded-3xl border-2 border-amber-400/50 bg-[#071d12]/95 shadow-[0_20px_60px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-5">
          {/* Header */}
          <div className="relative flex items-center justify-between border-b border-amber-500/20 bg-gradient-to-r from-red-900/80 via-[#0a2618]/90 to-red-900/80 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-red-700/80 border border-amber-300/60 shadow-md">
                <span className="text-2xl select-none">🎅</span>
                <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 border border-emerald-800" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-serif text-sm font-bold text-amber-200">Santa Claus</h3>
                  <span className="text-[11px] text-amber-300/70 font-arabic">بابا نويل</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-emerald-300/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>At the North Pole • Live AI</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleResetChat}
                type="button"
                className="rounded-full p-1.5 text-amber-200/60 hover:bg-white/10 hover:text-amber-200 transition-colors cursor-pointer"
                title="Restart conversation"
                aria-label="Restart conversation"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                type="button"
                className="rounded-full p-1.5 text-amber-200/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                title="Close chat"
                aria-label="Close chat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin scrollbar-thumb-amber-500/20">
            {messages.map((msg) => {
              const isSanta = msg.role === "santa";
              const arabicMode = isArabic(msg.content);

              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2.5 ${isSanta ? "justify-start" : "justify-end"}`}
                >
                  {isSanta && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-800 border border-amber-300/40 text-sm shadow">
                      🎅
                    </div>
                  )}

                  <div
                    className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-md ${
                      isSanta
                        ? "rounded-tl-xs border border-amber-400/25 bg-[#0e311f]/90 text-emerald-50 backdrop-blur-md"
                        : "rounded-tr-xs border border-emerald-500/30 bg-gradient-to-r from-red-700 via-red-600 to-red-700 text-white"
                    } ${arabicMode ? "text-right font-arabic" : "text-left"}`}
                    dir={arabicMode ? "rtl" : "ltr"}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <span
                      className={`mt-1 block text-[9px] ${
                        isSanta ? "text-amber-200/50" : "text-white/60"
                      }`}
                    >
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Typing Indicator */}
            {isLoading && (
              <div className="flex items-start gap-2.5 justify-start">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-800 border border-amber-300/40 text-sm shadow animate-pulse">
                  🎅
                </div>
                <div className="rounded-2xl rounded-tl-xs border border-amber-400/20 bg-[#0e311f]/90 px-4 py-2.5 text-xs text-amber-200/90 shadow-md">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-amber-200/80">
                      Santa is thinking... 📜✨
                    </span>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Suggestions Chips */}
          <div className="border-t border-amber-500/15 bg-[#05180f]/80 px-3 py-2">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[11px]">
              {SUGGESTIONS.map((s, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(s.text)}
                  disabled={isLoading}
                  type="button"
                  className="shrink-0 rounded-full border border-amber-400/20 bg-emerald-900/30 px-2.5 py-1 text-emerald-200/80 hover:border-amber-300/60 hover:bg-emerald-800/40 hover:text-amber-200 transition-all cursor-pointer disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input Footer */}
          <div className="border-t border-amber-500/20 bg-[#04150c] p-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Santa anything... / اسأل سانتا..."
                maxLength={500}
                disabled={isLoading}
                className="flex-1 rounded-full border border-amber-500/30 bg-[#092215] px-4 py-2.5 text-xs sm:text-sm text-white placeholder-emerald-200/40 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50 disabled:opacity-50 transition-colors"
                dir={isArabic(input) ? "rtl" : "ltr"}
              />
              <button
                onClick={() => handleSend()}
                disabled={isLoading || !input.trim()}
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-300/70 bg-gradient-to-r from-red-700 to-red-600 text-white shadow-md hover:scale-105 hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:hover:scale-100 cursor-pointer"
                aria-label="Send message to Santa"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 flex justify-between px-2 text-[10px] text-emerald-200/40">
              <span>Secret Santa 2024 • Powered by Gemini Flash</span>
              <span>{input.length}/500</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
