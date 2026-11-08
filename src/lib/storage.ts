import fs from "fs";
import path from "path";
import crypto from "crypto";
import { put, list, get, del } from "@vercel/blob";
import { PARTICIPANTS } from "./constants";
import { parseUserAgentDetails } from "./device-info";
import {
  generateChristmasPasscode,
  hashPasscode,
  hashPin,
  verifyPin,
  generateRandomSalt,
  encryptRecipient,
  decryptRecipient,
} from "./crypto";
import {
  generateConstrainedSecretSantaDraw,
  generateSubgroup20Pairs,
  validateConstrainedSecretSantaDraw,
  SUBGROUP_20_ID_SET,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  AssignmentPair,
} from "./derangement";

export interface StoredParticipant {
  id: string;
  name: string;
  code: string; // Original seed code for recovery & initial decryption
  codeHash: string; // Hash used for seed code
  encryptedRecipient: string | null; // AES-256-GCM encrypted recipient name
  isRevealed: boolean;
  revealedAt: string | null;
  // Personal PIN security fields
  pinHash?: string | null;
  pinSalt?: string | null;
  encryptedWithPin?: boolean;
}

export interface EventState {
  version: number;
  status: "uninitialized" | "ready" | "active" | "closed";
  createdAt: string;
  generatedAt: string | null;
  masterSalt: string;
  participants: StoredParticipant[];
}

export interface ParticipantRuntimeState {
  participantId: string;
  name: string;
  pinHash: string;
  pinSalt: string;
  encryptedRecipient: string; // AES-256-GCM encrypted with participant's personal PIN
  encryptedWithPin: boolean;
  isRevealed: boolean;
  revealedAt: string | null;
  registeredAt: string;
}

export interface DeviceBindingRecord {
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

// Storage path resolution: prioritize local project dir in development, fallback to /tmp in serverless
function getStorageFilePath(): string {
  if (process.env.STORAGE_FILE_PATH) {
    return process.env.STORAGE_FILE_PATH;
  }
  const localDir = path.join(process.cwd(), ".data");
  if (fs.existsSync(localDir) || !process.env.VERCEL) {
    try {
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      return path.join(localDir, "secret-santa-event.json");
    } catch {
      // Fall through to /tmp if local is read-only
    }
  }
  return path.join("/tmp", "secret-santa-event.json");
}

function getLocalParticipantDir(): string {
  const base = getStorageFilePath();
  const dir = path.join(path.dirname(base), "v7_participants");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore in read-only lambdas
    }
  }
  return dir;
}

function getLocalDeviceDir(): string {
  const base = getStorageFilePath();
  const dir = path.join(path.dirname(base), "v7_devices");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore in read-only lambdas
    }
  }
  return dir;
}

let inMemoryStateCache: EventState | null = null;
let inMemoryCacheTimestamp = 0;
const CACHE_TTL_MS = 4000;

const KNOWN_BLOB_BASE = "https://ygkog8lebahiid0k.private.blob.vercel-storage.com";
const KNOWN_BLOB_URL =
  process.env.BLOB_URL || `${KNOWN_BLOB_BASE}/secret-santa-event.json`;

let writeLock: Promise<void> = Promise.resolve();

// Concurrency-safe in-memory runtime caches
const runtimeParticipantCache = new Map<string, ParticipantRuntimeState>();
const deviceBindingCache = new Map<string, DeviceBindingRecord>();
const revealedParticipantIds = new Set<string>();
const registeredParticipantIds = new Set<string>();
let lastMarkersSyncTimestamp = 0;
const MARKERS_TTL_MS = 3000;

/**
 * Initializes a clean initial state with the exact 48 participants
 */
function createInitialState(): EventState {
  const masterSalt = crypto.randomBytes(16).toString("hex");
  const participants: StoredParticipant[] = PARTICIPANTS.map((p) => {
    const code = generateChristmasPasscode();
    const codeHash = hashPasscode(code, masterSalt);
    return {
      id: p.id,
      name: p.name,
      code,
      codeHash,
      encryptedRecipient: null,
      isRevealed: false,
      revealedAt: null,
      pinHash: null,
      pinSalt: null,
      encryptedWithPin: false,
    };
  });

  return {
    version: 7,
    status: "uninitialized",
    createdAt: new Date().toISOString(),
    generatedAt: null,
    masterSalt,
    participants,
  };
}

/**
 * Syncs lightweight revealed/registered markers from Vercel Blob / local disk
 */
async function syncMarkers(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastMarkersSyncTimestamp < MARKERS_TTL_MS) {
    return;
  }

  // 1. Cloud Blob sync (only when not running in isolated local test mode)
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const [revealedList, registeredList] = await Promise.all([
        list({ prefix: "v7/revealed/", token: process.env.BLOB_READ_WRITE_TOKEN }),
        list({ prefix: "v7/registered/", token: process.env.BLOB_READ_WRITE_TOKEN }),
      ]);

      for (const b of revealedList.blobs) {
        const id = b.pathname.replace("v7/revealed/", "");
        if (id) revealedParticipantIds.add(id);
      }
      for (const b of registeredList.blobs) {
        const id = b.pathname.replace("v7/registered/", "");
        if (id) registeredParticipantIds.add(id);
      }
      lastMarkersSyncTimestamp = now;
      return;
    } catch (err) {
      console.warn("Notice: Blob markers sync:", err);
    }
  }

  // 2. Local disk sync
  try {
    const localDir = path.dirname(getStorageFilePath());
    const revealedDir = path.join(localDir, "v7_revealed");
    const registeredDir = path.join(localDir, "v7_registered");

    if (fs.existsSync(revealedDir)) {
      const files = fs.readdirSync(revealedDir);
      for (const f of files) revealedParticipantIds.add(f);
    }
    if (fs.existsSync(registeredDir)) {
      const files = fs.readdirSync(registeredDir);
      for (const f of files) registeredParticipantIds.add(f);
    }
    lastMarkersSyncTimestamp = now;
  } catch {
    // ignore
  }
}

/**
 * Reads event state from persistent storage (Vercel Private Blob when available, or local filesystem)
 */
export async function getEventState(forceFresh = false): Promise<EventState> {
  const now = Date.now();
  if (!forceFresh && inMemoryStateCache && now - inMemoryCacheTimestamp < CACHE_TTL_MS) {
    return inMemoryStateCache;
  }

  // 1. Try reading from Vercel Private Blob store if configured (and not running in isolated local test mode)
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      let streamRes: any = null;
      try {
        streamRes = await get(`${KNOWN_BLOB_URL}?t=${now}`, {
          access: "private",
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      } catch {
        const listRes = await list({
          prefix: "secret-santa-event.json",
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        const blobInfo = listRes.blobs.find((b) => b.pathname === "secret-santa-event.json");
        if (blobInfo) {
          streamRes = await get(`${blobInfo.url}?t=${now}`, {
            access: "private",
            token: process.env.BLOB_READ_WRITE_TOKEN,
          });
        }
      }

      if (streamRes && streamRes.stream) {
        const text = await new Response(streamRes.stream).text();
        const parsed: EventState = JSON.parse(text);

        // Merge active markers into parsed state
        await syncMarkers();
        for (const p of parsed.participants) {
          if (revealedParticipantIds.has(p.id)) {
            p.isRevealed = true;
          }
          if (registeredParticipantIds.has(p.id)) {
            p.pinHash = p.pinHash || "registered_marker_present";
          }
        }

        inMemoryStateCache = parsed;
        inMemoryCacheTimestamp = Date.now();
        return parsed;
      }
    } catch (blobErr) {
      console.warn("Notice: Blob storage fetch attempt:", blobErr);
      if (inMemoryStateCache) {
        return inMemoryStateCache;
      }
    }
  }

  // 2. Fall back to local file storage
  const filePath = getStorageFilePath();
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      const data = await fs.promises.readFile(/*turbopackIgnore: true*/ filePath, "utf-8");
      const parsed: EventState = JSON.parse(data);

      await syncMarkers();
      for (const p of parsed.participants) {
        if (revealedParticipantIds.has(p.id)) {
          p.isRevealed = true;
        }
        if (registeredParticipantIds.has(p.id)) {
          p.pinHash = p.pinHash || "registered_marker_present";
        }
      }

      inMemoryStateCache = parsed;
      inMemoryCacheTimestamp = Date.now();
      return parsed;
    }
  } catch (err) {
    console.error("Warning: Failed to read from storage file:", err);
  }

  // In production with BLOB_READ_WRITE_TOKEN, NEVER auto-reinitialize or clobber existing draw!
  if (inMemoryStateCache) {
    return inMemoryStateCache;
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Temporary storage connection error. Please refresh the page.");
  }

  // Create default and persist ONLY in clean local development / test environments
  const initial = createInitialState();
  await saveEventState(initial);

  try {
    await generateAssignments(true);
    return await getEventState();
  } catch (err) {
    console.error("Auto-generate error on init:", err);
  }

  return initial;
}

/**
 * Atomically saves event state to persistent storage (Vercel Private Blob and local disk)
 */
export async function saveEventState(state: EventState): Promise<void> {
  inMemoryStateCache = state;
  inMemoryCacheTimestamp = Date.now();

  writeLock = writeLock.then(async () => {
    const serialized = JSON.stringify(state, null, 2);

    // 1. Persist to Vercel Private Blob if configured (and not in isolated test mode)
    if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
      try {
        await put("secret-santa-event.json", serialized, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      } catch (blobErr) {
        console.error("Critical: Failed to save state to Vercel Blob:", blobErr);
      }
    }

    // 2. Persist to local disk where writable
    try {
      const filePath = getStorageFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await fs.promises.writeFile(tempPath, serialized, "utf-8");
      await fs.promises.rename(tempPath, filePath);
    } catch {
      // In read-only serverless lambdas, local file write may be non-writable
    }
  });

  return writeLock;
}

/**
 * Reads an isolated participant's runtime state (dedicated blob / local file)
 */
export async function getParticipantRuntimeState(
  participantId: string
): Promise<ParticipantRuntimeState | null> {
  // Check in-memory runtime cache
  if (runtimeParticipantCache.has(participantId)) {
    return runtimeParticipantCache.get(participantId)!;
  }

  // 1. Check dedicated Vercel Blob for this participant (if not in isolated test mode)
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const url = `${KNOWN_BLOB_BASE}/v7/participants/${participantId}.json`;
      const res: any = await get(url, {
        access: "private",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      if (res && res.stream) {
        const text = await new Response(res.stream).text();
        const parsed: ParticipantRuntimeState = JSON.parse(text);
        runtimeParticipantCache.set(participantId, parsed);
        if (parsed.isRevealed) revealedParticipantIds.add(participantId);
        if (parsed.pinHash) registeredParticipantIds.add(participantId);
        return parsed;
      }
    } catch {
      // ignore blob fetch miss
    }
  }

  // 2. Check local dedicated participant file
  try {
    const localFile = path.join(getLocalParticipantDir(), `${participantId}.json`);
    if (fs.existsSync(localFile)) {
      const data = fs.readFileSync(localFile, "utf-8");
      const parsed: ParticipantRuntimeState = JSON.parse(data);
      runtimeParticipantCache.set(participantId, parsed);
      if (parsed.isRevealed) revealedParticipantIds.add(participantId);
      if (parsed.pinHash) registeredParticipantIds.add(participantId);
      return parsed;
    }
  } catch {
    // ignore
  }

  // 3. Fallback to check master state participant record
  const state = await getEventState();
  const p = state.participants.find((item) => item.id === participantId);
  if (p && p.pinHash && p.pinSalt && p.encryptedRecipient && p.encryptedWithPin) {
    const fromMaster: ParticipantRuntimeState = {
      participantId: p.id,
      name: p.name,
      pinHash: p.pinHash,
      pinSalt: p.pinSalt,
      encryptedRecipient: p.encryptedRecipient,
      encryptedWithPin: true,
      isRevealed: p.isRevealed,
      revealedAt: p.revealedAt,
      registeredAt: p.revealedAt || new Date().toISOString(),
    };
    runtimeParticipantCache.set(participantId, fromMaster);
    if (fromMaster.isRevealed) revealedParticipantIds.add(participantId);
    if (fromMaster.pinHash) registeredParticipantIds.add(participantId);
    return fromMaster;
  }

  return null;
}

/**
 * Saves an isolated participant's runtime state atomically and independently
 */
export async function saveParticipantRuntimeState(
  state: ParticipantRuntimeState
): Promise<void> {
  // Update in-memory caches
  runtimeParticipantCache.set(state.participantId, state);
  if (state.isRevealed) revealedParticipantIds.add(state.participantId);
  if (state.pinHash) registeredParticipantIds.add(state.participantId);

  // Sync to inMemoryStateCache if present
  if (inMemoryStateCache) {
    const match = inMemoryStateCache.participants.find((p) => p.id === state.participantId);
    if (match) {
      match.pinHash = state.pinHash;
      match.pinSalt = state.pinSalt;
      match.encryptedRecipient = state.encryptedRecipient;
      match.encryptedWithPin = true;
      match.isRevealed = state.isRevealed;
      match.revealedAt = state.revealedAt;
    }
  }

  const serialized = JSON.stringify(state, null, 2);

  // 1. Persist isolated blob to Vercel Blob (if not in isolated test mode)
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const promises: Promise<any>[] = [
        put(`v7/participants/${state.participantId}.json`, serialized, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }),
      ];

      // Lightweight markers for lightning-fast directory queries
      if (state.pinHash) {
        promises.push(
          put(`v7/registered/${state.participantId}`, "1", {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            token: process.env.BLOB_READ_WRITE_TOKEN,
          })
        );
      }
      if (state.isRevealed) {
        promises.push(
          put(`v7/revealed/${state.participantId}`, "1", {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            token: process.env.BLOB_READ_WRITE_TOKEN,
          })
        );
      }

      await Promise.all(promises);
    } catch (err) {
      console.error("Critical: Failed to save participant runtime blob:", err);
    }
  }

  // 2. Persist to local filesystem
  try {
    const dir = getLocalParticipantDir();
    const filePath = path.join(dir, `${state.participantId}.json`);
    const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    fs.writeFileSync(tempPath, serialized, "utf-8");
    fs.renameSync(tempPath, filePath);

    const localBaseDir = path.dirname(getStorageFilePath());
    if (state.pinHash) {
      const regDir = path.join(localBaseDir, "v7_registered");
      if (!fs.existsSync(regDir)) fs.mkdirSync(regDir, { recursive: true });
      fs.writeFileSync(path.join(regDir, state.participantId), "");
    }
    if (state.isRevealed) {
      const revDir = path.join(localBaseDir, "v7_revealed");
      if (!fs.existsSync(revDir)) fs.mkdirSync(revDir, { recursive: true });
      fs.writeFileSync(path.join(revDir, state.participantId), "");
    }
  } catch {
    // In read-only lambdas, local file writes may fail which is expected
  }
}

/**
 * Generates the Secret Santa assignments satisfying all Phase 3 constraints
 */
export async function generateAssignments(force = false): Promise<{
  success: boolean;
  message: string;
}> {
  const state = await getEventState();

  if (state.status === "active" && !force) {
    const revealedCount = state.participants.filter((p) => p.isRevealed).length;
    if (revealedCount > 0) {
      throw new Error(
        `Cannot regenerate draw: ${revealedCount} participant(s) have already revealed their secret gift!`
      );
    }
  }

  // Run constrained derangement
  const pairs = generateConstrainedSecretSantaDraw(PARTICIPANTS);

  // Map each pair to the participant's encrypted record
  for (const pair of pairs) {
    const participant = state.participants.find((p) => p.id === pair.giverId);
    if (!participant) {
      throw new Error(`Participant not found during assignment: ${pair.giverId}`);
    }

    // Encrypt the recipient's name using the participant's personal passcode and salt
    const encrypted = encryptRecipient(
      pair.recipientName,
      participant.code,
      state.masterSalt
    );

    participant.encryptedRecipient = encrypted;
    participant.isRevealed = false;
    participant.revealedAt = null;
    participant.pinHash = null;
    participant.pinSalt = null;
    participant.encryptedWithPin = false;
  }

  state.status = "active";
  state.version = 7;
  state.generatedAt = new Date().toISOString();
  runtimeParticipantCache.clear();
  revealedParticipantIds.clear();

  await saveEventState(state);

  return {
    success: true,
    message: "Constrained Secret Santa draw successfully generated for 48 participants.",
  };
}

/**
 * Authenticates with an existing PIN or establishes a personal PIN on first visit.
 * Highly concurrent: uses isolated per-participant storage to guarantee zero lost updates.
 */
export async function authenticateOrRegisterPin(
  participantId: string,
  rawPin: string
): Promise<{
  success: boolean;
  error?: string;
  isNewRegistration?: boolean;
  participant?: {
    id: string;
    name: string;
    isRevealed: boolean;
  };
  recipientName?: string;
}> {
  const pin = rawPin ? rawPin.trim() : "";
  if (!pin) {
    return { success: false, error: "Please enter your PIN." };
  }

  const masterState = await getEventState();
  const participant = masterState.participants.find((p) => p.id === participantId);

  if (!participant) {
    return { success: false, error: "Participant not found." };
  }

  // Load isolated participant runtime state
  const existingRuntime = await getParticipantRuntimeState(participantId);

  // CASE 1: Participant has ALREADY established a PIN
  if (existingRuntime && existingRuntime.pinHash && existingRuntime.pinSalt) {
    const isValid = verifyPin(pin, existingRuntime.pinHash, existingRuntime.pinSalt);
    if (!isValid) {
      return { success: false, error: "Incorrect PIN. Please try again." };
    }

    // Re-encrypt the new round recipient with this participant's verified PIN if not yet done for Round 6
    if (!existingRuntime.encryptedRecipient || !existingRuntime.encryptedWithPin) {
      try {
        const originalRecipient = decryptRecipient(
          participant.encryptedRecipient!,
          participant.code,
          masterState.masterSalt
        );
        existingRuntime.encryptedRecipient = encryptRecipient(
          originalRecipient,
          pin,
          existingRuntime.pinSalt
        );
        existingRuntime.encryptedWithPin = true;
        existingRuntime.isRevealed = false;
        existingRuntime.revealedAt = null;
        await saveParticipantRuntimeState(existingRuntime);
      } catch (err) {
        console.error("Failed to re-encrypt assignment with verified PIN:", err);
        return { success: false, error: "Error initializing assignment with your PIN. Please try again." };
      }
    }

    let recipientName: string | undefined;
    try {
      if (existingRuntime.encryptedRecipient && existingRuntime.isRevealed) {
        recipientName = decryptRecipient(
          existingRuntime.encryptedRecipient,
          pin,
          existingRuntime.pinSalt
        );
      }
    } catch (err) {
      console.error("Decryption with PIN failed:", err);
      return { success: false, error: "Error decrypting assignment. Please verify your PIN." };
    }

    return {
      success: true,
      isNewRegistration: false,
      participant: {
        id: participant.id,
        name: participant.name,
        isRevealed: existingRuntime.isRevealed,
      },
      recipientName: existingRuntime.isRevealed ? recipientName : undefined,
    };
  }

  // CASE 2: Participant is establishing their PIN for the FIRST TIME
  if (pin.length < 4) {
    return { success: false, error: "PIN must be at least 4 digits or characters." };
  }
  if (pin.length > 32) {
    return { success: false, error: "PIN cannot exceed 32 characters." };
  }

  // Decrypt original recipient from master draw state
  let originalRecipient: string;
  try {
    if (!participant.encryptedRecipient) {
      throw new Error("No assignment found to re-encrypt");
    }
    originalRecipient = decryptRecipient(
      participant.encryptedRecipient,
      participant.code,
      masterState.masterSalt
    );
  } catch (err) {
    console.error("Failed to decrypt seed recipient during PIN establishment:", err);
    return { success: false, error: "Could not initialize assignment. Please try again." };
  }

  const pinSalt = generateRandomSalt();
  const pinHash = hashPin(pin, pinSalt);
  const newEncryptedRecipient = encryptRecipient(originalRecipient, pin, pinSalt);

  const newRuntimeState: ParticipantRuntimeState = {
    participantId: participant.id,
    name: participant.name,
    pinHash,
    pinSalt,
    encryptedRecipient: newEncryptedRecipient,
    encryptedWithPin: true,
    isRevealed: false,
    revealedAt: null,
    registeredAt: new Date().toISOString(),
  };

  // Atomically save isolated participant blob
  await saveParticipantRuntimeState(newRuntimeState);

  return {
    success: true,
    isNewRegistration: true,
    participant: {
      id: participant.id,
      name: participant.name,
      isRevealed: false,
    },
    recipientName: undefined,
  };
}

/**
 * Reveals the recipient name for an authenticated participant.
 * Highly concurrent: updates only the calling participant's isolated record.
 */
export async function revealRecipientWithPin(
  participantId: string,
  pin: string
): Promise<{
  success: boolean;
  recipientName?: string;
  isFirstReveal?: boolean;
  error?: string;
}> {
  const runtime = await getParticipantRuntimeState(participantId);

  if (!runtime || !runtime.encryptedRecipient || !runtime.pinHash || !runtime.pinSalt) {
    return {
      success: false,
      error: "No personal PIN has been registered for this participant yet.",
    };
  }

  // Verify PIN
  const isValid = verifyPin(pin, runtime.pinHash, runtime.pinSalt);
  if (!isValid) {
    return { success: false, error: "Invalid PIN. Access denied." };
  }

  let decryptedName: string;
  try {
    decryptedName = decryptRecipient(
      runtime.encryptedRecipient,
      pin,
      runtime.pinSalt
    );
  } catch (err) {
    console.error("Reveal decryption error:", err);
    return { success: false, error: "Decryption failed. Please ensure PIN is correct." };
  }

  const isFirstReveal = !runtime.isRevealed;

  if (isFirstReveal) {
    runtime.isRevealed = true;
    runtime.revealedAt = new Date().toISOString();
    await saveParticipantRuntimeState(runtime);
  }

  return {
    success: true,
    recipientName: decryptedName,
    isFirstReveal,
  };
}

/**
 * Returns organizer safe view:
 * CRITICAL PRIVACY: Strictly omits encryptedRecipient, PINs, and hashes.
 */
export interface AdminAuditLogEntry {
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

export interface AdminSafeState {
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
  devices: DeviceBindingRecord[];
  participants: {
    id: string;
    name: string;
    isRevealed: boolean;
    revealedAt: string | null;
    isRegistered: boolean;
    deviceSummary?: string;
    deviceIp?: string;
    deviceBoundAt?: string;
    deviceHasRevealed?: boolean;
    deviceRevealedAt?: string | null;
  }[];
}

/**
 * Returns organizer safe view:
 * CRITICAL PRIVACY: Strictly omits encryptedRecipient, PINs, and hashes.
 */
export async function getAdminSafeState(): Promise<AdminSafeState> {
  const t0 = Date.now();
  const state = await getEventState();
  await syncMarkers();
  const latencyMs = Math.max(Date.now() - t0, 1);

  const revealedCount = state.participants.filter(
    (p) => p.isRevealed || revealedParticipantIds.has(p.id)
  ).length;

  const registeredCount = state.participants.filter(
    (p) => Boolean(p.pinHash) || registeredParticipantIds.has(p.id)
  ).length;

  const registeredDevicesCount = await getRegisteredDevicesCount();
  const auditLogs = await getAdminAuditLogs();

  const resetLog = auditLogs.find(
    (l) =>
      l.action === "RESET_ALL_DEVICES" ||
      l.action === "REROLL_SUBGROUP_20" ||
      l.action === "REGENERATE_FULL_DRAW"
  );
  const lastResetAt = resetLog ? resetLog.timestamp : null;

  let lastBackupName = "secret-santa-event.backup-pre-reseed-subgroup20-1793800280642.json";
  try {
    const localDir = path.join(process.cwd(), ".data");
    if (fs.existsSync(localDir)) {
      const files = fs
        .readdirSync(localDir)
        .filter((f) => f.startsWith("secret-santa-event.backup-"))
        .sort()
        .reverse();
      if (files.length > 0) {
        lastBackupName = files[0];
      }
    }
  } catch {
    // ignore
  }

  const provider =
    process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH
      ? "Vercel Private Blob (Encrypted)"
      : "Local Filesystem (Encrypted JSON)";

  const devices = await getAllDeviceBindings();
  const deviceByParticipantId = new Map(devices.map((d) => [d.participantId, d]));

  return {
    status: state.status,
    version: state.version || 7,
    createdAt: state.createdAt,
    generatedAt: state.generatedAt,
    totalParticipants: state.participants.length,
    registeredCount,
    revealedCount,
    pendingCount: state.participants.length - revealedCount,
    registeredDevicesCount,
    lastDrawGeneratedAt: state.generatedAt,
    lastResetAt,
    storageHealth: {
      provider,
      status: "Healthy",
      latencyMs,
      lastBackupName,
    },
    auditLogs,
    devices,
    participants: state.participants.map((p) => {
      const isRevealed = Boolean(p.isRevealed || revealedParticipantIds.has(p.id));
      const isRegistered = Boolean(p.pinHash || registeredParticipantIds.has(p.id));
      const boundDev = deviceByParticipantId.get(p.id);
      return {
        id: p.id,
        name: p.name,
        isRevealed,
        revealedAt: p.revealedAt || boundDev?.revealedAt || null,
        isRegistered,
        deviceSummary: boundDev?.summary,
        deviceIp: boundDev?.ip,
        deviceBoundAt: boundDev?.boundAt,
        deviceHasRevealed: boundDev?.hasRevealed,
        deviceRevealedAt: boundDev?.revealedAt,
      };
    }),
  };
}

/**
 * Reads a device's binding record (checks cache, Vercel Blob, and local disk)
 */
export async function getDeviceBinding(
  deviceId: string
): Promise<DeviceBindingRecord | null> {
  if (!deviceId || typeof deviceId !== "string") return null;
  const cleanId = deviceId.trim().toLowerCase();

  // Check in-memory cache
  if (deviceBindingCache.has(cleanId)) {
    return deviceBindingCache.get(cleanId)!;
  }

  // 1. Check Vercel Private Blob (if not in isolated test mode)
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const url = `${KNOWN_BLOB_BASE}/v7/devices/${cleanId}.json`;
      const res: any = await get(url, {
        access: "private",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      if (res && res.stream) {
        const text = await new Response(res.stream).text();
        const parsed: DeviceBindingRecord = JSON.parse(text);
        deviceBindingCache.set(cleanId, parsed);
        return parsed;
      }
    } catch {
      // ignore miss
    }
  }

  // 2. Check local disk
  try {
    const localFile = path.join(getLocalDeviceDir(), `${cleanId}.json`);
    if (fs.existsSync(localFile)) {
      const data = fs.readFileSync(localFile, "utf-8");
      const parsed: DeviceBindingRecord = JSON.parse(data);
      deviceBindingCache.set(cleanId, parsed);
      return parsed;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Authoritatively binds a device to an authenticated participant.
 * Prevents race conditions and duplicate multi-account device usage.
 */
export async function bindDeviceToParticipant(
  deviceId: string,
  participantId: string,
  participantName: string,
  meta?: { ip?: string; userAgent?: string }
): Promise<{ success: boolean; error?: string }> {
  if (!deviceId || typeof deviceId !== "string") {
    return { success: false, error: "Invalid device identifier." };
  }
  const cleanId = deviceId.trim().toLowerCase();

  // Check existing binding for race conditions
  const existing = await getDeviceBinding(cleanId);
  if (existing && existing.participantId !== participantId) {
    return {
      success: false,
      error: "This device is registered to another participant account. Accessing multiple accounts from the same device is not permitted.",
    };
  }

  const parsed = parseUserAgentDetails(meta?.userAgent || existing?.userAgent);
  const hasRevealed = Boolean(existing?.hasRevealed || revealedParticipantIds.has(participantId));
  const revealedAt = existing?.revealedAt || null;

  const record: DeviceBindingRecord = {
    deviceId: cleanId,
    participantId,
    participantName,
    boundAt: existing?.boundAt || new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ip: meta?.ip || existing?.ip || "unknown",
    userAgent: meta?.userAgent || existing?.userAgent || "",
    deviceModel: parsed.deviceModel !== "Unknown Device" ? parsed.deviceModel : existing?.deviceModel || "Unknown Device",
    os: parsed.os !== "Unknown OS" ? parsed.os : existing?.os || "Unknown OS",
    browser: parsed.browser !== "Unknown Browser" ? parsed.browser : existing?.browser || "Web Browser",
    summary: parsed.summary !== "Unknown Device" ? parsed.summary : existing?.summary || "Unknown Device",
    hasRevealed,
    revealedAt,
  };

  // Update in-memory cache
  deviceBindingCache.set(cleanId, record);

  const serialized = JSON.stringify(record, null, 2);

  // 1. Persist to Vercel Private Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      await Promise.all([
        put(`v7/devices/${cleanId}.json`, serialized, {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }),
        put(`v7/participant_devices/${participantId}/${cleanId}`, "1", {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        }),
      ]);
    } catch (err) {
      console.error("Critical: Failed to save device binding to Vercel Blob:", err);
    }
  }

  // 2. Persist to local filesystem
  try {
    const dir = getLocalDeviceDir();
    const filePath = path.join(dir, `${cleanId}.json`);
    const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
    fs.writeFileSync(tempPath, serialized, "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch {
    // ignore
  }

  return { success: true };
}

/**
 * Authorized recovery mechanism: Clears device bindings for a participant if device was lost/reset.
 */
export async function clearDeviceBindingsForParticipant(
  participantId: string
): Promise<{ success: boolean; clearedCount: number }> {
  let clearedCount = 0;

  // Clear in-memory cache entries matching this participant
  for (const [devId, rec] of deviceBindingCache.entries()) {
    if (rec.participantId === participantId) {
      deviceBindingCache.delete(devId);
      clearedCount++;
    }
  }

  // 1. Cloud cleanup
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const pDevicesList = await list({
        prefix: `v7/participant_devices/${participantId}/`,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      const urlsToDelete: string[] = pDevicesList.blobs.map((b) => b.url);

      for (const b of pDevicesList.blobs) {
        const devId = path.basename(b.pathname);
        const devBlobUrl = `${KNOWN_BLOB_BASE}/v7/devices/${devId}.json`;
        urlsToDelete.push(devBlobUrl);
      }

      if (urlsToDelete.length > 0) {
        await del(urlsToDelete, { token: process.env.BLOB_READ_WRITE_TOKEN });
      }
    } catch (err) {
      console.warn("Notice: clearing device bindings in Blob:", err);
    }
  }

  // 2. Local cleanup
  try {
    const dir = getLocalDeviceDir();
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.endsWith(".json")) {
          const filePath = path.join(dir, f);
          try {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            if (data.participantId === participantId) {
              fs.unlinkSync(filePath);
            }
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return { success: true, clearedCount };
}

let auditLogsCache: AdminAuditLogEntry[] | null = null;
const AUDIT_LOGS_BLOB_KEY = "v7/admin_audit_logs.json";

export async function getAdminAuditLogs(): Promise<AdminAuditLogEntry[]> {
  if (auditLogsCache) return auditLogsCache;

  // 1. Try Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const url = `${KNOWN_BLOB_BASE}/${AUDIT_LOGS_BLOB_KEY}`;
      const res: any = await get(url, {
        access: "private",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      if (res && res.stream) {
        const text = await new Response(res.stream).text();
        auditLogsCache = JSON.parse(text);
        return auditLogsCache || [];
      }
    } catch {
      // ignore miss
    }
  }

  // 2. Try local disk
  try {
    const localDir = path.dirname(getStorageFilePath());
    const filePath = path.join(localDir, "admin_audit_logs.json");
    if (fs.existsSync(filePath)) {
      auditLogsCache = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return auditLogsCache || [];
    }
  } catch {
    // ignore
  }

  auditLogsCache = [];
  return [];
}

export async function recordAdminAuditLog(
  entry: Omit<AdminAuditLogEntry, "id" | "timestamp">
): Promise<AdminAuditLogEntry> {
  const fullEntry: AdminAuditLogEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString("hex"),
    timestamp: new Date().toISOString(),
    ...entry,
  };

  const logs = await getAdminAuditLogs();
  logs.unshift(fullEntry);
  if (logs.length > 100) {
    logs.length = 100;
  }
  auditLogsCache = logs;

  const serialized = JSON.stringify(logs, null, 2);

  // 1. Save to Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      await put(AUDIT_LOGS_BLOB_KEY, serialized, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (err) {
      console.warn("Failed to persist audit log to Blob:", err);
    }
  }

  // 2. Save locally
  try {
    const localDir = path.dirname(getStorageFilePath());
    const filePath = path.join(localDir, "admin_audit_logs.json");
    fs.writeFileSync(filePath, serialized, "utf-8");
  } catch {
    // ignore
  }

  return fullEntry;
}

/**
 * Records that a bound device performed a gift reveal operation.
 */
export async function recordDeviceReveal(
  deviceId: string,
  participantId: string,
  meta?: { ip?: string; userAgent?: string }
): Promise<{ success: boolean }> {
  if (!deviceId || typeof deviceId !== "string") {
    return { success: false };
  }
  const cleanId = deviceId.trim().toLowerCase();
  const existing = await getDeviceBinding(cleanId);
  const now = new Date().toISOString();

  let participantName = existing?.participantName || "";
  if (!participantName) {
    const state = await getEventState();
    const p = state.participants.find((x) => x.id === participantId);
    if (p) participantName = p.name;
  }

  const parsed = parseUserAgentDetails(meta?.userAgent || existing?.userAgent);

  const updated: DeviceBindingRecord = {
    deviceId: cleanId,
    participantId,
    participantName,
    boundAt: existing?.boundAt || now,
    lastUsedAt: now,
    ip: meta?.ip || existing?.ip || "unknown",
    userAgent: meta?.userAgent || existing?.userAgent || "",
    deviceModel: parsed.deviceModel !== "Unknown Device" ? parsed.deviceModel : existing?.deviceModel || "Unknown Device",
    os: parsed.os !== "Unknown OS" ? parsed.os : existing?.os || "Unknown OS",
    browser: parsed.browser !== "Unknown Browser" ? parsed.browser : existing?.browser || "Web Browser",
    summary: parsed.summary !== "Unknown Device" ? parsed.summary : existing?.summary || "Unknown Device",
    hasRevealed: true,
    revealedAt: existing?.revealedAt || now,
  };

  deviceBindingCache.set(cleanId, updated);
  const serialized = JSON.stringify(updated, null, 2);

  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      await put(`v7/devices/${cleanId}.json`, serialized, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (err) {
      console.warn("Notice saving revealed device binding to blob:", err);
    }
  }

  try {
    const dir = getLocalDeviceDir();
    const filePath = path.join(dir, `${cleanId}.json`);
    fs.writeFileSync(filePath, serialized, "utf-8");
  } catch {
    // ignore
  }

  // Record audit log for reveal activity (Zero-Knowledge: strictly omits recipient name!)
  await recordAdminAuditLog({
    action: "GIFT_REVEALED",
    actionLabel: "Gift Revealed by Participant",
    ip: meta?.ip || "unknown",
    status: "SUCCESS",
    details: `${participantName} opened their gift using ${updated.summary} (IP: ${updated.ip})`,
  });

  return { success: true };
}

/**
 * Retrieves all registered device binding records with telemetry.
 */
export async function getAllDeviceBindings(): Promise<DeviceBindingRecord[]> {
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const listRes = await list({
        prefix: "v7/devices/",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      for (const blob of listRes.blobs) {
        const idMatch = blob.pathname.match(/^v7\/devices\/(.+)\.json$/);
        if (idMatch && !deviceBindingCache.has(idMatch[1])) {
          try {
            const res: any = await get(blob.url, {
              access: "private",
              token: process.env.BLOB_READ_WRITE_TOKEN,
            });
            if (res && res.stream) {
              const text = await new Response(res.stream).text();
              const rec = JSON.parse(text);
              deviceBindingCache.set(rec.deviceId, rec);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
  }

  try {
    const dir = getLocalDeviceDir();
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const devId = file.replace(/\.json$/, "");
        if (!deviceBindingCache.has(devId)) {
          try {
            const text = fs.readFileSync(path.join(dir, file), "utf-8");
            const rec = JSON.parse(text);
            deviceBindingCache.set(rec.deviceId, rec);
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return Array.from(deviceBindingCache.values()).sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
  );
}

export async function getRegisteredDevicesCount(): Promise<number> {
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const listRes = await list({
        prefix: "v7/devices/",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      return listRes.blobs.length;
    } catch {
      return deviceBindingCache.size;
    }
  }

  try {
    const dir = getLocalDeviceDir();
    if (fs.existsSync(dir)) {
      return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length;
    }
  } catch {
    // ignore
  }

  return deviceBindingCache.size;
}

export async function resetAllDeviceBindings(
  clientIp: string = "unknown"
): Promise<{ success: boolean; clearedCount: number; message: string }> {
  const initialCount = await getRegisteredDevicesCount();
  deviceBindingCache.clear();

  // 1. Clear in Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      for (const prefix of ["v7/devices/", "v7/participant_devices/"]) {
        const listRes = await list({
          prefix,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        if (listRes.blobs.length > 0) {
          await del(
            listRes.blobs.map((b) => b.url),
            { token: process.env.BLOB_READ_WRITE_TOKEN }
          );
        }
      }
    } catch (err) {
      console.warn("Notice: resetAllDeviceBindings in Blob:", err);
    }
  }

  // 2. Clear locally
  try {
    const dir = getLocalDeviceDir();
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f.endsWith(".json")) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    }
  } catch {
    // ignore
  }

  await recordAdminAuditLog({
    action: "RESET_ALL_DEVICES",
    actionLabel: "Reset All Device Bindings",
    ip: clientIp,
    status: "SUCCESS",
    details: `Cleared ${initialCount} device binding(s). Participant PINs, assignments, and reveals remain 100% intact.`,
  });

  return {
    success: true,
    clearedCount: initialCount,
    message: `Successfully reset ${initialCount} device binding(s). All participants can now log in freely from their devices without losing PINs or draw assignments.`,
  };
}

export async function rerollSubgroup20(
  clientIp: string = "unknown"
): Promise<{
  success: boolean;
  message: string;
  version: number;
  backupBlobKey: string;
}> {
  const state = await getEventState(true);

  // 1. Create automatic timestamped backup before any modification
  const timestamp = Date.now();
  const backupBlobKey = `secret-santa-event.backup-pre-reroll-sub20-${timestamp}.json`;
  const backupSerialized = JSON.stringify(state, null, 2);

  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      await put(backupBlobKey, backupSerialized, {
        access: "private",
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (err) {
      console.error("Critical: Failed to create pre-reroll backup in Blob:", err);
    }
  }

  try {
    const localBackupDir = path.join(process.cwd(), ".data");
    if (!fs.existsSync(localBackupDir)) fs.mkdirSync(localBackupDir, { recursive: true });
    fs.writeFileSync(path.join(localBackupDir, backupBlobKey), backupSerialized, "utf-8");
  } catch {
    // ignore
  }

  // 2. Extract and preserve the 28 participants' assignments outside Subgroup 20
  const preserved28Pairs: AssignmentPair[] = [];
  const participants28 = state.participants.filter(
    (p) => !SUBGROUP_20_ID_SET.has(p.id as any)
  );

  if (participants28.length !== 28) {
    throw new Error(`Expected 28 participants outside Subgroup 20, found ${participants28.length}`);
  }

  for (const p of participants28) {
    if (!p.encryptedRecipient) {
      throw new Error(`Participant ${p.name} missing encrypted recipient`);
    }
    const recName = decryptRecipient(p.encryptedRecipient, p.code, state.masterSalt);
    const recP = PARTICIPANTS.find((item) => item.name === recName);
    if (!recP) {
      throw new Error(`Failed to resolve recipient for ${p.name}`);
    }
    preserved28Pairs.push({
      giverId: p.id,
      giverName: p.name,
      recipientId: recP.id,
      recipientName: recP.name,
    });
  }

  // 3. Generate fresh randomized pairs for Subgroup 20
  const subgroup20Participants = PARTICIPANTS.filter((p) => SUBGROUP_20_ID_SET.has(p.id as any));
  const newSubgroup20Pairs = generateSubgroup20Pairs(subgroup20Participants);

  // 4. Combine and validate all 48 assignments
  const all48Assignments: AssignmentPair[] = [...newSubgroup20Pairs, ...preserved28Pairs];

  const validation = validateConstrainedSecretSantaDraw(PARTICIPANTS, all48Assignments);
  if (!validation.valid) {
    throw new Error(`Draw validation failed: ${validation.reason}`);
  }

  // Check reciprocal Ghazal ⇄ George
  const map = new Map<string, string>();
  for (const a of all48Assignments) {
    map.set(a.giverName, a.recipientName);
  }
  if (
    map.get(MANDATORY_RECIPROCAL_A) !== MANDATORY_RECIPROCAL_B ||
    map.get(MANDATORY_RECIPROCAL_B) !== MANDATORY_RECIPROCAL_A
  ) {
    throw new Error("Reciprocal pairing validation failed!");
  }
  if (
    map.get(FORBIDDEN_EXCLUSION_A) === FORBIDDEN_EXCLUSION_B ||
    map.get(FORBIDDEN_EXCLUSION_B) === FORBIDDEN_EXCLUSION_A
  ) {
    throw new Error("Mutual exclusion validation failed!");
  }

  // 5. Encrypt with new masterSalt
  const newMasterSalt = crypto.randomBytes(16).toString("hex");
  const newVersion = (state.version || 7) + 1;

  const newParticipantsState = PARTICIPANTS.map((p) => {
    const pair = all48Assignments.find((a) => a.giverId === p.id)!;
    const code = generateChristmasPasscode();
    const codeHash = hashPasscode(code, newMasterSalt);
    const encryptedRecipient = encryptRecipient(pair.recipientName, code, newMasterSalt);

    return {
      id: p.id,
      name: p.name,
      code,
      codeHash,
      encryptedRecipient,
      isRevealed: false,
      revealedAt: null,
      pinHash: null,
      pinSalt: null,
      encryptedWithPin: false,
    };
  });

  state.version = newVersion;
  state.status = "active";
  state.generatedAt = new Date().toISOString();
  state.masterSalt = newMasterSalt;
  state.participants = newParticipantsState;

  // Clear runtime caches and dynamic markers
  runtimeParticipantCache.clear();
  revealedParticipantIds.clear();
  registeredParticipantIds.clear();
  deviceBindingCache.clear();

  // Save new state atomically
  await saveEventState(state);

  // Clean dynamic blobs in Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const vList = await list({ prefix: "v7/", token: process.env.BLOB_READ_WRITE_TOKEN });
      const urlsToDelete = vList.blobs
        .filter((b) => !b.pathname.includes("admin_audit_logs"))
        .map((b) => b.url);
      if (urlsToDelete.length > 0) {
        await del(urlsToDelete, { token: process.env.BLOB_READ_WRITE_TOKEN });
      }
    } catch (err) {
      console.warn("Notice: cleaning runtime markers in Blob:", err);
    }
  }

  await recordAdminAuditLog({
    action: "REROLL_SUBGROUP_20",
    actionLabel: "Reroll 20-Person Subgroup",
    ip: clientIp,
    status: "SUCCESS",
    details: `Subgroup 20 rerolled; 28 participants preserved. Round incremented to ${newVersion}. Backup: ${backupBlobKey}`,
  });

  return {
    success: true,
    message: `Subgroup 20 successfully rerolled. All 28 other participants preserved. New Round ${newVersion} is now active.`,
    version: newVersion,
    backupBlobKey,
  };
}

export async function regenerateFullDraw(
  clientIp: string = "unknown"
): Promise<{
  success: boolean;
  message: string;
  version: number;
  backupBlobKey: string;
}> {
  const state = await getEventState(true);

  // 1. Automatic timestamped backup
  const timestamp = Date.now();
  const backupBlobKey = `secret-santa-event.backup-pre-full-regenerate-${timestamp}.json`;
  const backupSerialized = JSON.stringify(state, null, 2);

  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      await put(backupBlobKey, backupSerialized, {
        access: "private",
        addRandomSuffix: false,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (err) {
      console.error("Critical: Failed to create pre-full-regenerate backup in Blob:", err);
    }
  }

  try {
    const localBackupDir = path.join(process.cwd(), ".data");
    if (!fs.existsSync(localBackupDir)) fs.mkdirSync(localBackupDir, { recursive: true });
    fs.writeFileSync(path.join(localBackupDir, backupBlobKey), backupSerialized, "utf-8");
  } catch {
    // ignore
  }

  // 2. Generate constrained draw for all 48 participants
  const pairs = generateConstrainedSecretSantaDraw(PARTICIPANTS);

  const validation = validateConstrainedSecretSantaDraw(PARTICIPANTS, pairs);
  if (!validation.valid) {
    throw new Error(`Draw validation failed: ${validation.reason}`);
  }

  // 3. Encrypt with new masterSalt
  const newMasterSalt = crypto.randomBytes(16).toString("hex");
  const newVersion = (state.version || 7) + 1;

  const newParticipantsState = PARTICIPANTS.map((p) => {
    const pair = pairs.find((a) => a.giverId === p.id)!;
    const code = generateChristmasPasscode();
    const codeHash = hashPasscode(code, newMasterSalt);
    const encryptedRecipient = encryptRecipient(pair.recipientName, code, newMasterSalt);

    return {
      id: p.id,
      name: p.name,
      code,
      codeHash,
      encryptedRecipient,
      isRevealed: false,
      revealedAt: null,
      pinHash: null,
      pinSalt: null,
      encryptedWithPin: false,
    };
  });

  state.version = newVersion;
  state.status = "active";
  state.generatedAt = new Date().toISOString();
  state.masterSalt = newMasterSalt;
  state.participants = newParticipantsState;

  // Clear caches
  runtimeParticipantCache.clear();
  revealedParticipantIds.clear();
  registeredParticipantIds.clear();
  deviceBindingCache.clear();

  await saveEventState(state);

  // Clean runtime blobs (except audit logs)
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const vList = await list({ prefix: "v7/", token: process.env.BLOB_READ_WRITE_TOKEN });
      const urlsToDelete = vList.blobs
        .filter((b) => !b.pathname.includes("admin_audit_logs"))
        .map((b) => b.url);
      if (urlsToDelete.length > 0) {
        await del(urlsToDelete, { token: process.env.BLOB_READ_WRITE_TOKEN });
      }
    } catch (err) {
      console.warn("Notice: cleaning runtime markers in Blob:", err);
    }
  }

  await recordAdminAuditLog({
    action: "REGENERATE_FULL_DRAW",
    actionLabel: "Regenerate Full Draw",
    ip: clientIp,
    status: "SUCCESS",
    details: `Full draw regenerated for 48 participants. Round incremented to ${newVersion}. Backup: ${backupBlobKey}`,
  });

  return {
    success: true,
    message: `Full draw successfully regenerated for all 48 participants. New Round ${newVersion} is now active.`,
    version: newVersion,
    backupBlobKey,
  };
}
