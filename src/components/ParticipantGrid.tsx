"use client";

import React, { useState, useMemo } from "react";
import { Search, Gift, Check, Sparkles } from "lucide-react";

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
    <section className="relative z-20 mx-auto max-w-5xl px-4 py-4 sm:py-6">
      {/* Search Field */}
      <div className="relative mx-auto mb-8 max-w-md">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          <Search className="h-4 w-4 text-amber-400/80" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search name..."
          aria-label="Search participants"
          className="w-full rounded-2xl border border-amber-500/30 bg-[#0a2618]/85 py-3 pr-10 pl-10 text-sm text-white placeholder-emerald-300/40 shadow-[0_4px_20px_rgba(0,0,0,0.3)] backdrop-blur-md transition-all focus:border-amber-400 focus:bg-[#0c2e1c] focus:ring-2 focus:ring-amber-400/25 focus:outline-none"
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

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex h-20 animate-pulse items-center gap-3.5 rounded-2xl border border-emerald-800/30 bg-emerald-950/30 p-3.5"
            >
              <div className="h-11 w-11 rounded-2xl bg-emerald-800/50" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 rounded bg-emerald-800/50" />
                <div className="h-3 w-1/3 rounded bg-emerald-800/30" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mx-auto my-6 max-w-md rounded-2xl border border-red-500/40 bg-red-950/70 p-4 text-center backdrop-blur-md">
          <p className="text-xs text-red-200">{error}</p>
        </div>
      )}

      {/* Empty Search Results */}
      {!isLoading && !error && filteredParticipants.length === 0 && (
        <div className="mx-auto my-8 max-w-sm rounded-2xl border border-amber-500/20 bg-[#0a2618]/70 p-6 text-center backdrop-blur-md">
          <p className="text-2xl">🔍</p>
          <p className="mt-2 text-sm text-emerald-200/80">
            No matches found for &quot;{searchQuery}&quot;
          </p>
          <button
            onClick={() => setSearchQuery("")}
            className="mt-3 text-xs font-semibold text-amber-300 hover:text-white underline underline-offset-4"
          >
            Show all
          </button>
        </div>
      )}

      {/* Participants Grid */}
      {!isLoading && !error && filteredParticipants.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
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
                className={`christmas-glass-card group relative flex items-center justify-between overflow-hidden rounded-2xl p-3.5 text-left transition-all duration-300 ${
                  isSelected
                    ? "border-amber-400 bg-gradient-to-r from-red-950/90 to-emerald-950/90 shadow-[0_0_25px_rgba(212,175,55,0.4)] ring-2 ring-amber-400/80"
                    : "hover:border-amber-400/60 hover:shadow-[0_8px_25px_rgba(0,0,0,0.5)]"
                }`}
              >
                {/* Decorative festive corner shimmer */}
                <div className="pointer-events-none absolute top-0 right-0 -mr-6 -mt-6 h-12 w-12 rounded-full bg-amber-400/10 blur-md transition-opacity group-hover:opacity-100" />

                <div className="flex items-center gap-3">
                  {/* Monogram Badge */}
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border font-bold text-xs tracking-wider shadow-sm transition-transform duration-300 group-hover:scale-105 ${
                      isSelected
                        ? "border-amber-300 bg-amber-400 text-slate-950"
                        : "border-amber-400/30 bg-gradient-to-br from-red-800 to-emerald-950 text-amber-200"
                    }`}
                  >
                    {initials}
                  </div>

                  {/* Name and Subtle Status */}
                  <div>
                    <h3 className="font-semibold text-sm text-white tracking-wide transition-colors group-hover:text-amber-200">
                      {p.name}
                    </h3>
                    <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                      {p.isRevealed ? (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <Check className="h-3 w-3" />
                          <span>Opened</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-300/80">
                          <Gift className="h-3 w-3 text-amber-400/80" />
                          <span>Ready</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Arrow Indicator */}
                <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-amber-400/20 bg-[#123824]/60 text-amber-300 transition-all group-hover:border-amber-400 group-hover:bg-amber-400 group-hover:text-slate-950">
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
