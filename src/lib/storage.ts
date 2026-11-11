import fs from "fs";
import path from "path";
import crypto from "crypto";
import { put, list, get, del } from "@vercel/blob";
import { PARTICIPANTS } from "./constants";
import { parseUserAgentDetails } from "./device-info";
import { clearAllRateLimits } from "./rate-limit";
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
  generateSecretSantaDerangement,
  generateDistinctDerangement,
  validateDerangement,
  SUBGROUP_20_ID_SET,
  SUBGROUP_20_IDS,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  FORBIDDEN_EXCLUSION_C,
  FORBIDDEN_EXCLUSION_D,
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
  // Biometric / Device Screen Lock Passkey fields
  passkeyCredentialId?: string | null;
  passkeyPublicKey?: string | null;
  passkeyCounter?: number;
  passkeyRegisteredAt?: string | null;
}

export interface AdminPasskey {
  id: string; // Base64URL credential ID
  publicKey: string; // Base64URL public key
  counter: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  createdAt: string;
  label: string;
}

export interface EventState {
  version: number;
  status: "uninitialized" | "ready" | "active" | "closed";
  createdAt: string;
  generatedAt: string | null;
  masterSalt: string;
  participants: StoredParticipant[];
  deviceResetVersion?: number;
  adminPasswordHash?: string;
  adminPasswordSalt?: string;
  adminPasskeys?: AdminPasskey[];
  drawMode?: "constrained" | "free";
  savedOfficialParticipants?: StoredParticipant[];
  savedOfficialMasterSalt?: string;
}

export interface ParticipantRuntimeState {
  participantId: string;
  name: string;
  pinHash?: string | null;
  pinSalt?: string | null;
  encryptedRecipient: string; // AES-256-GCM encrypted
  encryptedWithPin: boolean;
  isRevealed: boolean;
  revealedAt: string | null;
  registeredAt: string;
  passkeyCredentialId?: string | null;
  passkeyPublicKey?: string | null;
  passkeyCounter?: number;
  passkeyRegisteredAt?: string | null;
}

export interface DeviceBindingRecord {
  deviceId: string;
  hardwareFingerprint?: string;
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
  resetVersion?: number;
}

function getLocalBackupDir(): string {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const dir = isServerless ? path.join("/tmp", ".data") : path.join(process.cwd(), ".data");
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // ignore in read-only environments
  }
  return dir;
}

function safeWriteBackup(filename: string, content: string): string | null {
  try {
    const dir = getLocalBackupDir();
    const target = path.join(dir, filename);
    fs.writeFileSync(target, content, "utf-8");
    return target;
  } catch (err) {
    console.warn("Notice: Local backup write skipped in serverless environment:", err);
    return null;
  }
}

// Storage path resolution: prioritize local project dir in development, fallback to /tmp in serverless
function getStorageFilePath(): string {
  if (process.env.STORAGE_FILE_PATH) {
    return process.env.STORAGE_FILE_PATH;
  }
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!isServerless) {
    const localDir = path.join(process.cwd(), ".data");
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

function getLocalHardwareDeviceDir(): string {
  const base = getStorageFilePath();
  const dir = path.join(path.dirname(base), "v7_hardware_devices");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  }
  return dir;
}

function getLocalPasskeyCredentialsDir(): string {
  const base = getStorageFilePath();
  const dir = path.join(path.dirname(base), "v7_all_passkey_credentials");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
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
let activeResetCount = 0;

/**
 * Returns true while an administrative draw regeneration or security reset is actively executing.
 * Used to block concurrent participant authentication, enrollment, device binding, or reveal calls.
 */
export function isDrawResetInProgress(): boolean {
  return activeResetCount > 0;
}

const RESET_IN_PROGRESS_ERROR =
  "Event draw regeneration and security reset is currently in progress. Please wait a moment and try again.";

// Concurrency-safe in-memory runtime caches
const runtimeParticipantCache = new Map<string, ParticipantRuntimeState>();
const deviceBindingCache = new Map<string, DeviceBindingRecord>();
const hardwareBindingCache = new Map<string, DeviceBindingRecord>();
const revealedParticipantIds = new Set<string>();
const registeredParticipantIds = new Set<string>();
const passkeyParticipantIds = new Set<string>();
const allRegisteredCredentialIdsSet = new Set<string>();
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
      passkeyCredentialId: null,
      passkeyPublicKey: null,
      passkeyCounter: 0,
      passkeyRegisteredAt: null,
    };
  });

  return {
    version: 0,
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

  // 0. Primary: PostgreSQL Transactional Store (Zero Vercel Blob operations, unlimited free queries)
  const { isPostgresConfigured, getPostgresMarkers } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      const markers = await getPostgresMarkers();
      if (markers) {
        revealedParticipantIds.clear();
        for (const id of markers.revealed) revealedParticipantIds.add(id);

        registeredParticipantIds.clear();
        for (const id of markers.registered) registeredParticipantIds.add(id);

        passkeyParticipantIds.clear();
        allRegisteredCredentialIdsSet.clear();
        for (const p of markers.passkeys) {
          passkeyParticipantIds.add(p.participantId);
          allRegisteredCredentialIdsSet.add(p.credentialId);
        }

        lastMarkersSyncTimestamp = now;
        return;
      }
    } catch (pgErr) {
      console.warn("Notice: PostgreSQL markers sync attempt:", pgErr);
    }
  }

  // 1. Cloud Blob sync (only when not running in isolated local test mode)
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const [revealedList, registeredList, passkeyList, credList] = await Promise.all([
        list({ prefix: "v7/revealed/", token: process.env.BLOB_READ_WRITE_TOKEN }),
        list({ prefix: "v7/registered/", token: process.env.BLOB_READ_WRITE_TOKEN }),
        list({ prefix: "v7/passkeys/", token: process.env.BLOB_READ_WRITE_TOKEN }),
        list({ prefix: "v7/all_passkey_credentials/", token: process.env.BLOB_READ_WRITE_TOKEN }),
      ]);

      const freshRevealed = new Set<string>();
      for (const b of revealedList.blobs) {
        const id = b.pathname.replace("v7/revealed/", "");
        if (id) freshRevealed.add(id);
      }

      const freshRegistered = new Set<string>();
      for (const b of registeredList.blobs) {
        const id = b.pathname.replace("v7/registered/", "");
        if (id) freshRegistered.add(id);
      }

      const freshPasskeys = new Set<string>();
      for (const b of passkeyList.blobs) {
        const id = b.pathname.replace("v7/passkeys/", "");
        if (id) freshPasskeys.add(id);
      }

      const freshCredentials = new Set<string>();
      for (const b of credList.blobs) {
        const id = b.pathname.replace("v7/all_passkey_credentials/", "");
        if (id) freshCredentials.add(id);
      }

      revealedParticipantIds.clear();
      for (const id of freshRevealed) revealedParticipantIds.add(id);

      registeredParticipantIds.clear();
      for (const id of freshRegistered) registeredParticipantIds.add(id);

      passkeyParticipantIds.clear();
      for (const id of freshPasskeys) passkeyParticipantIds.add(id);

      allRegisteredCredentialIdsSet.clear();
      for (const id of freshCredentials) allRegisteredCredentialIdsSet.add(id);

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
    const passkeysDir = path.join(localDir, "v7_passkeys");
    const credsDir = path.join(localDir, "v7_all_passkey_credentials");

    const freshRevealed = new Set<string>();
    if (fs.existsSync(revealedDir)) {
      const files = fs.readdirSync(revealedDir);
      for (const f of files) freshRevealed.add(f);
    }

    const freshRegistered = new Set<string>();
    if (fs.existsSync(registeredDir)) {
      const files = fs.readdirSync(registeredDir);
      for (const f of files) freshRegistered.add(f);
    }

    const freshPasskeys = new Set<string>();
    if (fs.existsSync(passkeysDir)) {
      const files = fs.readdirSync(passkeysDir);
      for (const f of files) freshPasskeys.add(f);
    }

    const freshCreds = new Set<string>();
    if (fs.existsSync(credsDir)) {
      const files = fs.readdirSync(credsDir);
      for (const f of files) freshCreds.add(f);
    }

    revealedParticipantIds.clear();
    for (const id of freshRevealed) revealedParticipantIds.add(id);

    registeredParticipantIds.clear();
    for (const id of freshRegistered) registeredParticipantIds.add(id);

    passkeyParticipantIds.clear();
    for (const id of freshPasskeys) passkeyParticipantIds.add(id);

    allRegisteredCredentialIdsSet.clear();
    for (const id of freshCreds) allRegisteredCredentialIdsSet.add(id);

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

  // 0. Primary: Transactional PostgreSQL Store if configured
  const { isPostgresConfigured, getPostgresEventState } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      const pgState = await getPostgresEventState();
      if (pgState && pgState.participants && pgState.participants.length === 56) {
        await syncMarkers(forceFresh);
        for (const p of pgState.participants) {
          if (revealedParticipantIds.has(p.id)) {
            p.isRevealed = true;
          }
          if (registeredParticipantIds.has(p.id)) {
            p.pinHash = p.pinHash || "registered_marker_present";
          }
        }
        inMemoryStateCache = pgState;
        inMemoryCacheTimestamp = Date.now();
        return pgState;
      }
    } catch (pgErr) {
      console.error("Critical: PostgreSQL event state fetch error:", pgErr);
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `Production Database Read Failure: ${pgErr instanceof Error ? pgErr.message : "PostgreSQL unreachable"}`
        );
      }
    }
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
        await syncMarkers(forceFresh);
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

      await syncMarkers(forceFresh);
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

  writeLock = writeLock.catch(() => {}).then(async () => {
    const serialized = JSON.stringify(state, null, 2);

    // 0. Primary: Persist to PostgreSQL if configured (and not in isolated test mode)
    const { isPostgresConfigured, savePostgresEventState } = await import("./db");
    if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
      try {
        const ok = await savePostgresEventState(state);
        if (!ok) {
          throw new Error("PostgreSQL save returned false");
        }
      } catch (pgErr) {
        console.error("Critical: Failed to save state to PostgreSQL:", pgErr);
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            `Production Database Write Failure: ${pgErr instanceof Error ? pgErr.message : "Unable to persist event state to PostgreSQL"}`
          );
        }
      }
    }

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

  // 0. Primary: PostgreSQL Transactional Store
  const { isPostgresConfigured, getPostgresParticipantState } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      const pgParticipant = await getPostgresParticipantState(participantId);
      if (pgParticipant) {
        runtimeParticipantCache.set(participantId, pgParticipant);
        if (pgParticipant.isRevealed) revealedParticipantIds.add(participantId);
        if (pgParticipant.pinHash || pgParticipant.passkeyCredentialId) registeredParticipantIds.add(participantId);
        if (pgParticipant.passkeyCredentialId) passkeyParticipantIds.add(participantId);
        return pgParticipant;
      }
    } catch (pgErr) {
      console.error("Critical: PostgreSQL participant fetch error:", pgErr);
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `Production Database Read Failure: ${pgErr instanceof Error ? pgErr.message : "PostgreSQL unreachable"}`
        );
      }
    }
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
        if (parsed.pinHash || parsed.passkeyCredentialId) registeredParticipantIds.add(participantId);
        if (parsed.passkeyCredentialId) passkeyParticipantIds.add(participantId);
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
      if (parsed.pinHash || parsed.passkeyCredentialId) registeredParticipantIds.add(participantId);
      if (parsed.passkeyCredentialId) passkeyParticipantIds.add(participantId);
      return parsed;
    }
  } catch {
    // ignore
  }

  // 3. Fallback to check master state participant record
  const state = await getEventState();
  const p = state.participants.find((item) => item.id === participantId);
  if (p && (p.pinHash || p.passkeyCredentialId) && p.encryptedRecipient) {
    const fromMaster: ParticipantRuntimeState = {
      participantId: p.id,
      name: p.name,
      pinHash: p.pinHash,
      pinSalt: p.pinSalt,
      encryptedRecipient: p.encryptedRecipient,
      encryptedWithPin: Boolean(p.encryptedWithPin),
      isRevealed: p.isRevealed,
      revealedAt: p.revealedAt,
      registeredAt: p.revealedAt || p.passkeyRegisteredAt || new Date().toISOString(),
      passkeyCredentialId: p.passkeyCredentialId,
      passkeyPublicKey: p.passkeyPublicKey,
      passkeyCounter: p.passkeyCounter,
      passkeyRegisteredAt: p.passkeyRegisteredAt,
    };
    runtimeParticipantCache.set(participantId, fromMaster);
    if (fromMaster.isRevealed) revealedParticipantIds.add(participantId);
    if (fromMaster.pinHash || fromMaster.passkeyCredentialId) registeredParticipantIds.add(participantId);
    if (fromMaster.passkeyCredentialId) passkeyParticipantIds.add(participantId);
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
  if (state.pinHash || state.passkeyCredentialId) registeredParticipantIds.add(state.participantId);
  if (state.passkeyCredentialId) passkeyParticipantIds.add(state.participantId);

  // Sync to inMemoryStateCache if present
  if (inMemoryStateCache) {
    const match = inMemoryStateCache.participants.find((p) => p.id === state.participantId);
    if (match) {
      match.pinHash = state.pinHash;
      match.pinSalt = state.pinSalt;
      match.encryptedRecipient = state.encryptedRecipient;
      match.encryptedWithPin = state.encryptedWithPin;
      match.isRevealed = state.isRevealed;
      match.revealedAt = state.revealedAt;
      match.passkeyCredentialId = state.passkeyCredentialId;
      match.passkeyPublicKey = state.passkeyPublicKey;
      match.passkeyCounter = state.passkeyCounter;
      match.passkeyRegisteredAt = state.passkeyRegisteredAt;
    }
  }

  // 0. Primary: PostgreSQL Transactional Store
  const { isPostgresConfigured, savePostgresParticipantState } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      const ok = await savePostgresParticipantState(state);
      if (!ok) {
        throw new Error("PostgreSQL save participant returned false");
      }
    } catch (pgErr) {
      console.error("Critical: Failed to save participant state to PostgreSQL:", pgErr);
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `Production Database Write Failure: ${pgErr instanceof Error ? pgErr.message : "Unable to persist participant state to PostgreSQL"}`
        );
      }
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
      if (state.pinHash || state.passkeyCredentialId) {
        promises.push(
          put(`v7/registered/${state.participantId}`, "1", {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            token: process.env.BLOB_READ_WRITE_TOKEN,
          })
        );
      }
      if (state.passkeyCredentialId) {
        allRegisteredCredentialIdsSet.add(state.passkeyCredentialId);
        promises.push(
          put(`v7/passkeys/${state.participantId}`, state.passkeyCredentialId, {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            token: process.env.BLOB_READ_WRITE_TOKEN,
          }),
          put(`v7/all_passkey_credentials/${state.passkeyCredentialId}`, state.participantId, {
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
    if (state.pinHash || state.passkeyCredentialId) {
      const regDir = path.join(localBaseDir, "v7_registered");
      if (!fs.existsSync(regDir)) fs.mkdirSync(regDir, { recursive: true });
      fs.writeFileSync(path.join(regDir, state.participantId), "");
    }
    if (state.passkeyCredentialId) {
      allRegisteredCredentialIdsSet.add(state.passkeyCredentialId);
      const passDir = path.join(localBaseDir, "v7_passkeys");
      const credsDir = path.join(localBaseDir, "v7_all_passkey_credentials");
      if (!fs.existsSync(passDir)) fs.mkdirSync(passDir, { recursive: true });
      if (!fs.existsSync(credsDir)) fs.mkdirSync(credsDir, { recursive: true });
      fs.writeFileSync(path.join(passDir, state.participantId), state.passkeyCredentialId);
      fs.writeFileSync(path.join(credsDir, state.passkeyCredentialId), state.participantId);
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
  state.version = 0;
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
  if (isDrawResetInProgress()) {
    return { success: false, error: RESET_IN_PROGRESS_ERROR };
  }
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
      if (existingRuntime.encryptedRecipient && existingRuntime.encryptedWithPin) {
        recipientName = decryptRecipient(
          existingRuntime.encryptedRecipient,
          pin,
          existingRuntime.pinSalt
        );
      }
    } catch {
      // ignore
    }
    if (!recipientName) {
      try {
        recipientName = decryptRecipient(
          participant.encryptedRecipient!,
          participant.code,
          masterState.masterSalt
        );
      } catch {
        // ignore
      }
    }

    return {
      success: true,
      isNewRegistration: false,
      participant: {
        id: participant.id,
        name: participant.name,
        isRevealed: existingRuntime.isRevealed,
      },
      recipientName: recipientName || undefined,
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
    passkeyCredentialId: existingRuntime?.passkeyCredentialId || null,
    passkeyPublicKey: existingRuntime?.passkeyPublicKey || null,
    passkeyCounter: existingRuntime?.passkeyCounter || 0,
    passkeyRegisteredAt: existingRuntime?.passkeyRegisteredAt || null,
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
    recipientName: originalRecipient,
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
  if (isDrawResetInProgress()) {
    return { success: false, error: RESET_IN_PROGRESS_ERROR };
  }
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
 * Retrieves biometric passkey and PIN status for a participant.
 */
export async function getParticipantBiometricStatus(participantId: string): Promise<{
  hasPasskey: boolean;
  hasPin: boolean;
  isRevealed: boolean;
  passkeyCredentialId?: string | null;
  passkeyPublicKey?: string | null;
  passkeyCounter: number;
  name: string;
}> {
  const runtime = await getParticipantRuntimeState(participantId);
  const masterState = await getEventState();
  const p = masterState.participants.find((item) => item.id === participantId);

  const rawCredId = (runtime?.passkeyCredentialId || p?.passkeyCredentialId || "").trim();
  const validCredId = isValidPasskeyCredentialId(rawCredId) ? rawCredId : null;
  const rawPubKey = (runtime?.passkeyPublicKey || p?.passkeyPublicKey || "").trim();
  const validPubKey = rawPubKey.length > 0 && validCredId ? rawPubKey : null;
  const counter = Number(runtime?.passkeyCounter ?? p?.passkeyCounter ?? 0);

  return {
    hasPasskey: Boolean(validCredId),
    hasPin: Boolean(runtime?.pinHash || p?.pinHash),
    isRevealed: Boolean(runtime?.isRevealed || p?.isRevealed),
    passkeyCredentialId: validCredId,
    passkeyPublicKey: validPubKey,
    passkeyCounter: counter,
    name: runtime?.name || p?.name || participantId,
  };
}

/**
 * Registers a new biometric passkey credential (Face ID / Touch ID / Device Passcode) for a participant.
 */
export async function registerParticipantBiometric(
  participantId: string,
  credential: { id: string; publicKey: string; counter?: number }
): Promise<{
  success: boolean;
  error?: string;
  participant?: { id: string; name: string; isRevealed: boolean };
  recipientName?: string;
}> {
  if (isDrawResetInProgress()) {
    return { success: false, error: RESET_IN_PROGRESS_ERROR };
  }
  const masterState = await getEventState();
  const participant = masterState.participants.find((p) => p.id === participantId);
  if (!participant) {
    return { success: false, error: "Participant not found." };
  }

  // Prevent duplicate registration or unauthorized overwrite of an existing valid passkey
  const existingRuntime = await getParticipantRuntimeState(participantId);
  const BASE64URL_REGEX = /^[A-Za-z0-9_-]{16,}$/;
  const existingCredId = (existingRuntime?.passkeyCredentialId || participant.passkeyCredentialId || "").trim();
  if (existingCredId && BASE64URL_REGEX.test(existingCredId) && existingCredId !== credential.id) {
    return {
      success: false,
      error: "A biometric passkey is already registered for this participant. Duplicate registration is blocked.",
    };
  }

  let originalRecipient = "";
  try {
    if (!participant.encryptedRecipient) {
      throw new Error("No assignment found for participant");
    }
    originalRecipient = decryptRecipient(
      participant.encryptedRecipient,
      participant.code,
      masterState.masterSalt
    );
  } catch (err) {
    console.error("Decryption error during biometric registration:", err);
    return { success: false, error: "Could not initialize assignment." };
  }

  const runtime = existingRuntime || {
    participantId: participant.id,
    name: participant.name,
    encryptedRecipient: participant.encryptedRecipient,
    encryptedWithPin: false,
    isRevealed: false,
    revealedAt: null,
    registeredAt: new Date().toISOString(),
  };

  runtime.passkeyCredentialId = credential.id;
  runtime.passkeyPublicKey = credential.publicKey;
  runtime.passkeyCounter = credential.counter ?? 0;
  runtime.passkeyRegisteredAt = new Date().toISOString();

  await saveParticipantRuntimeState(runtime);

  return {
    success: true,
    participant: {
      id: participant.id,
      name: participant.name,
      isRevealed: runtime.isRevealed,
    },
    recipientName: originalRecipient,
  };
}

/**
 * Authenticates a participant using their registered biometric credential.
 */
export async function authenticateParticipantBiometric(
  participantId: string,
  newCounter?: number
): Promise<{
  success: boolean;
  error?: string;
  participant?: { id: string; name: string; isRevealed: boolean };
  recipientName?: string;
}> {
  if (isDrawResetInProgress()) {
    return { success: false, error: RESET_IN_PROGRESS_ERROR };
  }
  const masterState = await getEventState();
  const participant = masterState.participants.find((p) => p.id === participantId);
  if (!participant) {
    return { success: false, error: "Participant not found." };
  }

  const runtime = await getParticipantRuntimeState(participantId);
  if (!runtime || !runtime.passkeyCredentialId) {
    return { success: false, error: "No biometric passkey registered for this participant." };
  }

  // Update anti-replay counter if provided by authenticator verification (defense-in-depth)
  if (typeof newCounter === "number") {
    const currentCounter = Number(runtime.passkeyCounter || 0);
    if (currentCounter > 0 && newCounter <= currentCounter) {
      return {
        success: false,
        error: `Potential replay attack detected: Authenticator counter (${newCounter}) must be strictly greater than stored counter (${currentCounter}).`,
      };
    }
    runtime.passkeyCounter = newCounter;
    await saveParticipantRuntimeState(runtime);
  }

  let recipientName: string | undefined;
  try {
    recipientName = decryptRecipient(
      participant.encryptedRecipient!,
      participant.code,
      masterState.masterSalt
    );
  } catch (err) {
    console.error("Recipient decryption error:", err);
  }

  return {
    success: true,
    participant: {
      id: participant.id,
      name: participant.name,
      isRevealed: runtime.isRevealed,
    },
    recipientName,
  };
}

/**
 * Reveals recipient for a participant authenticated via biometrics or active session.
 */
export async function revealRecipientWithBiometric(
  participantId: string
): Promise<{
  success: boolean;
  recipientName?: string;
  isFirstReveal?: boolean;
  error?: string;
}> {
  if (isDrawResetInProgress()) {
    return { success: false, error: RESET_IN_PROGRESS_ERROR };
  }
  const masterState = await getEventState();
  const participant = masterState.participants.find((p) => p.id === participantId);
  if (!participant) {
    return { success: false, error: "Participant not found." };
  }

  const runtime = await getParticipantRuntimeState(participantId);
  const BASE64URL_REGEX = /^[A-Za-z0-9_-]{16,}$/;
  const rawCredId = (runtime?.passkeyCredentialId || participant.passkeyCredentialId || "").trim();
  const hasPasskey = BASE64URL_REGEX.test(rawCredId);
  const hasPin = Boolean(runtime?.pinHash || participant.pinHash);

  if (!hasPasskey && !hasPin) {
    return {
      success: false,
      error: "Authentication session expired due to event reset. Please enroll again.",
    };
  }

  const activeRuntime: ParticipantRuntimeState = runtime || {
    participantId: participant.id,
    name: participant.name,
    encryptedRecipient: participant.encryptedRecipient!,
    encryptedWithPin: false,
    isRevealed: false,
    revealedAt: null,
    registeredAt: new Date().toISOString(),
  };

  let decryptedName: string;
  try {
    decryptedName = decryptRecipient(
      participant.encryptedRecipient!,
      participant.code,
      masterState.masterSalt
    );
  } catch (err) {
    console.error("Biometric reveal decryption error:", err);
    return { success: false, error: "Failed to decrypt secret assignment." };
  }

  const isFirstReveal = !activeRuntime.isRevealed;
  if (isFirstReveal) {
    activeRuntime.isRevealed = true;
    activeRuntime.revealedAt = new Date().toISOString();
    await saveParticipantRuntimeState(activeRuntime);
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
    | "GIFT_REVEALED"
    | "REGISTER_PASSKEY"
    | "DELETE_PASSKEY"
    | "AUTH_PASSKEY_LOGIN"
    | "SET_DRAW_MODE"
    | "RESET_AUDIT_LOGS";
  actionLabel: string;
  timestamp: string;
  ip: string;
  status: "SUCCESS" | "FAILED";
  details: string;
}

export interface AdminSafeState {
  status: string;
  version: number;
  drawMode: "constrained" | "free";
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
    version: state.version ?? 0,
    drawMode: state.drawMode || "constrained",
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

  let resetVersion = 1;
  try {
    const state = await getEventState();
    resetVersion = state.deviceResetVersion || 1;
  } catch {
    // fallback
  }

  // Check in-memory cache
  if (deviceBindingCache.has(cleanId)) {
    const cached = deviceBindingCache.get(cleanId)!;
    if (cached.resetVersion && cached.resetVersion < resetVersion) {
      deviceBindingCache.delete(cleanId);
      return null;
    }
    return cached;
  }

  // 0. Primary: PostgreSQL Transactional Store
  const { isPostgresConfigured, getPostgresDeviceOrHardwareBinding } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      const pg = await getPostgresDeviceOrHardwareBinding(cleanId, null, resetVersion);
      if (pg) {
        const record: DeviceBindingRecord = {
          deviceId: pg.deviceId,
          hardwareFingerprint: pg.hardwareFingerprint,
          participantId: pg.participantId,
          participantName: pg.participantName,
          boundAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          ip: "postgres",
          userAgent: "",
          deviceModel: "Personal Device",
          os: "Operating System",
          browser: "Web Browser",
          summary: "Bound Physical Device",
          hasRevealed: false,
          revealedAt: null,
          resetVersion,
        };
        deviceBindingCache.set(cleanId, record);
        return record;
      }
    } catch (pgErr) {
      console.warn("Notice: PostgreSQL device fetch attempt:", pgErr);
    }
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
        if (parsed.resetVersion && parsed.resetVersion < resetVersion) {
          return null;
        }
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
      if (parsed.resetVersion && parsed.resetVersion < resetVersion) {
        return null;
      }
      deviceBindingCache.set(cleanId, parsed);
      return parsed;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Authoritatively retrieves hardware-level device binding using deterministic hardware fingerprint.
 * Functions across Normal, Private, and Incognito browsing windows on the exact same physical device.
 */
export async function getHardwareDeviceBinding(hwFp: string): Promise<DeviceBindingRecord | null> {
  if (!hwFp || typeof hwFp !== "string") return null;
  const cleanFp = hwFp.trim().toLowerCase();

  let resetVersion = 1;
  try {
    const state = await getEventState();
    resetVersion = state.deviceResetVersion || 1;
  } catch {
    // fallback
  }

  // Check in-memory cache
  if (hardwareBindingCache.has(cleanFp)) {
    const cached = hardwareBindingCache.get(cleanFp)!;
    if (cached.resetVersion && cached.resetVersion < resetVersion) {
      hardwareBindingCache.delete(cleanFp);
      return null;
    }
    return cached;
  }

  // 0. Primary: PostgreSQL Transactional Store
  const { isPostgresConfigured, getPostgresDeviceOrHardwareBinding } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      const pg = await getPostgresDeviceOrHardwareBinding("", cleanFp, resetVersion);
      if (pg) {
        const record: DeviceBindingRecord = {
          deviceId: pg.deviceId,
          hardwareFingerprint: pg.hardwareFingerprint,
          participantId: pg.participantId,
          participantName: pg.participantName,
          boundAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          ip: "postgres",
          userAgent: "",
          deviceModel: "Personal Device",
          os: "Operating System",
          browser: "Web Browser",
          summary: "Bound Physical Device",
          hasRevealed: false,
          revealedAt: null,
          resetVersion,
        };
        hardwareBindingCache.set(cleanFp, record);
        return record;
      }
    } catch (pgErr) {
      console.warn("Notice: PostgreSQL hardware fetch attempt:", pgErr);
    }
  }

  // 1. Check Vercel Private Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const url = `${KNOWN_BLOB_BASE}/v7/hardware_devices/${cleanFp}.json`;
      const res: any = await get(url, {
        access: "private",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      if (res && res.stream) {
        const text = await new Response(res.stream).text();
        const parsed: DeviceBindingRecord = JSON.parse(text);
        if (parsed.resetVersion && parsed.resetVersion < resetVersion) {
          return null;
        }
        hardwareBindingCache.set(cleanFp, parsed);
        return parsed;
      }
    } catch {
      // ignore miss
    }
  }

  // 2. Check local disk
  try {
    const dir = getLocalHardwareDeviceDir();
    const localFile = path.join(dir, `${cleanFp}.json`);
    if (fs.existsSync(localFile)) {
      const data = fs.readFileSync(localFile, "utf-8");
      const parsed: DeviceBindingRecord = JSON.parse(data);
      if (parsed.resetVersion && parsed.resetVersion < resetVersion) {
        return null;
      }
      hardwareBindingCache.set(cleanFp, parsed);
      return parsed;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Composite resolver: checks both standard deviceId and client hardware fingerprint.
 * Blocks any attempt to bypass device restrictions via Incognito mode or cache wiping.
 */
export async function getDeviceOrHardwareBinding(
  deviceId: string,
  hwFp?: string | null
): Promise<DeviceBindingRecord | null> {
  const { isPostgresConfigured, getPostgresDeviceOrHardwareBinding } = await import("./db");
  if (isPostgresConfigured()) {
    let resetVersion = 1;
    try {
      const state = await getEventState();
      resetVersion = state.deviceResetVersion || 1;
    } catch {
      // fallback
    }
    const pgBinding = await getPostgresDeviceOrHardwareBinding(deviceId, hwFp, resetVersion);
    if (pgBinding) {
      return {
        deviceId: pgBinding.deviceId,
        hardwareFingerprint: pgBinding.hardwareFingerprint,
        participantId: pgBinding.participantId,
        participantName: pgBinding.participantName,
        boundAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        ip: "postgres",
        userAgent: "",
        deviceModel: "Personal Device",
        os: "Operating System",
        browser: "Web Browser",
        summary: "Bound Physical Device",
        hasRevealed: false,
        revealedAt: null,
        resetVersion,
      };
    }
  }

  const byDevice = await getDeviceBinding(deviceId);
  if (byDevice) {
    return byDevice;
  }
  if (hwFp && hwFp.trim().length > 5) {
    const byHw = await getHardwareDeviceBinding(hwFp);
    if (byHw) {
      return byHw;
    }
  }
  return null;
}

/**
 * Strictly validates whether a credential ID is a valid Base64URL passkey identifier.
 * Excludes legacy marker strings and malformed values to prevent atob DOMExceptions.
 */
export function isValidPasskeyCredentialId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (
    trimmed === "passkey_marker_present" ||
    trimmed === "registered_marker_present" ||
    trimmed.includes("marker") ||
    trimmed === "registered" ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed.includes(" ")
  ) {
    return false;
  }
  return /^[A-Za-z0-9_-]{16,}$/.test(trimmed);
}

/**
 * Returns all WebAuthn passkey credential IDs currently registered across all participants.
 * Used for excludeCredentials to hardware-lock platform authenticators (Touch ID / Face ID / Secure Enclave).
 */
export async function getAllRegisteredPasskeyCredentials(): Promise<string[]> {
  await syncMarkers();
  const creds = new Set<string>();

  const { isPostgresConfigured, getPostgresAllPasskeyCredentialIds } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      const pgCreds = await getPostgresAllPasskeyCredentialIds();
      for (const id of pgCreds) {
        if (isValidPasskeyCredentialId(id)) {
          creds.add(id.trim());
        }
      }
    } catch (err) {
      console.warn("Notice: PostgreSQL passkey creds fetch:", err);
    }
  }

  for (const id of allRegisteredCredentialIdsSet) {
    if (isValidPasskeyCredentialId(id)) {
      creds.add(id.trim());
    }
  }

  for (const [, p] of runtimeParticipantCache) {
    if (isValidPasskeyCredentialId(p.passkeyCredentialId)) {
      creds.add(p.passkeyCredentialId.trim());
    }
  }

  try {
    const state = await getEventState();
    for (const p of state.participants) {
      if (isValidPasskeyCredentialId(p.passkeyCredentialId)) {
        creds.add(p.passkeyCredentialId.trim());
      }
    }
  } catch {
    // ignore
  }

  return Array.from(creds);
}

/**
 * Authoritatively binds a device to an authenticated participant.
 * Prevents race conditions and duplicate multi-account device usage.
 */
export async function bindDeviceToParticipant(
  deviceId: string,
  participantId: string,
  participantName: string,
  meta?: { ip?: string; userAgent?: string; hardwareFingerprint?: string }
): Promise<{ success: boolean; error?: string }> {
  if (isDrawResetInProgress()) {
    return { success: false, error: RESET_IN_PROGRESS_ERROR };
  }
  if (!deviceId || typeof deviceId !== "string") {
    return { success: false, error: "Invalid device identifier." };
  }

  // If transactional PostgreSQL database is configured, enforce atomic uniqueness constraints in Postgres
  const { isPostgresConfigured, atomicBindDeviceToParticipant } = await import("./db");
  if (isPostgresConfigured()) {
    let resetVersion = 1;
    try {
      const state = await getEventState();
      resetVersion = state.deviceResetVersion || 1;
    } catch {
      // fallback
    }
    return atomicBindDeviceToParticipant(deviceId, participantId, participantName, {
      ...meta,
      resetVersion,
    });
  }

  const cleanId = deviceId.trim().toLowerCase();
  const cleanHwFp = meta?.hardwareFingerprint?.trim().toLowerCase();

  // Check existing device binding
  const existing = await getDeviceBinding(cleanId);
  if (existing && existing.participantId !== participantId) {
    return {
      success: false,
      error: `This device is officially registered to ${existing.participantName}.`,
    };
  }

  // Check existing hardware binding
  if (cleanHwFp && cleanHwFp.length > 5) {
    const existingHw = await getHardwareDeviceBinding(cleanHwFp);
    if (existingHw && existingHw.participantId !== participantId) {
      return {
        success: false,
        error: `This physical device is already registered to ${existingHw.participantName}. Accessing multiple accounts from the same physical device is strictly forbidden.`,
      };
    }
  }

  const parsed = parseUserAgentDetails(meta?.userAgent || existing?.userAgent);
  const hasRevealed = Boolean(existing?.hasRevealed || revealedParticipantIds.has(participantId));
  const revealedAt = existing?.revealedAt || null;

  let resetVersion = 1;
  try {
    const state = await getEventState();
    resetVersion = state.deviceResetVersion || 1;
  } catch {
    // fallback
  }

  const record: DeviceBindingRecord = {
    deviceId: cleanId,
    hardwareFingerprint: cleanHwFp || existing?.hardwareFingerprint,
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
    resetVersion,
  };

  // Update in-memory caches
  deviceBindingCache.set(cleanId, record);
  if (cleanHwFp && cleanHwFp.length > 5) {
    hardwareBindingCache.set(cleanHwFp, record);
  }

  const serialized = JSON.stringify(record, null, 2);

  // 1. Persist to Vercel Private Blob
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const blobPromises = [
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
      ];
      if (cleanHwFp && cleanHwFp.length > 5) {
        blobPromises.push(
          put(`v7/hardware_devices/${cleanHwFp}.json`, serialized, {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: true,
            token: process.env.BLOB_READ_WRITE_TOKEN,
          })
        );
      }
      await Promise.all(blobPromises);
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

    if (cleanHwFp && cleanHwFp.length > 5) {
      const hwDir = getLocalHardwareDeviceDir();
      const hwFilePath = path.join(hwDir, `${cleanHwFp}.json`);
      fs.writeFileSync(hwFilePath, serialized, "utf-8");
    }
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

  // 0. Primary: PostgreSQL Cleanup
  const { isPostgresConfigured, clearPostgresParticipant } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      await clearPostgresParticipant(participantId);
    } catch (pgErr) {
      console.warn("Notice: clearing participant in Postgres:", pgErr);
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

/**
 * Clears a specific device binding (e.g., when a user clicks "Unbind / Logout").
 */
export async function clearDeviceBinding(deviceId: string): Promise<{ success: boolean }> {
  if (!deviceId || typeof deviceId !== "string") return { success: true };
  const cleanId = deviceId.trim().toLowerCase();
  const binding = deviceBindingCache.get(cleanId);
  deviceBindingCache.delete(cleanId);

  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const urls: string[] = [`${KNOWN_BLOB_BASE}/v7/devices/${cleanId}.json`];
      if (binding?.participantId) {
        urls.push(`${KNOWN_BLOB_BASE}/v7/participant_devices/${binding.participantId}/${cleanId}`);
      }
      await del(urls, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch {
      // ignore
    }
  }

  try {
    const localFile = path.join(getLocalDeviceDir(), `${cleanId}.json`);
    if (fs.existsSync(localFile)) {
      fs.unlinkSync(localFile);
    }
  } catch {
    // ignore
  }

  return { success: true };
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
 * Resets/clears all administrative activity and login audit records.
 * Leaves the logging infrastructure fully intact for future events.
 */
export async function clearAdminAuditLogs(): Promise<{ success: boolean; clearedCount: number }> {
  const currentLogs = await getAdminAuditLogs();
  const clearedCount = currentLogs.length;
  auditLogsCache = [];
  const emptySerialized = JSON.stringify([], null, 2);

  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      await put(AUDIT_LOGS_BLOB_KEY, emptySerialized, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch (err) {
      console.warn("Failed to reset audit logs in Blob:", err);
    }
  }

  try {
    const localDir = path.dirname(getStorageFilePath());
    const filePath = path.join(localDir, "admin_audit_logs.json");
    fs.writeFileSync(filePath, emptySerialized, "utf-8");
  } catch {
    // ignore
  }

  return { success: true, clearedCount };
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

  // 0. Primary: PostgreSQL Transactional Store
  const { isPostgresConfigured, recordPostgresDeviceReveal } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      await recordPostgresDeviceReveal(cleanId, participantId);
    } catch (pgErr) {
      console.warn("Notice updating reveal in PostgreSQL:", pgErr);
    }
  }

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

  try {
    const state = await getEventState(true);
    state.deviceResetVersion = (state.deviceResetVersion || 1) + 1;
    await saveEventState(state);
  } catch {
    // ignore
  }

  // Clear PostgreSQL device and hardware bindings
  const { isPostgresConfigured, clearPostgresDeviceBindings } = await import("./db");
  if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
    try {
      await clearPostgresDeviceBindings();
    } catch (pgErr) {
      console.warn("Notice: clearing Postgres device bindings:", pgErr);
    }
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

/**
 * Full Event Reset: Clears all participant PINs, reveal statuses, passkeys, and device bindings,
 * advancing the round version (invalidating old cookies/sessions) while preserving all 56
 * Secret Santa assignments byte-for-byte with their constraints.
 */
export async function fullEventReset(
  clientIp: string = "unknown"
): Promise<{ success: boolean; message: string; version: number }> {
  if (isDrawResetInProgress()) {
    throw new Error(RESET_IN_PROGRESS_ERROR);
  }

  activeResetCount++;
  try {
    const state = await getEventState(true);

    // 1. Create timestamped backup
    const timestamp = Date.now();
    const backupBlobKey = `secret-santa-event.backup-pre-full-reset-${timestamp}.json`;
    const backupSerialized = JSON.stringify(state, null, 2);

    safeWriteBackup(backupBlobKey, backupSerialized);

    if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
      try {
        await put(backupBlobKey, backupSerialized, {
          access: "private",
          addRandomSuffix: false,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      } catch (err) {
        console.warn("Notice: backup in Blob:", err);
      }
    }

    // 2. Clear all participants' PINs, passkeys, and reveal status
    state.participants.forEach((p) => {
      p.pinHash = null;
      p.pinSalt = null;
      p.encryptedWithPin = false;
      p.isRevealed = false;
      p.revealedAt = null;
      p.passkeyCredentialId = null;
      p.passkeyPublicKey = null;
      p.passkeyCounter = 0;
      p.passkeyRegisteredAt = null;
    });

    // 3. Increment version to invalidate all active session tokens and device bindings
    state.version = (state.version ?? 0) + 1;
    state.deviceResetVersion = (state.deviceResetVersion || 1) + 1;

    // 4. Save state atomically BEFORE clearing runtime files/caches
    await saveEventState(state);

    // 5. Clear in-memory caches & rate limits
    inMemoryStateCache = null;
    runtimeParticipantCache.clear();
    revealedParticipantIds.clear();
    registeredParticipantIds.clear();
    passkeyParticipantIds.clear();
    deviceBindingCache.clear();
    hardwareBindingCache.clear();
    allRegisteredCredentialIdsSet.clear();
    lastMarkersSyncTimestamp = 0;
    clearAllRateLimits();

    // Clear PostgreSQL device bindings and reset all participant credentials
    const { isPostgresConfigured, resetPostgresParticipantsAuthentication } = await import("./db");
    if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
      try {
        await resetPostgresParticipantsAuthentication();
      } catch (pgErr) {
        console.warn("Notice: clearing Postgres participants authentication:", pgErr);
      }
    }

    // 6. Clear all device bindings and markers from Blob
    if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
      try {
        for (const prefix of [
          "v7/devices/",
          "v7/hardware_devices/",
          "v7/participant_devices/",
          "v7/revealed/",
          "v7/registered/",
          "v7/passkeys/",
          "v7/all_passkey_credentials/",
          "v7/participants/",
        ]) {
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
        console.warn("Notice: reset in Blob:", err);
      }
    }

    try {
      const localDir = path.dirname(getStorageFilePath());
      for (const sub of [
        "v7_revealed",
        "v7_registered",
        "v7_passkeys",
        "v7_all_passkey_credentials",
        "v7_participants",
        "v7_devices",
        "v7_hardware_devices",
        "v5_participants",
        "v5_registered",
        "v5_revealed",
      ]) {
        const targetDir = path.join(/*turbopackIgnore: true*/ localDir, sub);
        if (fs.existsSync(/*turbopackIgnore: true*/ targetDir)) {
          fs.rmSync(/*turbopackIgnore: true*/ targetDir, { recursive: true, force: true });
        }
      }
      const dir = getLocalDeviceDir();
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.endsWith(".json")) {
            fs.unlinkSync(path.join(dir, f));
          }
        }
      }
      const hwDir = getLocalHardwareDeviceDir();
      if (fs.existsSync(hwDir)) {
        const files = fs.readdirSync(hwDir);
        for (const f of files) {
          if (f.endsWith(".json")) {
            fs.unlinkSync(path.join(hwDir, f));
          }
        }
      }
    } catch {
      // ignore
    }

    await recordAdminAuditLog({
      action: "RESET_ALL_DEVICES",
      actionLabel: "Full Event Reset",
      ip: clientIp,
      status: "SUCCESS",
      details: `Full Event Reset executed. All 56 participant PINs, passkeys, reveal states, and device bindings were cleared. Assignments remain 100% intact. Advanced to Round ${state.version}.`,
    });

    return {
      success: true,
      message: `Full Event Reset completed. All participant PINs, passkeys, reveal records, and device locks have been completely reset. Event is now at Round ${state.version}.`,
      version: state.version,
    };
  } finally {
    activeResetCount--;
  }
}

/**
 * Updates the Organizer master password with salted scrypt hashing.
 */
export async function updateAdminPassword(
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters long.");
  }
  const state = await getEventState(true);
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(newPassword, salt, 32).toString("hex");

  state.adminPasswordHash = hash;
  state.adminPasswordSalt = salt;
  await saveEventState(state);

  return {
    success: true,
    message: "Organizer password updated successfully.",
  };
}

/**
 * Retrieve all registered WebAuthn / Passkey credentials for Admin.
 */
export async function getAdminPasskeys(): Promise<AdminPasskey[]> {
  const state = await getEventState(true);
  return state.adminPasskeys || [];
}

/**
 * Register or update an Admin Passkey.
 */
export async function saveAdminPasskey(passkey: AdminPasskey): Promise<void> {
  const state = await getEventState(true);
  if (!state.adminPasskeys) {
    state.adminPasskeys = [];
  }
  const existingIdx = state.adminPasskeys.findIndex((pk) => pk.id === passkey.id);
  if (existingIdx >= 0) {
    state.adminPasskeys[existingIdx] = passkey;
  } else {
    state.adminPasskeys.push(passkey);
  }
  await saveEventState(state);
}

/**
 * Update the counter for an Admin Passkey to prevent replay attacks.
 */
export async function updateAdminPasskeyCounter(id: string, counter: number): Promise<void> {
  const state = await getEventState(true);
  if (!state.adminPasskeys) return;
  const passkey = state.adminPasskeys.find((pk) => pk.id === id);
  if (passkey) {
    passkey.counter = counter;
    await saveEventState(state);
  }
}

/**
 * Remove a registered Admin Passkey by its credential ID.
 */
export async function removeAdminPasskey(id: string): Promise<boolean> {
  const state = await getEventState(true);
  if (!state.adminPasskeys) return false;
  const initialLen = state.adminPasskeys.length;
  state.adminPasskeys = state.adminPasskeys.filter((pk) => pk.id !== id);
  if (state.adminPasskeys.length !== initialLen) {
    await saveEventState(state);
    return true;
  }
  return false;
}

/**
 * Resets a single participant's registration, PIN, and reveal status,
 * and clears their device binding so they can start fresh without wiping others.
 */
export async function resetSingleParticipant(
  participantId: string,
  clientIp: string = "unknown"
): Promise<{ success: boolean; message: string }> {
  const state = await getEventState(true);
  const participant = state.participants.find((p) => p.id === participantId);
  if (!participant) {
    throw new Error("Participant not found.");
  }

  participant.pinHash = null;
  participant.pinSalt = null;
  participant.encryptedWithPin = false;
  participant.isRevealed = false;
  participant.revealedAt = null;
  participant.passkeyCredentialId = null;
  participant.passkeyPublicKey = null;
  participant.passkeyCounter = 0;
  participant.passkeyRegisteredAt = null;

  runtimeParticipantCache.delete(participantId);
  revealedParticipantIds.delete(participantId);
  registeredParticipantIds.delete(participantId);
  passkeyParticipantIds.delete(participantId);
  lastMarkersSyncTimestamp = 0;

  // Clear Blob markers
  if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
    try {
      const markers = [
        `v7/revealed/${participantId}`,
        `v7/registered/${participantId}`,
        `v7/passkeys/${participantId}`,
        `v7/participants/${participantId}.json`,
      ];
      for (const m of markers) {
        try {
          const listRes = await list({ prefix: m, token: process.env.BLOB_READ_WRITE_TOKEN });
          if (listRes.blobs.length > 0) {
            await del(listRes.blobs.map((b) => b.url), { token: process.env.BLOB_READ_WRITE_TOKEN });
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  // Clear device binding for this participant
  await clearDeviceBindingsForParticipant(participantId);

  await saveEventState(state);

  await recordAdminAuditLog({
    action: "RESET_ALL_DEVICES",
    actionLabel: "Reset Participant",
    ip: clientIp,
    status: "SUCCESS",
    details: `Participant ${participant.name} (${participant.id}) was individually reset (PIN, reveal, and device binding cleared).`,
  });

  return {
    success: true,
    message: `Participant ${participant.name} has been completely reset.`,
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

  if (state.drawMode === "free") {
    throw new Error(
      "Cannot shuffle special subgroup because the draw is currently in Free Mode. Please activate Constrained Mode first."
    );
  }

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

  safeWriteBackup(backupBlobKey, backupSerialized);

  // 2. Extract and preserve participants' assignments outside the designated subgroup
  const preservedOutsidePairs: AssignmentPair[] = [];
  const participantsOutside = state.participants.filter(
    (p) => !SUBGROUP_20_ID_SET.has(p.id as any)
  );

  const expectedOutsideCount = PARTICIPANTS.length - SUBGROUP_20_IDS.length;
  if (participantsOutside.length !== expectedOutsideCount) {
    throw new Error(`Expected ${expectedOutsideCount} participants outside designated subgroup, found ${participantsOutside.length}`);
  }

  for (const p of participantsOutside) {
    if (!p.encryptedRecipient) {
      throw new Error(`Participant ${p.name} missing encrypted recipient`);
    }
    const recName = decryptRecipient(p.encryptedRecipient, p.code, state.masterSalt);
    const recP = PARTICIPANTS.find((item) => item.name === recName);
    if (!recP) {
      throw new Error(`Failed to resolve recipient for ${p.name}`);
    }
    preservedOutsidePairs.push({
      giverId: p.id,
      giverName: p.name,
      recipientId: recP.id,
      recipientName: recP.name,
    });
  }

  // 3. Generate fresh randomized pairs for the designated subgroup
  const subgroupParticipants = PARTICIPANTS.filter((p) => SUBGROUP_20_ID_SET.has(p.id as any));
  const newSubgroupPairs = generateSubgroup20Pairs(subgroupParticipants);

  // 4. Combine and validate all assignments
  const allAssignments: AssignmentPair[] = [...newSubgroupPairs, ...preservedOutsidePairs];

  const validation = validateConstrainedSecretSantaDraw(PARTICIPANTS, allAssignments);
  if (!validation.valid) {
    throw new Error(`Draw validation failed: ${validation.reason}`);
  }

  // Check reciprocal Ghazal ⇄ George
  const map = new Map<string, string>();
  for (const a of allAssignments) {
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
    throw new Error("Mutual exclusion validation failed for Zeina and Hamza!");
  }
  if (
    map.get(FORBIDDEN_EXCLUSION_C) === FORBIDDEN_EXCLUSION_D ||
    map.get(FORBIDDEN_EXCLUSION_D) === FORBIDDEN_EXCLUSION_C
  ) {
    throw new Error("Mutual exclusion validation failed for Raghad and Mohammad!");
  }

  // 5. Encrypt with new masterSalt
  const newMasterSalt = crypto.randomBytes(16).toString("hex");
  const newVersion = (state.version ?? 0) + 1;

  const newParticipantsState = PARTICIPANTS.map((p) => {
    const pair = allAssignments.find((a) => a.giverId === p.id)!;
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
      passkeyCredentialId: null,
      passkeyPublicKey: null,
      passkeyCounter: 0,
      passkeyRegisteredAt: null,
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
  clientIp: string = "unknown",
  forcedMode?: "constrained" | "free"
): Promise<{
  success: boolean;
  message: string;
  version: number;
  backupBlobKey: string;
}> {
  if (isDrawResetInProgress()) {
    throw new Error(RESET_IN_PROGRESS_ERROR);
  }

  activeResetCount++;
  try {
    const state = await getEventState(true);

    // 1. Automatic timestamped backup with explicit disk verification
    const timestamp = Date.now();
    const backupBlobKey = `secret-santa-event.backup-pre-full-regenerate-${timestamp}.json`;
    const backupSerialized = JSON.stringify(state, null, 2);

    safeWriteBackup(backupBlobKey, backupSerialized);

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

    // 2. Generate draw according to mode (defaults to official constrained mode)
    const targetMode = forcedMode ?? "constrained";
    const isFree = targetMode === "free";

    // Build previous assignments map to prevent duplicate consecutive recipients on regenerate
    const previousAssignmentsMap: Record<string, string> = {};
    if (state.participants && state.masterSalt) {
      for (const p of state.participants) {
        if (p.encryptedRecipient && p.code) {
          try {
            const recName = decryptRecipient(p.encryptedRecipient, p.code, state.masterSalt);
            const recP = PARTICIPANTS.find((x) => x.name === recName);
            if (recP) {
              previousAssignmentsMap[p.id] = recP.id;
            }
          } catch {
            // ignore
          }
        }
      }
    }

    const pairs = isFree
      ? generateDistinctDerangement(PARTICIPANTS, previousAssignmentsMap)
      : generateConstrainedSecretSantaDraw(PARTICIPANTS);

    const validation = isFree
      ? validateDerangement(PARTICIPANTS, pairs)
      : validateConstrainedSecretSantaDraw(PARTICIPANTS, pairs);

    if (!validation.valid) {
      throw new Error(`Draw validation failed: ${validation.reason}`);
    }

    // 3. Encrypt with new masterSalt
    const newMasterSalt = crypto.randomBytes(16).toString("hex");
    const newVersion = (state.version ?? 0) + 1;

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
        passkeyCredentialId: null,
        passkeyPublicKey: null,
        passkeyCounter: 0,
        passkeyRegisteredAt: null,
      };
    });

    state.version = newVersion;
    state.status = "active";
    state.drawMode = targetMode;
    state.generatedAt = new Date().toISOString();
    state.masterSalt = newMasterSalt;
    state.participants = newParticipantsState;
    state.deviceResetVersion = (state.deviceResetVersion || 1) + 1;

    // 4. Save state atomically BEFORE clearing runtime files/caches
    await saveEventState(state);

    // 5. Clear caches and rate limits
    inMemoryStateCache = null;
    runtimeParticipantCache.clear();
    revealedParticipantIds.clear();
    registeredParticipantIds.clear();
    passkeyParticipantIds.clear();
    deviceBindingCache.clear();
    hardwareBindingCache.clear();
    allRegisteredCredentialIdsSet.clear();
    lastMarkersSyncTimestamp = 0;
    clearAllRateLimits();

    // Clear PostgreSQL device bindings and reset all participant credentials
    const { isPostgresConfigured, resetPostgresParticipantsAuthentication } = await import("./db");
    if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
      try {
        await resetPostgresParticipantsAuthentication();
      } catch (pgErr) {
        console.warn("Notice: clearing Postgres participants authentication:", pgErr);
      }
    }

    // 6. Clear local device & marker directories
    try {
      const localDir = path.dirname(getStorageFilePath());
      for (const sub of [
        "v7_revealed",
        "v7_registered",
        "v7_passkeys",
        "v7_all_passkey_credentials",
        "v7_participants",
        "v7_devices",
        "v7_hardware_devices",
        "v5_participants",
        "v5_registered",
        "v5_revealed",
      ]) {
        const targetDir = path.join(/*turbopackIgnore: true*/ localDir, sub);
        if (fs.existsSync(/*turbopackIgnore: true*/ targetDir)) {
          fs.rmSync(/*turbopackIgnore: true*/ targetDir, { recursive: true, force: true });
        }
      }
      const dir = getLocalDeviceDir();
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.endsWith(".json")) {
            fs.unlinkSync(path.join(dir, f));
          }
        }
      }
      const hwDir = getLocalHardwareDeviceDir();
      if (fs.existsSync(hwDir)) {
        const files = fs.readdirSync(hwDir);
        for (const f of files) {
          if (f.endsWith(".json")) {
            fs.unlinkSync(path.join(hwDir, f));
          }
        }
      }
    } catch {
      // ignore
    }

    // 7. Clean runtime blobs (devices, participant records, but preserve audit logs and admin passkeys)
    if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
      try {
        let hasMore = true;
        let cursor: string | undefined = undefined;
        while (hasMore) {
          const vList: any = await list({
            prefix: "v7/",
            cursor,
            limit: 1000,
            token: process.env.BLOB_READ_WRITE_TOKEN,
          });
          const urlsToDelete = vList.blobs
            .filter((b: any) => !b.pathname.includes("admin_audit_logs") && !b.pathname.includes("admin_passkeys"))
            .map((b: any) => b.url);
          if (urlsToDelete.length > 0) {
            await del(urlsToDelete, { token: process.env.BLOB_READ_WRITE_TOKEN });
          }
          hasMore = Boolean(vList.hasMore);
          cursor = vList.cursor;
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
      details: `Full draw regenerated for ${PARTICIPANTS.length} participants with complete security & device reset. Mode: ${targetMode}. Round incremented to ${newVersion}. Backup: ${backupBlobKey}`,
    });

    return {
      success: true,
      message: `Full draw successfully regenerated for all ${PARTICIPANTS.length} participants with complete security & device reset. New Round ${newVersion} is now active.`,
      version: newVersion,
      backupBlobKey,
    };
  } finally {
    activeResetCount--;
  }
}

/**
 * Toggles between Constrained Mode (official holiday rules & subgroup) and Free Mode (unconstrained pure derangement).
 * When switching to Free mode: stashes official constrained assignments so they are never lost.
 * When switching back to Constrained mode: restores or regenerates with all mandatory rules intact.
 */
export async function setDrawMode(
  targetMode: "constrained" | "free",
  clientIp: string = "unknown"
): Promise<{ success: boolean; mode: "constrained" | "free"; version: number; message: string }> {
  if (isDrawResetInProgress()) {
    throw new Error(RESET_IN_PROGRESS_ERROR);
  }

  activeResetCount++;
  try {
    const state = await getEventState(true);
    const currentMode = state.drawMode || "constrained";

    const timestamp = Date.now();
    const backupBlobKey = `secret-santa-event.backup-pre-mode-${targetMode}-${timestamp}.json`;
    const backupSerialized = JSON.stringify(state, null, 2);

    safeWriteBackup(backupBlobKey, backupSerialized);

    if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
      try {
        await put(backupBlobKey, backupSerialized, {
          access: "private",
          addRandomSuffix: false,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
      } catch (err) {
        console.warn("Notice: backup in Blob:", err);
      }
    }

    const newVersion = (state.version ?? 0) + 1;
    const newDeviceResetVersion = (state.deviceResetVersion || 1) + 1;

    if (targetMode === "free") {
      // 1. If currently constrained, stash official participants & masterSalt safely
      if (currentMode === "constrained" && state.participants.length === PARTICIPANTS.length) {
        state.savedOfficialParticipants = JSON.parse(JSON.stringify(state.participants));
        state.savedOfficialMasterSalt = state.masterSalt;
      }

      // 2. Generate a pure unconstrained random derangement across all 56 participants
      const pairs = generateSecretSantaDerangement(PARTICIPANTS);
      const newMasterSalt = crypto.randomBytes(16).toString("hex");

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
          passkeyCredentialId: null,
          passkeyPublicKey: null,
          passkeyCounter: 0,
          passkeyRegisteredAt: null,
        };
      });

      state.version = newVersion;
      state.deviceResetVersion = newDeviceResetVersion;
      state.drawMode = "free";
      state.generatedAt = new Date().toISOString();
      state.masterSalt = newMasterSalt;
      state.participants = newParticipantsState;
    } else {
      // targetMode === "constrained"
      state.drawMode = "constrained";
      state.version = newVersion;
      state.deviceResetVersion = newDeviceResetVersion;
      state.generatedAt = new Date().toISOString();

      if (
        state.savedOfficialParticipants &&
        state.savedOfficialParticipants.length === PARTICIPANTS.length &&
        state.savedOfficialMasterSalt
      ) {
        // Restore official saved participants with reset PINs and reveal status
        state.masterSalt = state.savedOfficialMasterSalt;
        state.participants = state.savedOfficialParticipants.map((p) => ({
          ...p,
          isRevealed: false,
          revealedAt: null,
          pinHash: null,
          pinSalt: null,
          encryptedWithPin: false,
          passkeyCredentialId: null,
          passkeyPublicKey: null,
          passkeyCounter: 0,
          passkeyRegisteredAt: null,
        }));
      } else {
        // Re-generate constrained draw
        const pairs = generateConstrainedSecretSantaDraw(PARTICIPANTS);
        const newMasterSalt = crypto.randomBytes(16).toString("hex");
        state.masterSalt = newMasterSalt;
        state.participants = PARTICIPANTS.map((p) => {
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
            passkeyCredentialId: null,
            passkeyPublicKey: null,
            passkeyCounter: 0,
            passkeyRegisteredAt: null,
          };
        });
      }
    }

    // Clear in-memory caches and rate limits
    inMemoryStateCache = null;
    runtimeParticipantCache.clear();
    revealedParticipantIds.clear();
    registeredParticipantIds.clear();
    passkeyParticipantIds.clear();
    deviceBindingCache.clear();
    hardwareBindingCache.clear();
    allRegisteredCredentialIdsSet.clear();
    lastMarkersSyncTimestamp = 0;
    clearAllRateLimits();

    // Clear PostgreSQL device bindings and reset all participant credentials
    const { isPostgresConfigured, resetPostgresParticipantsAuthentication } = await import("./db");
    if (isPostgresConfigured() && !process.env.STORAGE_FILE_PATH) {
      try {
        await resetPostgresParticipantsAuthentication();
      } catch (pgErr) {
        console.warn("Notice: clearing Postgres participants authentication:", pgErr);
      }
    }

    // Clear Blob markers and device locks
    if (process.env.BLOB_READ_WRITE_TOKEN && !process.env.STORAGE_FILE_PATH) {
      try {
        for (const prefix of [
          "v7/devices/",
          "v7/hardware_devices/",
          "v7/participant_devices/",
          "v7/revealed/",
          "v7/registered/",
          "v7/passkeys/",
          "v7/all_passkey_credentials/",
          "v7/participants/",
        ]) {
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
        console.warn("Notice: reset in Blob:", err);
      }
    }

    try {
      const localDir = path.dirname(getStorageFilePath());
      for (const sub of [
        "v7_revealed",
        "v7_registered",
        "v7_passkeys",
        "v7_all_passkey_credentials",
        "v7_participants",
        "v7_devices",
        "v7_hardware_devices",
      ]) {
        const targetDir = path.join(/*turbopackIgnore: true*/ localDir, sub);
        if (fs.existsSync(/*turbopackIgnore: true*/ targetDir)) {
          fs.rmSync(/*turbopackIgnore: true*/ targetDir, { recursive: true, force: true });
        }
      }
      const dir = getLocalDeviceDir();
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.endsWith(".json")) {
            fs.unlinkSync(path.join(dir, f));
          }
        }
      }
      const hwDir = getLocalHardwareDeviceDir();
      if (fs.existsSync(hwDir)) {
        const files = fs.readdirSync(hwDir);
        for (const f of files) {
          if (f.endsWith(".json")) {
            fs.unlinkSync(path.join(hwDir, f));
          }
        }
      }
    } catch {
      // ignore
    }

    await saveEventState(state);

    const actionDetails =
      targetMode === "free"
        ? "Switched to Free Draw Mode (Test Mode). All special rules disabled for demo."
        : "Restored Constrained Draw Mode. All special rules (Subgroup 24, directed pairs) active.";

    await recordAdminAuditLog({
      action: "SET_DRAW_MODE",
      actionLabel: targetMode === "free" ? "Enable Free Mode (Test)" : "Restore Constrained Rules",
      ip: clientIp,
      status: "SUCCESS",
      details: `${actionDetails} Advanced to Round ${newVersion}. Backup: ${backupBlobKey}`,
    });

    return {
      success: true,
      mode: targetMode,
      version: newVersion,
      message:
        targetMode === "free"
          ? "Normal draw mode (unconstrained) activated successfully. Participants can now test the portal with fully randomized pairings."
          : "Constrained draw mode restored successfully. All rules and special assignments are active.",
    };
  } finally {
    activeResetCount--;
  }
}
