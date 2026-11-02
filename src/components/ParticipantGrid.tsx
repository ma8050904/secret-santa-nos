"use client";

import React, { useState, useMemo } from "react";
import { Search, UserCheck, Gift, Sparkles, AlertCircle } from "lucide-react";

export interface ParticipantItem {
  id: string;
  name: string;
  isRevealed: boolean;
}

interface ParticipantGridProps {
  participants: ParticipantItem[];
  isLoading: boolean;
  error: string | null;
  onSelectParticipant: (participant: ParticipantItem) => void;
  selectedParticipantId: string | null;
}

export const ParticipantGrid: React.FC<ParticipantGridProps> = ({
  participants,
  isLoading,
  error,
  onSelectParticipant,
  selectedParticipantId,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  // Instant case-insensitive partial-name filtering
  const filteredParticipants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return participants;
    return participants.filter((p) => p.name.toLowerCase().includes(query));
  }, [participants, searchQuery]);

  return (
    <section className="relative z-20 mx-auto max-w-6xl px-4 py-8">
      {/* Section Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-[#123824]/80 px-4 py-1.5 text-xs font-semibold tracking-wider text-amber-300 uppercase shadow-md">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          <span>Step 1: Find Your Name</span>
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <h2 className="mt-3 font-serif text-2xl font-bold tracking-tight text-white md:text-3xl">
          Select Your Participant Card
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-emerald-200/80">
          Find and tap your own name to access your private gift box and discover who you are buying for.
        </p>

        {/* Search Field */}
        <div className="relative mx-auto mt-6 max-w-md">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            <Search className="h-5 w-5 text-amber-400/70" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your name (e.g. Mohammad, Zeina, Jude...)"
            aria-label="Search participant names"
            className="w-full rounded-2xl border border-amber-500/30 bg-[#0a2618]/90 py-3.5 pr-10 pl-11 text-sm text-white placeholder-emerald-300/50 shadow-inner backdrop-blur-md transition-all focus:border-amber-400 focus:bg-[#0f3422] focus:ring-2 focus:ring-amber-400/30 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-amber-300/70 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex h-24 animate-pulse items-center gap-4 rounded-2xl border border-emerald-800/40 bg-emerald-950/40 p-4"
            >
              <div className="h-12 w-12 rounded-full bg-emerald-800/60" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-emerald-800/60" />
                <div className="h-3 w-1/2 rounded bg-emerald-800/40" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mx-auto my-6 max-w-md rounded-2xl border border-red-500/40 bg-red-950/70 p-4 text-center backdrop-blur-md">
          <div className="flex items-center justify-center gap-2 text-red-300">
            <AlertCircle className="h-5 w-5" />
            <span className="font-semibold text-sm">Unable to load participants</span>
          </div>
          <p className="mt-1 text-xs text-red-200/80">{error}</p>
        </div>
      )}

      {/* Empty Search Results */}
      {!isLoading && !error && filteredParticipants.length === 0 && (
        <div className="mx-auto my-8 max-w-md rounded-2xl border border-amber-500/20 bg-[#0a2618]/70 p-8 text-center backdrop-blur-md">
          <p className="text-3xl">🔍</p>
          <h3 className="mt-2 text-lg font-bold text-white">No participants found</h3>
          <p className="mt-1 text-xs text-emerald-200/70">
            No participant matched &quot;{searchQuery}&quot;. Please check the spelling or clear the search.
          </p>
          <button
            onClick={() => setSearchQuery("")}
            className="mt-4 rounded-xl border border-amber-400/40 bg-[#123824] px-4 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-[#1b4d32]"
          >
            Show All 18 Participants
          </button>
        </div>
      )}

      {/* Participants Grid */}
      {!isLoading && !error && filteredParticipants.length > 0 && (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3">
          {filteredParticipants.map((p) => {
            const isSelected = selectedParticipantId === p.id;
            const initials = p.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .substring(0, 2)
              .toUpperCase();

            return (
              <button
                key={p.id}
                onClick={() => onSelectParticipant(p)}
                className={`christmas-glass-card group relative flex items-center justify-between overflow-hidden rounded-2xl p-4 text-left transition-all duration-300 ${
                  isSelected
                    ? "border-amber-400 bg-gradient-to-r from-red-950/90 to-emerald-950/90 shadow-[0_0_25px_rgba(212,175,55,0.45)] ring-2 ring-amber-400"
                    : "hover:border-amber-400/60"
                }`}
              >
                {/* Decorative festive corner shimmer */}
                <div className="absolute top-0 right-0 -mr-6 -mt-6 h-12 w-12 rounded-full bg-amber-400/10 blur-md transition-opacity group-hover:opacity-100" />

                <div className="flex items-center gap-3.5">
                  {/* Avatar / Monogram */}
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border font-bold text-sm shadow-md transition-transform duration-300 group-hover:scale-105 ${
                      isSelected
                        ? "border-amber-300 bg-amber-500 text-slate-950"
                        : "border-amber-400/30 bg-gradient-to-br from-red-800 to-emerald-900 text-amber-200"
                    }`}
                  >
                    {initials}
                  </div>

                  {/* Name and State */}
                  <div>
                    <h3 className="font-semibold text-base text-white tracking-wide transition-colors group-hover:text-amber-200">
                      {p.name}
                    </h3>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                      {p.isRevealed ? (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <UserCheck className="h-3 w-3" />
                          <span>Revealed (Revisit)</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-300/80">
                          <Gift className="h-3 w-3 text-amber-400" />
                          <span>Waiting to open</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Arrow / Action Badge */}
                <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-400/20 bg-[#123824]/60 text-amber-300 transition-colors group-hover:border-amber-400 group-hover:bg-amber-400 group-hover:text-slate-950">
                  <span className="text-xs font-bold">→</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
