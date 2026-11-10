"use client";

import React, { useState } from "react";
import confetti from "canvas-confetti";
import { Sparkles, Gift } from "lucide-react";
import { ParticipantItem } from "./ParticipantGrid";
import { getDeviceHeaders } from "@/lib/device";

interface GiftBoxRevealProps {
  participant: ParticipantItem;
  pin: string;
  initialRecipientName?: string;
  initialIsRevealed?: boolean;
  onClose: () => void;
  onRevealSuccess: (participantId: string) => void;
}

/**
 * Renders recipient names while preserving full, authentic emoji colors.
 * Text is styled with the metallic gold gradient, while emojis remain in their
 * natural colorful presentation instead of being clipped to a monochrome mask.
 */
function renderRecipientName(name: string) {
  const emojiRegex = /(\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]{2}|[\ufe0e\ufe0f]|[\u{1F3FB}-\u{1F3FF}])*)/gu;
  const parts = name.split(emojiRegex).filter(Boolean);

  return parts.map((part, index) => {
    const isEmoji = /(\p{Extended_Pictographic})/u.test(part);
    if (isEmoji) {
      return (
        <span
          key={index}
          className="inline-block select-none font-normal align-middle mx-0.5 filter-none"
          style={{
            WebkitTextFillColor: "initial",
            background: "none",
          }}
        >
          {part}
        </span>
      );
    }

    return (
      <span key={index} className="gold-text">
        {part}
      </span>
    );
  });
}

export const GiftBoxReveal: React.FC<GiftBoxRevealProps> = ({
  participant,
  pin,
  initialRecipientName,
  initialIsRevealed = false,
  onClose,
  onRevealSuccess,
}) => {
  const [stage, setStage] = useState<"ready_to_open" | "opening" | "revealed">(
    initialIsRevealed && initialRecipientName ? "revealed" : "ready_to_open"
  );
  const [recipientName, setRecipientName] = useState<string | null>(initialRecipientName || null);
  const [error, setError] = useState<string | null>(null);

  // Trigger rich multi-stage festive confetti
  const triggerConfetti = () => {
    try {
      const count = 240;
      const defaults = {
        origin: { y: 0.65 },
        colors: ["#d4af37", "#fef3c7", "#b91c1c", "#15803d", "#ffffff"],
      };

      function fire(particleRatio: number, opts: confetti.Options) {
        try {
          confetti({
            ...defaults,
            ...opts,
            particleCount: Math.floor(count * particleRatio),
          });
        } catch {
          // ignore confetti canvas errors
        }
      }

      fire(0.25, { spread: 30, startVelocity: 60 });
      fire(0.2, { spread: 65 });
      fire(0.35, { spread: 110, decay: 0.91, scalar: 0.8 });
      fire(0.1, { spread: 130, startVelocity: 25, decay: 0.92, scalar: 1.2 });
      fire(0.1, { spread: 130, startVelocity: 50 });
    } catch {
      // ignore
    }
  };

  // Perform animated gift unwrapping
  const handleOpenGift = async () => {
    if (stage !== "ready_to_open") return;
    setError(null);
    setStage("opening");

    // If recipientName was already established from biometric/PIN verification, reveal immediately
    if (recipientName) {
      setTimeout(() => {
        setStage("revealed");
        triggerConfetti();
        onRevealSuccess(participant.id);
      }, 450);

      // Persist reveal status asynchronously on server
      fetch("/api/reveal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getDeviceHeaders(),
        },
        body: JSON.stringify({
          participantId: participant.id,
          pin: pin === "biometric" ? "" : pin,
        }),
      }).catch((err) => console.warn("Background reveal record notice:", err));
      return;
    }

    // Safety watchdog: hard 7s cap to ensure UI never stays stuck on "Opening your gift..."
    const watchdog = setTimeout(() => {
      setError("Opening took longer than expected. Please tap to try again.");
      setStage("ready_to_open");
    }, 7000);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch("/api/reveal", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...getDeviceHeaders(),
        },
        body: JSON.stringify({
          participantId: participant.id,
          pin: pin === "biometric" ? "" : pin,
        }),
      });

      clearTimeout(timeoutId);
      clearTimeout(watchdog);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Failed to reveal your gift.");
        setStage("ready_to_open");
        return;
      }

      setRecipientName(data.recipientName);

      setTimeout(() => {
        setStage("revealed");
        triggerConfetti();
        onRevealSuccess(participant.id);
      }, 450);
    } catch {
      clearTimeout(watchdog);
      setError("Connection timed out. Please tap below to try again.");
      setStage("ready_to_open");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] via-[#071d13] to-[#04120b] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
        {/* Header Controls */}
        <div className="flex items-center justify-end pb-1">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/25 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white cursor-pointer"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* =========================================================================
            STAGE 1 & 2: READY TO OPEN / OPENING ANIMATION
           ========================================================================= */}
        {(stage === "ready_to_open" || stage === "opening") && (
          <div className="text-center py-4">
            <h3 className="font-serif text-2xl font-bold text-white tracking-wide">
              Your Christmas surprise is ready...
            </h3>

            {error && (
              <div className="mx-auto mt-3 max-w-xs rounded-xl border border-red-500/40 bg-red-950/80 p-2.5 text-xs text-red-200">
                {error}
              </div>
            )}

            {/* 3D Animated Gift Box */}
            <div className="my-8 flex justify-center">
              <div
                className={`relative cursor-pointer transition-transform duration-500 ${
                  stage === "opening" ? "scale-110" : "animate-bounce-gentle hover:scale-105"
                }`}
                onClick={stage === "ready_to_open" ? handleOpenGift : undefined}
              >
                {/* Gift Box Lid */}
                <div
                  className={`relative z-20 mx-auto h-12 w-44 rounded-t-xl border-2 border-amber-300 bg-gradient-to-r from-red-700 via-red-600 to-red-800 shadow-xl transition-all duration-700 ${
                    stage === "opening" ? "-translate-y-16 -rotate-12 opacity-40" : ""
                  }`}
                >
                  {/* Golden Ribbon on Lid */}
                  <div className="absolute top-0 bottom-0 left-1/2 -ml-3 w-6 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 shadow-md" />
                  {/* Ribbon Bow */}
                  <div className="absolute -top-5 left-1/2 -ml-6 flex items-center justify-center">
                    <span className="text-2xl drop-shadow-[0_2px_8px_rgba(212,175,55,0.8)]">🎀</span>
                  </div>
                </div>

                {/* Gift Box Body */}
                <div className="relative z-10 mx-auto h-36 w-40 rounded-b-xl border-2 border-t-0 border-amber-300 bg-gradient-to-b from-red-800 via-red-700 to-red-950 shadow-2xl">
                  {/* Golden Ribbon Vertical */}
                  <div className="absolute top-0 bottom-0 left-1/2 -ml-3 w-6 bg-gradient-to-r from-amber-300 via-yellow-200 to-amber-400 shadow-md" />
                  {/* Golden Ribbon Horizontal */}
                  <div className="absolute top-1/2 -mt-3 left-0 right-0 h-6 bg-gradient-to-b from-amber-300 via-yellow-200 to-amber-400 shadow-md" />

                  {/* Sparkle Glow Burst when opening */}
                  {stage === "opening" && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="h-32 w-32 animate-ping rounded-full bg-amber-400/40" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* CTA Button */}
            {stage === "ready_to_open" ? (
              <button
                onClick={handleOpenGift}
                className="group mx-auto flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 px-8 py-3.5 text-sm font-extrabold tracking-wider text-slate-950 shadow-[0_0_30px_rgba(212,175,55,0.6)] transition-all hover:scale-105 hover:brightness-110 cursor-pointer"
              >
                <Gift className="h-4 w-4" />
                <span>OPEN YOUR GIFT</span>
                <Sparkles className="h-4 w-4 animate-spin" />
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 text-amber-300 text-xs">
                <Sparkles className="h-4 w-4 animate-spin" />
                <span>Opening your gift...</span>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            STAGE 3: REVEALED RESULT (DIRECT CLEAN DISPLAY)
           ========================================================================= */}
        {stage === "revealed" && recipientName && (
          <div className="text-center py-2 animate-in zoom-in-95 duration-500">
            <h4 className="mt-2 text-xs font-bold tracking-widest text-emerald-200/90 uppercase">
              YOUR SECRET SANTA PERSON IS...
            </h4>

            {/* Recipient Showcase Card */}
            <div className="relative my-6 overflow-hidden rounded-3xl border-2 border-amber-400 bg-gradient-to-br from-[#123824] via-[#0b2417] to-[#04120b] p-6 shadow-[0_0_40px_rgba(212,175,55,0.4)]">
              <div className="absolute top-2 left-3 text-lg opacity-75">✨</div>
              <div className="absolute top-2 right-3 text-lg opacity-75">✨</div>
              <div className="absolute bottom-2 left-3 text-lg opacity-75">🎄</div>
              <div className="absolute bottom-2 right-3 text-lg opacity-75">🎁</div>

              <div className="py-5">
                <h2 className="font-serif text-3xl sm:text-4xl font-extrabold tracking-wide drop-shadow-[0_4px_16px_rgba(212,175,55,0.7)] text-amber-200">
                  {renderRecipientName(recipientName)}
                </h2>
              </div>

              {/* Shhh footer */}
              <div className="mt-2 border-t border-amber-400/20 pt-3">
                <p className="font-serif text-xs font-bold tracking-widest text-red-400 uppercase">
                  🤫 SHHH... IT&apos;S A SECRET!
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={onClose}
                className="rounded-xl border border-emerald-700/40 bg-emerald-950/80 px-6 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-900 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {stage === "revealed" && !recipientName && (
          <div className="text-center py-8">
            <p className="text-sm text-amber-200">Retrieving your secret assignment...</p>
            <button
              onClick={() => {
                setStage("ready_to_open");
                handleOpenGift();
              }}
              className="mt-4 rounded-2xl border border-amber-400 bg-gradient-to-r from-emerald-700 to-teal-800 px-6 py-2.5 text-xs font-bold text-white hover:brightness-110 cursor-pointer"
            >
              Tap to Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
