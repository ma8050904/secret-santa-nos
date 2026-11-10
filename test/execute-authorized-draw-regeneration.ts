import fs from "fs";
import path from "path";
import assert from "assert";
import { getEventState, regenerateFullDraw, getAllDeviceBindings, getAllRegisteredPasskeyCredentials, getAdminAuditLogs } from "../src/lib/storage";
import { PARTICIPANTS } from "../src/lib/constants";
import {
  SUBGROUP_20_ID_SET,
  MANDATORY_RECIPROCAL_A,
  MANDATORY_RECIPROCAL_B,
  FORBIDDEN_EXCLUSION_A,
  FORBIDDEN_EXCLUSION_B,
  FORBIDDEN_EXCLUSION_C,
  FORBIDDEN_EXCLUSION_D,
  MANDATORY_DIRECTED_GIVER_1,
  MANDATORY_DIRECTED_RECIPIENT_1,
  MANDATORY_DIRECTED_GIVER_2,
  MANDATORY_DIRECTED_RECIPIENT_2,
} from "../src/lib/derangement";
import { decryptRecipient } from "../src/lib/crypto";

async function executeAuthorizedDrawRegeneration() {
  console.log("===================================================================");
  console.log("  🚀 EXECUTING AUTHORIZED FULL DRAW REGENERATION & SECURITY RESET");
  console.log("===================================================================\n");

  const localStateFile = path.join(process.cwd(), ".data", "secret-santa-event.json");
  assert.ok(fs.existsSync(localStateFile), "Authoritative event state file must exist in .data/");

  // Step 1: Pre-execution state inspection
  const preState = await getEventState(true);
  console.log(`Pre-execution Event Round: ${preState.version}`);
  console.log(`Pre-execution Draw Mode: ${preState.drawMode}`);
  console.log(`Pre-execution Total Participants: ${preState.participants.length}`);

  // Step 2: Execute draw regeneration and security reset
  console.log("\nExecuting regenerateFullDraw with constrained holiday mode...");
  const result = await regenerateFullDraw("127.0.0.1", "constrained");
  console.log("Result:", result);
  assert.strictEqual(result.success, true, "Execution must succeed");

  // Step 3: Verify Post-execution State
  const postState = await getEventState(true);
  console.log(`\nPost-execution Event Round: ${postState.version}`);
  console.log(`Post-execution Draw Mode: ${postState.drawMode}`);
  console.log(`Post-execution Total Participants: ${postState.participants.length}`);

  assert.strictEqual(postState.status, "active", "Event status must be active");
  assert.strictEqual(postState.drawMode, "constrained", "Draw mode must be constrained");
  assert.strictEqual(postState.participants.length, 56, "Participant roster must be exactly 56");

  // Step 4: Verify complete auth & device wipe across all 56 participants
  for (const p of postState.participants) {
    assert.strictEqual(p.pinHash, null);
    assert.strictEqual(p.pinSalt, null);
    assert.strictEqual(p.encryptedWithPin, false);
    assert.strictEqual(p.isRevealed, false);
    assert.strictEqual(p.revealedAt, null);
    assert.strictEqual(p.passkeyCredentialId, null);
    assert.strictEqual(p.passkeyPublicKey, null);
    assert.strictEqual(p.passkeyCounter, 0);
    assert.strictEqual(p.passkeyRegisteredAt, null);
  }
  console.log("✅ All 56 participant PINs, passkeys, and reveals are 100% reset.");

  // Step 5: Verify device bindings & passkey pools
  const bindings = await getAllDeviceBindings();
  assert.strictEqual(bindings.length, 0, "All device bindings must be wiped");
  const creds = await getAllRegisteredPasskeyCredentials();
  assert.strictEqual(creds.length, 0, "Registered passkey credentials pool must be empty");
  console.log("✅ Device bindings and hardware device registrations are 100% wiped.");

  // Step 6: Decrypt and verify all 56 constrained assignments
  const assignmentMap = new Map<string, string>();
  for (const p of postState.participants) {
    assert.ok(p.encryptedRecipient);
    const recName = decryptRecipient(p.encryptedRecipient, p.code, postState.masterSalt);
    assert.ok(recName);
    assert.notStrictEqual(p.name, recName, `Self assignment forbidden for ${p.name}`);
    assignmentMap.set(p.name, recName);
  }

  // Reciprocal rule
  assert.strictEqual(assignmentMap.get(MANDATORY_RECIPROCAL_A), MANDATORY_RECIPROCAL_B);
  assert.strictEqual(assignmentMap.get(MANDATORY_RECIPROCAL_B), MANDATORY_RECIPROCAL_A);
  console.log("✅ Mandatory reciprocal pairing verified: Ghazal Baqleh ⇄ George Karkar.");

  // Exclusion rules
  assert.notStrictEqual(assignmentMap.get(FORBIDDEN_EXCLUSION_A), FORBIDDEN_EXCLUSION_B);
  assert.notStrictEqual(assignmentMap.get(FORBIDDEN_EXCLUSION_B), FORBIDDEN_EXCLUSION_A);
  console.log("✅ Mandatory exclusion verified: Zeina Darawi ↮ Hamza Darawi.");

  assert.notStrictEqual(assignmentMap.get(FORBIDDEN_EXCLUSION_C), FORBIDDEN_EXCLUSION_D);
  assert.notStrictEqual(assignmentMap.get(FORBIDDEN_EXCLUSION_D), FORBIDDEN_EXCLUSION_C);
  console.log("✅ Mandatory exclusion verified: Raghad Al-Shobaki ↮ Mohammad Alshourati.");

  // Directed rules
  assert.strictEqual(assignmentMap.get(MANDATORY_DIRECTED_GIVER_1), MANDATORY_DIRECTED_RECIPIENT_1);
  console.log("✅ Mandatory directed assignment verified: Maysoon 🏫 → Qais Al-Hadeed.");

  assert.strictEqual(assignmentMap.get(MANDATORY_DIRECTED_GIVER_2), MANDATORY_DIRECTED_RECIPIENT_2);
  console.log("✅ Mandatory directed assignment verified: Diana 👩‍🏫🛘 → Mohammad Alshourati.");

  // Subgroup 24 isolation
  for (const p of postState.participants) {
    const giverInSub20 = SUBGROUP_20_ID_SET.has(p.id as any);
    const recName = assignmentMap.get(p.name)!;
    const recP = PARTICIPANTS.find((x) => x.name === recName)!;
    const recInSub20 = SUBGROUP_20_ID_SET.has(recP.id as any);
    assert.strictEqual(giverInSub20, recInSub20);
  }
  console.log("✅ Subgroup 24 boundary isolation verified: 0 cross-boundary edges.");

  // Step 7: Audit log verification
  const auditLogs = await getAdminAuditLogs();
  assert.ok(auditLogs.length > 0);
  assert.strictEqual(auditLogs[0].action, "REGENERATE_FULL_DRAW");
  console.log("✅ Audit Ledger verified: REGENERATE_FULL_DRAW recorded successfully.");

  console.log("\n===================================================================");
  console.log("  🎉 AUTHORIZED FULL DRAW REGENERATION COMPLETED SUCCESSFULLY! 🎉");
  console.log("===================================================================");
}

executeAuthorizedDrawRegeneration().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
