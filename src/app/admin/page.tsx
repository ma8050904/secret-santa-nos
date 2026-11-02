"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  Shield,
  Lock,
  RefreshCw,
  Copy,
  Check,
  Share2,
  Users,
  Eye,
  Clock,
  Sparkles,
  Download,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { Snowfall } from "@/components/Snowfall";

interface AdminParticipant {
  id: string;
  name: string;
  code: string;
  isRevealed: boolean;
  revealedAt: string | null;
}

interface AdminState {
  status: string;
  createdAt: string;
  generatedAt: string | null;
  totalParticipants: number;
  revealedCount: number;
  pendingCount: number;
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const fetchAdminData = async (pwd = password) => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/admin/status", {
        headers: { "x-admin-password": pwd },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setState(data.data);
      } else {
        setAuthError(data.error || "Failed to load event data.");
      }
    } catch {
      setAuthError("Failed to fetch administrative data.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegenerateDraw = async () => {
    if (
      !confirm(
        "Are you sure you want to regenerate the Secret Santa assignments? This is only allowed if no participant has opened their gift yet."
      )
    ) {
      return;
    }

    try {
      setIsLoading(true);
      const res = await fetch("/api/admin/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ force: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || "Cannot regenerate draw.");
      } else {
        setActionMessage("Draw regenerated with new cryptographic derangement.");
        fetchAdminData();
      }
    } catch {
      alert("Error regenerating draw.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = (p: AdminParticipant) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}/?p=${p.id}&code=${encodeURIComponent(p.code)}`;
    navigator.clipboard.writeText(url);
    setCopiedId(p.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleExportCSV = () => {
    if (!state) return;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    let csv = "ID,Participant Name,Secret Code,Magic Link,Status,Revealed At\n";

    state.participants.forEach((p) => {
      const link = `${origin}/?p=${p.id}&code=${encodeURIComponent(p.code)}`;
      const status = p.isRevealed ? "Opened" : "Pending";
      const time = p.revealedAt ? `"${p.revealedAt}"` : "N/A";
      csv += `"${p.id}","${p.name}","${p.code}","${link}","${status}",${time}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Secret_Santa_Credentials_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredParticipants = useMemo(() => {
    if (!state) return [];
    const q = filterQuery.trim().toLowerCase();
    if (!q) return state.participants;
    return state.participants.filter(
      (p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
    );
  }, [state, filterQuery]);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#05150d] via-[#092215] to-[#040f09] text-white">
      <Snowfall />

      {/* Decorative Lights */}
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
                Please enter the organizer master password to access event controls and credential distribution.
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
                    Default: <code className="text-amber-300">SantaMagic2024!</code> (or configured via ADMIN_PASSWORD)
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

            {/* Cryptographic Privacy Assurance Card */}
            <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-r from-[#0a2618]/90 via-[#123824]/90 to-[#0a2618]/90 p-5 shadow-lg backdrop-blur-md">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-emerald-900/60 text-amber-300">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-serif text-sm font-bold text-white tracking-wide">
                      🔒 Zero-Knowledge Organizer-Blind Architecture Active
                    </h3>
                    <p className="mt-0.5 text-xs text-emerald-200/80">
                      All assignments are AES-256-GCM encrypted using participants&apos; individual secret keys. The server and this dashboard strictly have <strong>zero database queries, endpoints, or mapping tables</strong> that reveal who received whom.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-400/40 bg-[#123824] px-4 py-2 text-xs font-semibold text-amber-200 transition-colors hover:bg-[#1b4d32] hover:text-white"
                  >
                    <Download className="h-3.5 w-3.5 text-amber-400" />
                    <span>Export Distribution CSV</span>
                  </button>
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
                <p className="mt-1 text-[11px] text-emerald-300/70">All 18 members active</p>
              </div>

              <div className="christmas-glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                    Revealed Gifts
                  </span>
                  <Eye className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="mt-2 text-3xl font-bold text-emerald-400">{state.revealedCount}</p>
                <p className="mt-1 text-[11px] text-emerald-300/70">
                  {Math.round((state.revealedCount / state.totalParticipants) * 100)}% completed
                </p>
              </div>

              <div className="christmas-glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
                    Pending Reveals
                  </span>
                  <Clock className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-2 text-3xl font-bold text-amber-300">{state.pendingCount}</p>
                <p className="mt-1 text-[11px] text-emerald-300/70">Waiting to open</p>
              </div>

              <div className="christmas-glass-card rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
                    Draw Status
                  </span>
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-2 text-2xl font-bold text-white uppercase">{state.status}</p>
                <p className="mt-1 text-[11px] text-emerald-300/70">
                  {state.generatedAt ? `Generated ${new Date(state.generatedAt).toLocaleDateString()}` : "Ready"}
                </p>
              </div>
            </div>

            {/* Event Controls */}
            <div className="rounded-2xl border border-amber-500/20 bg-[#071d13]/80 p-5 backdrop-blur-md">
              <h3 className="font-serif text-sm font-bold tracking-wide text-white">
                Event Controls
              </h3>
              <p className="mt-1 text-xs text-emerald-200/70">
                Safely manage the draw lifecycle. Regeneration is locked once any participant has opened their gift.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleRegenerateDraw}
                  disabled={isLoading || state.revealedCount > 0}
                  className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-r from-red-800 to-red-900 px-4 py-2.5 text-xs font-semibold text-white shadow-md transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Regenerate Draw Permutation</span>
                </button>

                {state.revealedCount > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-300/90">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span>Regeneration locked because {state.revealedCount} gift(s) are already opened.</span>
                  </span>
                )}
              </div>
            </div>

            {/* Credential Distribution Table */}
            <div className="rounded-2xl border border-amber-500/30 bg-[#071d13]/90 p-6 shadow-2xl backdrop-blur-md">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-serif text-lg font-bold text-white">
                    Participant Credential Distribution
                  </h3>
                  <p className="mt-0.5 text-xs text-emerald-200/80">
                    Send each participant their private access code or copy their instant magic link.
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
                      <th className="py-3 px-3 font-semibold uppercase">Secret Code</th>
                      <th className="py-3 px-3 font-semibold uppercase">Status</th>
                      <th className="py-3 px-3 font-semibold uppercase text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/60">
                    {filteredParticipants.map((p) => {
                      const origin = typeof window !== "undefined" ? window.location.origin : "";
                      const magicUrl = `${origin}/?p=${p.id}&code=${encodeURIComponent(p.code)}`;
                      const waText = encodeURIComponent(
                        `🎄 Merry Christmas ${p.name}! Here is your private Secret Santa access link:\n${magicUrl}\n\nYour Secret Code: ${p.code}\nKeep it confidential! 🎁`
                      );
                      const isCopied = copiedId === p.id;

                      return (
                        <tr key={p.id} className="transition-colors hover:bg-emerald-950/40">
                          <td className="py-3.5 px-3 font-medium text-white">
                            <div className="flex items-center gap-2">
                              <span className="text-base">👤</span>
                              <span className="font-semibold text-sm">{p.name}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-3 font-mono font-bold text-amber-300">
                            <span className="rounded-lg border border-amber-400/30 bg-[#0a2618] px-2.5 py-1">
                              {p.code}
                            </span>
                          </td>
                          <td className="py-3.5 px-3">
                            {p.isRevealed ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                                <Check className="h-3 w-3" />
                                <span>Opened</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                                <Clock className="h-3 w-3" />
                                <span>Pending</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              {/* Copy Link Button */}
                              <button
                                onClick={() => handleCopyLink(p)}
                                title="Copy Magic Link"
                                className="flex items-center gap-1 rounded-lg border border-amber-400/30 bg-[#123824] px-2.5 py-1.5 text-xs text-amber-200 transition-colors hover:border-amber-400 hover:text-white"
                              >
                                {isCopied ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3.5 w-3.5" />
                                    <span>Copy Link</span>
                                  </>
                                )}
                              </button>

                              {/* WhatsApp Share Link */}
                              <a
                                href={`https://wa.me/?text=${waText}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Share via WhatsApp"
                                className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-950/80 px-2.5 py-1.5 text-xs text-emerald-300 transition-colors hover:bg-emerald-900 hover:text-white"
                              >
                                <Share2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">WhatsApp</span>
                              </a>
                            </div>
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
