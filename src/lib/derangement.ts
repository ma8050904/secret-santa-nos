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
export const FORBIDDEN_EXCLUSION_D = "Mohammad Alshourati";

export const MANDATORY_DIRECTED_GIVER_1 = "Maysoon 🏫";
export const MANDATORY_DIRECTED_RECIPIENT_1 = "Qais Al-Hadeed";

export const MANDATORY_DIRECTED_GIVER_2 = "Diana 👩‍🏫🛘";
export const MANDATORY_DIRECTED_RECIPIENT_2 = "Mohammad Alshourati";

// Canonical Designated Subgroup (24 participants: 20 original + Raghad + Diana + Maysoon + Njoud)
export const SUBGROUP_20_IDS = [
  "p3",  // Diana 👩‍🏫🛘
  "p6",  // George Karkar
  "p7",  // George Shammas
  "p8",  // Ghazal Baqleh
  "p12", // Hamza Darawi
  "p17", // Joewelle Ehab
  "p18", // Joseph Dababneh
  "p19", // Jude Fanous
  "p24", // Leya Al-Khatib
  "p25", // Malak Hindaileh
  "p30", // Maysoon 🏫
  "p31", // Michael Shamma
  "p33", // Mohammad Alshourati
  "p34", // Mohammad Darras
  "p35", // Nardeen Abdallah
  "p38", // Njoud👩‍🏫📜
  "p41", // Qais Al-Hadeed
  "p42", // Raghad Al-Shobaki
  "p44", // Sanad Al-Hunaiti
  "p45", // Sarah Rabadi
  "p48", // Toleen Awwad
  "p49", // Wasan Abu Hamdeh
  "p50", // Yara Barjawi
  "p56", // Zeina Darawi
] as const;

export const SUBGROUP_20_ID_SET = new Set<string>(SUBGROUP_20_IDS);

// Legacy backward-compatibility constants
export const TARGET_RECIPIENT = "Mohammad Alshourati";
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
 * 2. Designated Subgroup Isolation (zero edges entering or leaving the designated subgroup).
 * 3. Mandatory reciprocal pair: Ghazal Baqleh <-> George Karkar.
 * 4. Mandatory mutual exclusion: Zeina Darawi cannot give to or receive from Hamza Darawi.
 * 5. Mandatory mutual exclusion: Raghad Al-Shobaki cannot give to or receive from Mohammad Alshourati.
 * 6. Mandatory directed assignment 1: Maysoon 🏫 gives to Qais Al-Hadeed.
 * 7. Mandatory directed assignment 2: Diana 👩‍🏫🛘 gives to Mohammad Alshourati.
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

  // 4. Mandatory exclusion constraint 2: Raghad ⇎ Mohammad Alshourati
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

  // 5. Mandatory directed assignment 1: Maysoon 🏫 -> Qais Al-Hadeed
  if (map.has(MANDATORY_DIRECTED_GIVER_1) && map.get(MANDATORY_DIRECTED_GIVER_1) !== MANDATORY_DIRECTED_RECIPIENT_1) {
    return {
      valid: false,
      reason: `Mandatory directed assignment violation: ${MANDATORY_DIRECTED_GIVER_1} must be assigned to ${MANDATORY_DIRECTED_RECIPIENT_1}`,
    };
  }

  // 6. Mandatory directed assignment 2: Diana 👩‍🏫🛘 -> Mohammad Alshourati
  if (map.has(MANDATORY_DIRECTED_GIVER_2) && map.get(MANDATORY_DIRECTED_GIVER_2) !== MANDATORY_DIRECTED_RECIPIENT_2) {
    return {
      valid: false,
      reason: `Mandatory directed assignment violation: ${MANDATORY_DIRECTED_GIVER_2} must be assigned to ${MANDATORY_DIRECTED_RECIPIENT_2}`,
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
  const diana = participants.find((p) => p.name === MANDATORY_DIRECTED_GIVER_2);
  const mohammad = participants.find((p) => p.name === MANDATORY_DIRECTED_RECIPIENT_2);
  const maysoon = participants.find((p) => p.name === MANDATORY_DIRECTED_GIVER_1);
  const qais = participants.find((p) => p.name === MANDATORY_DIRECTED_RECIPIENT_1);

  if (!ghazal || !george || !diana || !mohammad || !maysoon || !qais) {
    throw new Error("Mandatory constrained participants missing from designated subgroup roster.");
  }

  // Participants other than Ghazal, George, Diana, Mohammad, Maysoon, Qais
  const others = participants.filter(
    (p) =>
      p.name !== MANDATORY_RECIPROCAL_A &&
      p.name !== MANDATORY_RECIPROCAL_B &&
      p.name !== MANDATORY_DIRECTED_GIVER_2 &&
      p.name !== MANDATORY_DIRECTED_RECIPIENT_2 &&
      p.name !== MANDATORY_DIRECTED_GIVER_1 &&
      p.name !== MANDATORY_DIRECTED_RECIPIENT_1
  );

  // Composite units:
  // Unit 1: [diana, mohammad] guarantees Diana -> Mohammad
  // Unit 2: [maysoon, qais] guarantees Maysoon -> Qais
  // Remaining participants as 1-element units
  const units: ParticipantItem[][] = [
    [diana, mohammad],
    [maysoon, qais],
    ...others.map((p) => [p]),
  ];

  let attempts = 0;
  const maxAttempts = 10000;

  while (attempts < maxAttempts) {
    attempts++;

    // Permute units uniformly
    const shuffledUnits = [...units];
    for (let i = shuffledUnits.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i);
      const temp = shuffledUnits[i];
      shuffledUnits[i] = shuffledUnits[j];
      shuffledUnits[j] = temp;
    }

    // Flatten into cycle
    const cycleParticipants: ParticipantItem[] = [];
    for (const u of shuffledUnits) {
      cycleParticipants.push(...u);
    }

    const pairs: AssignmentPair[] = [];
    let hasViolation = false;

    for (let i = 0; i < cycleParticipants.length; i++) {
      const giver = cycleParticipants[i];
      const recipient = cycleParticipants[(i + 1) % cycleParticipants.length];

      // Check exclusion constraint: Zeina <-> Hamza
      if (
        (giver.name === FORBIDDEN_EXCLUSION_A && recipient.name === FORBIDDEN_EXCLUSION_B) ||
        (giver.name === FORBIDDEN_EXCLUSION_B && recipient.name === FORBIDDEN_EXCLUSION_A)
      ) {
        hasViolation = true;
        break;
      }

      // Check exclusion constraint: Raghad <-> Mohammad Alshourati
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

  throw new Error(`Failed to generate Subgroup 24 draw after ${maxAttempts} attempts.`);
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
 * If full roster is given:
 * - Subgroup 1 (24 participants): closed internal draw, Ghazal <-> George reciprocal, Zeina <-> Hamza exclusion, Raghad <-> Mohammad exclusion, Maysoon -> Qais, Diana -> Mohammad.
 * - Subgroup 2 (32 participants): closed internal derangement cycle.
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
