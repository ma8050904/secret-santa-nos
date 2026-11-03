import { get } from "@vercel/blob";
import * as fs from "fs";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
} from "../src/lib/derangement";

if (fs.existsSync(".env.local")) {
  const content = fs.readFileSync(".env.local", "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const KNOWN_BLOB_URL = "https://ygkog8lebahiid0k.private.blob.vercel-storage.com/secret-santa-event.json";

async function verify() {
  console.log("=========================================================");
  console.log("  🎄 VERIFYING PRODUCTION VERCEL BLOB ROUND 5 STATE 🎄   ");
  console.log("=========================================================\n");

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("Missing BLOB_READ_WRITE_TOKEN");

  const t0 = Date.now();
  const directRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, { access: "private", token });
  const directTime = Date.now() - t0;
  console.log(`⚡ Direct Vercel Private Blob Read Latency: ${directTime}ms`);

  if (!directRes || !directRes.stream) {
    throw new Error("Failed to read from direct blob URL");
  }

  const text = await new Response(directRes.stream).text();
  const state = JSON.parse(text);

  console.log(`• Round Version: ${state.version}`);
  console.log(`• Event Status: ${state.status}`);
  console.log(`• Generated At: ${state.generatedAt}`);
  console.log(`• Total Participants: ${state.participants.length}`);

  if (state.version !== 5) throw new Error(`Expected Version 5, found ${state.version}`);
  if (state.participants.length !== 48) throw new Error(`Expected 48 participants, found ${state.participants.length}`);

  // Verify all 48 participant names
  const expectedNames = PARTICIPANTS.map((p) => p.name);
  const actualNames = state.participants.map((p: any) => p.name);
  const allNamesMatch = expectedNames.every((name) => actualNames.includes(name));
  console.log(`• All 48 expected participant names present: ${allNamesMatch}`);
  if (!allNamesMatch) throw new Error("Participant names mismatch");

  // Verify all ready, none revealed, none registered
  const readyCount = state.participants.filter((p: any) => !p.isRevealed).length;
  const revealedCount = state.participants.filter((p: any) => p.isRevealed).length;
  const registeredCount = state.participants.filter((p: any) => !!p.pinHash).length;
  const encryptedCount = state.participants.filter((p: any) => !!p.encryptedRecipient).length;

  console.log(`• Ready Participants: ${readyCount}/48`);
  console.log(`• Revealed Participants: ${revealedCount}/48`);
  console.log(`• Registered Participants: ${registeredCount}/48`);
  console.log(`• Encrypted Assignments: ${encryptedCount}/48`);

  if (readyCount !== 48 || revealedCount !== 0 || registeredCount !== 0 || encryptedCount !== 48) {
    throw new Error("State initialization check failed!");
  }

  console.log("\n✅ Production Vercel Blob is 100% verified and healthy for Round 5!");
}

verify().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
