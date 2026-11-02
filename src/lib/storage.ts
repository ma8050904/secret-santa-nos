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

export interface RegistrationSession {
  status: "not_started" | "active" | "paused" | "completed";
  currentTurn: number; // 1 to 18
  totalTurns: number; // 18
  turnDurationSeconds: number; // 60
  turnStartedAt: string | null;
  turnExpiresAt: string | null;
  pausedRemainingSeconds?: number | null;
  activeParticipantId: string | null;
  registeredCount: number;
  updatedAt: string;
}

export interface EventState {
  version: number;
  status: "uninitialized" | "ready" | "active" | "closed";
  createdAt: string;
  generatedAt: string | null;
  masterSalt: string;
  participants: StoredParticipant[];
  registrationSession?: RegistrationSession;
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
 * Reads event state from persistent storage (Vercel Private Blob when available, or local filesystem)
 */
export async function getEventState(): Promise<EventState> {
  if (inMemoryStateCache) {
    return inMemoryStateCache;
  }

  // 1. Try reading from Vercel Private Blob store if configured
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const listRes = await list({ prefix: "secret-santa-event.json" });
      const blobInfo = listRes.blobs.find((b) => b.pathname === "secret-santa-event.json");
      if (blobInfo) {
        const getRes = await get(blobInfo.url, { access: "private" });
        if (getRes) {
          const text = await new Response(getRes.stream).text();
          const parsed: EventState = JSON.parse(text);
          inMemoryStateCache = parsed;
          return parsed;
        }
      }
    } catch (blobErr) {
      console.warn("Notice: Blob storage fetch attempt:", blobErr);
    }
  }

  // 2. Fall back to local file storage
  const filePath = getStorageFilePath();
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      const data = await fs.promises.readFile(/*turbopackIgnore: true*/ filePath, "utf-8");
      const parsed: EventState = JSON.parse(data);
      inMemoryStateCache = parsed;

      // Seed to blob if blob token is present
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          await put("secret-santa-event.json", data, {
            access: "private",
            addRandomSuffix: false,
          });
        } catch {
          // ignore background seed error
        }
      }

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
 * Atomically saves event state to persistent storage (Vercel Private Blob and local disk)
 */
export async function saveEventState(state: EventState): Promise<void> {
  inMemoryStateCache = state;

  // Queue write operations through promise chain to ensure atomic sequential execution
  writeLock = writeLock.then(async () => {
    const serialized = JSON.stringify(state, null, 2);

    // 1. Persist to Vercel Private Blob if configured
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await put("secret-santa-event.json", serialized, {
          access: "private",
          addRandomSuffix: false,
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
      // In read-only serverless lambdas, local file write may be non-writable, which is expected
    }
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
 * Single PIN entry: first visit sets the PIN, subsequent visits verify it.
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
  const state = await getEventState();
  const participant = state.participants.find((p) => p.id === participantId);

  if (!participant) {
    return {
      success: false,
      error: "Participant not found.",
    };
  }

  const pin = rawPin ? rawPin.trim() : "";

  if (!pin) {
    return {
      success: false,
      error: "Please enter your PIN.",
    };
  }

  // CASE 1: Participant has ALREADY established a PIN
  if (participant.pinHash && participant.pinSalt) {
    const isValid = verifyPin(pin, participant.pinHash, participant.pinSalt);
    if (!isValid) {
      return { success: false, error: "Incorrect PIN. Please try again." };
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
  if (state.registrationSession) {
    const session = state.registrationSession;
    if (session.status === "paused") {
      return {
        success: false,
        error: "Registration is currently paused by the organizer.",
      };
    }
    if (session.status === "not_started") {
      return {
        success: false,
        error: "Registration has not started yet. Please wait for the organizer to start the session.",
      };
    }
    if (session.status === "completed") {
      return {
        success: false,
        error: "The registration session has ended.",
      };
    }
    // Check turn expiration
    if (session.turnExpiresAt && Date.now() > new Date(session.turnExpiresAt).getTime()) {
      await autoAdvanceRegistrationTurn(state);
      return {
        success: false,
        error: "This 60-second registration window has expired. Please try again on the current turn.",
      };
    }
    // Check if reserved for a specific participant
    if (session.activeParticipantId && session.activeParticipantId !== participantId) {
      const activeName = state.participants.find((p) => p.id === session.activeParticipantId)?.name || "another participant";
      return {
        success: false,
        error: `This turn is currently reserved for ${activeName}.`,
      };
    }
  }

  if (pin.length < 4) {
    return {
      success: false,
      error: "PIN must be at least 4 digits or characters.",
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
      error: "Could not initialize assignment. Please try again.",
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

  // Immediately advance turn upon successful registration
  if (state.registrationSession && state.registrationSession.status === "active") {
    const remaining = state.participants.filter((p) => Boolean(p.pinHash) || p.id === participant.id);
    const registeredCount = remaining.length;
    state.registrationSession.registeredCount = registeredCount;

    const stillUnregistered = state.participants.filter((p) => !p.pinHash && p.id !== participant.id);
    if (stillUnregistered.length === 0) {
      state.registrationSession.status = "completed";
      state.registrationSession.activeParticipantId = null;
    } else {
      state.registrationSession.currentTurn += 1;
      state.registrationSession.turnStartedAt = new Date().toISOString();
      state.registrationSession.turnExpiresAt = new Date(Date.now() + state.registrationSession.turnDurationSeconds * 1000).toISOString();
      state.registrationSession.pausedRemainingSeconds = null;
      state.registrationSession.activeParticipantId = stillUnregistered[0].id;
    }
    state.registrationSession.updatedAt = new Date().toISOString();
  }

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
 * Internal helper to advance turn when 60s expires
 */
async function autoAdvanceRegistrationTurn(state: EventState): Promise<void> {
  if (!state.registrationSession) return;
  const session = state.registrationSession;
  const registeredCount = state.participants.filter((p) => Boolean(p.pinHash)).length;
  session.registeredCount = registeredCount;

  const remaining = state.participants.filter((p) => !p.pinHash);
  if (remaining.length === 0) {
    session.status = "completed";
    session.activeParticipantId = null;
  } else {
    session.currentTurn += 1;
    session.turnStartedAt = new Date().toISOString();
    session.turnExpiresAt = new Date(Date.now() + session.turnDurationSeconds * 1000).toISOString();
    session.pausedRemainingSeconds = null;

    const currentIndex = session.activeParticipantId
      ? remaining.findIndex((p) => p.id === session.activeParticipantId)
      : -1;
    const next = remaining[(currentIndex + 1) % remaining.length];
    session.activeParticipantId = next ? next.id : null;
  }
  session.updatedAt = new Date().toISOString();
  await saveEventState(state);
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
  registrationSession?: {
    status: string;
    currentTurn: number;
    totalTurns: number;
    turnDurationSeconds: number;
    timeRemainingSeconds: number;
    registeredCount: number;
    activeParticipantId: string | null;
    activeParticipantName: string | null;
    isPaused: boolean;
  };
  participants: {
    id: string;
    name: string;
    isRevealed: boolean;
    revealedAt: string | null;
    isRegistered: boolean;
  }[];
}> {
  const sessionStatus = await getRegistrationSessionStatus();
  const state = await getEventState();
  const revealedCount = state.participants.filter((p) => p.isRevealed).length;

  return {
    status: state.status,
    createdAt: state.createdAt,
    generatedAt: state.generatedAt,
    totalParticipants: state.participants.length,
    revealedCount,
    pendingCount: state.participants.length - revealedCount,
    registrationSession: sessionStatus.session,
    // Strictly omit PINs, hashes, codes, and recipient mappings
    participants: state.participants.map((p) => ({
      id: p.id,
      name: p.name,
      isRevealed: p.isRevealed,
      revealedAt: p.revealedAt,
      isRegistered: Boolean(p.pinHash),
    })),
  };
}

/**
 * Returns sanitized real-time registration session status (auto-advancing expired turns)
 */
export async function getRegistrationSessionStatus(): Promise<{
  success: boolean;
  session: {
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
  };
}> {
  const state = await getEventState();
  const totalParticipants = state.participants.length;
  const registeredCount = state.participants.filter((p) => Boolean(p.pinHash)).length;

  if (!state.registrationSession) {
    return {
      success: true,
      session: {
        status: registeredCount >= totalParticipants ? "completed" : "not_started",
        currentTurn: 1,
        totalTurns: totalParticipants,
        turnDurationSeconds: 60,
        timeRemainingSeconds: 60,
        registeredCount,
        totalParticipants,
        activeParticipantId: null,
        activeParticipantName: null,
        isPaused: false,
        turnExpiresAt: null,
      },
    };
  }

  const session = state.registrationSession;

  // Auto-advance if active and 60-second window expired
  if (session.status === "active" && session.turnExpiresAt) {
    const now = Date.now();
    const expires = new Date(session.turnExpiresAt).getTime();
    if (now >= expires) {
      await autoAdvanceRegistrationTurn(state);
    }
  }

  let timeRemaining = 0;
  if (session.status === "active" && session.turnExpiresAt) {
    timeRemaining = Math.max(0, Math.ceil((new Date(session.turnExpiresAt).getTime() - Date.now()) / 1000));
  } else if (session.status === "paused") {
    timeRemaining = session.pausedRemainingSeconds ?? 60;
  } else if (session.status === "not_started") {
    timeRemaining = 60;
  }

  const activeParticipantName = session.activeParticipantId
    ? state.participants.find((p) => p.id === session.activeParticipantId)?.name || null
    : null;

  return {
    success: true,
    session: {
      status: session.status,
      currentTurn: session.currentTurn,
      totalTurns: session.totalTurns,
      turnDurationSeconds: session.turnDurationSeconds,
      timeRemainingSeconds: timeRemaining,
      registeredCount,
      totalParticipants,
      activeParticipantId: session.activeParticipantId,
      activeParticipantName,
      isPaused: session.status === "paused",
      turnExpiresAt: session.turnExpiresAt,
    },
  };
}

/**
 * Organizer action: Start registration session
 */
export async function startRegistrationSession(): Promise<{ success: boolean; session: RegistrationSession }> {
  const state = await getEventState();
  const registeredCount = state.participants.filter((p) => Boolean(p.pinHash)).length;
  const firstUnregistered = state.participants.find((p) => !p.pinHash);

  const session: RegistrationSession = {
    status: registeredCount >= state.participants.length ? "completed" : "active",
    currentTurn: Math.min(state.participants.length, registeredCount + 1),
    totalTurns: state.participants.length,
    turnDurationSeconds: 60,
    turnStartedAt: new Date().toISOString(),
    turnExpiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
    pausedRemainingSeconds: null,
    activeParticipantId: firstUnregistered ? firstUnregistered.id : null,
    registeredCount,
    updatedAt: new Date().toISOString(),
  };

  state.registrationSession = session;
  await saveEventState(state);
  return { success: true, session };
}

/**
 * Organizer action: Pause registration session
 */
export async function pauseRegistrationSession(): Promise<{ success: boolean; session: RegistrationSession }> {
  const state = await getEventState();
  if (!state.registrationSession) {
    return await startRegistrationSession();
  }

  const session = state.registrationSession;
  if (session.status === "active" && session.turnExpiresAt) {
    const remaining = Math.max(0, Math.ceil((new Date(session.turnExpiresAt).getTime() - Date.now()) / 1000));
    session.status = "paused";
    session.pausedRemainingSeconds = remaining;
    session.updatedAt = new Date().toISOString();
    await saveEventState(state);
  }
  return { success: true, session };
}

/**
 * Organizer action: Resume registration session
 */
export async function resumeRegistrationSession(): Promise<{ success: boolean; session: RegistrationSession }> {
  const state = await getEventState();
  if (!state.registrationSession) {
    return await startRegistrationSession();
  }

  const session = state.registrationSession;
  if (session.status === "paused") {
    const duration = session.pausedRemainingSeconds && session.pausedRemainingSeconds > 0
      ? session.pausedRemainingSeconds
      : 60;
    session.status = "active";
    session.turnStartedAt = new Date().toISOString();
    session.turnExpiresAt = new Date(Date.now() + duration * 1000).toISOString();
    session.pausedRemainingSeconds = null;
    session.updatedAt = new Date().toISOString();
    await saveEventState(state);
  }
  return { success: true, session };
}

/**
 * Organizer action: Skip / Advance turn
 */
export async function skipRegistrationTurn(): Promise<{ success: boolean; session: RegistrationSession }> {
  const state = await getEventState();
  if (!state.registrationSession) {
    return await startRegistrationSession();
  }

  const session = state.registrationSession;
  const remaining = state.participants.filter((p) => !p.pinHash);

  if (remaining.length === 0) {
    session.status = "completed";
    session.activeParticipantId = null;
  } else {
    session.currentTurn += 1;
    session.status = "active";
    session.turnStartedAt = new Date().toISOString();
    session.turnExpiresAt = new Date(Date.now() + session.turnDurationSeconds * 1000).toISOString();
    session.pausedRemainingSeconds = null;

    const currentIndex = session.activeParticipantId
      ? remaining.findIndex((p) => p.id === session.activeParticipantId)
      : -1;
    const next = remaining[(currentIndex + 1) % remaining.length];
    session.activeParticipantId = next ? next.id : null;
  }
  session.updatedAt = new Date().toISOString();
  await saveEventState(state);
  return { success: true, session };
}

/**
 * Organizer action: Revisit an unregistered participant
 */
export async function revisitParticipantRegistration(participantId: string): Promise<{
  success: boolean;
  error?: string;
  session?: EventState["registrationSession"];
}> {
  const state = await getEventState();
  const participant = state.participants.find((p) => p.id === participantId);

  if (!participant) {
    return { success: false, error: "Participant not found." };
  }

  if (participant.pinHash) {
    return { success: false, error: `${participant.name} is already registered.` };
  }

  if (!state.registrationSession) {
    await startRegistrationSession();
  }

  const session = state.registrationSession!;
  session.status = "active";
  session.activeParticipantId = participant.id;
  session.currentTurn += 1;
  session.turnStartedAt = new Date().toISOString();
  session.turnExpiresAt = new Date(Date.now() + session.turnDurationSeconds * 1000).toISOString();
  session.pausedRemainingSeconds = null;
  session.updatedAt = new Date().toISOString();

  await saveEventState(state);
  return { success: true, session };
}
