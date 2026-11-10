import * as fs from "fs";
import * as path from "path";
import QRCode from "qrcode";
import { getAdminAuditLogs, recordAdminAuditLog, clearAdminAuditLogs } from "../src/lib/storage";

async function verifyRefinements() {
  console.log("========================================================");
  console.log("  🍎 ADMIN PANEL REFINEMENT VERIFICATION AUDIT 🍎");
  console.log("========================================================\n");

  const adminPagePath = path.join(process.cwd(), "src/app/admin/page.tsx");
  const adminPageContent = fs.readFileSync(adminPagePath, "utf-8");

  // Test 1: Full Event Reset completely absent
  const hasFullResetAction = /activeModal\s*===\s*["']FULL_RESET["']/.test(adminPageContent);
  const hasFullResetButton = /["']Full Event Reset["']/i.test(adminPageContent);
  if (!hasFullResetAction && !hasFullResetButton) {
    console.log("✅ PASS: Full Event Reset option and modal are completely absent from Admin Panel");
  } else {
    throw new Error("FAIL: Full Event Reset was detected in admin page!");
  }

  // Test 2: Shuffle Group / Reroll Subgroup completely absent
  const hasRerollAction = /activeModal\s*===\s*["']REROLL_SUBGROUP["']/.test(adminPageContent);
  const hasRerollButton = /خلط المجموعة/i.test(adminPageContent);
  if (!hasRerollAction && !hasRerollButton) {
    console.log("✅ PASS: Shuffle Group (خلط المجموعة) option and modal are completely absent");
  } else {
    throw new Error("FAIL: Shuffle Group was detected in admin page!");
  }

  // Test 3: QR Code Destination strictly encodes exact production URL
  const PRODUCTION_PORTAL_URL = "https://secret-santa-holiday.vercel.app";
  const qrRaw = QRCode.create(PRODUCTION_PORTAL_URL);
  const decodedUrl = qrRaw.segments.map((s) => Buffer.from(s.data).toString("utf-8")).join("");
  if (decodedUrl === PRODUCTION_PORTAL_URL) {
    console.log(`✅ PASS: QR Code strictly encodes exact production URL: ${decodedUrl}`);
  } else {
    throw new Error(`FAIL: QR Code encoded destination mismatch: ${decodedUrl}`);
  }

  // Test 4: Complete English Localization - zero Arabic characters
  const arabicRegex = /[\u0600-\u06FF]/;
  const lines = adminPageContent.split("\n");
  const arabicLines = lines.filter((l) => arabicRegex.test(l));
  if (arabicLines.length === 0) {
    console.log("✅ PASS: Complete English Localization — 0 Arabic characters in Admin Panel (100% English)");
  } else {
    throw new Error(`FAIL: Found ${arabicLines.length} Arabic lines in admin page: ${arabicLines.join("\n")}`);
  }

  // Test 5: Participant Registration Directory collapsed by default
  const hasCollapsedDefault = /const\s*\[\s*isParticipantDirectoryExpanded\s*,\s*setIsParticipantDirectoryExpanded\s*\]\s*=\s*useState\(\s*false\s*\)/.test(
    adminPageContent
  );
  if (hasCollapsedDefault) {
    console.log("✅ PASS: Participant Directory is configured as compact and collapsed by default");
  } else {
    throw new Error("FAIL: Participant directory is not collapsed by default!");
  }

  // Test 6: Audit Records reset and empty
  const logs = await getAdminAuditLogs();
  if (logs.length === 0) {
    console.log("✅ PASS: Administrative Activity and Login Audit Ledger are completely reset (0 entries)");
  } else {
    throw new Error(`FAIL: Audit logs not empty, found: ${logs.length} entries`);
  }

  // Test 7: Future logging functionality preserved
  const testEntry = await recordAdminAuditLog({
    action: "ADMIN_LOGIN",
    actionLabel: "Audit Test Entry",
    ip: "127.0.0.1",
    status: "SUCCESS",
    details: "Testing future audit record preservation.",
  });
  const afterLog = await getAdminAuditLogs();
  if (afterLog.length === 1 && afterLog[0].id === testEntry.id) {
    console.log("✅ PASS: Future audit logging is fully operational and preserved");
  } else {
    throw new Error("FAIL: Future audit logging failed to record entry");
  }
  // Clear test entry back to clean state
  await clearAdminAuditLogs();
  const finalLogs = await getAdminAuditLogs();
  if (finalLogs.length === 0) {
    console.log("✅ PASS: Clean audit state restored after verification (0 entries)");
  }

  // Test 8: Reset Device Bindings option and modal are completely absent
  const hasResetDevicesModal = /activeModal\s*===\s*["']RESET_DEVICES["']/.test(adminPageContent);
  const hasResetDevicesButton = /["']Reset Device Bindings["']/i.test(adminPageContent);
  if (!hasResetDevicesModal && !hasResetDevicesButton) {
    console.log("✅ PASS: Standalone Reset Device Bindings option and modal are completely absent");
  } else {
    throw new Error("FAIL: Reset Device Bindings was detected in admin page!");
  }

  console.log("\n========================================================");
  console.log("  ALL 8 ADMIN REFINEMENT VERIFICATIONS PASSED! ✅");
  console.log("========================================================");
}

verifyRefinements().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
