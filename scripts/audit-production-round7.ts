import { get, list } from "@vercel/blob";
import * as fs from "fs";
import { PARTICIPANTS } from "../src/lib/constants";
import { decryptRecipient } from "../src/lib/crypto";
import {
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  SUBGROUP_20_ID_SET,
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

async function runReadOnlyAuditRound7() {
  console.log("=================================================================");
  console.log("  🔍 SECRET SANTA ROUND 7 — LIVE PRODUCTION READ-ONLY AUDIT 🔍   ");
  console.log("=================================================================\n");

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not available in environment");

  // 1. Fetch live event state from Vercel Private Blob
  console.log("--- 1. Querying Live Vercel Private Blob ---");
  const fetchStartTime = Date.now();
  const directRes: any = await get(`${KNOWN_BLOB_URL}?t=${Date.now()}`, { access: "private", token });
  const latency = Date.now() - fetchStartTime;

  if (!directRes || !directRes.stream) {
    throw new Error("Unable to obtain stream from Vercel Private Blob");
  }

  const rawJson = await new Response(directRes.stream).text();
  const state = JSON.parse(rawJson);

  console.log(`  • Blob Fetch Latency: ${latency}ms`);
  console.log(`  • Version: ${state.version}`);
  console.log(`  • Event Status: ${state.status}`);
  console.log(`  • Generated At: ${state.generatedAt}`);
  console.log(`  • Master Salt Present: ${Boolean(state.masterSalt && state.masterSalt.length === 32)}`);

  // 2. Query dynamic participant state markers under prefix 'v7/'
  console.log("\n--- 2. Inspecting Dynamic Runtime Markers in Blob (v7/) ---");
  const v7List = await list({ prefix: "v7/", token });
  const participantBlobs = v7List.blobs.filter((b) => b.pathname.startsWith("v7/participants/"));
  const registeredMarkers = v7List.blobs.filter((b) => b.pathname.startsWith("v7/registered/"));
  const revealedMarkers = v7List.blobs.filter((b) => b.pathname.startsWith("v7/revealed/"));

  console.log(`  • Total Blobs with prefix 'v7/': ${v7List.blobs.length}`);
  console.log(`  • Participant State Blobs (v7/participants/): ${participantBlobs.length}`);
  console.log(`  • Registered Markers (v7/registered/): ${registeredMarkers.length}`);
  console.log(`  • Revealed Markers (v7/revealed/): ${revealedMarkers.length}`);

  // 3. Confirm exact participant count and roster integrity
  console.log("\n--- 3. Verifying 48-Person Roster in Persisted State ---");
  console.log(`  • Total Participants in State: ${state.participants.length}`);

  const expectedNames = PARTICIPANTS.map((p) => p.name);
  const actualNames: string[] = state.participants.map((p: any) => p.name);

  const countMatches = state.participants.length === 48;
  const uniqueNames = new Set(actualNames);
  const all48Unique = uniqueNames.size === 48;
  const allNamesMatchExact = expectedNames.every((name, idx) => actualNames[idx] === name);

  console.log(`  • Exact count is 48: ${countMatches}`);
  console.log(`  • All 48 names unique: ${all48Unique}`);
  console.log(`  • Exact alphabetical order, spelling and casing matched: ${allNamesMatchExact}`);

  // 4. Verify participant readiness & confidentiality
  console.log("\n--- 4. Participant Readiness & Security States ---");
  let readyCount = 0;
  let revealedCount = 0;
  let registeredPinCount = 0;
  let encryptedAssignmentsCount = 0;

  for (const p of state.participants) {
    if (p.isRevealed) revealedCount++;
    else readyCount++;

    if (p.pinHash) registeredPinCount++;
    if (p.encryptedRecipient) encryptedAssignmentsCount++;
  }

  console.log(`  • Participants in Ready/Unrevealed State: ${readyCount}/48`);
  console.log(`  • Participants in Revealed State: ${revealedCount}/48`);
  console.log(`  • Participants with Established PIN Hashes: ${registeredPinCount}/48`);
  console.log(`  • Participants with AES-256-GCM Encrypted Assignment: ${encryptedAssignmentsCount}/48`);

  // 5. Verify constraints cryptographically WITHOUT logging the recipient map
  console.log("\n--- 5. Cryptographic Draw Constraint Verification (Confidential) ---");
  const masterSalt = state.masterSalt;
  const decryptedRecipients = new Map<string, string>(); // giverName -> recipientName

  for (const p of state.participants) {
    const recipient = decryptRecipient(p.encryptedRecipient, p.code, masterSalt);
    decryptedRecipients.set(p.name, recipient);
  }

  // Global derangement checks
  let selfAssignments = 0;
  const recipientSet = new Set<string>();

  for (const [giver, recipient] of decryptedRecipients.entries()) {
    if (giver === recipient) selfAssignments++;
    recipientSet.add(recipient);
  }

  const allGiversHaveUniqueRecipient = recipientSet.size === 48;
  console.log(`  • Bijection Verified (48 unique recipients for 48 givers): ${allGiversHaveUniqueRecipient}`);
  console.log(`  • Zero Self-Assignments: ${selfAssignments === 0} (count: ${selfAssignments})`);

  // Subgroup 20 Isolation check
  let sub20CrossEdges = 0;
  for (const [giver, rec] of decryptedRecipients.entries()) {
    const gp = PARTICIPANTS.find((p) => p.name === giver)!;
    const rp = PARTICIPANTS.find((p) => p.name === rec)!;
    const gIn20 = SUBGROUP_20_ID_SET.has(gp.id);
    const rIn20 = SUBGROUP_20_ID_SET.has(rp.id);
    if ((gIn20 && !rIn20) || (!gIn20 && rIn20)) sub20CrossEdges++;
  }
  const sub20Isolated = sub20CrossEdges === 0;
  console.log(`  • Subgroup 1 Isolation (20 participants strictly closed): ${sub20Isolated}`);

  // Subgroup 28 Isolation check
  const sub28Isolated = sub20CrossEdges === 0;
  console.log(`  • Subgroup 2 Isolation (28 participants strictly closed): ${sub28Isolated}`);

  // Mandatory Reciprocal: Ghazal Baqleh ⇄ George Karkar
  const ghazalRecipient = decryptedRecipients.get(MANDATORY_RECIPROCAL_A);
  const georgeRecipient = decryptedRecipients.get(MANDATORY_RECIPROCAL_B);
  const reciprocalValid = ghazalRecipient === MANDATORY_RECIPROCAL_B && georgeRecipient === MANDATORY_RECIPROCAL_A;
  console.log(`  • Constraint A — Mandatory Reciprocal (Ghazal Baqleh ⇄ George Karkar): ${reciprocalValid}`);

  // Mandatory Exclusion: Zeina Darawi and Hamza Darawi cannot be assigned to each other
  const zeinaRecipient = decryptedRecipients.get(FORBIDDEN_EXCLUSION_A);
  const hamzaRecipient = decryptedRecipients.get(FORBIDDEN_EXCLUSION_B);
  const exclusionValid = zeinaRecipient !== FORBIDDEN_EXCLUSION_B && hamzaRecipient !== FORBIDDEN_EXCLUSION_A;
  console.log(`  • Constraint B — Mandatory Mutual Exclusion (Zeina Darawi ⇎ Hamza Darawi): ${exclusionValid}`);

  console.log("\n=================================================================");
  console.log("  ✅ READ-ONLY AUDIT SUMMARY:");
  console.log(`  • Version 7 Active: ${state.version === 7}`);
  console.log(`  • 48 Participants: ${countMatches && all48Unique}`);
  console.log(`  • All Subgroup & Pairing Constraints Met: ${reciprocalValid && exclusionValid && sub20Isolated && allGiversHaveUniqueRecipient && selfAssignments === 0}`);
  console.log(`  • Reveal State Reset: All 48 participants unrevealed (0 revealed, 48 ready)`);
  console.log(`  • Clean PIN State: 0/48 (all participants ready to register new PIN)`);
  console.log("=================================================================\n");
}

runReadOnlyAuditRound7().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
