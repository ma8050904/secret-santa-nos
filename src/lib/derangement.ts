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

// Constraint 3 (Corrected): Who Receives Mohammad Shourati
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
 * Validates all constraints specified in Phase 3:
 * 1. Derangement properties (all 48 assigned, unique, non-self).
 * 2. Mandatory reciprocal pair: Ghazal Baqleh <-> George Karkar.
 * 3. Mandatory exclusion: Zeina Darawi cannot give to Hamza Darawi, and Hamza cannot give to Zeina.
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

  // 1. Mandatory reciprocal assignment
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

  // 2. Mandatory exclusion constraint
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

  // 3. Mandatory Constraint 3: Who Receives Mohammad Shourati
  // Mohammad Shourati must be assigned as the recipient to exactly ONE randomly selected participant from TARGET_ALLOWED_GIVERS
  const shouratiGivers = assignments.filter((a) => a.recipientName === TARGET_RECIPIENT);
  if (shouratiGivers.length !== 1) {
    return {
      valid: false,
      reason: `Constraint 3 violation: ${TARGET_RECIPIENT} must have exactly one giver, found ${shouratiGivers.length}`,
    };
  }
  const giverOfShourati = shouratiGivers[0].giverName;
  if (!TARGET_ALLOWED_GIVERS.includes(giverOfShourati as any)) {
    return {
      valid: false,
      reason: `Constraint 3 violation: Giver of ${TARGET_RECIPIENT} must be one of the 11 allowed participants, but got "${giverOfShourati}"`,
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

/**
 * Generates a constrained Secret Santa draw satisfying all Phase 3 requirements:
 * 1. Fixed reciprocal: Ghazal Baqleh <-> George Karkar
 * 2. Forbidden exclusions: Zeina Darawi <-> Hamza Darawi
 * 3. Uniform cryptographic derangement on remaining participants
 */
export function generateConstrainedSecretSantaDraw(
  participants: readonly ParticipantItem[]
): AssignmentPair[] {
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

      // Check constraint 3: If recipient is Mohammad Shourati, giver MUST be in TARGET_ALLOWED_GIVERS
      if (recipient.name === TARGET_RECIPIENT) {
        if (!TARGET_ALLOWED_GIVERS.includes(giver.name as any)) {
          hasViolation = true;
          break;
        }
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

    // Validate the candidate draw against all constraints
    const validation = validateConstrainedSecretSantaDraw(participants, pairs);
    if (validation.valid) {
      return pairs;
    }
  }

  throw new Error(`Failed to generate constrained Secret Santa draw after ${maxAttempts} attempts.`);
}
