"use client";

import React, { useEffect, useState } from "react";
import { Clock, Play, Pause, AlertCircle, CheckCircle2, Sparkles, UserCheck } from "lucide-react";

export interface RegistrationSessionData {
  status: "not_started" | "active" | "paused" | "completed";
  currentTurn: number;
  totalTurns: number;
  turnDurationSeconds: number;
  timeRemainingSeconds: number;
  registeredCount: number;
  totalParticipants: number;
  activeParticipantId: string | null;
  activeParticipantName: string | null;
  isPaused: boolean;
  turnExpiresAt: string | null;
}

interface RegistrationBannerProps {
  session: RegistrationSessionData | null;
  onRefresh?: () => void;
}

export const RegistrationBanner: React.FC<RegistrationBannerProps> = ({ session, onRefresh }) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(session?.timeRemainingSeconds ?? 60);

  // Sync internal countdown with server expires timestamp
  useEffect(() => {
    if (!session || session.status !== "active" || !session.turnExpiresAt) {
      setSecondsLeft(session?.timeRemainingSeconds ?? 60);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(session.turnExpiresAt!).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining === 0 && onRefresh) {
        onRefresh();
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [session, onRefresh]);

  if (!session || session.status === "not_started") {
    return null;
  }

  const isCompleted = session.status === "completed" || session.registeredCount >= session.totalParticipants;
  const isPaused = session.status === "paused";
  const progressPercent = Math.min(100, Math.round((session.registeredCount / session.totalParticipants) * 100));
  const timerPercent = Math.max(0, Math.min(100, (secondsLeft / session.turnDurationSeconds) * 100));

  return (
    <div className="relative mx-auto my-6 max-w-4xl px-4 animate-in fade-in slide-in-from-top-4 duration-500">
      <div className="relative overflow-hidden rounded-3xl border border-amber-400/40 bg-gradient-to-r from-[#0a2618]/95 via-[#0e3622]/95 to-[#081f14]/95 p-5 shadow-[0_10px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl">
        {/* Ambient Corner Sparkle */}
        <div className="pointer-events-none absolute -top-8 -right-8 h-28 w-28 rounded-full bg-amber-400/15 blur-xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-28 w-28 rounded-full bg-red-600/15 blur-xl" />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: Turn Progress & Description */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 text-[11px] font-bold tracking-wide text-amber-300">
                <Sparkles className="h-3 w-3 animate-spin" />
                {isCompleted ? "Registration Finished" : isPaused ? "Registration Paused" : "Supervised Turn Active"}
              </span>
              <span className="text-xs text-emerald-300/80">
                {session.registeredCount} of {session.totalParticipants} Registered
              </span>
            </div>

            <h3 className="font-serif text-lg sm:text-xl font-extrabold tracking-wide text-white">
              {isCompleted ? (
                <span className="text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5" />
                  All 18 Participants Registered!
                </span>
              ) : session.activeParticipantName ? (
                <>
                  Turn:{" "}
                  <span className="gold-text">
                    {session.activeParticipantName}
                  </span>{" "}
                  (Turn {session.currentTurn} of {session.totalTurns})
                </>
              ) : (
                <>
                  Participant Turn:{" "}
                  <span className="gold-text">
                    Turn {session.currentTurn} of {session.totalTurns}
                  </span>
                </>
              )}
            </h3>

            <p className="text-xs text-emerald-100/70">
              {isCompleted
                ? "Everyone has established their secret PIN. Secret Santa reveals are unlocked!"
                : isPaused
                ? "The organizer has paused the timer. Registration will resume shortly."
                : session.activeParticipantName
                ? `It is currently ${session.activeParticipantName}'s turn to register their secret PIN.`
                : "Search and select your name below to register your secret PIN."}
            </p>
          </div>

          {/* Right: Live 60-Second Countdown Dial */}
          {!isCompleted && (
            <div className="flex items-center gap-3 self-end sm:self-center">
              <div
                className={`relative flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 shadow-inner transition-colors ${
                  isPaused
                    ? "border-amber-500/40 bg-amber-950/40 text-amber-200"
                    : secondsLeft <= 10
                    ? "border-red-500/60 bg-red-950/60 text-red-200 animate-pulse"
                    : "border-amber-400/30 bg-[#06180f] text-amber-300"
                }`}
              >
                <Clock className={`h-5 w-5 ${isPaused ? "text-amber-400" : secondsLeft <= 10 ? "text-red-400" : "text-amber-400"}`} />
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-black tracking-tight">
                      {secondsLeft}
                    </span>
                    <span className="text-[10px] uppercase font-semibold text-emerald-200/60">
                      sec
                    </span>
                  </div>
                  <div className="text-[9px] font-medium text-emerald-300/60 uppercase tracking-widest">
                    {isPaused ? "Paused" : "Remaining"}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Progress Bars */}
        <div className="mt-4 space-y-1.5">
          {/* Participant Progress Bar */}
          <div className="flex items-center justify-between text-[11px] text-emerald-200/70">
            <span>Overall Progress</span>
            <span className="font-mono font-bold text-amber-300">{progressPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-950/80 border border-emerald-800/40">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-300 transition-all duration-500 shadow-[0_0_12px_rgba(212,175,55,0.8)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Active Turn Countdown Bar (Only if active & not completed) */}
          {!isCompleted && !isPaused && (
            <div className="pt-1">
              <div className="h-1 w-full overflow-hidden rounded-full bg-black/40">
                <div
                  className={`h-full transition-all duration-1000 ${
                    secondsLeft <= 10 ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" : "bg-emerald-400"
                  }`}
                  style={{ width: `${timerPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
