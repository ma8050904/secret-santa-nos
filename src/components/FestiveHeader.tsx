"use client";

import React from "react";
import Link from "next/link";
import { Sparkles, User } from "lucide-react";
import { ParticipantItem } from "./ParticipantGrid";
import { BackgroundMusic } from "./BackgroundMusic";

interface FestiveHeaderProps {
  activeParticipant?: ParticipantItem | null;
}

export const FestiveHeader: React.FC<FestiveHeaderProps> = ({
  activeParticipant,
}) => {
  // 24 decorative lights for the string garland
  const lights = [
    "light-1 bg-red-500",
    "light-2 bg-amber-400",
    "light-3 bg-emerald-400",
    "light-4 bg-blue-400",
    "light-1 bg-red-400",
    "light-2 bg-amber-300",
    "light-3 bg-green-500",
    "light-4 bg-sky-400",
    "light-1 bg-rose-500",
    "light-2 bg-yellow-400",
    "light-3 bg-emerald-500",
    "light-4 bg-cyan-400",
    "light-1 bg-red-500",
    "light-2 bg-amber-400",
    "light-3 bg-emerald-400",
    "light-4 bg-blue-400",
    "light-1 bg-red-400",
    "light-2 bg-amber-300",
    "light-3 bg-green-500",
    "light-4 bg-sky-400",
  ];

  return (
    <header className="relative z-30 w-full border-b border-amber-500/15 bg-[#061b10]/95 backdrop-blur-md">
      {/* Christmas Garland String Lights */}
      <div className="absolute top-0 left-0 right-0 flex justify-around overflow-hidden px-2 pt-0.5">
        {lights.map((cls, idx) => (
          <div key={idx} className="flex flex-col items-center">
            <div className="h-1.5 w-1 bg-emerald-950" />
            <div className={`h-2.5 w-2.5 rounded-full shadow-sm ${cls}`} />
          </div>
        ))}
      </div>

      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 pt-4.5 sm:px-6">
        {/* Brand / Logo */}
        <Link href="/" className="group flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-br from-red-700 to-red-950 shadow-md transition-transform group-hover:scale-105">
            <span className="text-lg">🎁</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-serif text-lg font-bold tracking-wider text-white">
              SECRET SANTA
            </span>
            <Sparkles className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
          </div>
        </Link>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Active User Indicator */}
          {activeParticipant && (
            <div className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-[#0c2e1c] px-3 py-1 text-xs text-amber-200">
              <User className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-medium text-[11px] sm:text-xs">{activeParticipant.name}</span>
            </div>
          )}

          {/* Autoplay Background Music Toggle */}
          <BackgroundMusic />
        </div>
      </div>
    </header>
  );
};
