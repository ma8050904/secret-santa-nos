"use client";

import React, { useState, useEffect } from "react";
import confetti from "canvas-confetti";
import { Sparkles, Gift, Eye, Lock } from "lucide-react";
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

  // Privacy Shield States
  const [isHolding, setIsHolding] = useState(false);
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  // Defensive lifecycle hooks for Privacy Shield
  useEffect(() => {
    const handleBlur = () => {
      setIsHolding(false);
      setIsWindowFocused(false);
    };
    const handleFocus = () => {
      setIsWindowFocused(true);
    };
    const handleVisibility = () => {
      if (document.hidden) {
        setIsHolding(false);
        setIsWindowFocused(false);
      } else {
        setIsWindowFocused(true);
      }
    };
    const handleRelease = () => {
      setIsHolding(false);
    };

    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pagehide", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pointerup", handleRelease);
    window.addEventListener("pointercancel", handleRelease);
    window.addEventListener("touchend", handleRelease);
    window.addEventListener("touchcancel", handleRelease);

    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pagehide", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pointerup", handleRelease);
      window.removeEventListener("pointercancel", handleRelease);
      window.removeEventListener("touchend", handleRelease);
      window.removeEventListener("touchcancel", handleRelease);
    };
  }, []);

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

    try {
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getDeviceHeaders(),
        },
        body: JSON.stringify({
          participantId: participant.id,
          pin: pin,
        }),
      });

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
      }, 1000);
    } catch {
      setError("Connection error. Please try again.");
      setStage("ready_to_open");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] via-[#071d13] to-[#04120b] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
        {/* Privacy Defocus Overlay */}
        {!isWindowFocused && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-6 text-center backdrop-blur-2xl">
            <div className="rounded-full bg-red-950/80 p-4 border border-red-500/40 text-red-400 mb-3 animate-pulse">
              <Lock className="h-8 w-8" />
            </div>
            <h3 className="font-serif text-lg font-bold text-amber-200">
              🔒 Privacy Shield Active
            </h3>
            <p className="mt-2 text-xs text-emerald-200/80 max-w-xs">
              Recipient name obscured while window is inactive. Tap or click this tab to resume.
            </p>
          </div>
        )}

        {/* Header Controls */}
        <div className="flex items-center justify-end pb-1">
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/25 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white"
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
                className="group mx-auto flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 px-8 py-3.5 text-sm font-extrabold tracking-wider text-slate-950 shadow-[0_0_30px_rgba(212,175,55,0.6)] transition-all hover:scale-105 hover:brightness-110"
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
            STAGE 3: REVEALED RESULT (PRESS & HOLD PRIVACY SHIELD)
           ========================================================================= */}
        {stage === "revealed" && recipientName && (
          <div className="text-center py-2 animate-in zoom-in-95 duration-500">
            <h4 className="mt-2 text-xs font-bold tracking-widest text-emerald-200/90 uppercase">
              YOUR SECRET SANTA PERSON IS...
            </h4>

            {/* Recipient Showcase Card with Press-and-Hold Shield */}
            <div className="relative my-5 overflow-hidden rounded-3xl border-2 border-amber-400 bg-gradient-to-br from-[#123824] via-[#0b2417] to-[#04120b] p-6 shadow-[0_0_40px_rgba(212,175,55,0.4)]">
              <div className="absolute top-2 left-3 text-lg opacity-75">✨</div>
              <div className="absolute top-2 right-3 text-lg opacity-75">✨</div>
              <div className="absolute bottom-2 left-3 text-lg opacity-75">🎄</div>
              <div className="absolute bottom-2 right-3 text-lg opacity-75">🎁</div>

              {isHolding ? (
                <div className="py-5 select-none animate-in zoom-in-95 duration-150">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 mb-3 rounded-full border border-emerald-500/40 bg-emerald-950/70 text-[11px] font-semibold text-emerald-300">
                    <Eye className="h-3.5 w-3.5 animate-pulse" />
                    <span>Viewing privately (Release finger to hide)</span>
                  </div>
                  <h2 className="font-serif text-3xl sm:text-4xl font-extrabold tracking-wide gold-text drop-shadow-[0_4px_16px_rgba(212,175,55,0.7)]">
                    {recipientName}
                  </h2>
                </div>
              ) : (
                <div
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setIsHolding(true);
                  }}
                  onPointerUp={() => setIsHolding(false)}
                  onPointerLeave={() => setIsHolding(false)}
                  onPointerCancel={() => setIsHolding(false)}
                  onTouchCancel={() => setIsHolding(false)}
                  className="my-3 py-6 px-4 rounded-2xl border-2 border-dashed border-amber-400/50 bg-[#0d2a1c]/80 flex flex-col items-center justify-center cursor-pointer select-none active:scale-95 transition-all hover:border-amber-400 hover:bg-[#123a26]"
                  style={{ touchAction: "none", userSelect: "none" }}
                >
                  <div className="rounded-full bg-amber-500/20 p-3 mb-2 text-amber-300 animate-bounce-gentle">
                    <Lock className="h-6 w-6" />
                  </div>
                  <span className="font-serif text-base font-bold text-amber-200">
                    👆 PRESS & HOLD TO REVEAL
                  </span>
                  <span className="mt-1 text-[11px] text-emerald-200/70 text-center max-w-[240px]">
                    Keep your finger pressed to view your person. Releases immediately when let go.
                  </span>
                </div>
              )}

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
                className="rounded-xl border border-emerald-700/40 bg-emerald-950/80 px-6 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-900"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
