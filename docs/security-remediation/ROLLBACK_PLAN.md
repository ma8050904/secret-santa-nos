# M5 Security Remediation — Rollback Plan
**Project:** `secret-santa-christmas`  
**Production URL:** `https://secret-santa-holiday.vercel.app`  
**Safety Checkpoint:** `.data/backup_verification_m5_remediation.json`

---

## 1. Rollback Triggers

A rollback must be initiated immediately if any of the following occur during or after production migration:
1. **Roster Corruption:** Number of participants in production falls below or exceeds 56.
2. **Assignment Invalidation:** Any participant receives a null recipient, an altered recipient, or a self-assignment.
3. **Database Connection Outage:** Unhandled database timeout errors (`ETIMEDOUT`, connection pool exhaustion) on Vercel Serverless.
4. **Catastrophic Lockout:** Valid PINs or biometric authentications fail globally for all participants.

---

## 2. Immediate Rollback Steps

### Step 1: Immediate Deployment Reversion (Vercel Instant Rollback)
1. Using Vercel Dashboard or CLI, redeploy the previous known-good deployment:
   ```bash
   vercel rollback <previous-deployment-id>
   ```
2. Revert any environment variable changes (`DATABASE_URL`).

### Step 2: Restore Event Data from Verified Snapshot
1. Authoritative snapshot location: `.data/backup_verification_m5_remediation.json`
2. Run data validation script:
   ```bash
   npx tsx -e '
     const fs = require("fs");
     const state = JSON.parse(fs.readFileSync(".data/backup_verification_m5_remediation.json", "utf-8"));
     console.log("Participants:", state.participants.length);
     console.log("MasterSalt present:", Boolean(state.masterSalt));
     if (state.participants.length !== 56) process.exit(1);
   '
   ```
3. If database restore is needed, re-seed the event state table from `.data/backup_verification_m5_remediation.json`.

---

## 3. Communication Protocol

If a rollback is triggered:
1. Display a maintenance banner on the landing page: `"The Secret Santa workshop is undergoing a quick 5-minute tune-up. Please check back shortly!"`
2. Maintain admin communication log in `docs/security-remediation/INCIDENT_LOG.md`.
3. Notify the organizer once the rollback is verified and stable.
