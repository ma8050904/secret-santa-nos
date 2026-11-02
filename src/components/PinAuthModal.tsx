"use client";

import React, { useState, useEffect } from "react";
import { ArrowRight, KeyRound, Eye, EyeOff, Clock, Sparkles } from "lucide-react";
import { ParticipantItem } from "./ParticipantGrid";
import { RegistrationSessionData } from "./RegistrationBanner";

interface PinAuthModalProps {
  participant: ParticipantItem;
  session?: RegistrationSessionData | null;
  onClose: () => void;
  onSuccess: (data: {
    participant: ParticipantItem;
    pin: string;
    isRevealed: boolean;
    recipientName?: string;
    isNewRegistration?: boolean;
  }) => void;
}

export const PinAuthModal: React.FC<PinAuthModalProps> = ({
  participant,
  session,
  onClose,
  onSuccess,
}) => {
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSec, setLockoutSec] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(session?.timeRemainingSeconds ?? 60);

  // Live timer sync when session is active
  useEffect(() => {
    if (!session || session.status !== "active" || !session.turnExpiresAt) return;

    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(session.turnExpiresAt!).getTime() - Date.now()) / 1000)
      );
      setTimeRemaining(remaining);
      if (remaining === 0) {
        setError("60-second turn window expired. Advancing to next participant...");
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError("Please enter your PIN.");
      return;
    }

    if (pin.trim().length < 4) {
      setError("PIN must be at least 4 characters.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: participant.id,
          pin: pin.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Authentication failed.");
        if (res.status === 429) {
          setLockoutSec(60);
          const timer = setInterval(() => {
            setLockoutSec((prev) => {
              if (!prev || prev <= 1) {
                clearInterval(timer);
                return null;
              }
              return prev - 1;
            });
          }, 1000);
        }
        setIsSubmitting(false);
        return;
      }

      // Success
      setIsSubmitting(false);
      onSuccess({
        participant: data.participant,
        pin: pin.trim(),
        isRevealed: Boolean(data.participant?.isRevealed),
        recipientName: data.recipientName,
        isNewRegistration: Boolean(data.isNewRegistration),
      });
    } catch {
      setError("Connection error. Please try again.");
      setIsSubmitting(false);
    }
  };

  const isRegistrationTurn = session && session.status === "active";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] via-[#071d13] to-[#04120b] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/25 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center pt-2">
          {/* Turn timer badge if active */}
          {isRegistrationTurn && (
            <div className="mx-auto mb-3 flex w-fit items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-bold text-amber-300">
              <Clock className={`h-3.5 w-3.5 ${timeRemaining <= 10 ? "text-red-400 animate-pulse" : "text-amber-400"}`} />
              <span>Turn {session.currentTurn} of {session.totalTurns}</span>
              <span className="text-white/40">•</span>
              <span className={timeRemaining <= 10 ? "text-red-400 font-mono" : "font-mono"}>
                {timeRemaining}s left
              </span>
            </div>
          )}

          {/* Key Icon */}
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-red-800 to-emerald-950 shadow-lg">
            <KeyRound className="h-7 w-7 text-amber-300" />
          </div>

          <h3 className="font-serif text-xl font-bold text-white tracking-wide">
            {participant.name}
          </h3>
          <p className="mt-1 text-xs text-emerald-200/70">
            {isRegistrationTurn ? "Establish your personal Secret Santa PIN" : "Enter your secret PIN to continue"}
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4 text-left">
            {/* Single PIN Field */}
            <div className="relative">
              <input
                type={showPin ? "text" : "password"}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError(null);
                }}
                placeholder="Enter PIN (min 4 characters)..."
                autoFocus
                required
                disabled={Boolean(lockoutSec) || isSubmitting}
                className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] pr-11 pl-4 py-3.5 text-center font-mono text-base tracking-widest text-amber-300 placeholder-emerald-400/30 shadow-inner focus:border-amber-400 focus:bg-[#0c2a1c] focus:ring-2 focus:ring-amber-400/30 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-amber-400/70 hover:text-white"
              >
                {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/80 p-2.5 text-center text-xs text-red-200">
                {error}
                {lockoutSec && (
                  <p className="mt-1 font-semibold text-amber-300">
                    Retry in {lockoutSec}s
                  </p>
                )}
              </div>
            )}

            {/* Confirm Registration / Unlock Button */}
            <button
              type="submit"
              disabled={isSubmitting || !pin.trim() || Boolean(lockoutSec)}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/50 bg-gradient-to-r from-red-700 via-red-600 to-red-800 py-3.5 text-sm font-bold tracking-wide text-white shadow-[0_4px_20px_rgba(185,28,28,0.5)] transition-all hover:brightness-110 hover:shadow-[0_6px_25px_rgba(185,28,28,0.7)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span>Confirming...</span>
              ) : (
                <>
                  <span>{isRegistrationTurn ? "Confirm Registration" : "Unlock"}</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
