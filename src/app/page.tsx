"use client";

import React, { useEffect, useState, Suspense } from "react";
import { ArrowDown, Gift } from "lucide-react";
import { FestiveHeader } from "@/components/FestiveHeader";
import { Snowfall } from "@/components/Snowfall";
import { ParticipantGrid, ParticipantItem } from "@/components/ParticipantGrid";
import { PinAuthModal } from "@/components/PinAuthModal";
import { GiftBoxReveal } from "@/components/GiftBoxReveal";

function SecretSantaApp() {
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Session & Modal States
  const [activeParticipant, setActiveParticipant] = useState<ParticipantItem | null>(null);
  const [selectedForAuth, setSelectedForAuth] = useState<ParticipantItem | null>(null);

  // Authenticated Reveal state
  const [activePin, setActivePin] = useState<string | null>(null);
  const [revealedRecipient, setRevealedRecipient] = useState<string | undefined>(undefined);
  const [isCurrentlyRevealed, setIsCurrentlyRevealed] = useState(false);
  const [showRevealModal, setShowRevealModal] = useState(false);

  // Load participants directory
  const loadParticipants = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch("/api/participants");
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load participants.");
      }
      setParticipants(data.participants);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Connection error.";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Check existing session
  const checkSession = async () => {
    try {
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (res.ok && data.authenticated && data.participant) {
        setActiveParticipant(data.participant);
      }
    } catch {
      // Session check failure is non-blocking
    }
  };

  useEffect(() => {
    loadParticipants();
    checkSession();
  }, []);

  const scrollToParticipants = () => {
    const el = document.getElementById("participants-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Participant card clicked
  const handleSelectParticipant = (p: ParticipantItem) => {
    if (activeParticipant?.id === p.id && activePin) {
      setShowRevealModal(true);
      return;
    }
    setSelectedForAuth(p);
  };

  // PIN verification success
  const handleAuthSuccess = (data: {
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

    // Refresh directory
    loadParticipants();

    if (data.isRevealed) {
      setParticipants((prev) =>
        prev.map((item) => (item.id === data.participant.id ? { ...item, isRevealed: true } : item))
      );
    }
  };

  // Logout
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setActiveParticipant(null);
    setActivePin(null);
    setRevealedRecipient(undefined);
    setIsCurrentlyRevealed(false);
    setShowRevealModal(false);
    setSelectedForAuth(null);
  };

  const handleRevealSuccess = (participantId: string) => {
    setIsCurrentlyRevealed(true);
    setParticipants((prev) =>
      prev.map((p) => (p.id === participantId ? { ...p, isRevealed: true } : p))
    );
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#05150d] via-[#092215] to-[#040f09] text-white selection:bg-amber-400 selection:text-slate-950">
      {/* Multi-layered 60fps Ambient Snowfall */}
      <Snowfall />

      {/* Subtle Ambient Lighting Orbs */}
      <div className="pointer-events-none fixed top-0 left-1/4 h-96 w-96 rounded-full bg-red-600/10 blur-[140px]" />
      <div className="pointer-events-none fixed top-1/3 right-1/4 h-96 w-96 rounded-full bg-amber-400/10 blur-[140px]" />
      <div className="pointer-events-none fixed bottom-10 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-[150px]" />

      {/* Header */}
      <FestiveHeader activeParticipant={activeParticipant} onLogout={handleLogout} />

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
              className="group flex items-center gap-2.5 rounded-full border-2 border-amber-300 bg-gradient-to-r from-red-700 via-red-600 to-red-800 px-8 py-3.5 text-sm sm:text-base font-bold tracking-wide text-white shadow-[0_8px_30px_rgba(185,28,28,0.45)] transition-all hover:scale-105 hover:brightness-110 hover:shadow-[0_12px_40px_rgba(185,28,28,0.65)]"
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
          onLogout={handleLogout}
          onRevealSuccess={() => handleRevealSuccess(activeParticipant.id)}
        />
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#05150d]" />}>
      <SecretSantaApp />
    </Suspense>
  );
}
