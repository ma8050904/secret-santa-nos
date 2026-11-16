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
export const FORBIDDEN_EXCLUSION_C = "Raghad Al-Shobaki";
export const FORBIDDEN_EXCLUSION_D = "Mohammad Alshourati";

export const MANDATORY_DIRECTED_GIVER_2 = "Diana 👩‍🏫🛘";
export const MANDATORY_DIRECTED_RECIPIENT_2 = "Mohammad Alshourati";
export const MANDATORY_DIRECTED_GIVER_3 = "Hamza Darawi";
export const MANDATORY_DIRECTED_RECIPIENT_3 = "Zeina Darawi";
export const MANDATORY_DIRECTED_GIVER_4 = "Maya Joy Mahrejian";
export const MANDATORY_DIRECTED_RECIPIENT_4 = "Natalie Khacherian";

export const FORBIDDEN_EXCLUSION_MAYA_PERSON = "Maya Joy Mahrejian";
export const FORBIDDEN_EXCLUSION_MAYA_GROUP = [
  "Yousef Jahshan",
  "Ibrahim Jahshan",
  "Ibrahim Hanin",
  "Issa Hijazeen",
] as const;
const FORBIDDEN_EXCLUSION_MAYA_GROUP_SET = new Set<string>(FORBIDDEN_EXCLUSION_MAYA_GROUP);

// Canonical Designated Subgroup (24 participants: Fadi moved into Subgroup 24 replacing Maysoon; Muneer⛪️ in Remaining 32)
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
  "p32", // Mohammad Alshourati
  "p33", // Mohammad Darras
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
 * 2. Designated Subgroup Isolation (zero edges entering or leaving Subgroup 24).
 * 3. Mandatory reciprocal pair: Ghazal Baqleh <-> George Karkar.
 * 4. Mandatory mutual exclusion: Raghad Al-Shobaki cannot give to or receive from Mohammad Alshourati.
 * 5. Mandatory directed assignment: Diana 👩‍🏫🛘 gives to Mohammad Alshourati.
 * 6. Mandatory directed assignment: Hamza Darawi gives to Zeina Darawi.
 * 7. Mandatory directed assignment: Maya Joy Mahrejian gives to Natalie Khacherian.
 * 8. Mandatory mutual exclusion: Maya Joy Mahrejian cannot give to or receive from Yousef Jahshan, Ibrahim Jahshan, Ibrahim Hanin, or Issa Hijazeen.
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

  // 2. Mandatory reciprocal assignment: Ghazal Baqleh <-> George Karkar
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

  // 3. Mandatory exclusion constraint: Raghad Al-Shobaki <-> Mohammad Alshourati
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

  // 4. Mandatory directed assignment: Diana 👩‍🏫🛘 -> Mohammad Alshourati
  if (map.has(MANDATORY_DIRECTED_GIVER_2) && map.get(MANDATORY_DIRECTED_GIVER_2) !== MANDATORY_DIRECTED_RECIPIENT_2) {
    return {
      valid: false,
      reason: `Mandatory directed assignment violation: ${MANDATORY_DIRECTED_GIVER_2} must be assigned to ${MANDATORY_DIRECTED_RECIPIENT_2}`,
    };
  }

  // 5. Mandatory directed assignment: Hamza Darawi -> Zeina Darawi
  if (map.has(MANDATORY_DIRECTED_GIVER_3) && map.get(MANDATORY_DIRECTED_GIVER_3) !== MANDATORY_DIRECTED_RECIPIENT_3) {
    return {
      valid: false,
      reason: `Mandatory directed assignment violation: ${MANDATORY_DIRECTED_GIVER_3} must be assigned to ${MANDATORY_DIRECTED_RECIPIENT_3}`,
    };
  }

  // 6. Mandatory directed assignment: Maya Joy Mahrejian -> Natalie Khacherian
  if (map.has(MANDATORY_DIRECTED_GIVER_4) && map.get(MANDATORY_DIRECTED_GIVER_4) !== MANDATORY_DIRECTED_RECIPIENT_4) {
    return {
      valid: false,
      reason: `Mandatory directed assignment violation: ${MANDATORY_DIRECTED_GIVER_4} must be assigned to ${MANDATORY_DIRECTED_RECIPIENT_4}`,
    };
  }

  // 7. Mandatory mutual exclusion: Maya Joy Mahrejian <-> {Yousef Jahshan, Ibrahim Jahshan, Ibrahim Hanin, Issa Hijazeen}
  for (const excludedName of FORBIDDEN_EXCLUSION_MAYA_GROUP) {
    if (map.get(FORBIDDEN_EXCLUSION_MAYA_PERSON) === excludedName) {
      return {
        valid: false,
        reason: `Mandatory exclusion violation: ${FORBIDDEN_EXCLUSION_MAYA_PERSON} cannot be assigned to ${excludedName}`,
      };
    }
    if (map.get(excludedName) === FORBIDDEN_EXCLUSION_MAYA_PERSON) {
      return {
        valid: false,
        reason: `Mandatory exclusion violation: ${excludedName} cannot be assigned to ${FORBIDDEN_EXCLUSION_MAYA_PERSON}`,
      };
    }
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
    const j = crypto.randomInt(0, i + 1);
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
 * Permutes participant units uniformly and flattens them into a single derangement cycle
 * while rejecting any edge that violates an exclusion predicate.
 */
function shuffleUnitsAndBuildCycle(
  units: ParticipantItem[][],
  isForbiddenEdge: (giverName: string, recipientName: string) => boolean,
  errorLabel: string,
  maxAttempts = 10000
): AssignmentPair[] {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shuffledUnits = [...units];
    for (let i = shuffledUnits.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      const temp = shuffledUnits[i];
      shuffledUnits[i] = shuffledUnits[j];
      shuffledUnits[j] = temp;
    }

    const cycleParticipants: ParticipantItem[] = [];
    for (const u of shuffledUnits) {
      cycleParticipants.push(...u);
    }

    const pairs: AssignmentPair[] = [];
    let hasViolation = false;

    for (let i = 0; i < cycleParticipants.length; i++) {
      const giver = cycleParticipants[i];
      const recipient = cycleParticipants[(i + 1) % cycleParticipants.length];

      if (isForbiddenEdge(giver.name, recipient.name)) {
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

    if (!hasViolation) {
      return pairs;
    }
  }

  throw new Error(`Failed to generate ${errorLabel} after ${maxAttempts} attempts.`);
}

export function generateSubgroup20Pairs(participants: readonly ParticipantItem[]): AssignmentPair[] {
  const ghazal = participants.find((p) => p.name === MANDATORY_RECIPROCAL_A);
  const george = participants.find((p) => p.name === MANDATORY_RECIPROCAL_B);
  const diana = participants.find((p) => p.name === MANDATORY_DIRECTED_GIVER_2);
  const mohammad = participants.find((p) => p.name === MANDATORY_DIRECTED_RECIPIENT_2);
  const hamza = participants.find((p) => p.name === MANDATORY_DIRECTED_GIVER_3);
  const zeina = participants.find((p) => p.name === MANDATORY_DIRECTED_RECIPIENT_3);

  if (!ghazal || !george || !diana || !mohammad || !hamza || !zeina) {
    throw new Error("Mandatory constrained participants missing from designated subgroup roster.");
  }

  // Participants other than Ghazal, George, Diana, Mohammad, Hamza Darawi, and Zeina Darawi
  const others = participants.filter(
    (p) =>
      p.name !== MANDATORY_RECIPROCAL_A &&
      p.name !== MANDATORY_RECIPROCAL_B &&
      p.name !== MANDATORY_DIRECTED_GIVER_2 &&
      p.name !== MANDATORY_DIRECTED_RECIPIENT_2 &&
      p.name !== MANDATORY_DIRECTED_GIVER_3 &&
      p.name !== MANDATORY_DIRECTED_RECIPIENT_3
  );

  // Composite units [diana, mohammad] and [hamza, zeina] guarantee Diana -> Mohammad and Hamza -> Zeina; remaining members are 1-element units
  const units: ParticipantItem[][] = [
    [diana, mohammad],
    [hamza, zeina],
    ...others.map((p) => [p]),
  ];

  const pairs = shuffleUnitsAndBuildCycle(
    units,
    (giverName, recipientName) =>
      (giverName === FORBIDDEN_EXCLUSION_C && recipientName === FORBIDDEN_EXCLUSION_D) ||
      (giverName === FORBIDDEN_EXCLUSION_D && recipientName === FORBIDDEN_EXCLUSION_C),
    "Subgroup 24 draw"
  );

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

function generateDerangementCyclePairs(participants: readonly ParticipantItem[]): AssignmentPair[] {
  const n = participants.length;
  if (n < 2) {
    throw new Error("Derangement requires at least 2 participants.");
  }

  const maya = participants.find((p) => p.name === MANDATORY_DIRECTED_GIVER_4);
  const natalie = participants.find((p) => p.name === MANDATORY_DIRECTED_RECIPIENT_4);

  if (maya && natalie) {
    const others = participants.filter(
      (p) => p.name !== MANDATORY_DIRECTED_GIVER_4 && p.name !== MANDATORY_DIRECTED_RECIPIENT_4
    );
    const units: ParticipantItem[][] = [[maya, natalie], ...others.map((p) => [p])];

    return shuffleUnitsAndBuildCycle(
      units,
      (giverName, recipientName) =>
        (giverName === FORBIDDEN_EXCLUSION_MAYA_PERSON && FORBIDDEN_EXCLUSION_MAYA_GROUP_SET.has(recipientName)) ||
        (recipientName === FORBIDDEN_EXCLUSION_MAYA_PERSON && FORBIDDEN_EXCLUSION_MAYA_GROUP_SET.has(giverName)),
      "Remaining 32 constrained draw"
    );
  }

  return shuffleUnitsAndBuildCycle(
    participants.map((p) => [p]),
    () => false,
    "derangement cycle"
  );
}

/**
 * Generates a constrained Secret Santa draw satisfying all requirements:
 * If full roster is given:
 * - Subgroup 1 (24 participants, includes Fadi 👨‍🏫📖): closed internal draw, Ghazal <-> George reciprocal, Raghad <-> Mohammad exclusion, Diana -> Mohammad, Hamza -> Zeina.
 * - Subgroup 2 (32 participants, includes Muneer⛪️): closed internal draw, Maya -> Natalie, and Maya <-> {Yousef Jahshan, Ibrahim Jahshan, Ibrahim Hanin, Issa Hijazeen} exclusion.
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
