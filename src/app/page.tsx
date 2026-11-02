"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Sparkles, Gift, ShieldCheck, Heart, ArrowDown } from "lucide-react";
import { FestiveHeader } from "@/components/FestiveHeader";
import { Snowfall } from "@/components/Snowfall";
import { ChristmasCountdown } from "@/components/ChristmasCountdown";
import { ParticipantGrid, ParticipantItem } from "@/components/ParticipantGrid";
import { GiftBoxReveal } from "@/components/GiftBoxReveal";

function SecretSantaApp() {
  const searchParams = useSearchParams();
  const [participants, setParticipants] = useState<ParticipantItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState<ParticipantItem | null>(null);
  const [initialCode, setInitialCode] = useState<string>("");

  // Fetch public participant list
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
      const msg = err instanceof Error ? err.message : "Error connecting to Secret Santa server";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadParticipants();
  }, []);

  // Handle URL query parameters for magic links (e.g. ?p=p1&code=SANTA-4X9B or ?code=...)
  useEffect(() => {
    if (!participants.length) return;

    const queryParticipantId = searchParams.get("p");
    const queryCode = searchParams.get("code");

    if (queryCode) {
      setInitialCode(queryCode);
    }

    if (queryParticipantId) {
      const found = participants.find((p) => p.id === queryParticipantId);
      if (found) {
        setSelectedParticipant(found);
      }
    }
  }, [participants, searchParams]);

  const scrollToParticipants = () => {
    const el = document.getElementById("participants-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleRevealSuccess = (participantId: string) => {
    // Mark locally as revealed so UI reflects it immediately
    setParticipants((prev) =>
      prev.map((p) => (p.id === participantId ? { ...p, isRevealed: true } : p))
    );
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#05150d] via-[#092215] to-[#040f09] text-white">
      {/* 60fps Ambient Falling Snow */}
      <Snowfall />

      {/* Decorative Glowing Ambience */}
      <div className="pointer-events-none fixed top-0 left-1/4 h-96 w-96 rounded-full bg-red-600/10 blur-[140px]" />
      <div className="pointer-events-none fixed top-1/3 right-1/4 h-96 w-96 rounded-full bg-amber-400/10 blur-[140px]" />
      <div className="pointer-events-none fixed bottom-10 left-1/3 h-96 w-96 rounded-full bg-emerald-500/10 blur-[150px]" />

      {/* Festive Navigation & Header */}
      <FestiveHeader />

      <main className="relative z-20 pb-20">
        {/* =====================================================================
            HERO SECTION
           ===================================================================== */}
        <section className="relative px-4 pt-12 pb-8 text-center md:pt-16 md:pb-12">
          {/* Festive Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-[#123824]/80 px-4 py-1.5 shadow-lg backdrop-blur-md">
            <span className="text-base">🎄</span>
            <span className="text-xs font-semibold tracking-widest text-amber-300 uppercase">
              Exclusive 18-Member Holiday Exchange
            </span>
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          </div>

          {/* Main Heading */}
          <h1 className="mx-auto mt-6 max-w-4xl font-serif text-4xl font-extrabold tracking-tight md:text-6xl lg:text-7xl">
            <span className="block text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]">
              THE MAGIC OF
            </span>
            <span className="mt-1 block gold-text drop-shadow-[0_4px_24px_rgba(212,175,55,0.5)]">
              SECRET SANTA
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mt-4 max-w-xl text-base font-light text-emerald-100/90 md:text-lg">
            A little mystery. A lot of Christmas magic.
          </p>

          {/* Live Christmas Countdown */}
          <ChristmasCountdown />

          {/* Primary CTA */}
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              onClick={scrollToParticipants}
              className="group flex items-center gap-2.5 rounded-full border-2 border-amber-300 bg-gradient-to-r from-red-700 via-red-600 to-red-800 px-8 py-4 text-base font-bold tracking-wide text-white shadow-[0_8px_30px_rgba(185,28,28,0.5)] transition-all hover:scale-105 hover:brightness-110 hover:shadow-[0_12px_40px_rgba(185,28,28,0.7)]"
            >
              <Gift className="h-5 w-5 transition-transform group-hover:rotate-12" />
              <span>Discover Your Secret Santa</span>
              <ArrowDown className="h-4 w-4 transition-transform group-hover:translate-y-1" />
            </button>
          </div>

          {/* Trust & Privacy Pill */}
          <div className="mx-auto mt-6 flex max-w-md items-center justify-center gap-4 text-xs text-emerald-200/70">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-amber-400" />
              Organizer-Blind Encryption
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-red-400" />
              Pure Holiday Joy
            </span>
          </div>
        </section>

        {/* Decorative Divider with Ornaments */}
        <div className="mx-auto my-4 flex max-w-4xl items-center justify-center gap-4 px-4 opacity-60">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
          <span className="text-xl">✨ 🎄 🎁 🦌 ✨</span>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
        </div>

        {/* =====================================================================
            PARTICIPANT SELECTION SECTION
           ===================================================================== */}
        <div id="participants-section">
          <ParticipantGrid
            participants={participants}
            isLoading={isLoading}
            error={error}
            onSelectParticipant={(p) => {
              setSelectedParticipant(p);
            }}
            selectedParticipantId={selectedParticipant?.id || null}
          />
        </div>

        {/* =====================================================================
            HOW IT WORKS FEATURE CARDS
           ===================================================================== */}
        <section className="mx-auto mt-12 max-w-5xl px-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="christmas-glass-card rounded-2xl p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/30 bg-emerald-950/80 text-xl text-amber-300">
                1️⃣
              </div>
              <h3 className="font-serif text-lg font-bold text-white">Find Your Name</h3>
              <p className="mt-2 text-xs leading-relaxed text-emerald-200/70">
                Select your card from the 18 participants above or use the instant search box.
              </p>
            </div>

            <div className="christmas-glass-card rounded-2xl p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/30 bg-emerald-950/80 text-xl text-amber-300">
                2️⃣
              </div>
              <h3 className="font-serif text-lg font-bold text-white">Enter Secret Code</h3>
              <p className="mt-2 text-xs leading-relaxed text-emerald-200/70">
                Type your confidential Christmas access code provided privately by your event organizer.
              </p>
            </div>

            <div className="christmas-glass-card rounded-2xl p-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/30 bg-emerald-950/80 text-xl text-amber-300">
                3️⃣
              </div>
              <h3 className="font-serif text-lg font-bold text-white">Open Your Gift</h3>
              <p className="mt-2 text-xs leading-relaxed text-emerald-200/70">
                Tap the 3D gift box to unwrap and discover who you will surprise this Christmas!
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* =====================================================================
          GIFT BOX REVEAL MODAL
         ===================================================================== */}
      {selectedParticipant && (
        <GiftBoxReveal
          participant={selectedParticipant}
          initialCode={initialCode}
          onClose={() => {
            setSelectedParticipant(null);
            setInitialCode("");
          }}
          onRevealSuccess={handleRevealSuccess}
        />
      )}

      {/* =====================================================================
          FESTIVE FOOTER
         ===================================================================== */}
      <footer className="relative z-20 border-t border-amber-500/20 bg-[#030e06] py-8 text-center text-xs text-emerald-300/60">
        <div className="mx-auto max-w-6xl px-4">
          <p className="font-serif text-sm font-semibold tracking-wider text-amber-300/90">
            THE MAGIC OF SECRET SANTA 🎄
          </p>
          <p className="mt-1">
            Built with Christmas joy, cryptographic privacy, and holiday warmth.
          </p>
          <p className="mt-2 text-[10px] text-emerald-400/40">
            All 18 assignments are mathematically verified derangements with zero self-matches.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#05150d] text-amber-300">
          <div className="flex flex-col items-center gap-3">
            <span className="text-4xl animate-bounce">🎁</span>
            <span className="text-sm font-semibold tracking-widest uppercase">
              Loading Christmas Magic...
            </span>
          </div>
        </div>
      }
    >
      <SecretSantaApp />
    </Suspense>
  );
}
