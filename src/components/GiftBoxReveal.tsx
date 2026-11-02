"use client";

import React, { useState } from "react";
import confetti from "canvas-confetti";
import { Sparkles, Lock, Gift, ArrowRight, ShieldCheck, CheckCircle2 } from "lucide-react";
import { ParticipantItem } from "./ParticipantGrid";

interface GiftBoxRevealProps {
  participant: ParticipantItem;
  initialCode?: string;
  onClose: () => void;
  onRevealSuccess: (participantId: string) => void;
}

export const GiftBoxReveal: React.FC<GiftBoxRevealProps> = ({
  participant,
  initialCode = "",
  onClose,
  onRevealSuccess,
}) => {
  const [passcode, setPasscode] = useState(initialCode);
  const [stage, setStage] = useState<"enter_code" | "ready_to_open" | "opening" | "revealed">("enter_code");
  const [recipientName, setRecipientName] = useState<string | null>(null);
  const [isFirstReveal, setIsFirstReveal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Trigger rich multi-stage festive confetti
  const triggerConfetti = () => {
    const count = 200;
    const defaults = {
      origin: { y: 0.7 },
      colors: ["#d4af37", "#fef3c7", "#b91c1c", "#15803d", "#ffffff"],
    };

    function fire(particleRatio: number, opts: confetti.Options) {
      confetti({
        ...defaults,
        ...opts,
        particleCount: Math.floor(count * particleRatio),
      });
    }

    fire(0.25, {
      spread: 26,
      startVelocity: 55,
    });
    fire(0.2, {
      spread: 60,
    });
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8,
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2,
    });
    fire(0.1, {
      spread: 120,
      startVelocity: 45,
    });
  };

  // Authenticate participant code
  const handleVerifyCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!passcode.trim()) {
      setError("Please enter your Christmas Secret Code.");
      return;
    }

    setError(null);
    setIsVerifying(true);

    try {
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: participant.id,
          passcode: passcode.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Authentication failed. Please verify your code.");
        setIsVerifying(false);
        return;
      }

      setRecipientName(data.recipientName);
      setIsFirstReveal(Boolean(data.isFirstReveal));
      setIsVerifying(false);

      // Transition to gift box ready stage
      setStage("ready_to_open");
    } catch {
      setError("Network error while connecting to Santa's server. Please try again.");
      setIsVerifying(false);
    }
  };

  // Perform animated gift unwrapping
  const handleOpenGift = () => {
    setStage("opening");

    // Play unwrap & celebratory chime if available
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const chimeFreqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      chimeFreqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        const start = ctx.currentTime + idx * 0.12;
        gain.gain.setValueAtTime(0.001, start);
        gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.8);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.85);
      });
    } catch {
      // Audio is non-blocking enhancement
    }

    setTimeout(() => {
      setStage("revealed");
      triggerConfetti();
      onRevealSuccess(participant.id);
    }, 1200);
  };

  const handleCopySecretLink = () => {
    const url = `${window.location.origin}/?p=${participant.id}&code=${encodeURIComponent(passcode.trim())}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] via-[#071d13] to-[#04120b] p-6 md:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.8)]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full border border-amber-500/30 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>

        {/* =========================================================================
            STAGE 1: ENTER CODE
           ========================================================================= */}
        {stage === "enter_code" && (
          <div className="text-center">
            {/* Participant Badge */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-amber-400/40 bg-gradient-to-br from-red-800 to-emerald-900 shadow-xl">
              <Lock className="h-8 w-8 text-amber-300" />
            </div>

            <p className="text-xs font-semibold tracking-widest text-amber-400 uppercase">
              Private Security Verification
            </p>
            <h3 className="mt-1 font-serif text-2xl font-bold text-white">
              Hello, {participant.name}!
            </h3>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-emerald-200/80">
              To keep Secret Santa truly blind and private, please enter your unique Christmas Secret Code to unlock your gift.
            </p>

            <form onSubmit={handleVerifyCode} className="mt-6 space-y-4">
              <div className="text-left">
                <label className="block text-xs font-medium text-amber-200/90 mb-1.5">
                  Christmas Secret Code:
                </label>
                <input
                  type="text"
                  value={passcode}
                  onChange={(e) => {
                    setPasscode(e.target.value);
                    setError(null);
                  }}
                  placeholder="e.g. SANTA-4A9B"
                  autoFocus
                  required
                  className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] px-4 py-3.5 text-center font-mono text-base font-bold tracking-widest text-amber-300 uppercase placeholder-emerald-400/30 shadow-inner focus:border-amber-400 focus:bg-[#0c2a1c] focus:ring-2 focus:ring-amber-400/30 focus:outline-none"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/40 bg-red-950/60 p-3 text-xs text-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isVerifying || !passcode.trim()}
                className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/50 bg-gradient-to-r from-red-700 via-red-600 to-red-800 py-3.5 text-sm font-bold tracking-wide text-white shadow-[0_4px_20px_rgba(185,28,28,0.5)] transition-all hover:brightness-110 hover:shadow-[0_6px_25px_rgba(185,28,28,0.7)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isVerifying ? (
                  <span>Verifying Secret Passcode...</span>
                ) : (
                  <>
                    <span>Unlock My Gift</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-emerald-300/70">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
              <span>AES-256-GCM encrypted • Zero organizer access</span>
            </div>
          </div>
        )}

        {/* =========================================================================
            STAGE 2 & 3: READY TO OPEN / OPENING ANIMATION
           ========================================================================= */}
        {(stage === "ready_to_open" || stage === "opening") && (
          <div className="text-center py-4">
            <p className="text-xs font-semibold tracking-widest text-amber-300 uppercase">
              Verification Succeeded!
            </p>
            <h3 className="mt-1 font-serif text-2xl font-bold text-white">
              Your Christmas surprise is ready...
            </h3>
            <p className="mt-2 text-xs text-emerald-200/80">
              {participant.name}, your secret recipient has been matched and is sealed in this gift box.
            </p>

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
                    stage === "opening" ? "-translate-y-16 -rotate-12 opacity-50" : ""
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
                className="group mx-auto flex items-center justify-center gap-2 rounded-2xl border-2 border-amber-400 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 px-8 py-4 text-base font-extrabold tracking-wider text-slate-950 shadow-[0_0_30px_rgba(212,175,55,0.6)] transition-all hover:scale-105 hover:brightness-110"
              >
                <Gift className="h-5 w-5" />
                <span>OPEN YOUR GIFT</span>
                <Sparkles className="h-5 w-5 animate-spin" />
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 text-amber-300">
                <Sparkles className="h-5 w-5 animate-spin" />
                <span className="font-semibold text-sm">Unwrapping your Christmas surprise...</span>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            STAGE 4: REVEALED RESULT
           ========================================================================= */}
        {stage === "revealed" && recipientName && (
          <div className="text-center py-2 animate-in zoom-in-95 duration-500">
            {/* Festive Ribbon Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/50 bg-gradient-to-r from-red-900/80 to-emerald-900/80 px-4 py-1 text-xs font-semibold tracking-widest text-amber-300 uppercase shadow-lg">
              <span>🎄 Secret Santa 2024</span>
              {isFirstReveal ? (
                <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                  New Reveal
                </span>
              ) : (
                <span className="rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                  Revisited
                </span>
              )}
            </div>

            <h4 className="mt-3 text-xs font-bold tracking-widest text-emerald-200/90 uppercase">
              YOUR SECRET SANTA PERSON IS...
            </h4>

            {/* Recipient Showcase Card */}
            <div className="relative my-6 overflow-hidden rounded-3xl border-2 border-amber-400 bg-gradient-to-br from-[#123824] via-[#0b2417] to-[#04120b] p-6 shadow-[0_0_40px_rgba(212,175,55,0.4)]">
              {/* Christmas Wreath / Garland background graphics */}
              <div className="absolute top-2 left-3 text-xl opacity-75">✨</div>
              <div className="absolute top-2 right-3 text-xl opacity-75">✨</div>
              <div className="absolute bottom-2 left-3 text-xl opacity-75">🎄</div>
              <div className="absolute bottom-2 right-3 text-xl opacity-75">🎁</div>

              <div className="py-4">
                <p className="text-xs font-medium text-amber-300/80 uppercase tracking-widest">
                  You are buying a gift for:
                </p>
                <h2 className="mt-2 font-serif text-3xl md:text-4xl font-extrabold tracking-wide gold-text drop-shadow-[0_4px_16px_rgba(212,175,55,0.6)]">
                  {recipientName}
                </h2>
              </div>

              {/* Shhh footer */}
              <div className="mt-2 border-t border-amber-400/20 pt-3">
                <p className="font-serif text-sm font-bold tracking-widest text-red-400 uppercase">
                  🤫 SHHH... IT&apos;S A SECRET!
                </p>
                <p className="mt-1 text-[11px] text-emerald-200/70">
                  Keep this confidential until the gift exchange ceremony!
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:justify-center">
              <button
                onClick={handleCopySecretLink}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-[#123824] px-4 py-2.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-[#1b4d32] hover:text-white"
              >
                {copiedLink ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span>Link Copied!</span>
                  </>
                ) : (
                  <>
                    <span>Copy My Secret Bookmark Link</span>
                  </>
                )}
              </button>

              <button
                onClick={onClose}
                className="rounded-xl border border-emerald-700/40 bg-emerald-950/80 px-6 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-900"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
