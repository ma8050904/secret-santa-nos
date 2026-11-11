"use client";

import { getCachedHardwareFingerprint, getHardwareFingerprint } from "./fingerprint";

const DEVICE_STORAGE_KEY = "santa_device_v7_clean_id";
const LEGACY_STORAGE_KEY = "santa_device_id";

/**
 * Validates whether a string matches a standard UUID v4 format.
 */
export function isValidUUID(id: string | null | undefined): boolean {
  if (!id || typeof id !== "string") return false;
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return regex.test(id.trim());
}

/**
 * Generates a cryptographically strong UUID v4 on the client.
 */
export function generateClientDeviceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback
    }
  }

  // Fallback using crypto.getRandomValues
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  // Pure Math.random fallback (last resort)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Retrieves the persistent device identifier from browser storage or generates a new one.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") {
    return generateClientDeviceId();
  }

  // Clear legacy storage key from test sessions
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }

  try {
    const stored = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (stored && isValidUUID(stored)) {
      return stored.trim();
    }
  } catch {
    // LocalStorage might be disabled in private mode
  }

  const newId = generateClientDeviceId();
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, newId);
  } catch {
    // ignore
  }

  return newId;
}

/**
 * Returns request headers containing the device identifier and hardware fingerprint.
 */
export function getDeviceHeaders(): Record<string, string> {
  const deviceId = getOrCreateDeviceId();
  const hwFp = getCachedHardwareFingerprint();
  return {
    "x-device-id": deviceId,
    ...(hwFp ? { "x-hardware-fingerprint": hwFp } : {}),
  };
}

/**
 * Returns request headers ensuring the hardware fingerprint is computed asynchronously if not already cached.
 */
export async function getAsyncDeviceHeaders(): Promise<Record<string, string>> {
  const deviceId = getOrCreateDeviceId();
  let hwFp = getCachedHardwareFingerprint();
  if (!hwFp) {
    try {
      hwFp = await getHardwareFingerprint();
    } catch {
      // fallback
    }
  }
  return {
    "x-device-id": deviceId,
    ...(hwFp ? { "x-hardware-fingerprint": hwFp } : {}),
  };
}

const BOUND_PARTICIPANT_KEY = "santa_bound_participant_v7";
const IDB_NAME = "santa_security_lock";
const IDB_STORE = "device_lock";

function openLockDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = window.indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function getStoredBoundParticipant(): { id: string; name: string } | null {
  if (typeof window === "undefined") return null;
  // 1. Check localStorage
  try {
    const raw = window.localStorage.getItem(BOUND_PARTICIPANT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  // 2. Check sessionStorage fallback
  try {
    const rawSession = window.sessionStorage.getItem(BOUND_PARTICIPANT_KEY);
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

export async function getAsyncStoredBoundParticipant(): Promise<{ id: string; name: string } | null> {
  const syncResult = getStoredBoundParticipant();
  if (syncResult) return syncResult;

  // 3. Check IndexedDB fallback
  try {
    const db = await openLockDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, "readonly");
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(BOUND_PARTICIPANT_KEY);
        req.onsuccess = () => {
          const val = req.result;
          if (val && typeof val.id === "string" && typeof val.name === "string") {
            // Re-populate localStorage & sessionStorage
            setStoredBoundParticipant(val);
            resolve(val);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

export function setStoredBoundParticipant(participant: { id: string; name: string } | null): void {
  if (typeof window === "undefined") return;
  const serialized = participant ? JSON.stringify({ id: participant.id, name: participant.name }) : null;

  // 1. localStorage
  try {
    if (!serialized) {
      window.localStorage.removeItem(BOUND_PARTICIPANT_KEY);
    } else {
      window.localStorage.setItem(BOUND_PARTICIPANT_KEY, serialized);
    }
  } catch {
    // ignore
  }

  // 2. sessionStorage
  try {
    if (!serialized) {
      window.sessionStorage.removeItem(BOUND_PARTICIPANT_KEY);
    } else {
      window.sessionStorage.setItem(BOUND_PARTICIPANT_KEY, serialized);
    }
  } catch {
    // ignore
  }

  // 3. IndexedDB
  openLockDB().then((db) => {
    if (!db) return;
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      if (!participant) {
        store.delete(BOUND_PARTICIPANT_KEY);
      } else {
        store.put(participant, BOUND_PARTICIPANT_KEY);
      }
    } catch {
      // ignore
    }
  }).catch(() => {});
}

export function clearStoredBoundParticipant(): void {
  setStoredBoundParticipant(null);
}

/**
 * Detects if the user is running inside an In-App browser (Instagram, WhatsApp, Telegram, Facebook)
 * where WebAuthn / Passkeys may not be natively supported or restricted by WebView sandbox.
 */
export function isInAppBrowser(): boolean {
  if (typeof window === "undefined" || !navigator.userAgent) return false;
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("instagram") ||
    ua.includes("fbav") ||
    ua.includes("fban") ||
    ua.includes("whatsapp") ||
    ua.includes("telegram") ||
    ua.includes("line/") ||
    ua.includes("micromessenger")
  );
}
