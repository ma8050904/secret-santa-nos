import crypto from "crypto";

export interface ParticipantItem {
  id: string;
  name: string;
}

export interface AssignmentPair {
  giverId: string;
  giverName: string;
  recipientId: string;
  recipientName: string;
}

// Special constrained participants
export const MANDATORY_RECIPROCAL_A = "Ghazal Baqleh";
export const MANDATORY_RECIPROCAL_B = "George Karkar";
export const FORBIDDEN_EXCLUSION_A = "Zeina Darawi";
export const FORBIDDEN_EXCLUSION_B = "Hamza Darawi";
export const FORBIDDEN_EXCLUSION_C = "Raghad Al-Shobaki";
export const FORBIDDEN_EXCLUSION_D = "Mohammad Shourati";

// Canonical Designated Subgroup (24 participants: 20 original + Raghad + Diana + Fadi + Njoud)
export const SUBGROUP_20_IDS = [
  "p3",  // Diana 👩‍🏫🛘
  "p5",  // Fadi 👨‍🏫📖
  "p6",  // George Karkar
  "p7",  // George Shammas
  "p8",  // Ghazal Baqleh
  "p12", // Hamza Darawi
  "p17", // Joewelle Ehab
  "p18", // Joseph Dababneh
  "p19", // Jude Fanous
  "p24", // Leya Al-Khatib
  "p25", // Malak Hindaileh
  "p30", // Michael Shamma
  "p32", // Mohammad Darras
  "p33", // Mohammad Shourati
  "p34", // Nardeen Abdallah
  "p37", // Njoud👩‍🏫📜
  "p40", // Qais Al-Hadeed
  "p41", // Raghad Al-Shobaki
  "p43", // Sanad Al-Hunaiti
  "p44", // Sarah Rabadi
  "p47", // Toleen Awwad
  "p48", // Wasan Abu Hamdeh
  "p49", // Yara Barjawi
  "p55", // Zeina Darawi
] as const;

export const SUBGROUP_20_ID_SET = new Set<string>(SUBGROUP_20_IDS);

// Legacy backward-compatibility constants
export const TARGET_RECIPIENT = "Mohammad Shourati";
export const TARGET_ALLOWED_GIVERS = [
  "Michael Shamma",
  "Mohammad Darras",
  "Qais Al-Hadeed",
  "Yara Barjawi",
  "Zeina Darawi",
  "Joewelle Ehab",
  "Joseph Dababneh",
  "George Shammas",
  "Toleen Awwad",
  "Wasan Abu Hamdeh",
  "Hamza Darawi",
] as const;

/**
 * Validates whether an assignment satisfies all mathematical Secret Santa properties:
 * 1. Every participant is a giver exactly once
 * 2. Every participant is a recipient exactly once
 * 3. Nobody is assigned to themselves (derangement condition)
 * 4. Bijection: size of givers == size of recipients == total participants
 */
export function validateDerangement(
  participants: readonly ParticipantItem[],
  assignments: AssignmentPair[]
): { valid: boolean; reason?: string } {
  const n = participants.length;
  if (assignments.length !== n) {
    return { valid: false, reason: `Assignment count (${assignments.length}) does not match participant count (${n})` };
  }

  const giverIds = new Set<string>();
  const recipientIds = new Set<string>();
  const participantIdSet = new Set(participants.map((p) => p.id));

  for (const pair of assignments) {
    if (!participantIdSet.has(pair.giverId)) {
      return { valid: false, reason: `Unknown giver ID: ${pair.giverId}` };
    }
    if (!participantIdSet.has(pair.recipientId)) {
      return { valid: false, reason: `Unknown recipient ID: ${pair.recipientId}` };
    }
    if (pair.giverId === pair.recipientId) {
      return { valid: false, reason: `Self-assignment detected: ${pair.giverName} assigned to themselves!` };
    }
    if (giverIds.has(pair.giverId)) {
      return { valid: false, reason: `Duplicate giver detected: ${pair.giverId}` };
    }
    if (recipientIds.has(pair.recipientId)) {
      return { valid: false, reason: `Duplicate recipient detected: ${pair.recipientId}` };
    }
    giverIds.add(pair.giverId);
    recipientIds.add(pair.recipientId);
  }

  if (giverIds.size !== n || recipientIds.size !== n) {
    return { valid: false, reason: "Incomplete bijection between givers and recipients" };
  }

  return { valid: true };
}

/**
 * Validates all constrained Secret Santa draw requirements:
 * 1. Base derangement properties (unique givers, unique recipients, zero self-assignments).
 * 2. 20-Person Subgroup Isolation (zero edges entering or leaving the 20-person subgroup).
 * 3. Mandatory reciprocal pair: Ghazal Baqleh <-> George Karkar.
 * 4. Mandatory mutual exclusion: Zeina Darawi cannot give to or receive from Hamza Darawi.
 */
export function validateConstrainedSecretSantaDraw(
  participants: readonly ParticipantItem[],
  assignments: AssignmentPair[]
): { valid: boolean; reason?: string } {
  // First run base derangement check
  const baseCheck = validateDerangement(participants, assignments);
  if (!baseCheck.valid) {
    return baseCheck;
  }

  const map = new Map<string, string>();
  for (const a of assignments) {
    map.set(a.giverName, a.recipientName);
  }

  // 1. Check Subgroup isolation if full roster is present
  if (participants.length > SUBGROUP_20_IDS.length) {
    for (const a of assignments) {
      const giverInSub20 = SUBGROUP_20_ID_SET.has(a.giverId);
      const recipientInSub20 = SUBGROUP_20_ID_SET.has(a.recipientId);

      if (giverInSub20 && !recipientInSub20) {
        return {
          valid: false,
          reason: `Subgroup isolation violation: ${a.giverName} (in designated subgroup) gave to ${a.recipientName} (outside designated subgroup)`,
        };
      }
      if (!giverInSub20 && recipientInSub20) {
        return {
          valid: false,
          reason: `Subgroup isolation violation: ${a.giverName} (outside designated subgroup) gave to ${a.recipientName} (inside designated subgroup)`,
        };
      }
    }
  }

  // 2. Mandatory reciprocal assignment
  if (map.get(MANDATORY_RECIPROCAL_A) !== MANDATORY_RECIPROCAL_B) {
    return {
      valid: false,
      reason: `Mandatory reciprocal violation: ${MANDATORY_RECIPROCAL_A} must be assigned to ${MANDATORY_RECIPROCAL_B}`,
    };
  }
  if (map.get(MANDATORY_RECIPROCAL_B) !== MANDATORY_RECIPROCAL_A) {
    return {
      valid: false,
      reason: `Mandatory reciprocal violation: ${MANDATORY_RECIPROCAL_B} must be assigned to ${MANDATORY_RECIPROCAL_A}`,
    };
  }

  // 3. Mandatory exclusion constraint 1: Zeina ⇎ Hamza
  if (map.get(FORBIDDEN_EXCLUSION_A) === FORBIDDEN_EXCLUSION_B) {
    return {
      valid: false,
      reason: `Mandatory exclusion violation: ${FORBIDDEN_EXCLUSION_A} cannot be assigned to ${FORBIDDEN_EXCLUSION_B}`,
    };
  }
  if (map.get(FORBIDDEN_EXCLUSION_B) === FORBIDDEN_EXCLUSION_A) {
    return {
      valid: false,
      reason: `Mandatory exclusion violation: ${FORBIDDEN_EXCLUSION_B} cannot be assigned to ${FORBIDDEN_EXCLUSION_A}`,
    };
  }

  // 4. Mandatory exclusion constraint 2: Raghad ⇎ Mohammad Shourati
  if (map.get(FORBIDDEN_EXCLUSION_C) === FORBIDDEN_EXCLUSION_D) {
    return {
      valid: false,
      reason: `Mandatory exclusion violation: ${FORBIDDEN_EXCLUSION_C} cannot be assigned to ${FORBIDDEN_EXCLUSION_D}`,
    };
  }
  if (map.get(FORBIDDEN_EXCLUSION_D) === FORBIDDEN_EXCLUSION_C) {
    return {
      valid: false,
      reason: `Mandatory exclusion violation: ${FORBIDDEN_EXCLUSION_D} cannot be assigned to ${FORBIDDEN_EXCLUSION_C}`,
    };
  }

  return { valid: true };
}

/**
 * Generates a derangement where NO participant receives the same recipient as in previousAssignments
 */
export function generateDistinctDerangement(
  participants: readonly ParticipantItem[],
  previousAssignmentsMap?: Record<string, string>
): AssignmentPair[] {
  let attempts = 0;
  const maxAttempts = 5000;

  while (attempts < maxAttempts) {
    attempts++;
    const pairs = generateSecretSantaDerangement(participants);

    if (!previousAssignmentsMap || Object.keys(previousAssignmentsMap).length === 0) {
      return pairs;
    }

    const hasAnyPreviousMatch = pairs.some(
      (p) => previousAssignmentsMap[p.giverId] && previousAssignmentsMap[p.giverId] === p.recipientId
    );

    if (!hasAnyPreviousMatch) {
      return pairs;
    }
  }

  throw new Error(`Could not generate distinct derangement after ${maxAttempts} attempts.`);
}

export function generateSecretSantaDerangement(
  participants: readonly ParticipantItem[]
): AssignmentPair[] {
  const n = participants.length;
  if (n < 2) {
    throw new Error("Secret Santa requires at least 2 participants.");
  }

  const list = [...participants];

  for (let i = n - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i);
    const temp = list[i];
    list[i] = list[j];
    list[j] = temp;
  }

  const assignments: AssignmentPair[] = [];
  for (let i = 0; i < n; i++) {
    const giver = list[i];
    const recipient = list[(i + 1) % n];
    assignments.push({
      giverId: giver.id,
      giverName: giver.name,
      recipientId: recipient.id,
      recipientName: recipient.name,
    });
  }

  const check = validateDerangement(participants, assignments);
  if (!check.valid) {
    throw new Error(`Derangement verification failed: ${check.reason}`);
  }

  return assignments;
}

export function generateSubgroup20Pairs(participants: readonly ParticipantItem[]): AssignmentPair[] {
  const ghazal = participants.find((p) => p.name === MANDATORY_RECIPROCAL_A);
  const george = participants.find((p) => p.name === MANDATORY_RECIPROCAL_B);

  if (!ghazal || !george) {
    throw new Error(
      `Mandatory participants missing: ${MANDATORY_RECIPROCAL_A} or ${MANDATORY_RECIPROCAL_B} not found in roster.`
    );
  }

  // Remaining participants for the derangement cycle
  const remaining = participants.filter(
    (p) => p.name !== MANDATORY_RECIPROCAL_A && p.name !== MANDATORY_RECIPROCAL_B
  );

  let attempts = 0;
  const maxAttempts = 10000;

  while (attempts < maxAttempts) {
    attempts++;

    // Permute remaining participants uniformly using Sattolo's algorithm
    const list = [...remaining];
    for (let i = list.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i);
      const temp = list[i];
      list[i] = list[j];
      list[j] = temp;
    }

    // Build assignment pairs for remaining participants
    const pairs: AssignmentPair[] = [];
    let hasViolation = false;

    for (let i = 0; i < list.length; i++) {
      const giver = list[i];
      const recipient = list[(i + 1) % list.length];

      // Check exclusion constraint: Zeina <-> Hamza
      if (
        (giver.name === FORBIDDEN_EXCLUSION_A && recipient.name === FORBIDDEN_EXCLUSION_B) ||
        (giver.name === FORBIDDEN_EXCLUSION_B && recipient.name === FORBIDDEN_EXCLUSION_A)
      ) {
        hasViolation = true;
        break;
      }

      // Check exclusion constraint: Raghad <-> Mohammad Shourati
      if (
        (giver.name === FORBIDDEN_EXCLUSION_C && recipient.name === FORBIDDEN_EXCLUSION_D) ||
        (giver.name === FORBIDDEN_EXCLUSION_D && recipient.name === FORBIDDEN_EXCLUSION_C)
      ) {
        hasViolation = true;
        break;
      }

      pairs.push({
        giverId: giver.id,
        giverName: giver.name,
        recipientId: recipient.id,
        recipientName: recipient.name,
      });
    }

    if (hasViolation) {
      continue;
    }

    // Add fixed reciprocal pair
    pairs.push({
      giverId: ghazal.id,
      giverName: ghazal.name,
      recipientId: george.id,
      recipientName: george.name,
    });
    pairs.push({
      giverId: george.id,
      giverName: george.name,
      recipientId: ghazal.id,
      recipientName: ghazal.name,
    });

    return pairs;
  }

  throw new Error(`Failed to generate Subgroup 20 draw after ${maxAttempts} attempts.`);
}

function generateDerangementCyclePairs(participants: readonly ParticipantItem[]): AssignmentPair[] {
  const n = participants.length;
  if (n < 2) {
    throw new Error("Derangement requires at least 2 participants.");
  }

  const list = [...participants];
  for (let i = n - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i);
    const temp = list[i];
    list[i] = list[j];
    list[j] = temp;
  }

  const pairs: AssignmentPair[] = [];
  for (let i = 0; i < n; i++) {
    const giver = list[i];
    const recipient = list[(i + 1) % n];
    pairs.push({
      giverId: giver.id,
      giverName: giver.name,
      recipientId: recipient.id,
      recipientName: recipient.name,
    });
  }

  return pairs;
}

/**
 * Generates a constrained Secret Santa draw satisfying all requirements:
 * If full 48-roster is given:
 * - Subgroup 1 (20 participants): closed internal draw, Ghazal <-> George reciprocal, Zeina <-> Hamza exclusion.
 * - Subgroup 2 (28 participants): closed internal derangement cycle.
 */
export function generateConstrainedSecretSantaDraw(
  participants: readonly ParticipantItem[]
): AssignmentPair[] {
  if (participants.length > SUBGROUP_20_IDS.length) {
    const sub = participants.filter((p) => SUBGROUP_20_ID_SET.has(p.id));
    const rem = participants.filter((p) => !SUBGROUP_20_ID_SET.has(p.id));

    if (sub.length !== SUBGROUP_20_IDS.length) {
      throw new Error(
        `Roster partition mismatch: expected ${SUBGROUP_20_IDS.length} in designated subgroup (got ${sub.length}) and ${participants.length - SUBGROUP_20_IDS.length} in remaining (got ${rem.length})`
      );
    }

    let attempts = 0;
    const maxAttempts = 10000;

    while (attempts < maxAttempts) {
      attempts++;
      const drawSub = generateSubgroup20Pairs(sub);
      const drawRem = generateDerangementCyclePairs(rem);
      const combined = [...drawSub, ...drawRem];

      const validation = validateConstrainedSecretSantaDraw(participants, combined);
      if (validation.valid) {
        return combined;
      }
    }

    throw new Error(`Failed to generate partitioned Secret Santa draw after ${maxAttempts} attempts.`);
  }

  // If already filtered to designated subgroup
  return generateSubgroup20Pairs(participants);
}
