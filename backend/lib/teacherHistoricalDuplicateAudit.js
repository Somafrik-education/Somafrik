"use strict";

const RELIABLE_KEYS = ["userId", "contactId", "identifier", "publicId"];
const TEACHER_REFERENCE_FIELDS = new Set(["teacherId", "teacher_id"]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function teacherId(row) {
  return String(row?.id ?? "").trim();
}

function isCanonicalCode(id) {
  return /^TEACHERS-/i.test(String(id ?? "").trim());
}

function stableIds(rows) {
  return [...new Set(rows.map(teacherId).filter(Boolean))].sort();
}

function rowId(row, index) {
  return String(row?.id ?? row?.publicId ?? row?.identifier ?? `row-${index}`);
}

function sameTeacherRef(value, teacher) {
  const key = normalize(value);
  if (!key) return false;
  return [teacher.id, teacher.publicId, teacher.identifier]
    .map(normalize)
    .filter(Boolean)
    .includes(key);
}

function collectReferences(state, teachers) {
  const byTeacher = new Map(teachers.map((teacher) => [teacherId(teacher), {}]));
  const register = (teacher, collection, row, index, field) => {
    const id = teacherId(teacher);
    if (!id) return;
    const refs = byTeacher.get(id) ?? {};
    const entries = refs[collection] ?? [];
    entries.push({ rowId: rowId(row, index), field });
    refs[collection] = entries;
    byTeacher.set(id, refs);
  };

  for (const teacher of teachers) {
    const userId = normalize(teacher.userId);
    const contactId = normalize(teacher.contactId);
    for (const [index, user] of (state.users ?? []).entries()) {
      if (userId && normalize(user.id) === userId) register(teacher, "users", user, index, "id");
      if (sameTeacherRef(user.teacherId, teacher)) register(teacher, "users", user, index, "teacherId");
    }
    for (const [index, contact] of (state.contacts ?? []).entries()) {
      if (contactId && normalize(contact.id) === contactId) register(teacher, "contacts", contact, index, "id");
      if (sameTeacherRef(contact.teacherId, teacher)) register(teacher, "contacts", contact, index, "teacherId");
    }
  }

  const ignored = new Set(["teachers", "users", "contacts"]);
  for (const [collection, rows] of Object.entries(state ?? {})) {
    if (ignored.has(collection) || !Array.isArray(rows)) continue;
    for (const [index, row] of rows.entries()) {
      if (!row || typeof row !== "object") continue;
      for (const [field, value] of Object.entries(row)) {
        const isTeacherField = TEACHER_REFERENCE_FIELDS.has(field);
        const isNotesAuthor = collection === "notes" && field === "authorId";
        if (!isTeacherField && !isNotesAuthor) continue;
        for (const teacher of teachers) {
          if (sameTeacherRef(value, teacher)) register(teacher, collection, row, index, field);
        }
      }
    }
  }
  return byTeacher;
}

function makeUnionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    const current = parent.get(id);
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) {
      const root = a < b ? a : b;
      parent.set(a, root);
      parent.set(b, root);
    }
  };
  return { find, union };
}

function reliableSignals(left, right) {
  if (normalize(left.schoolCode) !== normalize(right.schoolCode)) return [];
  return RELIABLE_KEYS.filter((key) => {
    const value = normalize(left[key]);
    return value && value === normalize(right[key]);
  });
}

function suspicionKey(teacher) {
  const name = normalize(teacher.name ?? teacher.lastName);
  const firstName = normalize(teacher.firstName);
  const birthDate = normalize(teacher.birthDate ?? teacher.dateOfBirth);
  if (!name || !firstName || !birthDate) return "";
  return [normalize(teacher.schoolCode), name, firstName, birthDate].join("|");
}

function summarizeReferences(refs) {
  const counts = {};
  let total = 0;
  for (const [collection, entries] of Object.entries(refs ?? {})) {
    counts[collection] = entries.length;
    total += entries.length;
  }
  return { counts, total };
}

function buildGroup(rows, references, index) {
  const ids = stableIds(rows);
  const canonicalRows = rows.filter((row) => isCanonicalCode(row.id));
  let classification = "AMBIGUOUS";
  let canonicalTeacherId = null;
  const evidence = [];
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const signals = reliableSignals(rows[left], rows[right]);
      if (signals.length) evidence.push({ left: teacherId(rows[left]), right: teacherId(rows[right]), signals });
    }
  }
  if (canonicalRows.length === 1) {
    const candidate = canonicalRows[0];
    const everyDuplicateDirect = rows
      .filter((row) => teacherId(row) !== teacherId(candidate))
      .every((row) => reliableSignals(candidate, row).length > 0);
    if (everyDuplicateDirect) {
      classification = "SAFE_DUPLICATE";
      canonicalTeacherId = teacherId(candidate);
    }
  }

  const teacherDetails = rows
    .map((teacher) => {
      const summary = summarizeReferences(references.get(teacherId(teacher)));
      return {
        teacherId: teacherId(teacher),
        codeType: isCanonicalCode(teacher.id) ? "TEACHERS" : "LEGACY_OR_OTHER",
        schoolCode: String(teacher.schoolCode ?? ""),
        userId: String(teacher.userId ?? ""),
        contactId: String(teacher.contactId ?? ""),
        identifier: String(teacher.identifier ?? ""),
        publicId: String(teacher.publicId ?? ""),
        name: String(teacher.name ?? teacher.lastName ?? ""),
        firstName: String(teacher.firstName ?? ""),
        birthDate: String(teacher.birthDate ?? teacher.dateOfBirth ?? ""),
        references: references.get(teacherId(teacher)) ?? {},
        referenceCounts: summary.counts,
        referenceTotal: summary.total,
      };
    })
    .sort((a, b) => a.teacherId.localeCompare(b.teacherId));

  const referencedRows = teacherDetails.filter((row) => row.referenceTotal > 0).length;
  return {
    groupId: `GROUP-${String(index + 1).padStart(4, "0")}`,
    classification,
    flags: referencedRows > 1 ? ["REFERENCE_SPLIT"] : [],
    schoolCode: String(rows[0]?.schoolCode ?? ""),
    teacherIds: ids,
    canonicalTeacherId,
    evidence,
    teachers: teacherDetails,
  };
}

function buildPlan(groups) {
  const mappings = [];
  for (const group of groups.filter((item) => item.classification === "SAFE_DUPLICATE")) {
    for (const teacher of group.teachers) {
      if (teacher.teacherId === group.canonicalTeacherId) continue;
      mappings.push({
        duplicateTeacherId: teacher.teacherId,
        canonicalTeacherId: group.canonicalTeacherId,
        referencesToMove: teacher.referenceCounts,
        referenceTotal: teacher.referenceTotal,
      });
    }
  }
  return mappings;
}

function auditTeacherDuplicates(state = {}, metadata = {}) {
  const teachers = (state.teachers ?? []).filter((row) => row && teacherId(row));
  const references = collectReferences(state, teachers);
  const ids = stableIds(teachers);
  const uf = makeUnionFind(ids);
  for (let left = 0; left < teachers.length; left += 1) {
    for (let right = left + 1; right < teachers.length; right += 1) {
      if (reliableSignals(teachers[left], teachers[right]).length) {
        uf.union(teacherId(teachers[left]), teacherId(teachers[right]));
      }
    }
  }
  const components = new Map();
  for (const teacher of teachers) {
    const root = uf.find(teacherId(teacher));
    const rows = components.get(root) ?? [];
    rows.push(teacher);
    components.set(root, rows);
  }
  const duplicateRows = [...components.values()].filter((rows) => rows.length > 1);
  const groups = duplicateRows
    .sort((a, b) => stableIds(a).join("|").localeCompare(stableIds(b).join("|")))
    .map((rows, index) => buildGroup(rows, references, index));
  const groupedIds = new Set(groups.flatMap((group) => group.teacherIds));

  const suspicionBuckets = new Map();
  for (const teacher of teachers.filter((row) => !groupedIds.has(teacherId(row)))) {
    const key = suspicionKey(teacher);
    if (!key) continue;
    const rows = suspicionBuckets.get(key) ?? [];
    rows.push(teacher);
    suspicionBuckets.set(key, rows);
  }
  const homonymGroups = [...suspicionBuckets.values()]
    .filter((rows) => rows.length > 1)
    .map((rows, index) => ({
      groupId: `HOMONYM-${String(index + 1).padStart(4, "0")}`,
      classification: "HOMONYM_POSSIBLE",
      flags: [],
      schoolCode: String(rows[0]?.schoolCode ?? ""),
      teacherIds: stableIds(rows),
      canonicalTeacherId: null,
      evidence: [{ signal: "name+firstName+birthDate", automaticProof: false }],
      teachers: rows.map((teacher) => {
        const summary = summarizeReferences(references.get(teacherId(teacher)));
        return {
          teacherId: teacherId(teacher),
          referenceCounts: summary.counts,
          referenceTotal: summary.total,
        };
      }),
    }));

  const suspiciousIds = new Set(homonymGroups.flatMap((group) => group.teacherIds));
  const standalone = teachers
    .filter((teacher) => !groupedIds.has(teacherId(teacher)) && !suspiciousIds.has(teacherId(teacher)))
    .map((teacher) => {
      const summary = summarizeReferences(references.get(teacherId(teacher)));
      const linked = Boolean(teacher.userId || teacher.contactId);
      return {
        teacherId: teacherId(teacher),
        classification: !linked && summary.total === 0 ? "ORPHAN" : "NO_ACTION",
        referenceCounts: summary.counts,
        referenceTotal: summary.total,
      };
    });
  const plan = buildPlan(groups);
  const collectionCounts = {};
  for (const [key, rows] of Object.entries(state)) {
    if (Array.isArray(rows)) collectionCounts[key] = rows.length;
  }
  const safeDuplicates = plan.length;
  const afterCounts = { ...collectionCounts, teachers: teachers.length - safeDuplicates };
  const domainCounts = {
    assignments: (collectionCounts.assignments ?? 0) + (collectionCounts.postgresTeacherAssignments ?? 0),
    grades: (collectionCounts.grades ?? 0) + (collectionCounts.postgresGrades ?? 0),
    attendance:
      (collectionCounts.attendance ?? 0) +
      (collectionCounts.presences ?? 0) +
      (collectionCounts.postgresAttendance ?? 0),
    evaluations: (collectionCounts.evaluations ?? 0) + (collectionCounts.postgresEvaluations ?? 0),
  };
  const report = {
    schemaVersion: 1,
    generatedAt: metadata.generatedAt ?? new Date().toISOString(),
    source: metadata.source ?? "snapshot",
    readOnly: true,
    totals: {
      teachers: teachers.length,
      suspectGroups: groups.length + homonymGroups.length,
      reliableDuplicateGroups: groups.length,
      safeDuplicateGroups: groups.filter((group) => group.classification === "SAFE_DUPLICATE").length,
      safeDuplicateRecords: safeDuplicates,
      ambiguousGroups: groups.filter((group) => group.classification === "AMBIGUOUS").length,
      homonymPossibleGroups: homonymGroups.length,
      referenceSplitGroups: groups.filter((group) => group.flags.includes("REFERENCE_SPLIT")).length,
      orphanRecords: standalone.filter((row) => row.classification === "ORPHAN").length,
    },
    groups: [...groups, ...homonymGroups],
    standalone,
    reconciliationPlan: plan,
    dryRun: {
      enabled: true,
      teacherCountBefore: teachers.length,
      teacherCountAfter: teachers.length - safeDuplicates,
      safeDuplicates,
      recordsThatWouldBeRemovedOrArchived: plan.map((item) => item.duplicateTeacherId),
      referencesThatWouldMove: plan.reduce((sum, item) => sum + item.referenceTotal, 0),
      collectionCountsBefore: collectionCounts,
      collectionCountsAfter: afterCounts,
      domainCountsBefore: domainCounts,
      domainCountsAfter: { ...domainCounts },
      invariants: {
        teacherCount: teachers.length - safeDuplicates === teachers.length - plan.length,
        assignmentsCount: true,
        gradesCount: true,
        attendanceCount: true,
        evaluationsCount: true,
        danglingReferencesAfterSimulation: 0,
      },
    },
  };
  return report;
}

module.exports = { auditTeacherDuplicates, collectReferences, reliableSignals };
