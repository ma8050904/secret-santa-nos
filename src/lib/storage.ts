import fs from "fs";
import path from "path";
import crypto from "crypto";
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
import { generateSecretSantaDerangement } from "./derangement";

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
      pinHash: null,
      pinSalt: null,
      encryptedWithPin: false,
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
 * Generates the Secret Santa assignments (ONLY used when initializing brand new event)
 */
export async function generateAssignments(force = false): Promise<{
  success: boolean;
  message: string;
}> {
  const state = await getEventState();

  if (state.status === "active" && !force) {
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
    participant.pinHash = null;
    participant.pinSalt = null;
    participant.encryptedWithPin = false;
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
 * Authenticates with an existing PIN or establishes a personal PIN on first visit.
 * CRITICAL SECURITY:
 * Never reveals whether another participant has already registered a PIN on failure.
 */
export async function authenticateOrRegisterPin(
  participantId: string,
  rawPin: string,
  rawConfirmPin?: string
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
  const state = await getEventState();
  const participant = state.participants.find((p) => p.id === participantId);

  if (!participant) {
    return {
      success: false,
      error: "Participant not found.",
    };
  }

  const pin = rawPin ? rawPin.trim() : "";
  const confirmPin = rawConfirmPin ? rawConfirmPin.trim() : "";

  // Universal authentication failure error message (prevents user enumeration & registration probing)
  const genericAuthFailMsg =
    "Authentication failed. Please verify your PIN. (If this is your first visit, please enter and confirm your chosen PIN in both fields).";

  // CASE 1: Participant has ALREADY established a PIN
  if (participant.pinHash && participant.pinSalt) {
    if (!pin) {
      return { success: false, error: genericAuthFailMsg };
    }

    const isValid = verifyPin(pin, participant.pinHash, participant.pinSalt);
    if (!isValid) {
      return { success: false, error: genericAuthFailMsg };
    }

    // Decrypt recipient name using verified PIN
    let recipientName: string | undefined;
    try {
      if (participant.encryptedRecipient) {
        recipientName = decryptRecipient(
          participant.encryptedRecipient,
          pin,
          participant.pinSalt
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
        isRevealed: participant.isRevealed,
      },
      recipientName: participant.isRevealed ? recipientName : undefined,
    };
  }

  // CASE 2: Participant is establishing their PIN for the FIRST TIME
  // Require both fields to be present and match
  if (!pin || !confirmPin || pin !== confirmPin) {
    return {
      success: false,
      error: genericAuthFailMsg,
    };
  }

  if (pin.length < 4) {
    return {
      success: false,
      error: "For your privacy, your PIN must be at least 4 characters long.",
    };
  }

  if (pin.length > 32) {
    return {
      success: false,
      error: "PIN cannot exceed 32 characters.",
    };
  }

  // Decrypt the existing assignment using the seed code and master salt
  let originalRecipient: string;
  try {
    if (!participant.encryptedRecipient) {
      throw new Error("No assignment found to re-encrypt");
    }
    originalRecipient = decryptRecipient(
      participant.encryptedRecipient,
      participant.code,
      state.masterSalt
    );
  } catch (err) {
    console.error("Failed to decrypt seed recipient during PIN establishment:", err);
    return {
      success: false,
      error: "Could not initialize assignment with your PIN. Please contact the administrator.",
    };
  }

  // Generate individual salt for this participant's PIN
  const pinSalt = generateRandomSalt();
  const pinHash = hashPin(pin, pinSalt);

  // Re-encrypt the recipient name with the key derived from the participant's new PIN
  const newEncryptedRecipient = encryptRecipient(originalRecipient, pin, pinSalt);

  // Update participant record (preserving isRevealed status and timestamps)
  participant.pinHash = pinHash;
  participant.pinSalt = pinSalt;
  participant.encryptedRecipient = newEncryptedRecipient;
  participant.encryptedWithPin = true;

  await saveEventState(state);

  return {
    success: true,
    isNewRegistration: true,
    participant: {
      id: participant.id,
      name: participant.name,
      isRevealed: participant.isRevealed,
    },
    recipientName: participant.isRevealed ? originalRecipient : undefined,
  };
}

/**
 * Reveals the recipient name for an authenticated participant.
 * If this is the participant's first time opening the gift, marks them as revealed atomically.
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
  const state = await getEventState();
  const participant = state.participants.find((p) => p.id === participantId);

  if (!participant || !participant.encryptedRecipient) {
    return { success: false, error: "Participant not found." };
  }

  if (!participant.pinHash || !participant.pinSalt) {
    return { success: false, error: "No personal PIN has been registered for this participant yet." };
  }

  // Verify PIN
  const isValid = verifyPin(pin, participant.pinHash, participant.pinSalt);
  if (!isValid) {
    return { success: false, error: "Invalid PIN. Access denied." };
  }

  let decryptedName: string;
  try {
    decryptedName = decryptRecipient(
      participant.encryptedRecipient,
      pin,
      participant.pinSalt
    );
  } catch (err) {
    console.error("Reveal decryption error:", err);
    return { success: false, error: "Decryption failed. Please ensure PIN is correct." };
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
 * Returns organizer safe view:
 * CRITICAL PRIVACY: Strictly omits encryptedRecipient, PINs, and hashes.
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
    // Strictly omit PINs, hashes, codes, and recipient mappings
    participants: state.participants.map((p) => ({
      id: p.id,
      name: p.name,
      isRevealed: p.isRevealed,
      revealedAt: p.revealedAt,
    })),
  };
}
