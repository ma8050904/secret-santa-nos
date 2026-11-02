import { get, list } from "@vercel/blob";
import * as fs from "fs";

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
  console.log("=== VERIFYING PRODUCTION BLOB & PERFORMANCE ===");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("Missing BLOB_READ_WRITE_TOKEN");
  }

  // 1. Direct fetch benchmark
  const t0 = Date.now();
  const directRes: any = await get(KNOWN_BLOB_URL, { access: "private" });
  const directTime = Date.now() - t0;
  console.log(`Direct Blob get latency: ${directTime}ms`);

  if (!directRes || !directRes.stream) {
    throw new Error("Failed to read from direct blob URL");
  }

  const text = await new Response(directRes.stream).text();
  const state = JSON.parse(text);

  console.log(`Event ID: ${state.eventId}`);
  console.log(`Version: ${state.version}`);
  console.log(`Status: ${state.status}`);
  console.log(`Generated At: ${state.generatedAt}`);
  console.log(`Participants count: ${state.participants.length}`);

  const readyCount = state.participants.filter((p: any) => !p.isRevealed).length;
  const revealedCount = state.participants.filter((p: any) => p.isRevealed).length;
  console.log(`Ready participants: ${readyCount}/18`);
  console.log(`Revealed participants: ${revealedCount}/18`);

  // Verify all 18 participants
  const expectedNames = [
    "Qais Alhadeed", "Mohammad Alshourati", "Mohammad Darras", "Hamza Darawi",
    "Zeina Darawi", "JOEL", "Yara Brj", "Leya Alkhateeb", "Nard", "Sanad",
    "G_karkar4", "Shammas", "Ghazal", "Jude", "Malak", "Sarah", "Wasan", "Michooo"
  ];

  const actualNames = state.participants.map((p: any) => p.name);
  const allMatch = expectedNames.every(name => actualNames.includes(name));
  console.log(`All 18 participant names present: ${allMatch}`);
  const encryptedCount = state.participants.filter((p: any) => !!p.encryptedRecipient).length;
  console.log(`Assignments encrypted count: ${encryptedCount}/18`);

  if (state.generatedAt === "2026-11-02T16:21:03.287Z") {
    console.log("✅ CRITICAL CHECK: Secret Santa draw timestamp is 100% UNCHANGED and preserved!");
  } else {
    console.warn(`⚠️ Warning: draw timestamp is ${state.generatedAt}`);
  }
}

verify().catch(console.error);
