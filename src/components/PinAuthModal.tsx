"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ArrowRight, KeyRound, Eye, EyeOff, Fingerprint, ShieldAlert, Sparkles } from "lucide-react";
import {
  startRegistration,
  startAuthentication,
  platformAuthenticatorIsAvailable,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
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

  // Active authentication tab: defaults to biometric if supported, else pin
  const [activeTab, setActiveTab] = useState<"biometric" | "pin">(() => {
    return typeof window !== "undefined" && Boolean(window.PublicKeyCredential)
      ? "biometric"
      : "pin";
  });

  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);

  // Refs for race-condition prevention, timeouts, and clean aborts
  const inFlightRef = useRef(false);
  const autoTriggeredRef = useRef(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const watchdogTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pinInputRef = useRef<HTMLInputElement | null>(null);

  // Safely abort any active WebAuthn ceremony and pending fetch
  const cancelActiveCeremony = useCallback(() => {
    try {
      WebAuthnAbortService.cancelCeremony();
    } catch {
      // ignore
    }
    if (activeAbortControllerRef.current) {
      try {
        activeAbortControllerRef.current.abort();
      } catch {
        // ignore
      }
      activeAbortControllerRef.current = null;
    }
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    inFlightRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelActiveCeremony();
    };
  }, [cancelActiveCeremony]);

  // Handle closing modal
  const handleClose = () => {
    cancelActiveCeremony();
    onClose();
  };

  // Switch to PIN tab cleanly and immediately
  const switchToPin = useCallback(() => {
    cancelActiveCeremony();
    setIsBiometricLoading(false);
    setError(null);
    setActiveTab("pin");
    setTimeout(() => {
      pinInputRef.current?.focus();
    }, 50);
  }, [cancelActiveCeremony]);

  // Unified Biometric Authentication Engine
  const triggerBiometricAuth = useCallback(async () => {
    // Re-entrancy guard: strictly prevent duplicate concurrent executions
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    cancelActiveCeremony();
    setError(null);
    setIsBiometricLoading(true);

    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    // Safety Watchdog: hard 14-second cap so UI NEVER stays stuck on "Waiting for device..."
    watchdogTimerRef.current = setTimeout(() => {
      console.warn("Biometric ceremony watchdog triggered.");
      cancelActiveCeremony();
      setIsBiometricLoading(false);
      setActiveTab("pin");
      setError("Biometric prompt took too long. You can enter your 4-digit PIN.");
      setTimeout(() => {
        pinInputRef.current?.focus();
      }, 50);
    }, 14000);

    try {
      // Step 1: Request options from unified endpoint
      const optRes = await fetch("/api/auth/biometric/options", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...getDeviceHeaders(),
        },
        body: JSON.stringify({ participantId: participant.id }),
      });

      const optData = await optRes.json();
      if (!optRes.ok || !optData.success) {
        throw new Error(optData.error || "Failed to initialize biometric check.");
      }

      // Step 2: Trigger platform authenticator (Face ID / Touch ID / Device Passcode)
      let clientResponse: any;
      if (optData.mode === "authenticate") {
        clientResponse = await startAuthentication({ optionsJSON: optData.options });
      } else {
        clientResponse = await startRegistration({ optionsJSON: optData.options });
      }

      // Step 3: Verify credential with server
      const verifyRes = await fetch("/api/auth/biometric/verify", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...getDeviceHeaders(),
        },
        body: JSON.stringify({
          participantId: participant.id,
          mode: optData.mode,
          response: clientResponse,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        throw new Error(verifyData.error || "Biometric verification failed.");
      }

      // Complete ceremony cleanly
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      inFlightRef.current = false;
      setIsBiometricLoading(false);

      onSuccess({
        participant: verifyData.participant,
        pin: "biometric",
        isRevealed: Boolean(verifyData.isRevealed ?? verifyData.participant?.isRevealed),
        recipientName: verifyData.recipientName,
        isNewRegistration: optData.mode === "register",
      });
    } catch (err: any) {
      if (watchdogTimerRef.current) {
        clearTimeout(watchdogTimerRef.current);
        watchdogTimerRef.current = null;
      }
      cancelActiveCeremony();
      setIsBiometricLoading(false);

      const isUserCancellation =
        err?.name === "NotAllowedError" ||
        err?.name === "AbortError" ||
        String(err?.message || "").includes("cancelled") ||
        String(err?.message || "").includes("timed out");

      if (isUserCancellation) {
        // User dismissed system prompt -> seamlessly switch to PIN tab
        setActiveTab("pin");
        setTimeout(() => {
          pinInputRef.current?.focus();
        }, 50);
      } else {
        // Unexpected error -> switch to PIN with clear feedback
        setActiveTab("pin");
        setError(err?.message || "Biometric verification failed. Please enter your 4-digit PIN.");
        setTimeout(() => {
          pinInputRef.current?.focus();
        }, 50);
      }
    }
  }, [participant.id, onSuccess, cancelActiveCeremony]);

  // Auto-detect biometric availability and auto-trigger on initial modal mount
  useEffect(() => {
    let isMounted = true;

    platformAuthenticatorIsAvailable()
      .then((supported) => {
        if (!isMounted) return;
        setIsBiometricSupported(Boolean(supported));
        if (!supported) {
          setIsBiometricLoading(false);
          setActiveTab("pin");
        } else if (!autoTriggeredRef.current) {
          autoTriggeredRef.current = true;
          triggerBiometricAuth();
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setIsBiometricSupported(false);
        setIsBiometricLoading(false);
        setActiveTab("pin");
      });

    return () => {
      isMounted = false;
    };
  }, [triggerBiometricAuth]);

  // Switch to Biometric Tab
  const switchToBiometric = useCallback(() => {
    setError(null);
    setActiveTab("biometric");
    if (!inFlightRef.current) {
      triggerBiometricAuth();
    }
  }, [triggerBiometricAuth]);

  // Traditional 4-digit PIN Form Submit
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

    cancelActiveCeremony();
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
          onClick={handleClose}
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/25 bg-[#0f3422]/60 text-amber-300 transition-colors hover:border-amber-400 hover:bg-red-950/80 hover:text-white cursor-pointer"
          aria-label="Close"
        >
          ✕
        </button>

        <div className="text-center pt-2">
          {/* Method Switcher Tabs (Visible when biometrics is supported) */}
          {isBiometricSupported && (
            <div className="flex rounded-2xl bg-[#06180e] p-1 border border-amber-500/25 mb-5 shadow-inner">
              <button
                type="button"
                onClick={switchToBiometric}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === "biometric"
                    ? "bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-md border border-emerald-400/40"
                    : "text-emerald-300/70 hover:text-white"
                }`}
              >
                <Fingerprint className="h-4 w-4 text-amber-300" />
                <span>Face ID / Passcode</span>
              </button>

              <button
                type="button"
                onClick={switchToPin}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeTab === "pin"
                    ? "bg-gradient-to-r from-red-800 to-red-700 text-white shadow-md border border-amber-400/40"
                    : "text-emerald-300/70 hover:text-white"
                }`}
              >
                <KeyRound className="h-4 w-4 text-amber-300" />
                <span>4-Digit PIN</span>
              </button>
            </div>
          )}

          {/* =========================================================================
              TAB 1: BIOMETRIC SCANNING VIEW
             ========================================================================= */}
          {activeTab === "biometric" && (
            <div className="py-2">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/50 bg-gradient-to-br from-emerald-600/30 to-amber-500/20 shadow-xl">
                <Fingerprint className="h-9 w-9 text-amber-300 animate-pulse" />
              </div>
              <h3 className="font-serif text-xl font-bold text-white tracking-wide">
                {participant.name}
              </h3>
              <p className="mt-2 text-xs text-emerald-200/80">
                {isBiometricLoading
                  ? "Verifying Face ID / Touch ID / Passcode..."
                  : "Tap below to scan Face ID or Passcode"}
              </p>

              {/* Error Message if any */}
              {error && (
                <div className="mt-3 rounded-xl border border-red-500/40 bg-red-950/80 p-2.5 text-center text-xs text-red-200">
                  {error}
                </div>
              )}

              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={triggerBiometricAuth}
                  disabled={isBiometricLoading}
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/50 bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-700 py-3 text-sm font-bold tracking-wide text-white shadow-[0_4px_20px_rgba(16,185,129,0.4)] transition-all hover:brightness-110 cursor-pointer disabled:opacity-50"
                >
                  {isBiometricLoading ? (
                    <>
                      <Sparkles className="h-4 w-4 text-amber-300 animate-spin" />
                      <span>Waiting for device...</span>
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4 text-amber-300" />
                      <span>Scan Face ID / Passcode</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={switchToPin}
                  className="text-xs text-amber-200/70 hover:text-amber-200 underline cursor-pointer"
                >
                  Or enter 4-digit PIN instead
                </button>
              </div>
            </div>
          )}

          {/* =========================================================================
              TAB 2: 4-DIGIT PIN FORM
             ========================================================================= */}
          {activeTab === "pin" && (
            <>
              {/* Header Icon */}
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-red-800 to-emerald-950 shadow-lg">
                <KeyRound className="h-7 w-7 text-amber-300" />
              </div>

              <h3 className="font-serif text-xl font-bold text-white tracking-wide">
                {participant.name}
              </h3>
              <p className="mt-1 text-xs text-emerald-200/70">
                Enter your personal PIN (min 4 characters)
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

              {/* Switch back to Face ID button if supported */}
              {isBiometricSupported && (
                <div className="mt-4 pt-3 border-t border-emerald-900/60 text-center">
                  <button
                    type="button"
                    onClick={switchToBiometric}
                    className="inline-flex items-center gap-1.5 text-xs text-emerald-300 hover:text-white transition-colors cursor-pointer"
                  >
                    <Fingerprint className="h-3.5 w-3.5 text-amber-300" />
                    <span>Switch to Face ID / Passcode</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
