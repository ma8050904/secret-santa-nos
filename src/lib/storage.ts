import fs from "fs";
import path from "path";
import crypto from "crypto";
import { put, list, get } from "@vercel/blob";
import { PARTICIPANTS } from "./constants";
import {
  generateChristmasPasscode,
  hashPasscode,
  hashPin,
  verifyPin,
  generateRandomSalt,
  encryptRecipient,
  decryptRecipient,
} from "./crypto";
import { generateConstrainedSecretSantaDraw } from "./derangement";

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

let inMemoryStateCache: EventState | null = null;
let inMemoryCacheTimestamp = 0;
const CACHE_TTL_MS = 4000;

const KNOWN_BLOB_BASE = "https://ygkog8lebahiid0k.private.blob.vercel-storage.com";
const KNOWN_BLOB_URL =
  process.env.BLOB_URL || `${KNOWN_BLOB_BASE}/secret-santa-event.json`;

let writeLock: Promise<void> = Promise.resolve();

// Concurrency-safe in-memory runtime caches
const runtimeParticipantCache = new Map<string, ParticipantRuntimeState>();
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
export async function getAdminSafeState(): Promise<{
  status: string;
  createdAt: string;
  generatedAt: string | null;
  totalParticipants: number;
  registeredCount: number;
  revealedCount: number;
  pendingCount: number;
  participants: {
    id: string;
    name: string;
    isRevealed: boolean;
    revealedAt: string | null;
    isRegistered: boolean;
  }[];
}> {
  const state = await getEventState();
  await syncMarkers();

  const revealedCount = state.participants.filter(
    (p) => p.isRevealed || revealedParticipantIds.has(p.id)
  ).length;

  const registeredCount = state.participants.filter(
    (p) => Boolean(p.pinHash) || registeredParticipantIds.has(p.id)
  ).length;

  return {
    status: state.status,
    createdAt: state.createdAt,
    generatedAt: state.generatedAt,
    totalParticipants: state.participants.length,
    registeredCount,
    revealedCount,
    pendingCount: state.participants.length - revealedCount,
    participants: state.participants.map((p) => ({
      id: p.id,
      name: p.name,
      isRevealed: Boolean(p.isRevealed || revealedParticipantIds.has(p.id)),
      revealedAt: p.revealedAt,
      isRegistered: Boolean(p.pinHash || registeredParticipantIds.has(p.id)),
    })),
  };
}
