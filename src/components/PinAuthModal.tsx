"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ArrowRight,
  KeyRound,
  Eye,
  EyeOff,
  ShieldAlert,
  Fingerprint,
} from "lucide-react";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { ParticipantItem } from "./ParticipantGrid";
import { getAsyncDeviceHeaders, setStoredBoundParticipant } from "@/lib/device";

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
  onDeviceBound?: (bound: { id: string; name: string }) => void;
}

export const PinAuthModal: React.FC<PinAuthModalProps> = ({
  participant,
  onClose,
  onSuccess,
  onDeviceBound,
}) => {
  // Determine if participant is already established with PIN-only (no passkey)
  const isPasskeyAccount = Boolean(
    participant.claimMethod === "passkey" || participant.hasPasskey
  );
  const isPinOnlyAccount = Boolean(
    (participant.claimMethod === "pin" || participant.hasRegistered || participant.isClaimed) &&
      !isPasskeyAccount
  );
  const isUnclaimed = !isPasskeyAccount && !isPinOnlyAccount;

  // Track platform biometric hardware availability (Face ID / Touch ID / Windows Hello)
  const [hasHardwareBiometrics, setHasHardwareBiometrics] = useState<boolean | null>(null);

  // Active view:
  // - "biometric": Shows pulsing Touch/Face ID and triggers WebAuthn prompt
  // - "pin": Direct 4-digit PIN input field
  const [activeView, setActiveView] = useState<"biometric" | "pin">(
    isPinOnlyAccount ? "pin" : "biometric"
  );

  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lockoutSec, setLockoutSec] = useState<number | null>(null);
  const [isDeviceBlocked, setIsDeviceBlocked] = useState(false);

  const pinInputRef = useRef<HTMLInputElement | null>(null);
  const hasTriggeredBiometricRef = useRef(false);

  // Check hardware biometric availability on mount
  useEffect(() => {
    let isMounted = true;
    async function checkPlatformBiometrics() {
      if (
        typeof window !== "undefined" &&
        window.PublicKeyCredential &&
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
      ) {
        try {
          const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          if (isMounted) {
            setHasHardwareBiometrics(Boolean(available));
            if (!available && isUnclaimed) {
              // Only fallback to PIN if device lacks biometric hardware
              setActiveView("pin");
            }
          }
        } catch {
          if (isMounted) {
            setHasHardwareBiometrics(false);
            if (isUnclaimed) setActiveView("pin");
          }
        }
      } else {
        if (isMounted) {
          setHasHardwareBiometrics(false);
          if (isUnclaimed) setActiveView("pin");
        }
      }
    }
    checkPlatformBiometrics();
    return () => {
      isMounted = false;
    };
  }, [isUnclaimed]);

  // Auto-focus PIN input whenever PIN view is active
  useEffect(() => {
    if (activeView === "pin") {
      const timer = setTimeout(() => {
        pinInputRef.current?.focus();
      }, 100);
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
  // Core Passkey Trigger Handler (Automatic on Mount or Manual Retry)
  // --------------------------------------------------------------------------
  const executeBiometricFlow = useCallback(async () => {
    // 1. Check if browser/device supports WebAuthn credentials
    const isSupported =
      typeof window !== "undefined" &&
      Boolean(window.PublicKeyCredential) &&
      browserSupportsWebAuthn();

    if (!isSupported) {
      if (isUnclaimed || isPinOnlyAccount) {
        setActiveView("pin");
        setError(null);
      } else {
        setError("Face ID / Touch ID verification is required to unlock this profile.");
      }
      return;
    }

    let isPlatformAvailable = hasHardwareBiometrics;
    if (
      isPlatformAvailable === null &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    ) {
      try {
        isPlatformAvailable = Boolean(
          await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        );
        setHasHardwareBiometrics(isPlatformAvailable);
      } catch {
        isPlatformAvailable = false;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const headers = await getAsyncDeviceHeaders();

      if (isPasskeyAccount) {
        // --- AUTHENTICATION FLOW (Returning User with Passkey) ---
        const optRes = await fetch("/api/auth/biometric/auth-options", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ participantId: participant.id }),
        });

        const optData = await optRes.json();

        // If device is permanently locked to another user, show lock screen
        if (optRes.status === 403 || optData.code === "DEVICE_ALREADY_BOUND" || optData.boundParticipantId) {
          if (optData.boundParticipantId) {
            onDeviceBound?.({
              id: optData.boundParticipantId,
              name: optData.boundParticipantName || "Registered User",
            });
          }
          setIsDeviceBlocked(true);
          setError(optData.error || "This device is permanently bound to another participant's profile.");
          setIsSubmitting(false);
          return;
        }

        if (!optRes.ok || !optData.success || !optData.options) {
          setError(optData.error || "Failed to initialize Face ID / Touch ID authentication. Please try again.");
          setIsSubmitting(false);
          return;
        }

        let assertionResponse;
        try {
          assertionResponse = await startAuthentication({ optionsJSON: optData.options });
        } catch {
          // Passkey authentication cancelled or timed out -> require retry, DO NOT switch to PIN
          setError("Touch ID / Face ID verification is required to unlock this profile. Please tap below to retry.");
          setIsSubmitting(false);
          return;
        }

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
        if (verifyRes.status === 403 || verifyData.code === "DEVICE_ALREADY_BOUND" || verifyData.boundParticipantId) {
          if (verifyData.boundParticipantId) {
            onDeviceBound?.({
              id: verifyData.boundParticipantId,
              name: verifyData.boundParticipantName || "Registered User",
            });
          }
          setIsDeviceBlocked(true);
          setError(verifyData.error || "This device is permanently bound to another participant's profile.");
          setIsSubmitting(false);
          return;
        }

        if (!verifyRes.ok || !verifyData.success) {
          setError(verifyData.error || "Touch ID / Face ID verification failed. Please try again.");
          setIsSubmitting(false);
          return;
        }

        // Authentication Success
        setStoredBoundParticipant({ id: participant.id, name: participant.name });
        setIsSubmitting(false);
        onSuccess({
          participant: verifyData.participant || participant,
          pin: "",
          isRevealed: Boolean(verifyData.isRevealed),
          recipientName: verifyData.recipientName,
          isNewRegistration: false,
        });
      } else {
        // --- REGISTRATION FLOW (First-Time Setup for Unclaimed Profile) ---
        const optRes = await fetch("/api/auth/biometric/register-options", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: JSON.stringify({ participantId: participant.id }),
        });

        const optData = await optRes.json();

        if (optRes.status === 403 || optData.code === "DEVICE_ALREADY_BOUND" || optData.boundParticipantId) {
          if (optData.boundParticipantId) {
            onDeviceBound?.({
              id: optData.boundParticipantId,
              name: optData.boundParticipantName || "Registered User",
            });
          }
          setIsDeviceBlocked(true);
          setError(optData.error || "This device is permanently bound to another participant's profile.");
          setIsSubmitting(false);
          return;
        }

        if (!optRes.ok || !optData.success || !optData.options) {
          if (optRes.status === 403) {
            setIsDeviceBlocked(true);
            setError(optData.error || "This profile has already been claimed. Please authenticate with the original Passkey or PIN.");
            setIsSubmitting(false);
            return;
          }
          if (isPlatformAvailable) {
            setError(optData.error || "Failed to initialize Face ID / Touch ID setup. Please tap below to retry.");
          } else {
            setActiveView("pin");
            setError(null);
          }
          setIsSubmitting(false);
          return;
        }

        let attestationResponse;
        try {
          attestationResponse = await startRegistration({ optionsJSON: optData.options });
        } catch (err: any) {
          // CRITICAL SECURITY CATCH BLOCK:
          // 1. Check for InvalidStateError:
          // W3C WebAuthn spec: Thrown when an excludeCredentials entry matches an authenticator credential on this device!
          // This proves this phone already has a Passkey for another student on this website!
          if (err?.name === "InvalidStateError") {
            setIsDeviceBlocked(true);
            setError("This device is already registered to another participant via Face ID / Touch ID. You cannot unlock or claim multiple profiles on the same device.");
            setIsSubmitting(false);
            return;
          }

          // 2. User clicked Cancel, timed out, or refused prompt on a capable device:
          if (isPlatformAvailable) {
            // NEVER switch to PIN!
            setError("Face ID / Touch ID verification is mandatory on this device to ensure one profile per student. Please tap below to verify with Face ID / Touch ID.");
            setIsSubmitting(false);
            return;
          }

          // 3. ONLY if device lacks platform biometrics: fallback to PIN
          setActiveView("pin");
          setError(null);
          setIsSubmitting(false);
          return;
        }

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
        if (verifyRes.status === 403 || verifyData.code === "DEVICE_ALREADY_BOUND" || verifyData.boundParticipantId) {
          if (verifyData.boundParticipantId) {
            onDeviceBound?.({
              id: verifyData.boundParticipantId,
              name: verifyData.boundParticipantName || "Registered User",
            });
          }
          setIsDeviceBlocked(true);
          setError(verifyData.error || "This device is permanently bound to another participant's profile.");
          setIsSubmitting(false);
          return;
        }

        if (!verifyRes.ok || !verifyData.success) {
          if (verifyRes.status === 403) {
            setIsDeviceBlocked(true);
            setError(verifyData.error || "This device is permanently bound to another participant's profile.");
            setIsSubmitting(false);
            return;
          }
          if (isPlatformAvailable) {
            setError(verifyData.error || "Biometric registration failed. Please tap below to retry.");
          } else {
            setActiveView("pin");
            setError(null);
          }
          setIsSubmitting(false);
          return;
        }

        // Registration Success
        setStoredBoundParticipant({ id: participant.id, name: participant.name });
        setIsSubmitting(false);
        onSuccess({
          participant: verifyData.participant || participant,
          pin: "",
          isRevealed: Boolean(verifyData.isRevealed),
          recipientName: verifyData.recipientName,
          isNewRegistration: true,
        });
      }
    } catch {
      if (isPlatformAvailable) {
        setError("Face ID / Touch ID verification is mandatory on this device to ensure one profile per student. Please tap below to verify with Face ID / Touch ID.");
      } else {
        setActiveView("pin");
        setError(null);
      }
      setIsSubmitting(false);
    }
  }, [
    isPasskeyAccount,
    isUnclaimed,
    isPinOnlyAccount,
    hasHardwareBiometrics,
    participant,
    onSuccess,
    onDeviceBound,
  ]);

  // ZERO-CLICK AUTO-TRIGGER ON MODAL OPEN
  useEffect(() => {
    if (activeView === "biometric" && !hasTriggeredBiometricRef.current) {
      hasTriggeredBiometricRef.current = true;
      executeBiometricFlow();
    }
  }, [activeView, executeBiometricFlow]);

  // --------------------------------------------------------------------------
  // PIN Submission (Only allowed for devices without platform biometrics or returning PIN accounts)
  // --------------------------------------------------------------------------
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!pin.trim()) {
      setError("Please enter your PIN.");
      return;
    }

    if (pin.trim().length < 4) {
      setError("PIN must be at least 4 digits or characters.");
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

      // Device Binding Violation (403: Hardware / Device bound to someone else)
      if (res.status === 403 || data.code === "DEVICE_ALREADY_BOUND" || data.boundParticipantId) {
        if (data.boundParticipantId) {
          onDeviceBound?.({
            id: data.boundParticipantId,
            name: data.boundParticipantName || "Registered User",
          });
        }
        setError(
          data.error ||
            "This physical device is already registered to another participant. Each student must use their own personal device."
        );
        setIsDeviceBlocked(true);
        setIsSubmitting(false);
        return;
      }

      // Rate Limiting (429)
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
                  "This device is already registered to another participant via Face ID / Touch ID. You cannot unlock or claim multiple profiles on the same device."}
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
                {activeView === "biometric" ? (
                  <Fingerprint className="h-7 w-7 text-amber-300 animate-pulse" />
                ) : (
                  <KeyRound className="h-7 w-7 text-amber-300" />
                )}
              </div>

              <h3 className="font-serif text-xl font-bold text-white tracking-wide">
                {participant.name}
              </h3>

              {/* Sub-header instructions */}
              <p className="mt-1 text-xs text-emerald-200/70">
                {activeView === "biometric"
                  ? isUnclaimed
                    ? "Verify Face ID / Touch ID to secure your profile"
                    : "Scanning Face ID / Touch ID..."
                  : isUnclaimed
                  ? "Create your personal Secret PIN"
                  : "Enter your personal 4-digit PIN"}
              </p>

              {/* ===============================================================
                  VIEW 1: BIOMETRIC SCANNING (Mandatory on Capable Hardware)
                 =============================================================== */}
              {activeView === "biometric" && (
                <div className="mt-6 space-y-4">
                  {/* Warning / Retry Message Banner */}
                  {error && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/80 p-3 text-center text-xs text-amber-200 flex items-center justify-center gap-2 leading-relaxed">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="py-2">
                    <button
                      type="button"
                      onClick={() => executeBiometricFlow()}
                      disabled={isSubmitting}
                      className="group flex w-full items-center justify-center gap-2.5 rounded-2xl border border-amber-400/60 bg-gradient-to-r from-emerald-800 via-teal-800 to-emerald-900 py-3.5 text-sm font-bold text-white shadow-[0_4px_20px_rgba(16,185,129,0.3)] transition-all hover:brightness-110 active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      <Fingerprint className="h-5 w-5 text-amber-300" />
                      <span>{isSubmitting ? "Prompting Biometrics..." : "Verify with Face ID / Touch ID"}</span>
                    </button>
                  </div>

                  {/* Manual PIN Fallback link - ONLY visible when device LACKS hardware biometrics AND is not a passkey account */}
                  {hasHardwareBiometrics === false && !isPasskeyAccount && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setActiveView("pin");
                      }}
                      className="text-xs font-semibold text-emerald-300/80 hover:text-amber-200 transition-colors underline underline-offset-4 cursor-pointer"
                    >
                      Enter PIN instead →
                    </button>
                  )}
                </div>
              )}

              {/* ===============================================================
                  VIEW 2: DIRECT PIN FORM (Only for Hardware Without Biometrics or PIN Accounts)
                 =============================================================== */}
              {activeView === "pin" && (
                <>
                  {/* Error Banner (Only for actual PIN errors) */}
                  {error && (
                    <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/80 p-2.5 text-center text-xs text-red-200 flex items-center justify-center gap-1.5">
                      <ShieldAlert className="h-4 w-4 shrink-0 text-red-400" />
                      <span>{error}</span>
                      {lockoutSec && (
                        <span className="font-semibold text-amber-300">({lockoutSec}s)</span>
                      )}
                    </div>
                  )}

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
                        <span>{isUnclaimed ? "Saving PIN..." : "Verifying PIN..."}</span>
                      ) : (
                        <>
                          <span>{isUnclaimed ? "Save PIN & Reveal Gift" : "Unlock Secret Santa"}</span>
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </>
                      )}
                    </button>

                    {/* Option to try Face ID / Touch ID if hardware biometrics become available */}
                    {hasHardwareBiometrics && (
                      <div className="pt-1 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setActiveView("biometric");
                            hasTriggeredBiometricRef.current = false;
                          }}
                          className="text-[11px] font-medium text-emerald-400/70 hover:text-amber-300 transition-colors cursor-pointer"
                        >
                          Use Face ID / Touch ID instead
                        </button>
                      </div>
                    )}
                  </form>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
