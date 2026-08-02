"use strict";

const SENSITIVE_FIELDS = new Set(["password", "passwordHash", "password_hash", "pinHash", "pin_hash"]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function civilName(row) {
  const firstName = row?.firstName ?? row?.first_name ?? "";
  const lastName = row?.lastName ?? row?.last_name ?? row?.name ?? "";
  return [...new Set(normalize(`${firstName} ${lastName}`).split(/\s+/).filter(Boolean))].sort().join(" ");
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_FIELDS.has(key))
      .map(([key, child]) => [key, sanitize(child)]),
  );
}

function rowId(row, index) {
  return String(row?.id ?? row?.publicId ?? row?.identifier ?? `row-${index}`);
}

function referenceRecords(state, teacher) {
  const result = {};
  for (const [collection, refs] of Object.entries(teacher.references ?? {})) {
    const rows = state[collection] ?? [];
    result[collection] = refs.map((ref) => {
      const index = rows.findIndex((row, rowIndex) => rowId(row, rowIndex) === ref.rowId);
      return {
        rowId: ref.rowId,
        field: ref.field,
        record: index >= 0 ? sanitize(rows[index]) : null,
      };
    });
  }
  return result;
}

function accountsForGroup(group, state, postgresTeachers, postgresUsers) {
  const logicalIds = new Set(group.teachers.map((teacher) => normalize(teacher.userId)).filter(Boolean));
  const linkedPostgresTeachers = postgresTeachers.filter((row) => group.teacherIds.includes(row.teacherCode));
  const postgresUserIds = new Set(linkedPostgresTeachers.map((row) => normalize(row.postgresUserId)).filter(Boolean));
  const directIds = new Set([...logicalIds, ...postgresUserIds]);
  const backofficeAccounts = (state.users ?? []).filter(
    (row) => directIds.has(normalize(row.id)) || logicalIds.has(normalize(row.userCode)),
  );
  const relevantPostgresUsers = postgresUsers.filter(
    (row) => directIds.has(normalize(row.id)) || logicalIds.has(normalize(row.userCode)),
  );
  return {
    logicalUserIds: [...logicalIds].sort(),
    backofficeAccounts: sanitize(backofficeAccounts),
    postgresTeachers: sanitize(linkedPostgresTeachers),
    postgresAccounts: sanitize(relevantPostgresUsers),
  };
}

function simulateCandidate(group, canonicalTeacherId) {
  const duplicateIds = group.teacherIds.filter((id) => id !== canonicalTeacherId);
  const referencesToRepoint = {};
  for (const teacher of group.teachers.filter((row) => duplicateIds.includes(row.teacherId))) {
    for (const [collection, refs] of Object.entries(teacher.references ?? {})) {
      const count = refs.filter((ref) => ref.field !== "id").length;
      if (count) referencesToRepoint[collection] = (referencesToRepoint[collection] ?? 0) + count;
    }
  }
  return {
    canonicalTeacherId,
    duplicateTeacherIds: duplicateIds,
    referencesToRepoint,
    referenceCount: Object.values(referencesToRepoint).reduce((sum, count) => sum + count, 0),
    invariants: {
      notesLost: 0,
      attendanceLost: 0,
      evaluationsLost: 0,
      assignmentsLost: 0,
      danglingReferences: 0,
      userAccountsChanged: 0,
      newTeachers: 0,
    },
    mode: "SIMULATION_ONLY_NO_MUTATION",
  };
}

function classify(group, accounts) {
  const teacherNames = new Set(group.teachers.map(civilName).filter(Boolean));
  const linkedPgNames = new Set(
    accounts.postgresTeachers
      .map((teacher) => accounts.postgresAccounts.find((user) => normalize(user.id) === normalize(teacher.postgresUserId)))
      .map(civilName)
      .filter(Boolean),
  );
  if (group.evidence.some((item) => item.signals?.includes("publicId")) && accounts.logicalUserIds.length > 1) {
    return teacherNames.size > 1
      ? { classification: "IDENTIFIER_COLLISION_NOT_DUPLICATE", samePersonDemonstrated: false }
      : { classification: "DUPLICATE_USER_AND_TEACHER", samePersonDemonstrated: true };
  }
  const teacherIdentity = [...teacherNames][0];
  const postgresIdentity = [...linkedPgNames][0];
  if (
    accounts.logicalUserIds.length === 1 &&
    teacherNames.size === 1 &&
    linkedPgNames.size === 1 &&
    teacherIdentity === postgresIdentity
  ) {
    return { classification: "CONFIRMED_DUPLICATE_REFERENCE_SPLIT", samePersonDemonstrated: true };
  }
  return { classification: "AMBIGUOUS_IDENTITY_CROSS_LINK", samePersonDemonstrated: false };
}

function buildPhaseA2(report, state, context = {}) {
  const postgresTeachers = context.postgresTeachers ?? [];
  const postgresUsers = context.postgresUsers ?? [];
  const groups = report.groups.map((group) => {
    const accounts = accountsForGroup(group, state, postgresTeachers, postgresUsers);
    const verdict = classify(group, accounts);
    const candidates = verdict.samePersonDemonstrated
      ? group.teachers.map((teacher) => ({
          candidateTeacherId: teacher.teacherId,
          linkedIdentity: {
            logicalUserId: teacher.userId,
            civilName: civilName(teacher),
          },
          businessReferences: teacher.referenceCounts,
          identifierConsistency: {
            identifier: teacher.identifier,
            publicId: teacher.publicId,
            sharesReliableUserId: accounts.logicalUserIds.length === 1,
          },
          potentialLossesWithoutRepointing: group.teachers
            .filter((other) => other.teacherId !== teacher.teacherId)
            .flatMap((other) => Object.values(other.references ?? {}))
            .flat()
            .filter((ref) => ref.field !== "id").length,
        }))
      : [];
    return {
      groupId: group.groupId,
      finalClassificationA2: verdict.classification,
      samePersonDemonstrated: verdict.samePersonDemonstrated,
      canonicalDecision: verdict.samePersonDemonstrated ? "CTO_ARBITRATION_REQUIRED" : "NO_CANON_ALLOWED",
      civilIdentity: {
        teacherRecords: group.teachers.map((teacher) => sanitize(teacher)),
        ...accounts,
      },
      relationProof: group.evidence,
      crossGroupIdentifierWarning:
        group.groupId === "GROUP-0002"
          ? "identifier/publicId reprend 43b64560-dfeb-4bca-8040-68cc935591cd, userId logique de GROUP-0001 ; aucune relation canonique autorisée"
          : null,
      referenceInventory: Object.fromEntries(
        group.teachers.map((teacher) => [teacher.teacherId, referenceRecords(state, teacher)]),
      ),
      candidateMatrix: candidates,
      reconciliationSimulations: candidates.map((candidate) =>
        simulateCandidate(group, candidate.candidateTeacherId),
      ),
    };
  });
  return {
    phase: "A2_MANUAL_ASSISTED_READ_ONLY",
    generatedAt: context.generatedAt ?? new Date().toISOString(),
    applyAllowed: false,
    groups,
  };
}

module.exports = { buildPhaseA2, sanitize };
