"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Volume2, VolumeX, Shield, Sparkles, User, LogOut } from "lucide-react";
import { ParticipantItem } from "./ParticipantGrid";

interface FestiveHeaderProps {
  activeParticipant?: ParticipantItem | null;
  onLogout?: () => void;
}

export const FestiveHeader: React.FC<FestiveHeaderProps> = ({
  activeParticipant,
  onLogout,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);

  // Synthesize pleasant holiday bell melody via Web Audio API without needing external files
  const toggleMusic = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();

      // "We Wish You a Merry Christmas" opening phrase frequencies:
      // D4, G4, G4, A4, G4, F#4, E4, E4
      const notes = [
        { freq: 293.66, dur: 0.35, delay: 0.0 }, // D4
        { freq: 392.0, dur: 0.35, delay: 0.38 }, // G4
        { freq: 392.0, dur: 0.2, delay: 0.76 },  // G4
        { freq: 440.0, dur: 0.2, delay: 1.0 },   // A4
        { freq: 392.0, dur: 0.2, delay: 1.25 },  // G4
        { freq: 369.99, dur: 0.2, delay: 1.5 },  // F#4
        { freq: 329.63, dur: 0.45, delay: 1.75 },// E4
        { freq: 329.63, dur: 0.35, delay: 2.25 },// E4
        { freq: 440.0, dur: 0.35, delay: 2.65 }, // A4
        { freq: 440.0, dur: 0.2, delay: 3.05 },  // A4
        { freq: 493.88, dur: 0.2, delay: 3.3 },  // B4
        { freq: 440.0, dur: 0.2, delay: 3.55 },  // A4
        { freq: 392.0, dur: 0.2, delay: 3.8 },   // G4
        { freq: 369.99, dur: 0.5, delay: 4.05 }, // F#4
        { freq: 293.66, dur: 0.4, delay: 4.6 },  // D4
      ];

      notes.forEach((note) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.delay);

        const startTime = ctx.currentTime + note.delay;
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + note.dur + 0.4);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + note.dur + 0.5);
      });

      setIsPlaying(true);
      setTimeout(() => {
        setIsPlaying(false);
      }, 5500);
    } catch (e) {
      console.warn("Audio unavailable:", e);
    }
  };

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
    <header className="relative z-30 w-full border-b border-amber-500/20 bg-[#061b10]/90 backdrop-blur-md">
      {/* Christmas Garland String Lights */}
      <div className="absolute top-0 left-0 right-0 flex justify-around overflow-hidden px-2 pt-0.5">
        {lights.map((cls, idx) => (
          <div key={idx} className="flex flex-col items-center">
            <div className="h-1.5 w-1 bg-emerald-900" />
            <div className={`h-2.5 w-2.5 rounded-full shadow-sm ${cls}`} />
          </div>
        ))}
      </div>

      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 pt-5 md:px-8">
        {/* Brand / Logo */}
        <Link href="/" className="group flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-400/40 bg-gradient-to-br from-red-700 to-red-950 shadow-lg transition-transform group-hover:scale-105">
            <span className="text-xl">🎁</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-serif text-lg font-bold tracking-wide text-white md:text-xl">
                SECRET SANTA
              </span>
              <Sparkles className="h-4 w-4 text-amber-400 animate-pulse" />
            </div>
            <p className="text-[10px] tracking-widest text-amber-300/80 uppercase">
              Premium Holiday Edition
            </p>
          </div>
        </Link>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {/* Active User Indicator */}
          {activeParticipant && (
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-amber-400/30 bg-[#0c2e1c] px-3 py-1 text-xs text-amber-200">
              <User className="h-3.5 w-3.5 text-amber-400" />
              <span className="font-medium">{activeParticipant.name}</span>
              {onLogout && (
                <button
                  onClick={onLogout}
                  title="Logout"
                  className="ml-1 text-emerald-400 hover:text-white"
                >
                  <LogOut className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          {/* Festive Bell Chime Toggle */}
          <button
            onClick={toggleMusic}
            title={isPlaying ? "Playing Holiday Chime" : "Play Holiday Chime"}
            className="flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-[#123824]/80 px-3 py-1.5 text-xs text-amber-200 transition-all hover:border-amber-400 hover:bg-[#1b4d32] hover:text-white"
          >
            {isPlaying ? (
              <>
                <Volume2 className="h-3.5 w-3.5 text-amber-400 animate-bounce" />
                <span className="hidden sm:inline">Playing...</span>
              </>
            ) : (
              <>
                <VolumeX className="h-3.5 w-3.5 text-amber-300/70" />
                <span className="hidden sm:inline">Holiday Chime</span>
              </>
            )}
          </button>

          {/* Organizer Link */}
          <Link
            href="/admin"
            className="flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-950/60 px-3 py-1.5 text-xs text-emerald-200 transition-all hover:border-amber-400/60 hover:bg-emerald-900/80 hover:text-white"
          >
            <Shield className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">Organizer</span>
          </Link>
        </div>
      </div>
    </header>
  );
};
