"use client";

import React, { useState } from "react";
import { Lock, ArrowRight, ShieldCheck, KeyRound, Eye, EyeOff } from "lucide-react";
import { ParticipantItem } from "./ParticipantGrid";

interface PinAuthModalProps {
  participant: ParticipantItem;
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
  onClose,
  onSuccess,
}) => {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSec, setLockoutSec] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError("Please enter your personal PIN.");
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
          confirmPin: confirmPin.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Authentication failed. Please verify your PIN.");
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
      setError("Network error connecting to Santa's authentication server. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] via-[#071d13] to-[#04120b] p-6 md:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.8)]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full border border-amber-500/30 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center">
          {/* Lock Ornament Icon */}
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-amber-400/40 bg-gradient-to-br from-red-800 to-emerald-900 shadow-xl">
            <KeyRound className="h-8 w-8 text-amber-300 animate-pulse" />
          </div>

          <p className="text-xs font-semibold tracking-widest text-amber-400 uppercase">
            Step 2: Personal Verification
          </p>
          <h3 className="mt-1 font-serif text-2xl font-bold text-white">
            Hello, {participant.name}!
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-emerald-200/80">
            Enter your secret personal PIN or password.
          </p>

          {/* Context Explanatory Card */}
          <div className="mx-auto mt-4 rounded-xl border border-amber-500/20 bg-[#071e13]/80 p-3 text-left text-[11px] leading-relaxed text-emerald-200/90 backdrop-blur-md">
            <p className="flex items-start gap-1.5">
              <span className="text-amber-400 font-bold">🎄 First visit:</span>
              <span>Enter your chosen PIN in both fields to securely register it.</span>
            </p>
            <p className="mt-1 flex items-start gap-1.5">
              <span className="text-amber-400 font-bold">✨ Returning:</span>
              <span>Simply enter your existing PIN in the first field.</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3.5 text-left">
            {/* Primary PIN Field */}
            <div>
              <label className="block text-xs font-medium text-amber-200 mb-1">
                Your Secret PIN:
              </label>
              <div className="relative">
                <input
                  type={showPin ? "text" : "password"}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter 4–8 digit PIN..."
                  autoFocus
                  required
                  disabled={Boolean(lockoutSec) || isSubmitting}
                  className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] pr-11 pl-4 py-3 font-mono text-sm tracking-wider text-amber-300 placeholder-emerald-400/30 shadow-inner focus:border-amber-400 focus:bg-[#0c2a1c] focus:ring-2 focus:ring-amber-400/30 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-amber-400/70 hover:text-white"
                >
                  {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm PIN Field (for First-Time Setup) */}
            <div>
              <label className="block text-xs font-medium text-amber-200/90 mb-1">
                Confirm PIN <span className="text-[10px] text-amber-400/70">(First-Time Registration Only)</span>:
              </label>
              <input
                type={showPin ? "text" : "password"}
                value={confirmPin}
                onChange={(e) => {
                  setConfirmPin(e.target.value);
                  setError(null);
                }}
                placeholder="Re-enter PIN if registering for first time..."
                disabled={Boolean(lockoutSec) || isSubmitting}
                className="w-full rounded-2xl border border-amber-500/30 bg-[#071d13] px-4 py-3 font-mono text-sm tracking-wider text-amber-300 placeholder-emerald-400/30 shadow-inner focus:border-amber-400 focus:bg-[#0c2a1c] focus:ring-2 focus:ring-amber-400/30 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-xl border border-red-500/40 bg-red-950/70 p-3 text-xs leading-relaxed text-red-200">
                {error}
                {lockoutSec && (
                  <p className="mt-1 font-semibold text-amber-300">
                    Temporary lockout active: retry in {lockoutSec}s
                  </p>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !pin.trim() || Boolean(lockoutSec)}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/50 bg-gradient-to-r from-red-700 via-red-600 to-red-800 py-3.5 text-sm font-bold tracking-wide text-white shadow-[0_4px_20px_rgba(185,28,28,0.5)] transition-all hover:brightness-110 hover:shadow-[0_6px_25px_rgba(185,28,28,0.7)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span>Verifying Secret PIN...</span>
              ) : (
                <>
                  <span>Unlock My Secret Santa</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </form>

          <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-emerald-300/70">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
            <span>Salted PBKDF2 Hash • Zero organizer access</span>
          </div>
        </div>
      </div>
    </div>
  );
};
