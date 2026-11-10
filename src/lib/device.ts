"use client";

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
 * Returns request headers containing the device identifier.
 */
export function getDeviceHeaders(): Record<string, string> {
  const deviceId = getOrCreateDeviceId();
  return {
    "x-device-id": deviceId,
  };
}

const BOUND_PARTICIPANT_KEY = "santa_bound_participant_v7";

export function getStoredBoundParticipant(): { id: string; name: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(BOUND_PARTICIPANT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function setStoredBoundParticipant(participant: { id: string; name: string } | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!participant) {
      window.localStorage.removeItem(BOUND_PARTICIPANT_KEY);
    } else {
      window.localStorage.setItem(
        BOUND_PARTICIPANT_KEY,
        JSON.stringify({ id: participant.id, name: participant.name })
      );
    }
  } catch {
    // ignore
  }
}

export function clearStoredBoundParticipant(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(BOUND_PARTICIPANT_KEY);
  } catch {
    // ignore
  }
}
