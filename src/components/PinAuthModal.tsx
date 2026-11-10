"use client";

import React, { useState, useEffect } from "react";
import { ArrowRight, KeyRound, Eye, EyeOff, Fingerprint, ShieldCheck } from "lucide-react";
import { startRegistration, startAuthentication, platformAuthenticatorIsAvailable } from "@simplewebauthn/browser";
import { ParticipantItem } from "./ParticipantGrid";
import { getDeviceHeaders, setStoredBoundParticipant } from "@/lib/device";

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

  // Biometric / Device Screen Lock states
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [showPinFallback, setShowPinFallback] = useState(false);

  useEffect(() => {
    platformAuthenticatorIsAvailable()
      .then((supported) => {
        setIsBiometricSupported(Boolean(supported));
        if (!supported) {
          setShowPinFallback(true);
        }
      })
      .catch(() => {
        setIsBiometricSupported(false);
        setShowPinFallback(true);
      });
  }, []);

  // Biometric Authentication (Face ID / Touch ID / Native Device Passcode)
  const handleBiometricAuth = async () => {
    setError(null);
    setIsBiometricLoading(true);

    try {
      if (participant.hasPasskey) {
        // Authenticate existing credential
        const optRes = await fetch("/api/auth/biometric/auth-options", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getDeviceHeaders(),
          },
          body: JSON.stringify({ participantId: participant.id }),
        });

        const optData = await optRes.json();
        if (!optRes.ok || !optData.success) {
          setError(optData.error || "Failed to start biometric authentication.");
          setIsBiometricLoading(false);
          return;
        }

        const assertion = await startAuthentication({ optionsJSON: optData.options });

        const verifyRes = await fetch("/api/auth/biometric/auth-verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getDeviceHeaders(),
          },
          body: JSON.stringify({
            participantId: participant.id,
            response: assertion,
          }),
        });

        const verifyData = await verifyRes.json();
        if (!verifyRes.ok || !verifyData.success) {
          setError(verifyData.error || "Biometric authentication failed.");
          setIsBiometricLoading(false);
          return;
        }

        setIsBiometricLoading(false);
        onSuccess({
          participant: verifyData.participant,
          pin: "biometric",
          isRevealed: Boolean(verifyData.participant?.isRevealed),
          recipientName: verifyData.recipientName,
          isNewRegistration: false,
        });
      } else {
        // Register new credential (Face ID / Touch ID / Screen Lock Passcode)
        const optRes = await fetch("/api/auth/biometric/register-options", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getDeviceHeaders(),
          },
          body: JSON.stringify({ participantId: participant.id }),
        });

        const optData = await optRes.json();
        if (!optRes.ok || !optData.success) {
          setError(optData.error || "Failed to initialize biometric registration.");
          setIsBiometricLoading(false);
          return;
        }

        const registration = await startRegistration({ optionsJSON: optData.options });

        const verifyRes = await fetch("/api/auth/biometric/register-verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getDeviceHeaders(),
          },
          body: JSON.stringify({
            participantId: participant.id,
            response: registration,
          }),
        });

        const verifyData = await verifyRes.json();
        if (!verifyRes.ok || !verifyData.success) {
          setError(verifyData.error || "Biometric registration failed.");
          setIsBiometricLoading(false);
          return;
        }

        setIsBiometricLoading(false);
        onSuccess({
          participant: verifyData.participant,
          pin: "biometric",
          isRevealed: Boolean(verifyData.participant?.isRevealed),
          recipientName: verifyData.recipientName,
          isNewRegistration: true,
        });
      }
    } catch (err: unknown) {
      console.error("Biometric auth error:", err);
      const msg = err instanceof Error ? err.message : "Authentication canceled.";
      if (!msg.toLowerCase().includes("abort") && !msg.toLowerCase().includes("cancel")) {
        setError(msg);
      }
      setIsBiometricLoading(false);
    }
  };

  // Traditional PIN Fallback Submit
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

    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getDeviceHeaders(),
        },
        body: JSON.stringify({
          participantId: participant.id,
          pin: pin.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.boundParticipantId && data.boundParticipantName) {
          setStoredBoundParticipant({
            id: data.boundParticipantId,
            name: data.boundParticipantName,
          });
        }
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] via-[#071d13] to-[#04120b] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.85)]">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/25 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white cursor-pointer"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center pt-2">
          {/* Header Icon */}
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-red-800 to-emerald-950 shadow-lg">
            {isBiometricSupported ? (
              <Fingerprint className="h-7 w-7 text-amber-300 animate-pulse" />
            ) : (
              <KeyRound className="h-7 w-7 text-amber-300" />
            )}
          </div>

          <h3 className="font-serif text-xl font-bold text-white tracking-wide">
            {participant.name}
          </h3>
          <p className="mt-1 text-xs text-emerald-200/70">
            {isBiometricSupported
              ? "Verify with Face ID, Touch ID, or Device Passcode"
              : "Enter your personal PIN (create on first visit)"}
          </p>

          {/* Error Message */}
          {error && (
            <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/80 p-2.5 text-center text-xs text-red-200">
              {error}
              {lockoutSec && (
                <p className="mt-1 font-semibold text-amber-300">
                  Retry in {lockoutSec}s
                </p>
              )}
            </div>
          )}

          {/* Primary Biometric Action (Apple Face ID / Touch ID / Phone Passcode) */}
          {isBiometricSupported && (
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={handleBiometricAuth}
                disabled={isBiometricLoading}
                className="group flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-emerald-400/80 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 py-4 text-sm font-bold text-white shadow-[0_4px_25px_rgba(5,150,105,0.4)] transition-all hover:scale-[1.02] hover:brightness-110 disabled:opacity-50 cursor-pointer"
              >
                <Fingerprint className="h-5 w-5 text-amber-300 animate-pulse" />
                <span>
                  {isBiometricLoading
                    ? "Verifying Device Lock..."
                    : participant.hasPasskey
                    ? "Unlock with Face ID / Passcode"
                    : "Continue with Face ID / Passcode"}
                </span>
              </button>

              <div className="flex items-center justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowPinFallback((prev) => !prev)}
                  className="flex items-center gap-1.5 text-xs text-amber-200/60 hover:text-amber-200 transition-colors cursor-pointer"
                >
                  <KeyRound className="h-3 w-3" />
                  <span>{showPinFallback ? "Hide PIN option" : "Or use a 4-digit PIN instead"}</span>
                </button>
              </div>
            </div>
          )}

          {/* PIN Fallback Form */}
          {(showPinFallback || !isBiometricSupported) && (
            <form onSubmit={handlePinSubmit} className="mt-5 space-y-4 text-left border-t border-emerald-900/60 pt-4">
              <div className="relative">
                <input
                  type={showPin ? "text" : "password"}
                  value={pin}
                  onChange={(e) => {
                    setPin(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter PIN (min 4 characters)..."
                  autoFocus={!isBiometricSupported}
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
          )}
        </div>
      </div>
    </div>
  );
};
