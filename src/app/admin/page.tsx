"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Shield,
  Lock,
  RefreshCw,
  Users,
  Eye,
  Clock,
  Sparkles,
  ArrowLeft,
  Check,
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Snowfall } from "@/components/Snowfall";

interface AdminParticipant {
  id: string;
  name: string;
  isRevealed: boolean;
  revealedAt: string | null;
  isRegistered?: boolean;
}

interface RegistrationSessionInfo {
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

interface AdminState {
  status: string;
  createdAt: string;
  generatedAt: string | null;
  totalParticipants: number;
  revealedCount: number;
  pendingCount: number;
  registrationSession?: RegistrationSessionInfo;
  participants: AdminParticipant[];
}

export default function AdminDashboardPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [state, setState] = useState<AdminState | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Authenticate Admin
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || "Invalid organizer password.");
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);
      fetchAdminData(password);
    } catch {
      setAuthError("Network error connecting to Santa's administrative portal.");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAdminData = useCallback(async (pwd = password) => {
    try {
      const res = await fetch("/api/admin/status", {
        headers: { "x-admin-password": pwd },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setState(data.data);
      }
    } catch {
      // non-blocking
    }
  }, [password]);

  // Live auto-refresh polling every 2 seconds when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      fetchAdminData();
    }, 2000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchAdminData]);

  // Execute registration control actions
  const handleRegistrationAction = async (
    action: "start" | "pause" | "resume" | "skip" | "revisit",
    participantId?: string
  ) => {
    setActionLoading(true);
    setActionMessage(null);

    try {
      const res = await fetch("/api/registration/control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ action, participantId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionMessage(`Error: ${data.error || "Action failed."}`);
      } else {
        setActionMessage(data.message || `Action '${action}' successful.`);
        await fetchAdminData();
      }
    } catch {
      setActionMessage("Network error executing action.");
    } finally {
      setActionLoading(false);
    }
  };

  const filteredParticipants = useMemo(() => {
    if (!state) return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return state.participants;
    return state.participants.filter((p) => p.name.toLowerCase().includes(q));
  }, [state, filterQuery]);

  const regSession = state?.registrationSession;
  const isRegActive = regSession?.status === "active";
  const isRegPaused = regSession?.status === "paused";
  const isRegCompleted = regSession?.status === "completed" || (regSession && regSession.registeredCount >= regSession.totalParticipants);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#05150d] via-[#092215] to-[#040f09] text-white">
      <Snowfall />

      {/* Decorative Top Lights */}
      <div className="h-1 bg-gradient-to-r from-red-600 via-amber-400 to-emerald-600" />

      {/* Header */}
      <header className="relative z-20 border-b border-amber-500/20 bg-[#061b10]/90 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-[#123824] px-3 py-1.5 text-xs text-amber-200 transition-colors hover:bg-[#1b4d32]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Event</span>
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-400" />
              <h1 className="font-serif text-lg font-bold tracking-wide text-white">
                Secret Santa Organizer Portal
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full border border-emerald-500/40 bg-emerald-950/70 px-3 py-1 text-[11px] font-semibold tracking-wider text-emerald-300 uppercase">
              18 Participants
            </span>
          </div>
        </div>
      </header>

      <main className="relative z-20 mx-auto max-w-6xl px-4 py-8">
        {/* ===================================================================
            LOGIN SCREEN
           =================================================================== */}
        {!isAuthenticated && (
          <div className="mx-auto max-w-md py-12">
            <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] to-[#05160d] p-8 shadow-2xl backdrop-blur-xl">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-red-900/60 shadow-lg">
                <Lock className="h-7 w-7 text-amber-300" />
              </div>

              <h2 className="text-center font-serif text-2xl font-bold text-white">
                Organizer Authentication
              </h2>
              <p className="mt-2 text-center text-xs text-emerald-200/80">
                Please enter the organizer master password to access event controls and supervise registration.
              </p>

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-amber-200 mb-1">
                    Organizer Master Password:
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setAuthError(null);
                    }}
                    placeholder="Enter password..."
                    autoFocus
                    required
                    className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] px-4 py-3 text-sm text-white placeholder-emerald-400/40 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  />
                  <p className="mt-1.5 text-[11px] text-emerald-300/60">
                    Default: <code className="text-amber-300">SantaMagic2024!</code>
                  </p>
                </div>

                {authError && (
                  <div className="rounded-xl border border-red-500/40 bg-red-950/70 p-3 text-xs text-red-200">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading || !password}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-400/40 bg-gradient-to-r from-red-700 via-red-600 to-red-800 py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 disabled:opacity-50"
                >
                  {isLoading ? <span>Verifying...</span> : <span>Unlock Organizer Portal</span>}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ===================================================================
            ORGANIZER DASHBOARD
           =================================================================== */}
        {isAuthenticated && state && (
          <div className="space-y-8">
            {/* Status Notification Banner */}
            {actionMessage && (
              <div className="flex items-center justify-between rounded-2xl border border-emerald-400/40 bg-emerald-950/80 p-4 text-xs text-emerald-200">
                <span>{actionMessage}</span>
                <button onClick={() => setActionMessage(null)} className="text-emerald-400 hover:text-white">
                  ✕
                </button>
              </div>
            )}

            {/* ===============================================================
                SUPERVISED ONE-AT-A-TIME REGISTRATION CONTROL PANEL
               =============================================================== */}
            <div className="rounded-3xl border border-amber-400/40 bg-gradient-to-br from-[#0c2e1c] via-[#092215] to-[#05150d] p-6 shadow-2xl backdrop-blur-xl">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="flex h-6 items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 text-xs font-bold text-amber-300">
                      <Clock className="h-3.5 w-3.5" />
                      Supervised Registration System
                    </span>
                    <span className="text-xs text-emerald-300/80">
                      60-second window per turn
                    </span>
                  </div>

                  <h2 className="font-serif text-2xl font-extrabold text-white">
                    {isRegCompleted ? (
                      <span className="text-emerald-400 flex items-center gap-2">
                        <CheckCircle2 className="h-6 w-6" />
                        Registration Completed (18/18 Registered)
                      </span>
                    ) : isRegActive ? (
                      <>
                        Turn {regSession?.currentTurn} of {regSession?.totalTurns}{" "}
                        {regSession?.activeParticipantName && (
                          <span className="gold-text">
                            ({regSession.activeParticipantName})
                          </span>
                        )}
                      </>
                    ) : isRegPaused ? (
                      <span className="text-amber-300">
                        Registration Paused (Turn {regSession?.currentTurn})
                      </span>
                    ) : (
                      <span>Registration Not Started</span>
                    )}
                  </h2>

                  <p className="mt-1 text-xs text-emerald-200/80 max-w-xl">
                    Registration proceeds one participant at a time with a 60-second window. Each participant establishes their secret PIN. Once confirmed, the turn immediately advances.
                  </p>
                </div>

                {/* Right: Live Countdown Dial & Primary Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Countdown Badge */}
                  {regSession && regSession.status !== "not_started" && !isRegCompleted && (
                    <div
                      className={`flex items-center gap-2 rounded-2xl border px-4 py-2.5 shadow-inner ${
                        isRegPaused
                          ? "border-amber-500/40 bg-amber-950/40 text-amber-300"
                          : regSession.timeRemainingSeconds <= 10
                          ? "border-red-500/60 bg-red-950/60 text-red-200 animate-pulse"
                          : "border-amber-400/40 bg-[#06180f] text-amber-300"
                      }`}
                    >
                      <Clock className="h-5 w-5" />
                      <div>
                        <div className="font-mono text-2xl font-bold leading-none">
                          {regSession.timeRemainingSeconds}s
                        </div>
                        <div className="text-[9px] uppercase tracking-wider text-emerald-300/60 font-semibold">
                          {isRegPaused ? "Paused" : "Remaining"}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Primary Action Button: Start / Pause / Resume */}
                  {(!regSession || regSession.status === "not_started") ? (
                    <button
                      onClick={() => handleRegistrationAction("start")}
                      disabled={actionLoading}
                      className="group flex items-center gap-2 rounded-2xl border-2 border-amber-300 bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_20px_rgba(5,150,105,0.4)] transition-all hover:scale-105 hover:brightness-110 disabled:opacity-50"
                    >
                      <Play className="h-4 w-4 fill-white" />
                      <span>Start Registration</span>
                    </button>
                  ) : isRegActive ? (
                    <button
                      onClick={() => handleRegistrationAction("pause")}
                      disabled={actionLoading}
                      className="flex items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-950/70 px-5 py-3 text-xs font-bold text-amber-200 hover:bg-amber-900/80 transition-colors disabled:opacity-50"
                    >
                      <Pause className="h-4 w-4" />
                      <span>Pause Turn</span>
                    </button>
                  ) : isRegPaused ? (
                    <button
                      onClick={() => handleRegistrationAction("resume")}
                      disabled={actionLoading}
                      className="flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-900/80 px-5 py-3 text-xs font-bold text-white hover:bg-emerald-800 transition-colors disabled:opacity-50"
                    >
                      <Play className="h-4 w-4 fill-white" />
                      <span>Resume Turn</span>
                    </button>
                  ) : null}

                  {/* Skip Turn Button */}
                  {regSession && (isRegActive || isRegPaused) && !isRegCompleted && (
                    <button
                      onClick={() => handleRegistrationAction("skip")}
                      disabled={actionLoading}
                      title="Skip current turn and advance to the next participant"
                      className="flex items-center gap-1.5 rounded-2xl border border-amber-400/30 bg-[#0a2618] px-4 py-3 text-xs font-semibold text-amber-300 hover:bg-[#123824] transition-colors disabled:opacity-50"
                    >
                      <SkipForward className="h-4 w-4" />
                      <span>Skip Turn</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Cryptographic Privacy Assurance Card */}
            <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-r from-[#0a2618]/90 via-[#123824]/90 to-[#0a2618]/90 p-5 shadow-lg backdrop-blur-md">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-emerald-900/60 text-amber-300">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-serif text-sm font-bold text-white tracking-wide">
                      🔒 Zero-Knowledge Organizer-Blind Privacy Active
                    </h3>
                    <p className="mt-0.5 text-xs text-emerald-200/80">
                      All assignments are AES-256-GCM encrypted. The organizer dashboard strictly has <strong>zero knowledge of personal PINs, recipient assignments, or mappings</strong>.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="christmas-glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
                    Total Participants
                  </span>
                  <Users className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-2 text-3xl font-bold text-white">{state.totalParticipants}</p>
                <p className="mt-1 text-[11px] text-emerald-300/70">All 18 members</p>
              </div>

              <div className="christmas-glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                    Registered PINs
                  </span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="mt-2 text-3xl font-bold text-emerald-400">
                  {state.participants.filter((p) => p.isRegistered).length} / 18
                </p>
                <p className="mt-1 text-[11px] text-emerald-300/70">
                  {Math.round(
                    (state.participants.filter((p) => p.isRegistered).length / state.totalParticipants) * 100
                  )}% established PIN
                </p>
              </div>

              <div className="christmas-glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
                    Revealed Gifts
                  </span>
                  <Eye className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-2 text-3xl font-bold text-amber-300">{state.revealedCount}</p>
                <p className="mt-1 text-[11px] text-emerald-300/70">Opened secret gift</p>
              </div>

              <div className="christmas-glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
                    Draw Status
                  </span>
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-2 text-2xl font-bold text-white uppercase">{state.status}</p>
                <p className="mt-1 text-[11px] text-emerald-300/70">Active & verified</p>
              </div>
            </div>

            {/* Participation Directory Table with Supervision Controls */}
            <div className="rounded-2xl border border-amber-500/30 bg-[#071d13]/90 p-6 shadow-2xl backdrop-blur-md">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-serif text-lg font-bold text-white">
                    Participant Registration & Status Directory
                  </h3>
                  <p className="mt-0.5 text-xs text-emerald-200/80">
                    Live overview of all 18 participants with individual turn revisit controls.
                  </p>
                </div>

                {/* Filter Input */}
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter participants..."
                  className="w-full sm:w-64 rounded-xl border border-amber-500/30 bg-[#0a2618] px-3.5 py-2 text-xs text-white placeholder-emerald-400/40 focus:border-amber-400 focus:outline-none"
                />
              </div>

              {/* Table */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-amber-500/20 text-amber-300">
                      <th className="py-3 px-3 font-semibold uppercase">Participant</th>
                      <th className="py-3 px-3 font-semibold uppercase">PIN Registration</th>
                      <th className="py-3 px-3 font-semibold uppercase">Gift Reveal</th>
                      <th className="py-3 px-3 font-semibold uppercase">Turn Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/60">
                    {filteredParticipants.map((p) => {
                      const isActiveTurnTarget = regSession?.activeParticipantId === p.id;

                      return (
                        <tr key={p.id} className="transition-colors hover:bg-emerald-950/40">
                          <td className="py-3.5 px-3 font-medium text-white">
                            <div className="flex items-center gap-2">
                              <span className="text-base">👤</span>
                              <span className="font-semibold text-sm">{p.name}</span>
                              {isActiveTurnTarget && (
                                <span className="rounded-full border border-amber-400 bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 animate-pulse">
                                  Current Turn
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-3">
                            {p.isRegistered ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                                <Check className="h-3 w-3" />
                                <span>PIN Established</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                                <Clock className="h-3 w-3" />
                                <span>Unregistered</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3">
                            {p.isRevealed ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                                <Eye className="h-3 w-3" />
                                <span>Opened</span>
                              </span>
                            ) : (
                              <span className="text-emerald-300/50 text-[11px]">Unopened</span>
                            )}
                          </td>
                          <td className="py-3.5 px-3">
                            {!p.isRegistered && (
                              <button
                                onClick={() => handleRegistrationAction("revisit", p.id)}
                                disabled={actionLoading}
                                title={`Open a 60-second registration turn specifically for ${p.name}`}
                                className="flex items-center gap-1 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/20 transition-colors disabled:opacity-50"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Revisit This Turn</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
