"use client";

import React, { useState, useEffect, useRef } from "react";
import { ArrowRight, KeyRound, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { ParticipantItem } from "./ParticipantGrid";
import { getAsyncDeviceHeaders } from "@/lib/device";

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
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSec, setLockoutSec] = useState<number | null>(null);
  const [isDeviceBlocked, setIsDeviceBlocked] = useState(false);

  const pinInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the PIN input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      pinInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Handle countdown for rate-limiting
  useEffect(() => {
    if (!lockoutSec || lockoutSec <= 0) return;
    const interval = setInterval(() => {
      setLockoutSec((prev) => {
        if (!prev || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSec]);

  // Handle PIN submission and device binding
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const headers = await getAsyncDeviceHeaders();
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          participantId: participant.id,
          pin: pin.trim(),
        }),
      });
      clearTimeout(timeoutId);

      const data = await res.json();

      // Handle Device Binding Violation (403: Hardware / Device bound to someone else)
      if (res.status === 403) {
        setError(
          data.error ||
            "This physical device is already registered to another participant. Each student must use their own personal device."
        );
        setIsDeviceBlocked(true);
        setIsSubmitting(false);
        return;
      }

      // Handle Rate Limiting (429)
      if (res.status === 429) {
        setLockoutSec(data.retryAfterSec || 60);
        setError(
          data.error || "Too many incorrect attempts. Please wait 60 seconds."
        );
        setIsSubmitting(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || "Authentication failed. Please verify your PIN.");
        setIsSubmitting(false);
        return;
      }

      // Success
      setIsSubmitting(false);
      onSuccess({
        participant: data.participant,
        pin: pin.trim(),
        isRevealed: Boolean(data.isRevealed ?? data.participant?.isRevealed),
        recipientName: data.recipientName,
        isNewRegistration: Boolean(data.isNewRegistration),
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError") {
        setError("Request timed out. Please check your connection and try again.");
      } else {
        setError("Connection error. Please try again.");
      }
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-sm rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2318] via-[#05150e] to-[#020a06] p-6 shadow-2xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/25 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white cursor-pointer"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center pt-2">
          {/* Security Device Block Screen */}
          {isDeviceBlocked ? (
            <div className="py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/50 bg-gradient-to-br from-red-950 to-red-900 shadow-xl">
                <ShieldAlert className="h-9 w-9 text-red-400" />
              </div>
              <h3 className="font-serif text-xl font-bold text-white tracking-wide">
                Device Binding Locked
              </h3>
              <p className="mt-3 text-xs text-red-200/90 leading-relaxed bg-red-950/60 p-3.5 rounded-xl border border-red-500/30">
                {error ||
                  "This physical device is officially registered to another participant. Multiple accounts on one device are not permitted."}
              </p>
              <div className="mt-6">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-2xl border border-amber-500/40 bg-gradient-to-r from-emerald-800 to-teal-900 py-3 text-xs font-bold text-white shadow-lg transition-transform hover:scale-[1.02] cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Header Icon */}
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-red-800 to-emerald-950 shadow-lg">
                <KeyRound className="h-7 w-7 text-amber-300" />
              </div>

              <h3 className="font-serif text-xl font-bold text-white tracking-wide">
                {participant.name}
              </h3>
              <p className="mt-1 text-xs text-emerald-200/70">
                Enter your personal PIN (4 digits)
              </p>

              {/* Error Message */}
              {error && (
                <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/80 p-2.5 text-center text-xs text-red-200 flex items-center justify-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                  {lockoutSec && (
                    <span className="font-semibold text-amber-300">
                      ({lockoutSec}s)
                    </span>
                  )}
                </div>
              )}

              {/* PIN Input Form */}
              <form onSubmit={handlePinSubmit} className="mt-5 space-y-4 text-left">
                <div className="relative">
                  <input
                    ref={pinInputRef}
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    value={pin}
                    onChange={(e) => {
                      setPin(e.target.value);
                      setError(null);
                    }}
                    placeholder="Enter PIN (4 digits)..."
                    autoFocus
                    required
                    disabled={Boolean(lockoutSec) || isSubmitting}
                    className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] pr-11 pl-4 py-3.5 text-center font-mono text-base tracking-widest text-amber-300 placeholder-emerald-400/30 shadow-inner focus:border-amber-400 focus:bg-[#0c2a1c] focus:ring-2 focus:ring-amber-400/30 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(!showPin)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-amber-400/70 hover:text-white cursor-pointer"
                  >
                    {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !pin.trim() || Boolean(lockoutSec)}
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/50 bg-gradient-to-r from-red-700 via-red-600 to-red-800 py-3.5 text-sm font-bold tracking-wide text-white shadow-[0_4px_20px_rgba(185,28,28,0.5)] transition-all hover:brightness-110 hover:shadow-[0_6px_25px_rgba(185,28,28,0.7)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSubmitting ? (
                    <span>Verifying PIN...</span>
                  ) : (
                    <>
                      <span>Unlock Secret Santa</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
