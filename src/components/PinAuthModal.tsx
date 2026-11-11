"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowRight,
  KeyRound,
  Eye,
  EyeOff,
  ShieldAlert,
  Fingerprint,
  Lock,
  Sparkles,
  Smartphone,
  AlertTriangle,
} from "lucide-react";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { ParticipantItem } from "./ParticipantGrid";
import { getAsyncDeviceHeaders, isInAppBrowser, setStoredBoundParticipant } from "@/lib/device";

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
  // Determine if participant has already established credentials (CLAIMED)
  const isClaimedByPasskey = Boolean(
    participant.claimMethod === "passkey" || participant.hasPasskey
  );
  const isClaimedByPin = Boolean(
    participant.claimMethod === "pin" ||
      (!isClaimedByPasskey && (participant.isClaimed || participant.hasRegistered))
  );
  const isUnclaimed = !isClaimedByPasskey && !isClaimedByPin;

  // Active view in modal:
  // - For unclaimed: "choice" (shows Option 1 Passkey + Option 2 PIN) or "pin_setup"
  // - For claimed passkey: "passkey_auth"
  // - For claimed PIN: "pin_auth"
  const [activeView, setActiveView] = useState<"choice" | "pin_setup" | "passkey_auth" | "pin_auth">(
    isClaimedByPasskey ? "passkey_auth" : isClaimedByPin ? "pin_auth" : "choice"
  );

  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSec, setLockoutSec] = useState<number | null>(null);
  const [isDeviceBlocked, setIsDeviceBlocked] = useState(false);
  const [webAuthnSupported, setWebAuthnSupported] = useState(true);
  const [inAppDetected, setInAppDetected] = useState(false);

  const pinInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setWebAuthnSupported(browserSupportsWebAuthn());
    setInAppDetected(isInAppBrowser());
  }, []);

  // Auto-focus input when in PIN view
  useEffect(() => {
    if (activeView === "pin_auth" || activeView === "pin_setup") {
      const timer = setTimeout(() => {
        pinInputRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [activeView]);

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

  // --------------------------------------------------------------------------
  // FLOW A - OPTION 1: Register Face ID / Touch ID (Passkey)
  // --------------------------------------------------------------------------
  const handleRegisterPasskey = useCallback(async () => {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const headers = await getAsyncDeviceHeaders();

      // Step 1: Request registration options
      const optRes = await fetch("/api/auth/biometric/register-options", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ participantId: participant.id }),
      });

      const optData = await optRes.json();
      if (!optRes.ok || !optData.success) {
        if (optRes.status === 403) {
          setIsDeviceBlocked(true);
        }
        setError(optData.error || "Failed to initialize biometric registration.");
        setIsSubmitting(false);
        return;
      }

      // Step 2: Trigger platform authenticator (Face ID / Touch ID / Windows Hello)
      let attestationResponse;
      try {
        attestationResponse = await startRegistration({ optionsJSON: optData.options });
      } catch (clientErr: any) {
        if (clientErr?.name === "NotAllowedError") {
          setError("Biometric prompt was cancelled. You can try again or create a PIN below.");
        } else {
          setError("Biometric registration could not be completed on this browser.");
        }
        setIsSubmitting(false);
        return;
      }

      // Step 3: Verify registration on server
      const verifyRes = await fetch("/api/auth/biometric/register-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          participantId: participant.id,
          response: attestationResponse,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        if (verifyRes.status === 403) {
          setIsDeviceBlocked(true);
        }
        setError(verifyData.error || "Failed to verify biometric registration.");
        setIsSubmitting(false);
        return;
      }

      // Success: Save storage lock
      setStoredBoundParticipant({ id: participant.id, name: participant.name });
      setIsSubmitting(false);
      onSuccess({
        participant: verifyData.participant || participant,
        pin: "",
        isRevealed: Boolean(verifyData.isRevealed),
        recipientName: verifyData.recipientName,
        isNewRegistration: true,
      });
    } catch (err: any) {
      console.error("Biometric registration error:", err);
      setError("An unexpected error occurred during biometric registration.");
      setIsSubmitting(false);
    }
  }, [isSubmitting, participant, onSuccess]);

  // --------------------------------------------------------------------------
  // FLOW B - Authenticate with existing Face ID / Touch ID (Passkey)
  // --------------------------------------------------------------------------
  const handleAuthenticatePasskey = useCallback(async () => {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const headers = await getAsyncDeviceHeaders();

      // Step 1: Request authentication options
      const optRes = await fetch("/api/auth/biometric/auth-options", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ participantId: participant.id }),
      });

      const optData = await optRes.json();
      if (!optRes.ok || !optData.success) {
        if (optRes.status === 403) {
          setIsDeviceBlocked(true);
        }
        setError(optData.error || "Failed to initialize biometric authentication.");
        setIsSubmitting(false);
        return;
      }

      // Step 2: Prompt Face ID / Touch ID
      let assertionResponse;
      try {
        assertionResponse = await startAuthentication({ optionsJSON: optData.options });
      } catch (clientErr: any) {
        if (clientErr?.name === "NotAllowedError") {
          setError("Biometric prompt was cancelled. Please tap below to try again.");
        } else {
          setError("Biometric authentication error. Please try again.");
        }
        setIsSubmitting(false);
        return;
      }

      // Step 3: Verify authentication on server
      const verifyRes = await fetch("/api/auth/biometric/auth-verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          participantId: participant.id,
          response: assertionResponse,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        if (verifyRes.status === 403) {
          setIsDeviceBlocked(true);
        }
        setError(verifyData.error || "Biometric authentication failed.");
        setIsSubmitting(false);
        return;
      }

      // Success
      setStoredBoundParticipant({ id: participant.id, name: participant.name });
      setIsSubmitting(false);
      onSuccess({
        participant: verifyData.participant || participant,
        pin: "",
        isRevealed: Boolean(verifyData.isRevealed),
        recipientName: verifyData.recipientName,
        isNewRegistration: false,
      });
    } catch (err: any) {
      console.error("Biometric auth error:", err);
      setError("An unexpected error occurred during biometric sign in.");
      setIsSubmitting(false);
    }
  }, [isSubmitting, participant, onSuccess]);

  // --------------------------------------------------------------------------
  // PIN Submission (Used for First-Time PIN Setup OR Returning PIN Verification)
  // --------------------------------------------------------------------------
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!pin.trim()) {
      setError("Please enter your PIN.");
      return;
    }

    if (pin.trim().length < 4) {
      setError("PIN must be at least 4 characters or digits.");
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
        setError(data.error || "Too many incorrect attempts. Please wait 60 seconds.");
        setIsSubmitting(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || "Authentication failed. Please check your PIN.");
        setIsSubmitting(false);
        return;
      }

      // Success
      setStoredBoundParticipant({ id: participant.id, name: participant.name });
      setIsSubmitting(false);
      onSuccess({
        participant: data.participant || participant,
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
          {/* ===================================================================
              DEVICE BLOCKED SCREEN (HTTP 403 Violation)
             =================================================================== */}
          {isDeviceBlocked ? (
            <div className="py-4">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/50 bg-gradient-to-br from-red-950 to-red-900 shadow-xl">
                <ShieldAlert className="h-9 w-9 text-red-400" />
              </div>
              <h3 className="font-serif text-xl font-bold text-white tracking-wide">
                Device Access Locked
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
              {/* Header Badge */}
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-red-800 to-emerald-950 shadow-lg">
                {isClaimedByPasskey ? (
                  <Fingerprint className="h-7 w-7 text-amber-300" />
                ) : (
                  <KeyRound className="h-7 w-7 text-amber-300" />
                )}
              </div>

              <h3 className="font-serif text-xl font-bold text-white tracking-wide">
                {participant.name}
              </h3>

              {/* Sub-header instruction */}
              <p className="mt-1 text-xs text-emerald-200/70">
                {activeView === "choice"
                  ? "Claim and lock your Secret Santa profile"
                  : activeView === "passkey_auth"
                  ? "Unlock with Face ID / Touch ID"
                  : activeView === "pin_auth"
                  ? "Enter your 4-digit PIN"
                  : "Create your 4-digit Secret PIN"}
              </p>

              {/* In-App Browser Warning Banner */}
              {inAppDetected && isUnclaimed && (
                <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/40 p-2.5 text-left text-[11px] text-amber-200/90 flex items-start gap-2">
                  <Smartphone className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <span>
                    In-app browser detected (Instagram/WhatsApp). For Face ID / Touch ID, open in Safari/Chrome, or create a PIN below.
                  </span>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/80 p-2.5 text-center text-xs text-red-200 flex items-center justify-center gap-1.5">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{error}</span>
                  {lockoutSec && (
                    <span className="font-semibold text-amber-300">({lockoutSec}s)</span>
                  )}
                </div>
              )}

              {/* ===============================================================
                  FLOW A: UNCLAIMED PARTICIPANT SETUP OPTIONS
                 =============================================================== */}
              {activeView === "choice" && (
                <div className="mt-5 space-y-3.5">
                  {/* Option 1: Face ID / Touch ID Passkey */}
                  {webAuthnSupported && (
                    <button
                      type="button"
                      onClick={handleRegisterPasskey}
                      disabled={isSubmitting}
                      className="group relative flex w-full items-center gap-3 rounded-2xl border border-amber-400/60 bg-gradient-to-r from-emerald-950 via-[#0a2f1c] to-emerald-900 p-3.5 text-left transition-all hover:border-amber-300 hover:shadow-[0_0_20px_rgba(212,175,55,0.3)] disabled:opacity-50 cursor-pointer"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-300">
                        <Fingerprint className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-amber-200">Face ID / Touch ID</span>
                          <span className="rounded-full bg-amber-400/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-300 uppercase tracking-wider">
                            Best
                          </span>
                        </div>
                        <p className="text-[11px] text-emerald-300/70 truncate mt-0.5">
                          Hardware locked to your phone
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-amber-400 transition-transform group-hover:translate-x-1" />
                    </button>
                  )}

                  {/* Divider */}
                  <div className="relative my-2 flex items-center justify-center">
                    <div className="w-full border-t border-emerald-900/60" />
                    <span className="absolute bg-[#061910] px-3 text-[10px] font-semibold text-emerald-400/50 uppercase tracking-widest">
                      Or
                    </span>
                  </div>

                  {/* Option 2: Custom Secret PIN */}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setActiveView("pin_setup");
                    }}
                    disabled={isSubmitting}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-amber-500/20 bg-[#071d13] p-3.5 text-left transition-all hover:border-amber-400/40 hover:bg-[#0a2618] cursor-pointer"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-600/30 bg-emerald-900/30 text-emerald-300">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-white group-hover:text-amber-200">
                        Create Secret PIN
                      </span>
                      <p className="text-[11px] text-emerald-300/60 truncate mt-0.5">
                        Choose your own 4-digit code
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-emerald-400 transition-transform group-hover:translate-x-1" />
                  </button>
                </div>
              )}

              {/* ===============================================================
                  FLOW B: RETURNING PASSKEY AUTHENTICATION
                 =============================================================== */}
              {activeView === "passkey_auth" && (
                <div className="mt-5 space-y-4">
                  <button
                    type="button"
                    onClick={handleAuthenticatePasskey}
                    disabled={isSubmitting}
                    className="group flex w-full items-center justify-center gap-2.5 rounded-2xl border border-amber-400/60 bg-gradient-to-r from-emerald-800 via-teal-800 to-emerald-900 py-4 text-sm font-bold text-white shadow-[0_4px_20px_rgba(16,185,129,0.3)] transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    <Fingerprint className="h-5 w-5 text-amber-300" />
                    <span>{isSubmitting ? "Scanning Face ID / Touch ID..." : "Tap to Unlock with Biometrics"}</span>
                  </button>

                  <p className="text-[11px] text-emerald-300/60 text-center">
                    This profile is permanently secured with your device&apos;s Face ID / Touch ID.
                  </p>
                </div>
              )}

              {/* ===============================================================
                  PIN FORM (SETUP OR AUTHENTICATION)
                 =============================================================== */}
              {(activeView === "pin_auth" || activeView === "pin_setup") && (
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
                      placeholder="Enter 4-digit PIN..."
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
                      <span>{activeView === "pin_setup" ? "Saving PIN..." : "Verifying PIN..."}</span>
                    ) : (
                      <>
                        <span>{activeView === "pin_setup" ? "Save PIN & Reveal Gift" : "Unlock Secret Santa"}</span>
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </>
                    )}
                  </button>

                  {/* Back to Options button for unclaimed accounts */}
                  {isUnclaimed && activeView === "pin_setup" && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setActiveView("choice");
                      }}
                      className="w-full text-center text-xs font-semibold text-emerald-300/70 hover:text-amber-200 transition-colors cursor-pointer py-1"
                    >
                      ← Back to setup options
                    </button>
                  )}
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
