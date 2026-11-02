import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PARTICIPANTS } from "./constants";
import {
  generateChristmasPasscode,
  hashPasscode,
  encryptRecipient,
  decryptRecipient,
} from "./crypto";
import { generateSecretSantaDerangement } from "./derangement";

export interface StoredParticipant {
  id: string;
  name: string;
  code: string; // Plaintext code stored ONLY for organizer distribution; excluded from admin public status
  codeHash: string; // Hash used for auth
  encryptedRecipient: string | null; // AES-256-GCM encrypted recipient name
  isRevealed: boolean;
  revealedAt: string | null;
}

export interface EventState {
  version: number;
  status: "uninitialized" | "ready" | "active" | "closed";
  createdAt: string;
  generatedAt: string | null;
  masterSalt: string;
  participants: StoredParticipant[];
}

// Storage path resolution: prioritize local project dir in development, fallback to /tmp in serverless
function getStorageFilePath(): string {
  if (process.env.STORAGE_FILE_PATH) {
    return process.env.STORAGE_FILE_PATH;
  }
  // Try local .data directory first
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

let inMemoryStateCache: EventState | null = null;
let writeLock: Promise<void> = Promise.resolve();

/**
 * Initializes a clean initial state with the exact 18 participants
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
    };
  });

  return {
    version: 1,
    status: "uninitialized",
    createdAt: new Date().toISOString(),
    generatedAt: null,
    masterSalt,
    participants,
  };
}

/**
 * Reads event state from persistent storage or initializes it
 */
export async function getEventState(): Promise<EventState> {
  const filePath = getStorageFilePath();

  if (inMemoryStateCache) {
    return inMemoryStateCache;
  }

  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      const data = await fs.promises.readFile(/*turbopackIgnore: true*/ filePath, "utf-8");
      const parsed: EventState = JSON.parse(data);
      inMemoryStateCache = parsed;
      return parsed;
    }
  } catch (err) {
    console.error("Warning: Failed to read from storage file, reinitializing", err);
  }

  // Create default and persist
  const initial = createInitialState();
  await saveEventState(initial);
  
  // Auto-generate initial assignments so the event is ready immediately
  try {
    await generateAssignments(true);
    return await getEventState();
  } catch (err) {
    console.error("Auto-generate error on init:", err);
  }

  return initial;
}

/**
 * Atomically saves event state to disk using a write mutex and temp file replacement
 */
export async function saveEventState(state: EventState): Promise<void> {
  inMemoryStateCache = state;

  // Queue write operations through promise chain to ensure atomic sequential execution
  writeLock = writeLock.then(async () => {
    const filePath = getStorageFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    const tempPath = `${filePath}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    const serialized = JSON.stringify(state, null, 2);

    await fs.promises.writeFile(tempPath, serialized, "utf-8");
    await fs.promises.rename(tempPath, filePath);
  });

  return writeLock;
}

/**
 * Generates the Secret Santa assignments:
 * 1. Checks that no participant has revealed yet (if already generated)
 * 2. Runs cryptographic derangement
 * 3. Encrypts each assigned recipient with that participant's personal passcode
 * 4. Stores ONLY encrypted recipient blobs (NO plaintext mapping table in DB!)
 * 5. Saves state atomically
 */
export async function generateAssignments(force = false): Promise<{
  success: boolean;
  message: string;
}> {
  const state = await getEventState();

  if (state.status === "active" && !force) {
    // Check if anyone has revealed
    const revealedCount = state.participants.filter((p) => p.isRevealed).length;
    if (revealedCount > 0) {
      throw new Error(`Cannot regenerate draw: ${revealedCount} participant(s) have already revealed their secret gift!`);
    }
  }

  // Run derangement
  const pairs = generateSecretSantaDerangement(PARTICIPANTS);

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
  }

  state.status = "active";
  state.generatedAt = new Date().toISOString();

  await saveEventState(state);

  return {
    success: true,
    message: "Secret Santa draw successfully generated with cryptographic organizer-blind encryption.",
  };
}

/**
 * Authenticates participant and decrypts their secret recipient.
 * If not previously revealed, marks them as revealed atomically.
 */
export async function revealRecipientForParticipant(
  participantId: string,
  enteredPasscode: string
): Promise<{
  success: boolean;
  recipientName?: string;
  isFirstReveal?: boolean;
  error?: string;
}> {
  const state = await getEventState();

  if (state.status !== "active") {
    return {
      success: false,
      error: "The Secret Santa draw has not been activated by the organizer yet. Please check back soon!",
    };
  }

  const participant = state.participants.find((p) => p.id === participantId);
  if (!participant) {
    return { success: false, error: "Participant not found." };
  }

  if (!participant.encryptedRecipient) {
    return { success: false, error: "No assignment found for this participant." };
  }

  // Verify passcode hash
  const testHash = hashPasscode(enteredPasscode, state.masterSalt);
  if (testHash !== participant.codeHash) {
    return { success: false, error: "Invalid Christmas Secret Code. Please check your code and try again!" };
  }

  // Decrypt recipient name using the participant's passcode
  let decryptedName: string;
  try {
    decryptedName = decryptRecipient(
      participant.encryptedRecipient,
      enteredPasscode,
      state.masterSalt
    );
  } catch (err) {
    console.error("Decryption failed:", err);
    return { success: false, error: "Decryption failed. Please ensure the code is correct." };
  }

  const isFirstReveal = !participant.isRevealed;

  if (isFirstReveal) {
    participant.isRevealed = true;
    participant.revealedAt = new Date().toISOString();
    await saveEventState(state);
  }

  return {
    success: true,
    recipientName: decryptedName,
    isFirstReveal,
  };
}

/**
 * Regenerates new access codes for all participants (ONLY allowed before draw is active/revealed)
 */
export async function regenerateParticipantCodes(): Promise<{ success: boolean; message: string }> {
  const state = await getEventState();

  const revealedCount = state.participants.filter((p) => p.isRevealed).length;
  if (revealedCount > 0) {
    throw new Error(`Cannot regenerate credentials: ${revealedCount} participant(s) have already opened their gifts!`);
  }

  const masterSalt = crypto.randomBytes(16).toString("hex");
  state.masterSalt = masterSalt;

  for (const p of state.participants) {
    p.code = generateChristmasPasscode();
    p.codeHash = hashPasscode(p.code, masterSalt);
    p.encryptedRecipient = null;
    p.isRevealed = false;
    p.revealedAt = null;
  }

  state.status = "uninitialized";
  state.generatedAt = null;

  await saveEventState(state);

  return {
    success: true,
    message: "New participant credentials successfully generated.",
  };
}

/**
 * Returns organizer safe view:
 * CRITICAL PRIVACY: Strictly omits encryptedRecipient and has zero recipient mapping data!
 */
export async function getAdminSafeState(): Promise<{
  status: string;
  createdAt: string;
  generatedAt: string | null;
  totalParticipants: number;
  revealedCount: number;
  pendingCount: number;
  participants: {
    id: string;
    name: string;
    code: string;
    isRevealed: boolean;
    revealedAt: string | null;
  }[];
}> {
  const state = await getEventState();
  const revealedCount = state.participants.filter((p) => p.isRevealed).length;

  return {
    status: state.status,
    createdAt: state.createdAt,
    generatedAt: state.generatedAt,
    totalParticipants: state.participants.length,
    revealedCount,
    pendingCount: state.participants.length - revealedCount,
    // Return distribution credentials without any recipient or mapping info
    participants: state.participants.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      isRevealed: p.isRevealed,
      revealedAt: p.revealedAt,
    })),
  };
}
