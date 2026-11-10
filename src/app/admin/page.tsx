"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Shield,
  Lock,
  RefreshCw,
  Users,
  Eye,
  Check,
  Clock,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Smartphone,
  Database,
  Activity,
  History,
  RotateCcw,
  Dices,
  LogOut,
  X,
  Laptop,
  Globe,
  Fingerprint,
  KeyRound,
  Trash2,
} from "lucide-react";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Snowfall } from "@/components/Snowfall";

interface DeviceBindingRecord {
  deviceId: string;
  participantId: string;
  participantName: string;
  boundAt: string;
  lastUsedAt: string;
  ip?: string;
  userAgent?: string;
  deviceModel?: string;
  os?: string;
  browser?: string;
  summary?: string;
  hasRevealed?: boolean;
  revealedAt?: string | null;
}

interface AdminParticipant {
  id: string;
  name: string;
  isRevealed: boolean;
  revealedAt: string | null;
  isRegistered?: boolean;
  deviceSummary?: string;
  deviceIp?: string;
  deviceBoundAt?: string;
  deviceHasRevealed?: boolean;
  deviceRevealedAt?: string | null;
}

interface AdminAuditLogEntry {
  id: string;
  action:
    | "REGENERATE_FULL_DRAW"
    | "REROLL_SUBGROUP_20"
    | "RESET_ALL_DEVICES"
    | "ADMIN_LOGIN"
    | "ADMIN_LOGIN_FAILED"
    | "GIFT_REVEALED";
  actionLabel: string;
  timestamp: string;
  ip: string;
  status: "SUCCESS" | "FAILED";
  details: string;
}

interface AdminSafeState {
  status: string;
  version: number;
  createdAt: string;
  generatedAt: string | null;
  totalParticipants: number;
  registeredCount: number;
  revealedCount: number;
  pendingCount: number;
  registeredDevicesCount: number;
  lastDrawGeneratedAt: string | null;
  lastResetAt: string | null;
  storageHealth: {
    provider: string;
    status: "Healthy" | "Degraded";
    latencyMs: number;
    lastBackupName?: string;
  };
  auditLogs: AdminAuditLogEntry[];
  devices?: DeviceBindingRecord[];
  participants: AdminParticipant[];
}

export default function AdminDashboardPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [state, setState] = useState<AdminSafeState | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [deviceFilter, setDeviceFilter] = useState<"ALL" | "REVEALED" | "UNREVEALED">("ALL");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  // Active Confirmation Modal state
  const [activeModal, setActiveModal] = useState<
    "FULL_REGENERATE" | "REROLL_SUBGROUP" | "RESET_DEVICES" | "FULL_RESET" | null
  >(null);
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);

  // Custom password management state (Mac Keychain & Touch ID compatible)
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [confirmAdminPassword, setConfirmAdminPassword] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Passkey / WebAuthn Biometric state (Apple Touch ID / Face ID)
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  const [registeredPasskeys, setRegisteredPasskeys] = useState<
    Array<{ id: string; label: string; createdAt: string; deviceType?: string }>
  >([]);
  const [showPasswordFallback, setShowPasswordFallback] = useState(false);
  const [resetParticipantTarget, setResetParticipantTarget] = useState<AdminParticipant | null>(null);
  const [isResettingParticipant, setIsResettingParticipant] = useState(false);

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
        setAuthError(data.error || "Incorrect organizer password.");
        setIsLoading(false);
        return;
      }

      setIsAuthenticated(true);
      fetchAdminData();
    } catch {
      setAuthError("Network connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch Admin Status
  const fetchAdminData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/admin/status", {
        headers: {
          "x-admin-password": password,
        },
        cache: "no-store",
      });

      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }

      const data = await res.json();
      if (res.ok && data.success && data.data) {
        setState(data.data);
      }
    } catch {
      // non-blocking
    } finally {
      setIsRefreshing(false);
    }
  }, [password]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchAdminData();
    }
  }, [isAuthenticated, fetchAdminData]);

  // Check existing session & passkeys on mount
  useEffect(() => {
    fetch("/api/admin/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && data.data) {
          setIsAuthenticated(true);
          setState(data.data);
        }
      })
      .catch(() => {});

    fetch("/api/admin/passkey/list", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success) {
          setHasPasskeys(Boolean(data.hasPasskeys));
          if (data.passkeys) setRegisteredPasskeys(data.passkeys);
        }
      })
      .catch(() => {});
  }, []);

  // Biometric Passkey Login (Apple Touch ID / Face ID)
  const handlePasskeyLogin = async () => {
    setIsPasskeyLoading(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/admin/passkey/auth-options", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || "Failed to start Touch ID authentication.");
        setIsPasskeyLoading(false);
        return;
      }

      const assertion = await startAuthentication({ optionsJSON: data.options });

      const verifyRes = await fetch("/api/admin/passkey/auth-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        setAuthError(verifyData.error || "Touch ID verification failed.");
        setIsPasskeyLoading(false);
        return;
      }

      setIsAuthenticated(true);
      fetchAdminData();
    } catch (err: unknown) {
      console.error("Passkey login error:", err);
      const msg = err instanceof Error ? err.message : "Touch ID canceled.";
      if (!msg.toLowerCase().includes("abort") && !msg.toLowerCase().includes("cancel")) {
        setAuthError(msg);
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  // Register new Biometric Passkey
  const handleRegisterPasskey = async (label = "Mac Touch ID") => {
    setIsPasskeyLoading(true);
    setAuthError(null);
    try {
      const res = await fetch("/api/admin/passkey/register-options", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(password ? { "x-admin-password": password } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAuthError(data.error || "Failed to start passkey registration.");
        setIsPasskeyLoading(false);
        return;
      }

      const reg = await startRegistration({ optionsJSON: data.options });

      const verifyRes = await fetch("/api/admin/passkey/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: reg, label }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        setAuthError(verifyData.error || "Registration verification failed.");
        setIsPasskeyLoading(false);
        return;
      }

      setHasPasskeys(true);
      setIsAuthenticated(true);
      fetchAdminData();
      setShowPasskeyModal(false);

      const listRes = await fetch("/api/admin/passkey/list", { cache: "no-store" });
      const listData = await listRes.json();
      if (listData && listData.passkeys) setRegisteredPasskeys(listData.passkeys);
    } catch (err: unknown) {
      console.error("Passkey register error:", err);
      const msg = err instanceof Error ? err.message : "Passkey registration canceled.";
      if (!msg.toLowerCase().includes("abort") && !msg.toLowerCase().includes("cancel")) {
        setAuthError(msg);
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  // Delete Passkey
  const handleDeletePasskey = async (id: string) => {
    try {
      const res = await fetch("/api/admin/passkey/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(password ? { "x-admin-password": password } : {}),
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRegisteredPasskeys((prev) => prev.filter((p) => p.id !== id));
        if (registeredPasskeys.length <= 1) setHasPasskeys(false);
      }
    } catch {
      // non-blocking
    }
  };

  // Individual Participant Reset
  const handleResetSingleParticipant = async () => {
    if (!resetParticipantTarget) return;
    setIsResettingParticipant(true);
    try {
      const res = await fetch("/api/admin/reset-participant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(password ? { "x-admin-password": password } : {}),
        },
        body: JSON.stringify({ participantId: resetParticipantTarget.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionSuccessMsg(data.message || `Participant ${resetParticipantTarget.name} has been reset.`);
        setResetParticipantTarget(null);
        fetchAdminData();
      } else {
        setActionErrorMsg(data.error || "Failed to reset participant.");
      }
    } catch {
      setActionErrorMsg("Network error resetting participant.");
    } finally {
      setIsResettingParticipant(false);
    }
  };

  // Admin Logout
  const handleAdminLogout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setIsAuthenticated(false);
    setPassword("");
    setState(null);
  };

  // Change Admin Master Password
  const handleChangeAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);

    if (newAdminPassword.length < 6) {
      setPasswordFeedback({ type: "error", text: "Password must be at least 6 characters long." });
      return;
    }

    if (newAdminPassword !== confirmAdminPassword) {
      setPasswordFeedback({ type: "error", text: "Passwords do not match." });
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const res = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ newPassword: newAdminPassword.trim() }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setPasswordFeedback({ type: "error", text: data.error || "Failed to update password." });
        return;
      }

      setPassword(newAdminPassword.trim());
      setPasswordFeedback({
        type: "success",
        text: "Password updated successfully! macOS Keychain will offer to update Touch ID.",
      });
      setNewAdminPassword("");
      setConfirmAdminPassword("");
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordFeedback(null);
      }, 2000);
    } catch {
      setPasswordFeedback({ type: "error", text: "Network connection error." });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Execute Sensitive Action
  const executeAction = async (actionType: "FULL_REGENERATE" | "REROLL_SUBGROUP" | "RESET_DEVICES" | "FULL_RESET") => {
    setIsActionSubmitting(true);
    setActionSuccessMsg(null);
    setActionErrorMsg(null);

    let endpoint = "";
    if (actionType === "FULL_REGENERATE") endpoint = "/api/admin/generate";
    else if (actionType === "REROLL_SUBGROUP") endpoint = "/api/admin/reroll-subgroup";
    else if (actionType === "RESET_DEVICES") endpoint = "/api/admin/reset-devices";
    else if (actionType === "FULL_RESET") endpoint = "/api/admin/reset";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": password,
        },
        body: JSON.stringify({ force: true }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionErrorMsg(data.error || "Action execution failed.");
        return;
      }

      setActionSuccessMsg(data.message || "Operation completed successfully.");
      setActiveModal(null);
      await fetchAdminData();
    } catch {
      setActionErrorMsg("Failed to communicate with server. Please try again.");
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const filteredParticipants = useMemo(() => {
    if (!state) return [];
    const sorted = [...state.participants].sort((a, b) => {
      const cleanA = (a.name || "").replace(/^[^\p{L}]+/u, "").toLowerCase();
      const cleanB = (b.name || "").replace(/^[^\p{L}]+/u, "").toLowerCase();
      return cleanA.localeCompare(cleanB);
    });
    const q = filterQuery.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => p.name.toLowerCase().includes(q));
  }, [state, filterQuery]);

  const filteredDevices = useMemo(() => {
    if (!state?.devices) return [];
    return state.devices.filter((dev) => {
      const q = deviceSearch.trim().toLowerCase();
      const matchesSearch =
        !q ||
        dev.participantName.toLowerCase().includes(q) ||
        (dev.summary && dev.summary.toLowerCase().includes(q)) ||
        (dev.ip && dev.ip.toLowerCase().includes(q)) ||
        dev.deviceId.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (deviceFilter === "REVEALED") return dev.hasRevealed === true;
      if (deviceFilter === "UNREVEALED") return !dev.hasRevealed;
      return true;
    });
  }, [state?.devices, deviceSearch, deviceFilter]);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#05150d] via-[#092215] to-[#040f09] text-white selection:bg-amber-400 selection:text-slate-950">
      <Snowfall />

      {/* Decorative Top Accent */}
      <div className="h-1 bg-gradient-to-r from-red-600 via-amber-400 to-emerald-600" />

      {/* Header */}
      <header className="relative z-20 border-b border-amber-500/20 bg-[#061b10]/90 px-4 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-[#123824] px-3.5 py-1.5 text-xs text-amber-200 transition-colors hover:bg-[#1b4d32]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Event</span>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-amber-400" />
                <h1 className="font-serif text-lg font-bold tracking-wide text-white">
                  Secret Santa — Organizer Dashboard
                </h1>
              </div>
              <p className="text-[11px] text-emerald-300/70">
                Organizer Control Center • Admin only
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isAuthenticated && (
              <>
                <button
                  onClick={() => {
                    setPasswordFeedback(null);
                    setShowPasswordModal(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-[#071d13] px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-[#0f3422] cursor-pointer"
                >
                  <Fingerprint className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Passkeys ({registeredPasskeys.length})</span>
                </button>
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-950/60 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-900/80 cursor-pointer"
                  title="Change Organizer Master Password"
                >
                  <Lock className="h-3.5 w-3.5 text-amber-400" />
                  <span>Password</span>
                </button>
                <button
                  onClick={fetchAdminData}
                  disabled={isRefreshing}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-[#071d13] px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-[#0f3422] disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  <span>Refresh</span>
                </button>
                <button
                  onClick={handleAdminLogout}
                  className="flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-950/60 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-900/80 cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Logout</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-20 mx-auto max-w-6xl px-4 py-8">
        {/* ===================================================================
            LOGIN SCREEN (With Apple Touch ID & Passkey Biometric Support)
           =================================================================== */}
        {!isAuthenticated && (
          <div className="mx-auto max-w-md py-8">
            <div className="rounded-3xl border border-amber-500/40 bg-gradient-to-b from-[#0a2618] to-[#05160d] p-8 shadow-2xl backdrop-blur-xl">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/50 bg-gradient-to-br from-emerald-600/30 to-amber-500/20 shadow-xl">
                <Fingerprint className="h-9 w-9 text-amber-300 animate-pulse" />
              </div>

              <h2 className="text-center font-serif text-2xl font-bold text-white">
                لوحة تحكم المنظّم
              </h2>
              <p className="mt-2 text-center text-xs text-emerald-200/80">
                تسجيل الدخول الآمن ببصمة الإصبع عبر Apple Touch ID / Passkey
              </p>

              {authError && (
                <div className="mt-4 rounded-xl border border-red-500/40 bg-red-950/70 p-3 text-xs text-red-200">
                  {authError}
                </div>
              )}

              {/* Primary Biometric Passkey Action */}
              <div className="mt-6 space-y-3">
                {hasPasskeys ? (
                  <button
                    onClick={handlePasskeyLogin}
                    disabled={isPasskeyLoading}
                    className="flex w-full items-center justify-center gap-3 rounded-2xl border border-amber-400/80 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 py-4 text-sm font-bold text-white shadow-xl transition-all hover:scale-[1.02] hover:brightness-110 disabled:opacity-50 cursor-pointer"
                  >
                    <Fingerprint className="h-6 w-6 text-amber-300" />
                    <span>{isPasskeyLoading ? "جاري التحقق من البصمة..." : "الدخول عبر بصمة الإصبع (Touch ID)"}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleRegisterPasskey("Mac Touch ID")}
                    disabled={isPasskeyLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/80 bg-gradient-to-r from-emerald-600 to-emerald-800 py-3.5 text-xs font-bold text-white shadow-lg transition-all hover:scale-[1.02] disabled:opacity-50 cursor-pointer"
                  >
                    <Fingerprint className="h-5 w-5 text-amber-300" />
                    <span>{isPasskeyLoading ? "جاري تفعيل البصمة..." : "تفعيل وتسجيل بصمة Mac Touch ID الآن"}</span>
                  </button>
                )}

                {hasPasskeys && (
                  <button
                    onClick={() => handleRegisterPasskey("Mac Touch ID")}
                    disabled={isPasskeyLoading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/40 hover:bg-emerald-950/70 py-2.5 text-xs font-medium text-emerald-300 transition-colors cursor-pointer"
                  >
                    <Fingerprint className="h-3.5 w-3.5 text-amber-300/80" />
                    <span>+ تسجيل جهاز جديد / بصمة إضافية</span>
                  </button>
                )}
              </div>

              {/* Collapsible Password Fallback */}
              <div className="mt-6 border-t border-emerald-900/80 pt-4">
                <button
                  type="button"
                  onClick={() => setShowPasswordFallback((prev) => !prev)}
                  className="mx-auto flex items-center gap-1.5 text-xs text-amber-200/70 hover:text-amber-200 transition-colors cursor-pointer"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>{showPasswordFallback ? "إخفاء خيار كلمة المرور" : "أو الدخول بكلمة المرور اليدوية (Password Fallback)"}</span>
                </button>

                {showPasswordFallback && (
                  <form method="POST" onSubmit={handleLogin} autoComplete="on" className="mt-4 space-y-3">
                    <input
                      type="text"
                      name="username"
                      id="admin-username"
                      autoComplete="username"
                      defaultValue="Organizer"
                      readOnly
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <div>
                      <input
                        id="admin-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setAuthError(null);
                        }}
                        placeholder="أدخل كلمة مرور المنظّم..."
                        required
                        className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] px-4 py-2.5 text-xs text-white placeholder-emerald-400/40 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading || !password}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/40 bg-gradient-to-r from-red-800 to-red-900 py-2.5 text-xs font-bold text-white shadow transition-all hover:brightness-110 disabled:opacity-50 cursor-pointer"
                    >
                      {isLoading ? <span>Verifying...</span> : <span>الدخول بكلمة المرور</span>}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            ORGANIZER CONTROL CENTER
           =================================================================== */}
        {isAuthenticated && state && (
          <div className="space-y-8">
            {/* Feedback Banners */}
            {actionSuccessMsg && (
              <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/80 p-4 shadow-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <p className="text-xs text-emerald-100 font-medium">{actionSuccessMsg}</p>
                </div>
                <button
                  onClick={() => setActionSuccessMsg(null)}
                  className="text-emerald-300 hover:text-white text-xs px-2 py-1"
                >
                  ✕
                </button>
              </div>
            )}

            {actionErrorMsg && (
              <div className="rounded-2xl border border-red-400/40 bg-red-950/80 p-4 shadow-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
                  <p className="text-xs text-red-100 font-medium">{actionErrorMsg}</p>
                </div>
                <button
                  onClick={() => setActionErrorMsg(null)}
                  className="text-red-300 hover:text-white text-xs px-2 py-1"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Zero-Knowledge Privacy Banner */}
            <div className="rounded-2xl border border-amber-400/30 bg-gradient-to-r from-[#0a2618]/90 via-[#123824]/90 to-[#0a2618]/90 p-5 shadow-lg backdrop-blur-md">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-400/40 bg-emerald-900/60 text-amber-300">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-serif text-sm font-bold text-white tracking-wide">
                      🔒 Zero-Knowledge Organizer Privacy Guard Active
                    </h3>
                    <p className="mt-0.5 text-xs text-emerald-200/80">
                      All participant assignments are strictly encrypted using AES-256-GCM. The organizer dashboard and audit records strictly omit recipient names, pairing maps, and participant PINs.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ===============================================================
                1. FOUR PRIMARY METRIC CARDS
               =============================================================== */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {/* Card 1: Participants */}
              <div className="christmas-glass-card rounded-2xl p-5 border border-amber-500/20 bg-[#071d13]/80 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
                    Participants
                  </span>
                  <Users className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-2 text-3xl sm:text-4xl font-extrabold text-white">
                  {state.totalParticipants}
                </p>
                <p className="mt-1 text-[11px] text-emerald-300/70">Verified {state.totalParticipants}-member roster</p>
              </div>

              {/* Card 2: Current Round (Read dynamically from production) */}
              <div className="christmas-glass-card rounded-2xl p-5 border border-amber-500/20 bg-[#071d13]/80 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-amber-300 uppercase">
                    Current Round
                  </span>
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </div>
                <p className="mt-2 text-3xl sm:text-4xl font-extrabold text-amber-300">
                  Round {state.version}
                </p>
                <p className="mt-1 text-[11px] text-emerald-300/70">Active & verified on production</p>
              </div>

              {/* Card 3: Revealed Count */}
              <div className="christmas-glass-card rounded-2xl p-5 border border-amber-500/20 bg-[#071d13]/80 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                    Revealed
                  </span>
                  <Eye className="h-4 w-4 text-emerald-400" />
                </div>
                <p className="mt-2 text-3xl sm:text-4xl font-extrabold text-emerald-400">
                  {state.revealedCount} <span className="text-lg text-emerald-200/60 font-normal">/ {state.totalParticipants}</span>
                </p>
                <p className="mt-1 text-[11px] text-emerald-300/70">
                  {state.totalParticipants > 0 ? Math.round((state.revealedCount / state.totalParticipants) * 100) : 0}% gifts opened
                </p>
              </div>

              {/* Card 4: Registered Devices */}
              <div className="christmas-glass-card rounded-2xl p-5 border border-amber-500/20 bg-[#071d13]/80 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-sky-300 uppercase">
                    Registered Devices
                  </span>
                  <Smartphone className="h-4 w-4 text-sky-400" />
                </div>
                <p className="mt-2 text-3xl sm:text-4xl font-extrabold text-sky-300">
                  {state.registeredDevicesCount}
                </p>
                <p className="mt-1 text-[11px] text-sky-200/70">Bound hardware identifiers</p>
              </div>
            </div>

            {/* ===============================================================
                2. DRAW MANAGEMENT SECTION
               =============================================================== */}
            <div className="rounded-3xl border border-amber-500/30 bg-[#071d13]/90 p-6 shadow-2xl backdrop-blur-md">
              <div className="flex items-center gap-2.5 pb-4 border-b border-amber-500/20">
                <Dices className="h-5 w-5 text-amber-400" />
                <h3 className="font-serif text-lg font-bold text-white tracking-wide">
                  Draw Management
                </h3>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Action 1: Full Event Reset */}
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-[#0a1e12] to-[#040f09] p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-serif text-base font-bold text-white">
                        Full Event Reset
                      </h4>
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-950/80 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 uppercase tracking-wider">
                        Preserves Draw
                      </span>
                    </div>
                    <p className="text-xs text-emerald-200/90 leading-relaxed">
                      Reset all participant PINs, reveal statuses, and device locks while keeping assignments 100% intact.
                    </p>
                    <p className="mt-2 text-[11px] text-emerald-300/60 leading-normal">
                      Creates an automatic backup. Clears all registrations and unlocks all devices without re-drawing or altering pairings.
                    </p>
                  </div>

                  <div className="mt-5 pt-3 border-t border-emerald-500/20 flex justify-end">
                    <button
                      onClick={() => setActiveModal("FULL_RESET")}
                      className="flex items-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-700 hover:bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:scale-[1.02] cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Full Event Reset</span>
                    </button>
                  </div>
                </div>

                {/* Action 2: Regenerate Full Draw */}
                <div className="rounded-2xl border border-red-500/30 bg-gradient-to-b from-[#190a0d] to-[#0d0406] p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-serif text-base font-bold text-white">
                        Regenerate Full Draw
                      </h4>
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/50 bg-red-950/80 px-2.5 py-0.5 text-[10px] font-bold text-red-300 uppercase tracking-wider">
                        Re-draws all
                      </span>
                    </div>
                    <p className="text-xs text-red-200/90 leading-relaxed">
                      Re-randomize assignments for all participants while strictly adhering to all rules.
                    </p>
                    <p className="mt-2 text-[11px] text-red-300/60 leading-normal">
                      Creates an automatic backup. Regenerates assignments for all {state.totalParticipants} participants with all mandatory constraints.
                    </p>
                  </div>

                  <div className="mt-5 pt-3 border-t border-red-500/20 flex justify-end">
                    <button
                      onClick={() => setActiveModal("FULL_REGENERATE")}
                      className="flex items-center gap-2 rounded-xl border border-red-500/50 bg-red-900/80 px-4 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-red-800 hover:scale-[1.02] cursor-pointer"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Regenerate Full Draw</span>
                    </button>
                  </div>
                </div>

                {/* Action 3: Reroll Subgroup */}
                <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-[#18150a] to-[#0d0b04] p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-serif text-base font-bold text-white">
                        Reroll Designated Subgroup
                      </h4>
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-950/80 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 uppercase tracking-wider">
                        Subgroup Only
                      </span>
                    </div>
                    <p className="text-xs text-amber-200/90 leading-relaxed">
                      Reroll the designated 24-person group only, leaving the assignments of the other participants unchanged.
                    </p>
                    <p className="mt-2 text-[11px] text-amber-300/60 leading-normal">
                      Creates an automatic backup. Rerolls the closed subgroup with all mandatory constraints while preserving the other assignments.
                    </p>
                  </div>

                  <div className="mt-5 pt-3 border-t border-amber-500/20 flex justify-end">
                    <button
                      onClick={() => setActiveModal("REROLL_SUBGROUP")}
                      className="flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-600 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg transition-all hover:bg-amber-500 hover:scale-[1.02] cursor-pointer"
                    >
                      <Dices className="h-3.5 w-3.5" />
                      <span>Reroll Subgroup</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ===============================================================
                3. DEVICE MANAGEMENT & REVEAL TELEMETRY SECTION
               =============================================================== */}
            <div className="rounded-3xl border border-amber-500/30 bg-[#071d13]/90 p-6 shadow-2xl backdrop-blur-md">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-amber-500/20 gap-3">
                <div className="flex items-center gap-2.5">
                  <Smartphone className="h-5 w-5 text-sky-400" />
                  <div>
                    <h3 className="font-serif text-lg font-bold text-white tracking-wide">
                      Device Management & Reveal Telemetry
                    </h3>
                    <p className="text-xs text-sky-200/80">
                      Real-time device tracking: Inspect bound devices, operating systems, IP addresses, and exact timestamps of participants who opened their gift.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-950/60 px-3 py-1 text-xs font-semibold text-sky-300">
                    <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                    <span>{state.devices?.length || 0} Registered Devices</span>
                  </span>
                </div>
              </div>

              {/* Reset Devices Action Box */}
              <div className="mt-6 rounded-2xl border border-sky-500/30 bg-gradient-to-b from-[#0a1820] to-[#040c11] p-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2.5 mb-2">
                      <h4 className="font-serif text-base font-bold text-white">
                        Reset All Device Bindings
                      </h4>
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/50 bg-sky-950/80 px-2.5 py-0.5 text-[10px] font-bold text-sky-300 uppercase tracking-wider">
                        Requires confirmation
                      </span>
                    </div>
                    <p className="text-xs text-sky-200/90 leading-relaxed max-w-2xl">
                      Unlink registered devices so participants can log in again.
                    </p>
                    <p className="mt-1.5 text-[11px] text-emerald-300/80 max-w-2xl">
                      🛡️ <strong>Separated Operations:</strong> Unlinking devices does not delete participant PINs, regenerate the draw, or alter reveal statuses. It only frees locked devices so participants can log in from a new device when necessary.
                    </p>
                  </div>

                  <button
                    onClick={() => setActiveModal("RESET_DEVICES")}
                    className="shrink-0 flex items-center gap-2 rounded-xl border border-sky-500/50 bg-sky-900/80 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-sky-800 hover:scale-[1.02] cursor-pointer"
                  >
                    <Smartphone className="h-3.5 w-3.5" />
                    <span>Reset All Device Bindings</span>
                  </button>
                </div>
              </div>

              {/* Devices Table Header & Filters */}
              <div className="mt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-amber-400" />
                  <h4 className="text-sm font-bold text-amber-200">
                    Device Activity & Reveal Registry
                  </h4>
                  <span className="text-xs text-emerald-300/60 font-mono">
                    ({filteredDevices.length} matching)
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  {/* Status Filter Tabs */}
                  <div className="flex rounded-xl border border-amber-500/25 bg-[#05170e] p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setDeviceFilter("ALL")}
                      className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                        deviceFilter === "ALL"
                          ? "bg-amber-500 text-slate-950 font-bold shadow"
                          : "text-emerald-200/70 hover:text-white"
                      }`}
                    >
                      All ({state.devices?.length || 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceFilter("REVEALED")}
                      className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                        deviceFilter === "REVEALED"
                          ? "bg-emerald-500 text-slate-950 font-bold shadow"
                          : "text-emerald-200/70 hover:text-white"
                      }`}
                    >
                      <span>🎁 Opened ({state.devices?.filter((d) => d.hasRevealed).length || 0})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceFilter("UNREVEALED")}
                      className={`px-3 py-1 rounded-lg font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                        deviceFilter === "UNREVEALED"
                          ? "bg-amber-400 text-slate-950 font-bold shadow"
                          : "text-emerald-200/70 hover:text-white"
                      }`}
                    >
                      <span>⏳ Unopened ({state.devices?.filter((d) => !d.hasRevealed).length || 0})</span>
                    </button>
                  </div>

                  {/* Device Search Filter */}
                  <input
                    type="text"
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    placeholder="Search device, name, IP..."
                    className="w-full sm:w-56 rounded-xl border border-amber-500/30 bg-[#0a2618] px-3 py-1.5 text-xs text-white placeholder-emerald-400/40 focus:border-amber-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Devices Telemetry Table */}
              <div className="mt-4 overflow-x-auto rounded-2xl border border-amber-500/20 bg-[#05170e]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-amber-500/20 text-amber-300">
                      <th className="py-2.5 px-3 font-semibold uppercase">Participant</th>
                      <th className="py-2.5 px-3 font-semibold uppercase">Device & Browser</th>
                      <th className="py-2.5 px-3 font-semibold uppercase">Client IP</th>
                      <th className="py-2.5 px-3 font-semibold uppercase">Gift Reveal Status</th>
                      <th className="py-2.5 px-3 font-semibold uppercase">Reveal Time</th>
                      <th className="py-2.5 px-3 font-semibold uppercase">First Bound</th>
                      <th className="py-2.5 px-3 font-semibold uppercase">Device ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/60">
                    {filteredDevices.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-xs text-emerald-300/60">
                          {state.devices && state.devices.length > 0
                            ? "No devices match your search filter."
                            : "No devices connected yet. When participants log in or open gifts, their device details and timestamps will appear here automatically."}
                        </td>
                      </tr>
                    ) : (
                      filteredDevices.map((dev) => (
                        <tr key={dev.deviceId} className="transition-colors hover:bg-emerald-950/30">
                          <td className="py-3 px-3 font-medium text-white">
                            <div className="flex items-center gap-2">
                              <span className="text-base">👤</span>
                              <span className="font-semibold text-sm">{dev.participantName}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-amber-200">
                              {dev.summary || `${dev.deviceModel || "Device"} • ${dev.browser || "Browser"}`}
                            </div>
                            <div className="text-[10px] text-emerald-400/60 truncate max-w-xs" title={dev.userAgent}>
                              {dev.os} • {dev.deviceModel}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-emerald-300/80">
                            {dev.ip || "unknown"}
                          </td>
                          <td className="py-3 px-3">
                            {dev.hasRevealed ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                                <span className="text-xs">🎁</span>
                                <span>Revealed Gift</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/40 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
                                <span>⏳</span>
                                <span>Connected (Unopened)</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-emerald-300/80">
                            {dev.revealedAt ? new Date(dev.revealedAt).toLocaleString() : "—"}
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-emerald-300/60">
                            {new Date(dev.boundAt).toLocaleString()}
                          </td>
                          <td className="py-3 px-3 font-mono text-[10px] text-emerald-400/50">
                            {dev.deviceId.slice(0, 8)}...{dev.deviceId.slice(-4)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ===============================================================
                4. SECURITY & AUDIT SECTION
               =============================================================== */}
            <div className="rounded-3xl border border-amber-500/30 bg-[#071d13]/90 p-6 shadow-2xl backdrop-blur-md">
              <div className="flex items-center gap-2.5 pb-4 border-b border-amber-500/20">
                <Activity className="h-5 w-5 text-amber-400" />
                <h3 className="font-serif text-lg font-bold text-white tracking-wide">
                  Security & Audit
                </h3>
              </div>

              {/* Status & Timestamps Grid */}
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-emerald-500/30 bg-[#0a2618]/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300 uppercase">
                    <Database className="h-3.5 w-3.5" />
                    <span>Database / Storage Health</span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{state.storageHealth.status}</span>
                    <span className="text-[11px] text-emerald-200/60 font-normal">({state.storageHealth.latencyMs}ms)</span>
                  </p>
                  <p className="mt-1 text-[10px] text-emerald-300/60 truncate" title={state.storageHealth.provider}>
                    {state.storageHealth.provider}
                  </p>
                </div>

                <div className="rounded-2xl border border-amber-500/30 bg-[#161a0d]/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 uppercase">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Last Draw Generated</span>
                  </div>
                  <p className="mt-2 text-xs font-bold text-white">
                    {state.lastDrawGeneratedAt ? new Date(state.lastDrawGeneratedAt).toLocaleString() : "Initial setup"}
                  </p>
                  <p className="mt-1 text-[10px] text-amber-300/60">Cryptographic CSPRNG</p>
                </div>

                <div className="rounded-2xl border border-amber-500/30 bg-[#161a0d]/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 uppercase">
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Last Reset Operation</span>
                  </div>
                  <p className="mt-2 text-xs font-bold text-white">
                    {state.lastResetAt ? new Date(state.lastResetAt).toLocaleString() : "None"}
                  </p>
                  <p className="mt-1 text-[10px] text-amber-300/60">Recorded in audit ledger</p>
                </div>

                <div className="rounded-2xl border border-sky-500/30 bg-[#0d1820]/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-300 uppercase">
                    <Smartphone className="h-3.5 w-3.5" />
                    <span>Active Device Locks</span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-sky-300">
                    {state.registeredDevicesCount} bound device(s)
                  </p>
                  <p className="mt-1 text-[10px] text-sky-300/60">Strict 1:1 participant isolation</p>
                </div>
              </div>

              {/* Audit Ledger Table */}
              <div className="mt-8">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-amber-200 flex items-center gap-2">
                    <History className="h-4 w-4 text-amber-400" />
                    <span>Administrative Activity & Login Audit Ledger</span>
                  </h4>
                  <span className="text-[11px] text-emerald-300/60">
                    {state.auditLogs.length} entries recorded
                  </span>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-amber-500/20 bg-[#05170e]">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-amber-500/20 text-amber-300">
                        <th className="py-2.5 px-3 font-semibold uppercase">Action</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Status</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Timestamp</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Operator IP</th>
                        <th className="py-2.5 px-3 font-semibold uppercase">Details & Backup Ref</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-950/60">
                      {state.auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-xs text-emerald-300/60">
                            No administrative operations logged yet.
                          </td>
                        </tr>
                      ) : (
                        state.auditLogs.slice(0, 15).map((log) => (
                          <tr key={log.id} className="transition-colors hover:bg-emerald-950/30">
                            <td className="py-2.5 px-3 font-medium text-white">
                              <span className="font-semibold text-xs">{log.actionLabel}</span>
                              <span className="block text-[10px] text-emerald-400/60 font-mono">
                                {log.action}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              {log.status === "SUCCESS" ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                  SUCCESS
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-950/60 px-2 py-0.5 text-[10px] font-bold text-red-300">
                                  FAILED
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-emerald-300/80 font-mono text-[11px]">
                              {new Date(log.timestamp).toLocaleString()}
                            </td>
                            <td className="py-2.5 px-3 text-emerald-300/60 font-mono text-[11px]">
                              {log.ip}
                            </td>
                            <td className="py-2.5 px-3 text-emerald-200/90 text-[11px]">
                              {log.details}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* ===============================================================
                5. PARTICIPANT STATUS & REGISTRATION DIRECTORY
               =============================================================== */}
            <div className="rounded-3xl border border-amber-500/30 bg-[#071d13]/90 p-6 shadow-2xl backdrop-blur-md">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-amber-500/20">
                <div>
                  <h3 className="font-serif text-lg font-bold text-white">
                    Participant Registration & Status Directory
                  </h3>
                  <p className="mt-0.5 text-xs text-emerald-200/80">
                    Live overview of all {state.totalParticipants} participants and their personal registration progress.
                  </p>
                </div>

                {/* Filter Input */}
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter participant name..."
                  className="w-full sm:w-64 rounded-xl border border-amber-500/30 bg-[#0a2618] px-3.5 py-2 text-xs text-white placeholder-emerald-400/40 focus:border-amber-400 focus:outline-none"
                />
              </div>

              {/* Table */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-amber-500/20 text-amber-300">
                      <th className="py-3 px-3 font-semibold uppercase">Participant</th>
                      <th className="py-3 px-3 font-semibold uppercase">Device & Network</th>
                      <th className="py-3 px-3 font-semibold uppercase">PIN Registration</th>
                      <th className="py-3 px-3 font-semibold uppercase">Gift Reveal</th>
                      <th className="py-3 px-3 font-semibold uppercase">Reveal Timestamp</th>
                      <th className="py-3 px-3 font-semibold uppercase text-right">Reset Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/60">
                    {filteredParticipants.map((p) => {
                      return (
                        <tr key={p.id} className="transition-colors hover:bg-emerald-950/40">
                          <td className="py-3.5 px-3 font-medium text-white">
                            <div className="flex items-center gap-2">
                              <span className="text-base">👤</span>
                              <span className="font-semibold text-sm">{p.name}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-3">
                            {p.deviceSummary ? (
                              <div>
                                <div className="text-xs font-semibold text-sky-200">
                                  {p.deviceSummary}
                                </div>
                                <div className="text-[10px] text-sky-400/60 font-mono">
                                  IP: {p.deviceIp || "unknown"}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[11px] text-emerald-300/40 font-mono">
                                — Not Connected
                              </span>
                            )}
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
                                <span>Awaiting Registration</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-3">
                            {p.isRevealed ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                                <Eye className="h-3 w-3" />
                                <span>Revealed</span>
                              </span>
                            ) : (
                              <span className="text-emerald-300/50 text-[11px]">Unopened</span>
                            )}
                          </td>
                          <td className="py-3.5 px-3 text-emerald-300/70 font-mono text-[11px]">
                            {p.revealedAt ? new Date(p.revealedAt).toLocaleString() : "—"}
                          </td>
                          <td className="py-3.5 px-3 text-right">
                            {(p.isRegistered || p.isRevealed || p.deviceSummary) ? (
                              <button
                                onClick={() => setResetParticipantTarget(p)}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-950/50 hover:bg-red-900/80 px-2.5 py-1 text-[11px] font-medium text-red-200 transition-colors cursor-pointer"
                                title={`Reset ${p.name} only`}
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>Reset User</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-emerald-300/30 font-mono">— Clean</span>
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

        {/* ===================================================================
            CONFIRMATION MODALS (FOR DESTRUCTIVE & SENSITIVE ACTIONS)
           =================================================================== */}
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
            <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-amber-500/40 bg-[#071d13] p-6 shadow-2xl">
              <button
                onClick={() => setActiveModal(null)}
                disabled={isActionSubmitting}
                className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full border border-amber-500/30 bg-[#0d2a1c] text-amber-300 hover:bg-red-950/80 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>

              {/* MODAL 1: FULL REGENERATE */}
              {activeModal === "FULL_REGENERATE" && (
                <div>
                  <div className="flex items-center gap-3 text-red-400 mb-3">
                    <div className="p-3 rounded-2xl border border-red-500/40 bg-red-950/80">
                      <AlertTriangle className="h-6 w-6 text-red-400" />
                    </div>
                    <div>
                      <h3 className="font-serif text-lg font-bold text-white">
                        Confirm Full Draw Regeneration
                      </h3>
                      <p className="text-xs text-red-300/80">Destructive action requiring explicit confirmation</p>
                    </div>
                  </div>

                  <div className="my-4 space-y-2.5 text-xs text-emerald-100/90 leading-relaxed rounded-2xl border border-red-500/30 bg-red-950/30 p-4">
                    <p>• <strong>Encrypted Backup:</strong> An automated backup is created immediately before any modifications to the draw.</p>
                    <p>• <strong>Full Redistribution:</strong> Regenerates pairing assignments for all {state?.totalParticipants || 56} participants while adhering strictly to all constraints (subgroups, Ghazal ⇄ George, Zeina ⇎ Hamza, and Raghad ⇎ Mohammad).</p>
                    <p>• <strong>Round Reset:</strong> Starts a new round with an incremented version number; reveals reset to 0 so participants can set a fresh PIN.</p>
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      disabled={isActionSubmitting}
                      className="rounded-xl border border-emerald-700/40 bg-emerald-950/70 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => executeAction("FULL_REGENERATE")}
                      disabled={isActionSubmitting}
                      className="flex items-center gap-2 rounded-xl border border-red-500 bg-red-700 hover:bg-red-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                    >
                      {isActionSubmitting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Regenerating draw...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Confirm Full Draw Regeneration</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* MODAL 2: REROLL SUBGROUP 20 */}
              {activeModal === "REROLL_SUBGROUP" && (
                <div>
                  <div className="flex items-center gap-3 text-amber-400 mb-3">
                    <div className="p-3 rounded-2xl border border-amber-500/40 bg-amber-950/80">
                      <Dices className="h-6 w-6 text-amber-300" />
                    </div>
                    <div>
                      <h3 className="font-serif text-lg font-bold text-white">
                        Confirm Designated Subgroup Reroll
                      </h3>
                      <p className="text-xs text-amber-300/80">Assignments for participants outside this subgroup remain untouched</p>
                    </div>
                  </div>

                  <div className="my-4 space-y-2.5 text-xs text-emerald-100/90 leading-relaxed rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4">
                    <p>• <strong>Automatic Backup:</strong> An immediate, complete backup of the current state is stored before changes.</p>
                    <p>• <strong>Designated Group Only:</strong> Only the 24 subgroup names are rerolled, adhering strictly to constraints (Ghazal ⇄ George, Zeina ⇎ Hamza, Raghad ⇎ Mohammad).</p>
                    <p>• <strong>Preservation:</strong> Assignments for all other participants remain 100% byte-for-byte identical.</p>
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      disabled={isActionSubmitting}
                      className="rounded-xl border border-emerald-700/40 bg-emerald-950/70 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => executeAction("REROLL_SUBGROUP")}
                      disabled={isActionSubmitting}
                      className="flex items-center gap-2 rounded-xl border border-amber-400 bg-amber-500 hover:bg-amber-400 px-5 py-2.5 text-xs font-bold text-slate-950 shadow-lg transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                    >
                      {isActionSubmitting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Rerolling subgroup...</span>
                        </>
                      ) : (
                        <>
                          <Dices className="h-3.5 w-3.5" />
                          <span>Confirm 20-Person Subgroup Reroll</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* MODAL 3: RESET DEVICES */}
              {activeModal === "RESET_DEVICES" && (
                <div>
                  <div className="flex items-center gap-3 text-sky-400 mb-3">
                    <div className="p-3 rounded-2xl border border-sky-500/40 bg-sky-950/80">
                      <Smartphone className="h-6 w-6 text-sky-300" />
                    </div>
                    <div>
                      <h3 className="font-serif text-lg font-bold text-white">
                        Reset Registered Device Bindings
                      </h3>
                      <p className="text-xs text-sky-300/80">Release bound devices without affecting participant accounts</p>
                    </div>
                  </div>

                  <div className="my-4 space-y-2.5 text-xs text-emerald-100/90 leading-relaxed rounded-2xl border border-sky-500/30 bg-sky-950/30 p-4">
                    <p>• <strong>Device Unlock:</strong> Immediately unlinks all currently registered devices.</p>
                    <p>• <strong>Data Preservation:</strong> Does not delete any PINs, does not alter the draw, and leaves reveal statuses intact.</p>
                    <p>• <strong>Immediate Re-entry:</strong> Any participant who changed their phone or cleared browser data can log in again using their existing PIN.</p>
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      disabled={isActionSubmitting}
                      className="rounded-xl border border-emerald-700/40 bg-emerald-950/70 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => executeAction("RESET_DEVICES")}
                      disabled={isActionSubmitting}
                      className="flex items-center gap-2 rounded-xl border border-sky-400 bg-sky-600 hover:bg-sky-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                    >
                      {isActionSubmitting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Resetting device bindings...</span>
                        </>
                      ) : (
                        <>
                          <Smartphone className="h-3.5 w-3.5" />
                          <span>Confirm Device Reset</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* MODAL 4: FULL EVENT RESET */}
              {activeModal === "FULL_RESET" && (
                <div>
                  <div className="flex items-center gap-3 text-emerald-400 mb-3">
                    <div className="p-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/80">
                      <RotateCcw className="h-6 w-6 text-emerald-300" />
                    </div>
                    <div>
                      <h3 className="font-serif text-lg font-bold text-white">
                        Confirm Full Event Reset
                      </h3>
                      <p className="text-xs text-emerald-300/80">Clear PINs and device locks while keeping assignments 100% intact</p>
                    </div>
                  </div>

                  <div className="my-4 space-y-2.5 text-xs text-emerald-100/90 leading-relaxed rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4">
                    <p>• <strong>Automatic Backup:</strong> An automated timestamped backup is created immediately before any changes.</p>
                    <p>• <strong>Zero Data Loss:</strong> Secret Santa pairings and all rules (Maysoon ➔ Qais, Diana ➔ Mohammad, Ghazal ⇄ George, etc.) remain 100% untouched.</p>
                    <p>• <strong>Fresh Start:</strong> Clears all registered participant PINs, resets reveals to 0, and unlinks all bound devices.</p>
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveModal(null)}
                      disabled={isActionSubmitting}
                      className="rounded-xl border border-emerald-700/40 bg-emerald-950/70 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-900 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => executeAction("FULL_RESET")}
                      disabled={isActionSubmitting}
                      className="flex items-center gap-2 rounded-xl border border-emerald-400 bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                    >
                      {isActionSubmitting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                          <span>Resetting event...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Confirm Full Event Reset</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================================================================
            CHANGE ORGANIZER PASSWORD MODAL (Apple Keychain & Touch ID Ready)
           =================================================================== */}
        {showPasswordModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
              onClick={() => !isUpdatingPassword && setShowPasswordModal(false)}
            />
            <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-500/40 bg-gradient-to-b from-[#0a2618] to-[#040f09] p-6 shadow-2xl z-10 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-amber-500/20">
                <div className="flex items-center gap-2 text-amber-300">
                  <Lock className="h-5 w-5" />
                  <h3 className="font-serif text-lg font-bold text-white">Change Master Password</h3>
                </div>
                <button
                  onClick={() => setShowPasswordModal(false)}
                  disabled={isUpdatingPassword}
                  className="rounded-lg p-1 text-emerald-300 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form method="POST" onSubmit={handleChangeAdminPassword} autoComplete="on" className="mt-5 space-y-4">
                <input
                  type="text"
                  name="username"
                  id="admin-username-change"
                  autoComplete="username"
                  defaultValue="Organizer"
                  readOnly
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                />

                <div>
                  <label className="block text-xs font-medium text-amber-200 mb-1">
                    New Master Password:
                  </label>
                  <input
                    type="password"
                    name="new-password"
                    id="new-password"
                    autoComplete="new-password"
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    placeholder="Enter new password (min 6 characters)..."
                    required
                    autoFocus
                    className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] px-4 py-2.5 text-sm text-white placeholder-emerald-400/40 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-amber-200 mb-1">
                    Confirm New Password:
                  </label>
                  <input
                    type="password"
                    name="confirm-password"
                    id="confirm-password"
                    autoComplete="new-password"
                    value={confirmAdminPassword}
                    onChange={(e) => setConfirmAdminPassword(e.target.value)}
                    placeholder="Confirm new password..."
                    required
                    className="w-full rounded-2xl border border-amber-500/40 bg-[#071d13] px-4 py-2.5 text-sm text-white placeholder-emerald-400/40 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  />
                </div>

                {passwordFeedback && (
                  <div
                    className={`rounded-xl border p-3 text-xs ${
                      passwordFeedback.type === "success"
                        ? "border-emerald-400/50 bg-emerald-950/80 text-emerald-200"
                        : "border-red-400/50 bg-red-950/80 text-red-200"
                    }`}
                  >
                    {passwordFeedback.text}
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowPasswordModal(false)}
                    disabled={isUpdatingPassword}
                    className="rounded-xl border border-emerald-700/40 bg-emerald-950/70 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdatingPassword || !newAdminPassword || !confirmAdminPassword}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-400/50 bg-amber-500 hover:bg-amber-400 px-5 py-2 text-xs font-bold text-slate-950 shadow-md transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                  >
                    {isUpdatingPassword ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Updating...</span>
                      </>
                    ) : (
                      <span>Save Password</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ===================================================================
            PASSKEY MANAGEMENT MODAL (Touch ID / Face ID)
           =================================================================== */}
        {showPasskeyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
              onClick={() => setShowPasskeyModal(false)}
            />
            <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-500/40 bg-gradient-to-b from-[#0a2618] to-[#040f09] p-6 shadow-2xl z-10 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                <div className="flex items-center gap-2 text-emerald-300">
                  <Fingerprint className="h-5 w-5 text-amber-300" />
                  <h3 className="font-serif text-lg font-bold text-white">إدارة البصمات (Passkeys)</h3>
                </div>
                <button
                  onClick={() => setShowPasskeyModal(false)}
                  className="rounded-lg p-1 text-emerald-300 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 space-y-4">
                <p className="text-xs text-emerald-200/80">
                  الأجهزة المصرّح لها بالدخول إلى لوحة التحكم عبر بصمة الإصبع (Apple Touch ID / Face ID). يمكنك تسجيل بصمة جديدة لأي جهاز أو حذف بصمة قديمة.
                </p>

                {registeredPasskeys.length === 0 ? (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4 text-center">
                    <p className="text-xs text-amber-200">لا توجد بصمات مسجلة حالياً على هذا الخادم.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-emerald-950/80 rounded-2xl border border-emerald-500/20 bg-[#061910] overflow-hidden">
                    {registeredPasskeys.map((pk) => (
                      <div key={pk.id} className="p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            <Fingerprint className="h-5 w-5 text-amber-300" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-white">{pk.label}</p>
                            <p className="text-[10px] text-emerald-300/60 font-mono">
                              أضيفت في: {new Date(pk.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeletePasskey(pk.id)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/30 bg-red-950/40 hover:bg-red-900/60 text-red-300 transition-colors cursor-pointer"
                          title="حذف هذه البصمة"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-2 flex justify-between gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowPasskeyModal(false)}
                    className="rounded-xl border border-emerald-700/40 bg-emerald-950/70 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-900 cursor-pointer"
                  >
                    إغلاق
                  </button>

                  <button
                    onClick={() => handleRegisterPasskey("Mac Touch ID")}
                    disabled={isPasskeyLoading}
                    className="flex items-center gap-2 rounded-xl border border-amber-400/80 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                  >
                    <Fingerprint className="h-4 w-4 text-amber-300" />
                    <span>{isPasskeyLoading ? "جاري التسجيل..." : "+ تسجيل بصمة جهاز إضافي"}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================================================================
            INDIVIDUAL PARTICIPANT RESET CONFIRMATION MODAL
           =================================================================== */}
        {resetParticipantTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
              onClick={() => !isResettingParticipant && setResetParticipantTarget(null)}
            />
            <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-red-500/40 bg-gradient-to-b from-[#190a0d] to-[#0d0406] p-6 shadow-2xl z-10 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3 pb-3 border-b border-red-500/20 text-red-300">
                <AlertTriangle className="h-6 w-6 text-red-400 shrink-0" />
                <h3 className="font-serif text-lg font-bold text-white">إعادة ضبط العضو فقط</h3>
              </div>

              <div className="mt-4 space-y-3">
                <p className="text-xs text-red-100">
                  هل أنت متأكد من رغبتك في إعادة ضبط العضو:{" "}
                  <strong className="text-amber-300 text-sm block mt-1">
                    {resetParticipantTarget.name}
                  </strong>
                </p>

                <div className="rounded-xl border border-amber-500/30 bg-amber-950/40 p-3 text-[11px] text-amber-200/90 space-y-1">
                  <p>• سيتم مسح رمز الـ PIN وحالة الفتح لهذا العضو فقط.</p>
                  <p>• سيتم فك قفل الجهاز المرتبط به ليتمكن من الدخول مجدداً.</p>
                  <p className="font-bold text-emerald-300">• القرعة والهدية المخصصة له تبقى محفوظة 100% دون أي تغيير.</p>
                </div>

                <div className="pt-3 flex justify-end gap-2.5 border-t border-red-500/20">
                  <button
                    type="button"
                    onClick={() => setResetParticipantTarget(null)}
                    disabled={isResettingParticipant}
                    className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    إلغاء
                  </button>

                  <button
                    type="button"
                    onClick={handleResetSingleParticipant}
                    disabled={isResettingParticipant}
                    className="flex items-center gap-1.5 rounded-xl border border-red-500/50 bg-red-800 hover:bg-red-700 px-5 py-2 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer disabled:opacity-50"
                  >
                    {isResettingParticipant ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>جاري إعادة الضبط...</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>تأكيد إعادة ضبط هذا العضو</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
