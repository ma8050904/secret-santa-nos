import fs from "fs";
import path from "path";
import crypto from "crypto";
import { put, list, get, del } from "@vercel/blob";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  generateConstrainedSecretSantaDraw,
  validateConstrainedSecretSantaDraw,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
} from "../src/lib/derangement";
import {
  generateChristmasPasscode,
  hashPasscode,
  encryptRecipient,
  decryptRecipient,
} from "../src/lib/crypto";
import { EventState, StoredParticipant } from "../src/lib/storage";

const EXPECTED_NAMES = [
  "Elean Nshewat",
  "George Karkar",
  "George Shammas",
  "Ghazal Baqleh",
  "Hala Ahmad",
  "Hala Shaheen",
  "Hamza Ahmad",
  "Hamza Darawi",
  "Ibrahim Hanin",
  "Ibrahim Jahshan",
  "Issa Hijazeen",
  "Joelle Al-Dallou",
  "Joewelle Ehab",
  "Joseph Dababneh",
  "Jude Fanous",
  "Karam Abu Hamdan",
  "Kerolos Esrael",
  "Katia Majrouh",
  "Khalil Dabit",
  "Leya Al-Khatib",
  "Malak Malek",
  "Malak Hindaileh",
  "Maria Halaseh",
  "Mariana Salkawi",
  "Maya Joy Mahrejian",
  "Michael Shamma",
  "Mohammad Darras",
  "Mohammad Shourati",
  "Nardeen Abdallah",
  "Natalie Khacherian",
  "Nishan Nodiznaya",
  "Omar Batshoun",
  "Omar Fakhoury",
  "Qais Al-Hadeed",
  "Raghad Al-Shobaki",
  "Sanad Al-Hunaiti",
  "Sarah Rabadi",
  "Suhail Haddad",
  "Tala Bouri",
  "Toleen Awwad",
  "Wasan Abu Hamdeh",
  "Yara Barjawi",
  "Yousef Jahshan",
  "Yousef Rabadi",
  "Zaid Al-Helu",
  "Zaid Al-Lataifeh",
  "Zaid Al-Louh",
  "Zeina Darawi",
];

// Load environment variables if available
if (fs.existsSync(".env.local")) {
  const content = fs.readFileSync(".env.local", "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function runMigration() {
  console.log("=================================================================");
  console.log("  🎄 SECRET SANTA – ROUND 5 MIGRATION & CONSTRAINED DRAW 🎄     ");
  console.log("=================================================================\n");

  // =========================================================================
  // STEP 1 — PROGRAMMATIC VALIDATION OF 48-PERSON ROSTER
  // =========================================================================
  console.log("--- 1. Validating 48-Person Participant Roster ---");
  const actualNames: string[] = PARTICIPANTS.map((p) => p.name as string);

  if (actualNames.length !== 48) {
    throw new Error(`Roster count mismatch: expected 48, found ${actualNames.length}`);
  }

  const uniqueActual = new Set<string>(actualNames);
  if (uniqueActual.size !== 48) {
    throw new Error(`Roster contains duplicates: ${uniqueActual.size} unique entries`);
  }

  for (let i = 0; i < EXPECTED_NAMES.length; i++) {
    const expected = EXPECTED_NAMES[i];
    if (!uniqueActual.has(expected)) {
      throw new Error(`Missing expected participant: "${expected}"`);
    }
    const actual = actualNames[i];
    if (actual !== expected) {
      throw new Error(`Participant order/casing discrepancy at index ${i}: expected "${expected}", got "${actual}"`);
    }
  }
  console.log("  ✅ Exactly 48 participants validated (all unique, exact casing preserved).");

  // =========================================================================
  // STEP 2 — GENERATE & RIGOROUSLY VALIDATE CONSTRAINED DRAW
  // =========================================================================
  console.log("\n--- 2. Generating & Validating Constrained Secret Santa Draw ---");
  const pairs = generateConstrainedSecretSantaDraw(PARTICIPANTS);

  const validation = validateConstrainedSecretSantaDraw(PARTICIPANTS, pairs);
  if (!validation.valid) {
    throw new Error(`Draw validation failed: ${validation.reason}`);
  }

  // Double check mandatory constraints
  const ghazalPair = pairs.find((p) => p.giverName === MANDATORY_RECIPROCAL_A);
  const georgePair = pairs.find((p) => p.giverName === MANDATORY_RECIPROCAL_B);
  if (!ghazalPair || ghazalPair.recipientName !== MANDATORY_RECIPROCAL_B) {
    throw new Error(`CRITICAL: ${MANDATORY_RECIPROCAL_A} not assigned to ${MANDATORY_RECIPROCAL_B}`);
  }
  if (!georgePair || georgePair.recipientName !== MANDATORY_RECIPROCAL_A) {
    throw new Error(`CRITICAL: ${MANDATORY_RECIPROCAL_B} not assigned to ${MANDATORY_RECIPROCAL_A}`);
  }
  console.log(`  ✅ Mandatory Reciprocal Assignment Verified: ${MANDATORY_RECIPROCAL_A} ⇄ ${MANDATORY_RECIPROCAL_B}`);

  const zeinaPair = pairs.find((p) => p.giverName === FORBIDDEN_EXCLUSION_A);
  const hamzaPair = pairs.find((p) => p.giverName === FORBIDDEN_EXCLUSION_B);
  if (zeinaPair?.recipientName === FORBIDDEN_EXCLUSION_B) {
    throw new Error(`CRITICAL: Forbidden exclusion violated: ${FORBIDDEN_EXCLUSION_A} assigned to ${FORBIDDEN_EXCLUSION_B}`);
  }
  if (hamzaPair?.recipientName === FORBIDDEN_EXCLUSION_A) {
    throw new Error(`CRITICAL: Forbidden exclusion violated: ${FORBIDDEN_EXCLUSION_B} assigned to ${FORBIDDEN_EXCLUSION_A}`);
  }
  console.log(`  ✅ Mandatory Exclusion Verified: Neither ${FORBIDDEN_EXCLUSION_A} nor ${FORBIDDEN_EXCLUSION_B} assigned to each other`);

  // Verify Bijection (48 givers, 48 unique recipients, zero self-assignments)
  const givers = new Set(pairs.map((p) => p.giverId));
  const recipients = new Set(pairs.map((p) => p.recipientId));
  if (givers.size !== 48 || recipients.size !== 48) {
    throw new Error(`Incomplete bijection: ${givers.size} givers, ${recipients.size} recipients`);
  }
  const selfMatch = pairs.find((p) => p.giverId === p.recipientId);
  if (selfMatch) {
    throw new Error(`Self-assignment detected: ${selfMatch.giverName}`);
  }
  console.log("  ✅ Global constraints verified: 48 givers, 48 unique recipients, zero self-assignments, zero omissions.");

  // =========================================================================
  // STEP 3 — CRYPTOGRAPHIC ENCRYPTION OF ASSIGNMENTS
  // =========================================================================
  console.log("\n--- 3. Encrypting Assignments with AES-256-GCM ---");
  const masterSalt = crypto.randomBytes(16).toString("hex");
  const storedParticipants: StoredParticipant[] = [];

  for (const p of PARTICIPANTS) {
    const pair = pairs.find((pair) => pair.giverId === p.id);
    if (!pair) {
      throw new Error(`Missing assignment pair for participant ${p.name} (${p.id})`);
    }

    const code = generateChristmasPasscode();
    const codeHash = hashPasscode(code, masterSalt);
    const encryptedRecipient = encryptRecipient(pair.recipientName, code, masterSalt);

    // Verify decryption roundtrip immediately
    const decrypted = decryptRecipient(encryptedRecipient, code, masterSalt);
    if (decrypted !== pair.recipientName) {
      throw new Error(`Encryption roundtrip failed for ${p.name}`);
    }

    storedParticipants.push({
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
    });
  }
  console.log("  ✅ All 48 assignments encrypted and verified via AES-256-GCM roundtrip.");

  // =========================================================================
  // STEP 4 — BUILD ROUND 5 EVENT STATE
  // =========================================================================
  const round5State: EventState = {
    version: 5,
    status: "active",
    createdAt: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    masterSalt,
    participants: storedParticipants,
  };

  const serializedState = JSON.stringify(round5State, null, 2);

  // =========================================================================
  // STEP 5 — PERSIST TO LOCAL STORAGE & VERCEL BLOB
  // =========================================================================
  console.log("\n--- 4. Persisting Round 5 State ---");

  // Save local copy
  const dataDir = path.join(process.cwd(), ".data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "secret-santa-event.json"), serializedState, "utf-8");

  // Clean local participant caches
  const localPartDir = path.join(dataDir, "v5_participants");
  const localRevDir = path.join(dataDir, "v5_revealed");
  const localRegDir = path.join(dataDir, "v5_registered");
  if (fs.existsSync(localPartDir)) fs.rmSync(localPartDir, { recursive: true, force: true });
  if (fs.existsSync(localRevDir)) fs.rmSync(localRevDir, { recursive: true, force: true });
  if (fs.existsSync(localRegDir)) fs.rmSync(localRegDir, { recursive: true, force: true });
  fs.mkdirSync(localPartDir, { recursive: true });
  fs.mkdirSync(localRevDir, { recursive: true });
  fs.mkdirSync(localRegDir, { recursive: true });
  console.log("  ✅ Local storage initialized for Round 5.");

  // Persist to Vercel Private Blob
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    console.warn("  ⚠️ Warning: BLOB_READ_WRITE_TOKEN not found, skipping cloud persistence.");
  } else {
    // Clean old participant blobs if any
    try {
      const oldBlobs = await list({ prefix: "v5/", token: blobToken });
      if (oldBlobs.blobs.length > 0) {
        console.log(`  Cleaning ${oldBlobs.blobs.length} previous round 5 blobs...`);
        for (const b of oldBlobs.blobs) {
          await del(b.url, { token: blobToken });
        }
      }
    } catch (err) {
      console.warn("Notice: Blob cleanup warning:", err);
    }

    const blobRes = await put("secret-santa-event.json", serializedState, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken,
    });
    console.log(`  ✅ Vercel Private Blob updated: ${blobRes.url}`);

    // Verify direct fetch from Vercel Private Blob (with cache buster)
    console.log("  Verifying cloud blob read-back...");
    const readBackRes: any = await get(`${blobRes.url}?t=${Date.now()}`, { access: "private", token: blobToken });
    if (!readBackRes || !readBackRes.stream) {
      throw new Error("Failed to read back newly written blob from Vercel");
    }
    const readBackText = await new Response(readBackRes.stream).text();
    const readBackState: EventState = JSON.parse(readBackText);

    if (readBackState.version !== 5 || readBackState.participants.length !== 48) {
      throw new Error(`Cloud state validation failed: version=${readBackState.version}, count=${readBackState.participants.length}`);
    }
    console.log(`  ✅ Cloud state verified: Version 5, ${readBackState.participants.length} participants.`);
  }

  console.log("\n=================================================================");
  console.log("  🎄 ROUND 5 MIGRATION COMPLETED SUCCESSFULLY! 🎄               ");
  console.log("=================================================================");
}

runMigration().catch((err) => {
  console.error("Migration fatal error:", err);
  process.exit(1);
});
