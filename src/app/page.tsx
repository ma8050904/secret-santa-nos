"use client";

import React, { useEffect, useState, Suspense, useCallback, useRef } from "react";
import { ArrowDown, Gift, RefreshCw, Lock, ShieldAlert, X, CheckCircle2 } from "lucide-react";
import { FestiveHeader } from "@/components/FestiveHeader";
import { Snowfall } from "@/components/Snowfall";
import { ParticipantGrid, ParticipantItem } from "@/components/ParticipantGrid";
import { PinAuthModal } from "@/components/PinAuthModal";
import { GiftBoxReveal } from "@/components/GiftBoxReveal";
import { SantaChatModal } from "@/components/SantaChatModal";
import { PARTICIPANTS } from "@/lib/constants";
import {
  getDeviceHeaders,
  getAsyncDeviceHeaders,
  getStoredBoundParticipant,
  getAsyncStoredBoundParticipant,
  setStoredBoundParticipant,
  clearStoredBoundParticipant,
} from "@/lib/device";
import { getHardwareFingerprint } from "@/lib/fingerprint";

// Default participant list pre-populated to guarantee immediate rendering and resilience
const DEFAULT_PARTICIPANTS: ParticipantItem[] = PARTICIPANTS.map((p) => ({
  id: p.id,
  name: p.name,
  isRevealed: false,
}));

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class SafeErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Client error boundary caught exception:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#05150d] px-4 text-center text-white">
          <div className="mx-auto max-w-md rounded-3xl border border-amber-500/30 bg-[#0a2618]/90 p-8 shadow-2xl backdrop-blur-xl">
            <span className="text-4xl">🎄</span>
            <h2 className="mt-4 font-serif text-2xl font-bold text-amber-200">
              The Magic of Secret Santa
            </h2>
            <p className="mt-2 text-sm text-emerald-200/80">
              A temporary display error occurred.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                if (typeof window !== "undefined") window.location.reload();
              }}
              type="button"
              className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-400 bg-gradient-to-r from-red-700 to-red-800 px-6 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Reload Website</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function SecretSantaApp() {
  const [participants, setParticipants] = useState<ParticipantItem[]>(DEFAULT_PARTICIPANTS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active Session & Modal States
  const [activeParticipant, setActiveParticipant] = useState<ParticipantItem | null>(null);
  const [boundDeviceUser, setBoundDeviceUser] = useState<{ id: string; name: string } | null>(null);
  const [selectedForAuth, setSelectedForAuth] = useState<ParticipantItem | null>(null);

  // Synchronous ref to prevent stale closures when clicking any card
  const lockedUserRef = useRef<{ id: string; name: string } | null>(null);

  // Synchronously seed bound device user from storage on mount (with IndexedDB fallback)
  useEffect(() => {
    const stored = getStoredBoundParticipant();
    if (stored) {
      setBoundDeviceUser(stored);
      lockedUserRef.current = stored;
    } else {
      getAsyncStoredBoundParticipant().then((idbUser) => {
        if (idbUser) {
          setBoundDeviceUser(idbUser);
          lockedUserRef.current = idbUser;
        }
      });
    }
  }, []);

  useEffect(() => {
    lockedUserRef.current = activeParticipant || boundDeviceUser;
  }, [activeParticipant, boundDeviceUser]);

  // Authenticated Reveal state
  const [activePin, setActivePin] = useState<string | null>(null);
  const [revealedRecipient, setRevealedRecipient] = useState<string | undefined>(undefined);
  const [isCurrentlyRevealed, setIsCurrentlyRevealed] = useState(false);
  const [showRevealModal, setShowRevealModal] = useState(false);

  // Floating Toast notification state (always in viewport)
  const [toastNotification, setToastNotification] = useState<{
    id: number;
    title: string;
    message: string;
    type?: "error" | "warning" | "info";
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);

  const showToast = useCallback(
    (params: {
      title: string;
      message: string;
      type?: "error" | "warning" | "info";
      actionLabel?: string;
      onAction?: () => void;
    }) => {
      setToastNotification({
        id: Date.now(),
        ...params,
      });
    },
    []
  );

  useEffect(() => {
    if (!toastNotification) return;
    const timer = setTimeout(() => {
      setToastNotification(null);
    }, 7000);
    return () => clearTimeout(timer);
  }, [toastNotification]);

  // Load participants directory silently without flashing skeletons
  const loadParticipants = useCallback(async (isBackground = true) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      if (!isBackground) setIsLoading(true);
      setError(null);
      const res = await fetch(`/api/participants?t=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        throw new Error("Unable to connect. Please check your connection.");
      }
      const data = await res.json();
      if (data && data.success && Array.isArray(data.participants)) {
        setParticipants(data.participants);
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (!isBackground) {
        const msg = err instanceof Error ? err.message : "Connection notice.";
        setError(msg);
      }
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  }, []);

  // Check existing session
  const checkSession = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`/api/auth/session?t=${Date.now()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (res.ok && data.authenticated && data.participant) {
        setActiveParticipant(data.participant);
        setBoundDeviceUser({ id: data.participant.id, name: data.participant.name });
        setStoredBoundParticipant({ id: data.participant.id, name: data.participant.name });
        setIsCurrentlyRevealed(Boolean(data.participant.isRevealed));
        if (data.recipientName) {
          setRevealedRecipient(data.recipientName);
        }
      } else {
        setActiveParticipant(null);
        setActivePin(null);
        setBoundDeviceUser(null);
        setStoredBoundParticipant(null);
        lockedUserRef.current = null;
        setIsCurrentlyRevealed(false);
        setRevealedRecipient(undefined);
      }
    } catch {
      clearTimeout(timeoutId);
      setActiveParticipant(null);
      setActivePin(null);
      setBoundDeviceUser(null);
      setStoredBoundParticipant(null);
      lockedUserRef.current = null;
      setIsCurrentlyRevealed(false);
      setRevealedRecipient(undefined);
    }
  }, []);

  // Check existing device and hardware binding
  const checkDeviceStatus = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    try {
      const headers = await getAsyncDeviceHeaders();
      const res = await fetch(`/api/auth/device-status?t=${Date.now()}`, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (res.ok && data.bound && data.participantId && data.participantName) {
        const boundParticipant = {
          id: data.participantId,
          name: data.participantName,
        };
        setBoundDeviceUser(boundParticipant);
        setStoredBoundParticipant(boundParticipant);
        lockedUserRef.current = boundParticipant;
      } else if (res.ok && !data.bound) {
        // Device explicitly unbound by admin on server - completely wipe local state
        setActiveParticipant(null);
        setActivePin(null);
        setBoundDeviceUser(null);
        setStoredBoundParticipant(null);
        lockedUserRef.current = null;
        setIsCurrentlyRevealed(false);
        setRevealedRecipient(undefined);
      }
    } catch {
      clearTimeout(timeoutId);
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    getHardwareFingerprint().catch(() => {});
    loadParticipants(true);
    checkSession();
    checkDeviceStatus();
  }, [loadParticipants, checkSession, checkDeviceStatus]);

  const scrollToParticipants = () => {
    const el = document.getElementById("participants-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Participant card clicked (Session-Locked & Device-Locked immediately on click)
  const handleSelectParticipant = useCallback(
    (p: ParticipantItem) => {
      const lockedUser = lockedUserRef.current || activeParticipant || boundDeviceUser;

      if (lockedUser) {
        if (lockedUser.id !== p.id) {
          if (typeof window !== "undefined" && "vibrate" in navigator) {
            try {
              navigator.vibrate([40, 60, 40]);
            } catch {
              // ignore
            }
          }

          showToast({
            title: `Device Linked to ${lockedUser.name}`,
            message: `This device is officially registered to ${lockedUser.name}. To preserve draw secrecy and gift privacy, accessing or revealing any other participant's account from this device is not permitted.`,
            type: "warning",
            actionLabel: `🎁 Open ${lockedUser.name}'s Gift`,
            onAction: () => {
              if (activeParticipant) {
                setShowRevealModal(true);
              } else {
                const target =
                  participants.find((item) => item.id === lockedUser.id) || {
                    id: lockedUser.id,
                    name: lockedUser.name,
                    isRevealed: false,
                  };
                setSelectedForAuth(target);
              }
            },
          });
          return;
        }

        if (activeParticipant) {
          setShowRevealModal(true);
        } else {
          setSelectedForAuth(p);
        }
        return;
      }

      setSelectedForAuth(p);
    },
    [activeParticipant, boundDeviceUser, activePin, participants, showToast]
  );

  // PIN verification success
  const handleAuthSuccess = useCallback(
    (data: {
      participant: ParticipantItem;
      pin: string;
      isRevealed: boolean;
      recipientName?: string;
    }) => {
      setSelectedForAuth(null);
      setActiveParticipant(data.participant);
      setBoundDeviceUser({ id: data.participant.id, name: data.participant.name });
      setStoredBoundParticipant({ id: data.participant.id, name: data.participant.name });
      setActivePin(data.pin);
      setIsCurrentlyRevealed(data.isRevealed);
      setRevealedRecipient(data.recipientName);
      setShowRevealModal(true);

      if (data.isRevealed) {
        setParticipants((prev) =>
          prev.map((item) => (item.id === data.participant.id ? { ...item, isRevealed: true } : item))
        );
      }

      // Refresh directory silently in background
      loadParticipants(true);
    },
    [loadParticipants]
  );

  const handleRevealSuccess = useCallback((participantId: string) => {
    setIsCurrentlyRevealed(true);
    setParticipants((prev) =>
      prev.map((p) => (p.id === participantId ? { ...p, isRevealed: true } : p))
    );
  }, []);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#05150d] via-[#092215] to-[#040f09] text-white selection:bg-amber-400 selection:text-slate-950">
      {/* Multi-layered 60fps Ambient Snowfall */}
      <Snowfall />

      {/* Subtle Ambient Lighting Orbs */}
      <div className="pointer-events-none fixed top-0 left-1/4 h-96 w-96 rounded-full bg-red-600/10 blur-[140px]" />
      <div className="pointer-events-none fixed top-1/3 right-1/4 h-96 w-96 rounded-full bg-amber-400/10 blur-[140px]" />
      <div className="pointer-events-none fixed bottom-10 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-[150px]" />

      {/* Header */}
      <FestiveHeader activeParticipant={activeParticipant} />

      <main className="relative z-20 pb-16">
        {/* =====================================================================
            HERO SECTION
           ===================================================================== */}
        <section className="relative px-4 pt-14 pb-8 text-center sm:pt-20 sm:pb-12">
          {/* Main Heading */}
          <h1 className="mx-auto max-w-4xl font-serif text-3xl font-extrabold tracking-tight sm:text-5xl md:text-6xl space-y-2">
            <span className="block text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
              A SECRET TO KEEP.
            </span>
            <span className="block gold-text drop-shadow-[0_4px_24px_rgba(212,175,55,0.5)]">
              A SURPRISE TO GIVE.
            </span>
          </h1>

          {/* Primary CTA */}
          <div className="mt-8 flex justify-center">
            <button
              onClick={scrollToParticipants}
              type="button"
              className="group flex items-center gap-2.5 rounded-full border-2 border-amber-300 bg-gradient-to-r from-red-700 via-red-600 to-red-800 px-8 py-3.5 text-sm sm:text-base font-bold tracking-wide text-white shadow-[0_8px_30px_rgba(185,28,28,0.45)] transition-all hover:scale-105 hover:brightness-110 hover:shadow-[0_12px_40px_rgba(185,28,28,0.65)] cursor-pointer"
            >
              <Gift className="h-4 w-4 transition-transform group-hover:rotate-12" />
              <span>Discover Your Secret Santa</span>
              <ArrowDown className="h-4 w-4 transition-transform group-hover:translate-y-0.5" />
            </button>
          </div>
        </section>

        {/* Decorative Divider */}
        <div className="mx-auto my-6 flex max-w-md items-center justify-center gap-3 px-4 opacity-40">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
          <span className="text-sm">✨ 🎄 🎁 ✨</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent" />
        </div>

        {/* Bound Participant Banner & Unbind / Logout Action */}
        {(activeParticipant || boundDeviceUser) && (
          <div className="mx-auto max-w-xl px-4 mb-6">
            <div className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-r from-[#0d2a1a] via-[#143d26] to-[#0d2a1a] p-4 shadow-xl backdrop-blur-md">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/50 bg-amber-500/20 text-amber-300">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-emerald-200/80">
                      This device is registered to:
                    </p>
                    <p className="font-serif text-sm font-bold text-amber-200 truncate">
                      {(activeParticipant || boundDeviceUser)?.name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    onClick={() => {
                      const user = activeParticipant || boundDeviceUser;
                      if (!user) return;
                      if (activeParticipant && activePin) {
                        setShowRevealModal(true);
                      } else {
                        const target =
                          participants.find((item) => item.id === user.id) || {
                            id: user.id,
                            name: user.name,
                            isRevealed: false,
                          };
                        setSelectedForAuth(target);
                      }
                    }}
                    className="flex items-center gap-2 rounded-xl border border-amber-400/80 bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-slate-950 px-4 py-2 text-xs font-bold shadow-lg transition-transform hover:scale-105 cursor-pointer"
                  >
                    <Gift className="h-4 w-4" />
                    <span>Open Your Gift Now</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            PARTICIPANT SELECTION SECTION
           ===================================================================== */}
        <div id="participants-section">
          <ParticipantGrid
            participants={participants}
            isLoading={isLoading}
            error={error}
            onSelectParticipant={handleSelectParticipant}
            selectedParticipantId={activeParticipant?.id || selectedForAuth?.id || null}
            boundParticipantId={boundDeviceUser?.id || activeParticipant?.id || null}
            onRetry={() => loadParticipants(false)}
          />
        </div>
      </main>

      {/* =====================================================================
          PIN AUTHENTICATION MODAL (Single Input)
         ===================================================================== */}
      {selectedForAuth && (
        <PinAuthModal
          participant={selectedForAuth}
          onClose={() => setSelectedForAuth(null)}
          onSuccess={handleAuthSuccess}
          onDeviceBound={(bound) => {
            setBoundDeviceUser(bound);
            setStoredBoundParticipant(bound);
            lockedUserRef.current = bound;
            setSelectedForAuth(null);
            showToast({
              title: "Device Locked to Another Profile",
              message: `This device is permanently bound to ${bound.name}'s profile. You cannot unlock or claim multiple profiles on the same device.`,
              type: "error",
            });
          }}
        />
      )}

      {/* =====================================================================
          GIFT BOX REVEAL MODAL
         ===================================================================== */}
      {showRevealModal && activeParticipant && (
        <GiftBoxReveal
          participant={activeParticipant}
          pin={activePin || "biometric"}
          initialRecipientName={revealedRecipient}
          initialIsRevealed={isCurrentlyRevealed}
          onClose={() => setShowRevealModal(false)}
          onRevealSuccess={() => handleRevealSuccess(activeParticipant.id)}
        />
      )}

      {/* =====================================================================
          FLOATING VIEWPORT TOAST NOTIFICATION (ALWAYS VISIBLE REGARDLESS OF SCROLL)
         ===================================================================== */}
      {toastNotification && (
        <div
          key={toastNotification.id}
          role="alert"
          aria-live="assertive"
          className="fixed bottom-6 inset-x-4 max-w-md mx-auto z-50 animate-in slide-in-from-bottom-5 fade-in duration-300"
        >
          <div className="relative overflow-hidden rounded-2xl border-2 border-amber-400/90 bg-gradient-to-br from-[#1a0606] via-[#140505] to-[#07180e] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.95),0_0_30px_rgba(212,175,55,0.4)] backdrop-blur-2xl">
            {/* Festive ambient glow */}
            <div className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full bg-amber-400/20 blur-xl" />

            <div className="flex items-start gap-3.5">
              {/* Icon badge */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/60 bg-gradient-to-br from-amber-500/20 to-red-600/30 text-amber-300 shadow-inner">
                <Lock className="h-5 w-5" />
              </div>

              {/* Message body */}
              <div className="flex-1 min-w-0 pr-1">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-serif text-sm font-bold text-amber-300 tracking-wide flex items-center gap-1.5">
                    <span>{toastNotification.title}</span>
                  </h4>
                  <button
                    onClick={() => setToastNotification(null)}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-amber-300/70 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                    aria-label="Dismiss notification"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="mt-1.5 text-xs text-emerald-100/90 leading-relaxed font-medium">
                  {toastNotification.message}
                </p>

                {/* Direct Action Button */}
                {toastNotification.actionLabel && toastNotification.onAction && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => {
                        const action = toastNotification.onAction;
                        setToastNotification(null);
                        action?.();
                      }}
                      className="group flex items-center gap-2 rounded-xl border border-amber-300 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 px-3.5 py-1.5 text-xs font-bold text-slate-950 shadow-md transition-all hover:scale-[1.02] hover:brightness-110 active:scale-95 cursor-pointer"
                    >
                      <Gift className="h-3.5 w-3.5 transition-transform group-hover:rotate-12" />
                      <span>{toastNotification.actionLabel}</span>
                    </button>
                    <button
                      onClick={() => setToastNotification(null)}
                      className="rounded-xl px-2.5 py-1.5 text-xs font-semibold text-amber-300/80 hover:text-white transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          INTERACTIVE AI SANTA CHAT
         ===================================================================== */}
      <SantaChatModal />
    </div>
  );
}

export default function Home() {
  return (
    <SafeErrorBoundary>
      <Suspense fallback={<div className="min-h-screen bg-[#05150d]" />}>
        <SecretSantaApp />
      </Suspense>
    </SafeErrorBoundary>
  );
}
