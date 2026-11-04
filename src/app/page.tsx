"use client";

import React, { useEffect, useState, Suspense, useCallback } from "react";
import { ArrowDown, Gift, RefreshCw } from "lucide-react";
import { FestiveHeader } from "@/components/FestiveHeader";
import { Snowfall } from "@/components/Snowfall";
import { ParticipantGrid, ParticipantItem } from "@/components/ParticipantGrid";
import { PinAuthModal } from "@/components/PinAuthModal";
import { GiftBoxReveal } from "@/components/GiftBoxReveal";
import { SantaChatModal } from "@/components/SantaChatModal";
import { PARTICIPANTS } from "@/lib/constants";
import { getDeviceHeaders } from "@/lib/device";

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
  const [selectedForAuth, setSelectedForAuth] = useState<ParticipantItem | null>(null);

  // Authenticated Reveal state
  const [activePin, setActivePin] = useState<string | null>(null);
  const [revealedRecipient, setRevealedRecipient] = useState<string | undefined>(undefined);
  const [isCurrentlyRevealed, setIsCurrentlyRevealed] = useState(false);
  const [showRevealModal, setShowRevealModal] = useState(false);

  // Load participants directory silently without flashing skeletons
  const loadParticipants = useCallback(async (isBackground = true) => {
    try {
      if (!isBackground) setIsLoading(true);
      setError(null);
      const res = await fetch("/api/participants", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Unable to connect. Please check your connection.");
      }
      const data = await res.json();
      if (data && data.success && Array.isArray(data.participants)) {
        setParticipants(data.participants);
      }
    } catch (err: unknown) {
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
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.authenticated && data.participant) {
        setActiveParticipant(data.participant);
      } else {
        setActiveParticipant(null);
        setActivePin(null);
        setIsCurrentlyRevealed(false);
        setRevealedRecipient(undefined);
      }
    } catch {
      setActiveParticipant(null);
      setActivePin(null);
      setIsCurrentlyRevealed(false);
      setRevealedRecipient(undefined);
    }
  }, []);

  // Check existing device binding
  const checkDeviceStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/device-status", {
        headers: getDeviceHeaders(),
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok && data.bound && data.participantId && data.participantName) {
        const boundParticipant: ParticipantItem = {
          id: data.participantId,
          name: data.participantName,
          isRevealed: false,
        };
        setActiveParticipant((prev) => prev || boundParticipant);
      }
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
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

  // Participant card clicked (Session-Locked & Device-Locked to active participant once authenticated)
  const handleSelectParticipant = useCallback(
    (p: ParticipantItem) => {
      if (activeParticipant) {
        if (activeParticipant.id !== p.id) {
          setError(
            `This device is bound to ${activeParticipant.name}. Accessing multiple accounts from the same device is not permitted.`
          );
          return;
        }
        if (activePin) {
          setShowRevealModal(true);
        } else {
          setSelectedForAuth(activeParticipant);
        }
        return;
      }
      setSelectedForAuth(p);
    },
    [activeParticipant, activePin]
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
        />
      )}

      {/* =====================================================================
          GIFT BOX REVEAL MODAL
         ===================================================================== */}
      {showRevealModal && activeParticipant && activePin && (
        <GiftBoxReveal
          participant={activeParticipant}
          pin={activePin}
          initialRecipientName={revealedRecipient}
          initialIsRevealed={isCurrentlyRevealed}
          onClose={() => setShowRevealModal(false)}
          onRevealSuccess={() => handleRevealSuccess(activeParticipant.id)}
        />
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
