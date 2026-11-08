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

// Canonical 20-Person Subgroup
export const SUBGROUP_20_IDS = [
  "p34", // Qais Al-Hadeed
  "p28", // Mohammad Shourati
  "p27", // Mohammad Darras
  "p8",  // Hamza Darawi
  "p48", // Zeina Darawi
  "p13", // Joewelle Ehab
  "p42", // Yara Barjawi
  "p20", // Leya Al-Khatib
  "p29", // Nardeen Abdallah
  "p36", // Sanad Al-Hunaiti
  "p2",  // George Karkar
  "p3",  // George Shammas
  "p4",  // Ghazal Baqleh
  "p15", // Jude Fanous
  "p22", // Malak Hindaileh
  "p37", // Sarah Rabadi
  "p41", // Wasan Abu Hamdeh
  "p26", // Michael Shamma
  "p40", // Toleen Awwad
  "p14", // Joseph Dababneh
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

  // 1. Check Subgroup 20 isolation if full 48-roster is present
  if (participants.length === 48) {
    for (const a of assignments) {
      const giverInSub20 = SUBGROUP_20_ID_SET.has(a.giverId);
      const recipientInSub20 = SUBGROUP_20_ID_SET.has(a.recipientId);

      if (giverInSub20 && !recipientInSub20) {
        return {
          valid: false,
          reason: `Subgroup 20 isolation violation: ${a.giverName} (in Subgroup 20) gave to ${a.recipientName} (outside Subgroup 20)`,
        };
      }
      if (!giverInSub20 && recipientInSub20) {
        return {
          valid: false,
          reason: `Subgroup 20 isolation violation: ${a.giverName} (outside Subgroup 20) gave to ${a.recipientName} (inside Subgroup 20)`,
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

  // 3. Mandatory exclusion constraint
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
  if (participants.length === 48) {
    const sub20 = participants.filter((p) => SUBGROUP_20_ID_SET.has(p.id));
    const rem28 = participants.filter((p) => !SUBGROUP_20_ID_SET.has(p.id));

    if (sub20.length !== 20 || rem28.length !== 28) {
      throw new Error(
        `Roster partition mismatch: expected 20 in sub20 (got ${sub20.length}) and 28 in rem28 (got ${rem28.length})`
      );
    }

    let attempts = 0;
    const maxAttempts = 10000;

    while (attempts < maxAttempts) {
      attempts++;
      const draw20 = generateSubgroup20Pairs(sub20);
      const draw28 = generateDerangementCyclePairs(rem28);
      const combined = [...draw20, ...draw28];

      const validation = validateConstrainedSecretSantaDraw(participants, combined);
      if (validation.valid) {
        return combined;
      }
    }

    throw new Error(`Failed to generate partitioned Secret Santa draw after ${maxAttempts} attempts.`);
  }

  // If already filtered to sub20
  return generateSubgroup20Pairs(participants);
}
