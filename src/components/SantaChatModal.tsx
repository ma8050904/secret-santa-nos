"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, X, RefreshCw } from "lucide-react";

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
    "Ho ho ho! 🎅 Merry Christmas! I’m Santa Claus. How can I bring some holiday cheer to your day? Feel free to ask me anything!",
  timestamp: "Just now",
};

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

export function SantaChatModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([INITIAL_SANTA_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isOpen) {
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

  const handleSend = async () => {
    const textToSend = input.trim();
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
          ? "هو هو هو! 🎅 عاصفة ثلجية تشوش على بلورتي السحرية حالياً! ❄️ حاول سؤالي مجدداً بعد لحظات يا صديقي!"
          : "Ho ho ho! 🎅 A little snowstorm is causing static in my communicator! ❄️✨ Please ask me again in just a moment!";

      const santaMessage: Message = {
        id: `santa-${Date.now()}`,
        role: "santa",
        content: replyContent,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };

      setMessages((prev) => [...prev, santaMessage]);
    } catch {
      const fallbackMsg: Message = {
        id: `santa-${Date.now()}`,
        role: "santa",
        content: isArabic(textToSend)
          ? "هو هو هو! 🎅 ورشة الألعاب مشغولة جداً الآن! تفضل بسؤالي مرة أخرى بعد ثوانٍ قليلة! 🎄"
          : "Ho ho ho! 🎅 The workshop is bustling with activity right now! Give me a second and try asking again! 🎄✨",
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
          FLOATING SANTA AVATAR (Bottom-Right, Clean & Minimal)
         ===================================================================== */}
      {!isOpen && (
        <div className="fixed bottom-5 right-5 z-40">
          <button
            onClick={() => setIsOpen(true)}
            type="button"
            className="group relative flex h-13 w-13 sm:h-14 sm:w-14 items-center justify-center rounded-full border-2 border-amber-300/80 bg-gradient-to-br from-red-700 via-red-600 to-amber-700 shadow-[0_6px_24px_rgba(0,0,0,0.55),0_0_20px_rgba(212,175,55,0.35)] transition-all duration-300 hover:scale-110 hover:shadow-[0_8px_32px_rgba(212,175,55,0.6)] active:scale-95 cursor-pointer"
            aria-label="Santa Claus"
            title="Chat with Santa"
          >
            <span className="text-2xl sm:text-3xl select-none transition-transform duration-300 group-hover:rotate-6">
              🎅
            </span>
            {/* Subtle festive breathing ring */}
            <span
              className="absolute inset-0 rounded-full border border-amber-300/40 animate-ping opacity-30 pointer-events-none"
              style={{ animationDuration: "3s" }}
            />
          </button>
        </div>
      )}

      {/* =====================================================================
          SANTA CHAT POPUP WINDOW (Compact, Elegant, Minimal)
         ===================================================================== */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 flex w-[calc(100vw-2.5rem)] max-w-[380px] h-[520px] max-h-[82vh] flex-col overflow-hidden rounded-3xl border border-amber-400/40 bg-[#071d12]/95 shadow-[0_20px_60px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
          {/* Minimal Header */}
          <div className="relative flex items-center justify-between border-b border-amber-500/20 bg-gradient-to-r from-red-900/90 via-[#0a2618]/95 to-red-900/90 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-700/80 border border-amber-300/60 shadow">
                <span className="text-lg select-none">🎅</span>
              </div>
              <h3 className="font-serif text-sm font-bold text-amber-200">Santa Claus</h3>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleResetChat}
                type="button"
                className="rounded-full p-1.5 text-amber-200/60 hover:bg-white/10 hover:text-amber-200 transition-colors cursor-pointer"
                title="Restart conversation"
                aria-label="Restart conversation"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                type="button"
                className="rounded-full p-1.5 text-amber-200/60 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                title="Close chat"
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-amber-500/20">
            {messages.map((msg) => {
              const isSanta = msg.role === "santa";
              const arabicMode = isArabic(msg.content);

              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-2 ${isSanta ? "justify-start" : "justify-end"}`}
                >
                  {isSanta && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-800 border border-amber-300/40 text-xs shadow mt-0.5">
                      🎅
                    </div>
                  )}

                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-md ${
                      isSanta
                        ? "rounded-tl-xs border border-amber-400/25 bg-[#0e311f]/90 text-emerald-50 backdrop-blur-md"
                        : "rounded-tr-xs border border-emerald-500/30 bg-gradient-to-r from-red-700 via-red-600 to-red-700 text-white"
                    } ${arabicMode ? "text-right font-arabic" : "text-left"}`}
                    dir={arabicMode ? "rtl" : "ltr"}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <span
                      className={`mt-1 block text-[9px] ${
                        isSanta ? "text-amber-200/40" : "text-white/50"
                      }`}
                    >
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Subtle Typing Indicator */}
            {isLoading && (
              <div className="flex items-start gap-2 justify-start">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-800 border border-amber-300/40 text-xs shadow mt-0.5 animate-pulse">
                  🎅
                </div>
                <div className="rounded-2xl rounded-tl-xs border border-amber-400/20 bg-[#0e311f]/90 px-3.5 py-2 text-xs text-amber-200/80 shadow-md">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-amber-200/70">
                      Santa is thinking...
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

          {/* Minimal Input Footer (Input & Send button only) */}
          <div className="border-t border-amber-500/20 bg-[#04150c] p-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Santa..."
                maxLength={500}
                disabled={isLoading}
                className="flex-1 rounded-full border border-amber-500/30 bg-[#092215] px-4 py-2.5 text-xs sm:text-sm text-white placeholder-emerald-200/40 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400/50 disabled:opacity-50 transition-colors"
                dir={isArabic(input) ? "rtl" : "ltr"}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300/70 bg-gradient-to-r from-red-700 to-red-600 text-white shadow-md hover:scale-105 hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:hover:scale-100 cursor-pointer"
                aria-label="Send message"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
