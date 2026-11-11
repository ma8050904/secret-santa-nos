"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, Gift, Check, Sparkles, RefreshCw, Lock } from "lucide-react";

export interface ParticipantItem {
  id: string;
  name: string;
  isRevealed: boolean;
  hasRegistered?: boolean;
  hasPasskey?: boolean;
  isClaimed?: boolean;
  claimMethod?: "passkey" | "pin" | "none";
}

interface ParticipantGridProps {
  participants: ParticipantItem[];
  isLoading: boolean;
  error: string | null;
  onSelectParticipant: (participant: ParticipantItem) => void;
  selectedParticipantId: string | null;
  boundParticipantId?: string | null;
  onRetry?: () => void;
}

interface ParticipantCardProps {
  participant: ParticipantItem;
  isSelected: boolean;
  isBoundToThisUser?: boolean;
  isLockedOut?: boolean;
  onSelect: (p: ParticipantItem) => void;
}

/**
 * Isolated, memoized participant card to eliminate unnecessary re-renders across all 56 cards.
 * Implements Section 3 Single-Profile UI Lockdown:
 * - If device is bound to this participant: Highlighted with gold/emerald ring.
 * - If device is bound to another participant: Visually locked (opacity-40, lock icon, non-interactive visual tell).
 */
const ParticipantCard: React.FC<ParticipantCardProps> = React.memo(
  ({ participant: p, isSelected, isBoundToThisUser, isLockedOut, onSelect }) => {
    const initials = useMemo(() => {
      const cleanWords = (p.name || "")
        .replace(/[^\p{L}\s]/gu, "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      return cleanWords.length >= 2
        ? (cleanWords[0][0] + cleanWords[1][0]).toUpperCase()
        : cleanWords.length === 1
        ? cleanWords[0][0].toUpperCase()
        : (p.name || "").trim().slice(0, 1).toUpperCase();
    }, [p.name]);

    const handleClick = useCallback(() => {
      onSelect(p);
    }, [onSelect, p]);

    return (
      <button
        onClick={handleClick}
        type="button"
        style={{ contentVisibility: "auto", containIntrinsicSize: "80px" }}
        className={`christmas-glass-card group relative flex items-center justify-between overflow-hidden rounded-2xl p-3.5 text-left select-none transition-transform duration-100 ${
          isLockedOut
            ? "opacity-40 cursor-not-allowed filter grayscale-[25%] border-slate-800/40 bg-[#05150d]/80 hover:border-red-500/30"
            : isBoundToThisUser
            ? "border-amber-400 bg-gradient-to-r from-amber-950/80 to-emerald-950/90 shadow-[0_0_25px_rgba(212,175,55,0.4)] ring-2 ring-amber-400/90 cursor-pointer active:scale-[0.98]"
            : isSelected
            ? "border-amber-400 bg-gradient-to-r from-red-950/90 to-emerald-950/90 shadow-[0_0_20px_rgba(212,175,55,0.4)] ring-2 ring-amber-400/80 cursor-pointer active:scale-[0.98]"
            : "hover:border-amber-400/60 cursor-pointer active:scale-[0.98]"
        }`}
      >
        {/* Subtle festive shimmer */}
        {!isLockedOut && (
          <div className="pointer-events-none absolute top-0 right-0 -mr-6 -mt-6 h-12 w-12 rounded-full bg-amber-400/10 blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
        )}

        <div className="flex items-center gap-3 min-w-0">
          {/* Monogram Badge */}
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border font-bold text-xs tracking-wider shadow-sm transition-transform duration-150 ${
              isLockedOut
                ? "border-slate-700/40 bg-slate-900/60 text-slate-400"
                : isBoundToThisUser || isSelected
                ? "border-amber-300 bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-black shadow-[0_0_12px_rgba(212,175,55,0.6)]"
                : p.isRevealed
                ? "border-emerald-500/40 bg-emerald-950/80 text-emerald-200"
                : "border-amber-500/30 bg-gradient-to-br from-red-900/60 to-red-950/80 text-amber-200"
            }`}
          >
            {isLockedOut ? <Lock className="h-4 w-4 text-slate-400" /> : initials}
          </div>

          {/* Name & Status */}
          <div className="min-w-0 flex-1">
            <p
              className={`truncate text-sm font-semibold tracking-wide transition-colors duration-100 ${
                isLockedOut
                  ? "text-slate-400"
                  : isBoundToThisUser || isSelected
                  ? "text-amber-200"
                  : "text-white group-hover:text-amber-200"
              }`}
            >
              {p.name}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              {isLockedOut ? (
                <>
                  <Lock className="h-3 w-3 text-amber-500/60 shrink-0" />
                  <span className="text-[11px] font-medium text-amber-300/60">
                    Locked
                  </span>
                </>
              ) : isBoundToThisUser ? (
                <>
                  <Sparkles className="h-3 w-3 text-amber-300 shrink-0" />
                  <span className="text-[11px] font-bold text-amber-300">
                    Your Profile
                  </span>
                </>
              ) : p.isRevealed ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span className="text-[11px] font-medium text-emerald-300/90">
                    Revealed
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3 text-amber-400/80 shrink-0" />
                  <span className="text-[11px] font-medium text-amber-300/80">
                    Ready
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Arrow / Action Indicator */}
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-colors duration-150 ${
            isLockedOut
              ? "border-slate-800 bg-slate-900/60 text-slate-500"
              : isBoundToThisUser
              ? "border-amber-400 bg-amber-400/20 text-amber-300"
              : "border-amber-500/20 bg-[#051a0f]/60 text-amber-400 group-hover:border-amber-400 group-hover:bg-amber-400/20"
          }`}
        >
          {isLockedOut ? <Lock className="h-3.5 w-3.5" /> : <Gift className="h-4 w-4" />}
        </div>
      </button>
    );
  },
  (prev, next) =>
    prev.participant.id === next.participant.id &&
    prev.participant.name === next.participant.name &&
    prev.participant.isRevealed === next.participant.isRevealed &&
    prev.isSelected === next.isSelected &&
    prev.isBoundToThisUser === next.isBoundToThisUser &&
    prev.isLockedOut === next.isLockedOut
);

ParticipantCard.displayName = "ParticipantCard";

const ParticipantGridComponent: React.FC<ParticipantGridProps> = ({
  participants = [],
  isLoading,
  error,
  onSelectParticipant,
  selectedParticipantId,
  boundParticipantId,
  onRetry,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const onSelectRef = useRef(onSelectParticipant);
  useEffect(() => {
    onSelectRef.current = onSelectParticipant;
  }, [onSelectParticipant]);

  const handleCardSelect = useCallback((p: ParticipantItem) => {
    onSelectRef.current(p);
  }, []);

  const safeList = Array.isArray(participants) ? participants : [];

  // Sort once per list reference change
  const sortedList = useMemo(() => {
    return [...safeList].sort((a, b) => {
      const cleanA = (a.name || "").replace(/^[^\p{L}]+/u, "").toLowerCase();
      const cleanB = (b.name || "").replace(/^[^\p{L}]+/u, "").toLowerCase();
      return cleanA.localeCompare(cleanB);
    });
  }, [safeList]);

  // Instant case-insensitive partial-name filtering
  const filteredParticipants = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedList;
    return sortedList.filter(
      (p) => p && typeof p.name === "string" && p.name.toLowerCase().includes(query)
    );
  }, [sortedList, searchQuery]);

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
          className="w-full rounded-2xl border border-amber-500/30 bg-[#0a2618]/90 py-3 pr-10 pl-10 text-sm text-white placeholder-emerald-300/40 shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-colors focus:border-amber-400 focus:bg-[#0c2e1c] focus:ring-2 focus:ring-amber-400/25 focus:outline-none"
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

      {/* Loading Skeletons only if list is empty */}
      {isLoading && safeList.length === 0 && (
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

      {/* Error Notice */}
      {error && (
        <div className="mx-auto my-4 flex max-w-md items-center justify-between gap-3 rounded-2xl border border-red-500/40 bg-red-950/70 px-4 py-2.5 text-center backdrop-blur-md">
          <p className="text-xs text-red-200">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-lg bg-red-800/80 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-700 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      {/* Empty Search Results */}
      {filteredParticipants.length === 0 && safeList.length > 0 && (
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
      {filteredParticipants.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {filteredParticipants.map((p) => {
            const isBoundToThisUser = Boolean(boundParticipantId && boundParticipantId === p.id);
            const isLockedOut = Boolean(boundParticipantId && boundParticipantId !== p.id);
            return (
              <ParticipantCard
                key={p.id}
                participant={p}
                isSelected={selectedParticipantId === p.id}
                isBoundToThisUser={isBoundToThisUser}
                isLockedOut={isLockedOut}
                onSelect={handleCardSelect}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};

export const ParticipantGrid = React.memo(ParticipantGridComponent);
