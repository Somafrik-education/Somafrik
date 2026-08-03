"use strict";

const { buildUserIndex, resolveCanonicalIdentity } = require("./teacherCanonicalIdentity");

const REMOVED_TEACHER_IDS = new Set([
  "TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1",
  "TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd",
]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function duplicateKeys(teachers, key) {
  const buckets = new Map();
  for (const teacher of teachers) {
    const value = normalize(teacher[key]);
    const school = normalize(teacher.schoolCode);
    if (!value || !school) continue;
    const bucket = `${school}|${value}`;
    const ids = buckets.get(bucket) ?? [];
    ids.push(String(teacher.id));
    buckets.set(bucket, ids);
  }
  return [...buckets.entries()].filter(([, ids]) => ids.length > 1).map(([keyValue, teacherIds]) => ({ keyValue, teacherIds }));
}

function aliasChain(start, postgresUsersById) {
  const chain = [];
  let current = String(start ?? "").trim();
  const seen = new Set();
  while (current && !seen.has(normalize(current))) {
    seen.add(normalize(current));
    chain.push(current);
    const user = postgresUsersById.get(normalize(current));
    current = String(user?.userCode ?? "").trim();
  }
  return chain;
}

function collectBackofficeReferences(state, validTeacherIds) {
  const dangling = [];
  const removed = [];
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((child, index) => walk(child, [...path, index]));
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const isReference = key === "teacherId" || key === "teacher_id" || (key === "authorId" && path[0] === "notes");
      if (isReference && child) {
        const id = String(child);
        const entry = { path: [...path, key].join("."), teacherId: id };
        if (REMOVED_TEACHER_IDS.has(id)) removed.push(entry);
        if (!validTeacherIds.has(normalize(id))) dangling.push(entry);
      } else walk(child, [...path, key]);
    }
  };
  for (const [collection, rows] of Object.entries(state)) {
    if (collection === "teachers") continue;
    walk(rows, [collection]);
  }
  return { dangling, removed };
}

function civilSuspicions(teachers) {
  const buckets = new Map();
  for (const teacher of teachers) {
    const name = normalize(`${teacher.firstName ?? ""} ${teacher.name ?? teacher.lastName ?? ""}`);
    const birthDate = normalize(teacher.birthDate ?? teacher.dateOfBirth);
    const school = normalize(teacher.schoolCode);
    if (!name || !birthDate || !school) continue;
    const key = `${school}|${name}|${birthDate}`;
    const rows = buckets.get(key) ?? [];
    rows.push(teacher);
    buckets.set(key, rows);
  }
  return [...buckets.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({
      key,
      teacherIds: rows.map((row) => String(row.id)),
      sharedTechnicalLink: ["userId", "contactId", "identifier", "publicId"].some((field) => {
        const values = rows.map((row) => normalize(row[field])).filter(Boolean);
        return new Set(values).size < values.length;
      }),
    }))
    .filter((item) => !item.sharedTechnicalLink);
}

function buildFullAudit(state, postgresUsers = [], postgresTeachers = [], postgresReferences = {}) {
  const teachers = state.teachers ?? [];
  const users = state.users ?? [];
  const teacherUserIds = new Set(teachers.map((teacher) => normalize(teacher.userId)).filter(Boolean));
  const postgresUsersById = new Map(postgresUsers.map((user) => [normalize(user.id), user]));
  const canonicalIdentityIndex = buildUserIndex(postgresUsers);
  const postgresTeacherUserIds = new Set(postgresTeachers.map((teacher) => normalize(teacher.postgresUserId)).filter(Boolean));
  const teacherAccounts = users.filter((user) => ["enseignant", "teacher"].includes(normalize(user.role)));
  const accountClassifications = teacherAccounts.map((user) => {
    const chain = aliasChain(user.id, postgresUsersById);
    const resolvedTeacherUserId = chain.find((id) => teacherUserIds.has(normalize(id))) ?? null;
    const postgresUser = postgresUsersById.get(normalize(user.id));
    let classification = "INCOHERENT_NO_TEACHER";
    if (teacherUserIds.has(normalize(user.id))) classification = "DIRECT_TEACHER_ACCOUNT";
    else if (resolvedTeacherUserId) classification = "POSTGRES_ALIAS_TO_TEACHER";
    else if (normalize(postgresUser?.status) === "deleted") classification = "DELETED_ACCOUNT_NO_TEACHER_EXPECTED";
    return { userId: String(user.id), classification, aliasChain: chain, resolvedTeacherUserId };
  });
  const postgresAccountClassifications = postgresUsers
    .filter((user) => normalize(user.role) === "teacher")
    .map((user) => {
      const chain = aliasChain(user.id, postgresUsersById);
      const resolvedTeacherUserId = chain.find((id) => teacherUserIds.has(normalize(id))) ?? null;
      let classification = "INCOHERENT_NO_TEACHER";
      if (postgresTeacherUserIds.has(normalize(user.id))) classification = "DIRECT_POSTGRES_TEACHER_ACCOUNT";
      else if (resolvedTeacherUserId) classification = "POSTGRES_ALIAS_TO_TEACHER";
      else if (normalize(user.status) === "deleted") classification = "DELETED_ACCOUNT_NO_TEACHER_EXPECTED";
      return { userId: String(user.id), userCode: String(user.userCode ?? ""), status: user.status, classification, aliasChain: chain, resolvedTeacherUserId };
    });
  const validTeacherIds = new Set(
    teachers.flatMap((teacher) => [teacher.id, teacher.identifier, teacher.publicId].map(normalize).filter(Boolean)),
  );
  const boReferences = collectBackofficeReferences(state, validTeacherIds);
  const canonicalUsers = teachers.map((teacher) => users.find((user) => normalize(user.id) === normalize(teacher.userId))).filter(Boolean);
  const canonicalResolutionErrors = [];
  const canonicalGroupsByKey = new Map();
  for (const teacher of teachers) {
    try {
      const canonicalIdentity = resolveCanonicalIdentity(teacher.userId, canonicalIdentityIndex);
      const schoolCode = String(teacher.schoolCode ?? "").trim().toUpperCase();
      if (!schoolCode) throw Object.assign(new Error("Code établissement absent"), { code: "CANONICAL_IDENTITY_SCHOOL_MISSING" });
      const key = `${schoolCode}|${canonicalIdentity}`;
      const group = canonicalGroupsByKey.get(key) ?? { schoolCode, canonicalIdentity, teacherIds: [] };
      group.teacherIds.push(String(teacher.id));
      canonicalGroupsByKey.set(key, group);
    } catch (error) {
      canonicalResolutionErrors.push({
        teacherId: String(teacher.id ?? ""),
        userId: String(teacher.userId ?? ""),
        schoolCode: String(teacher.schoolCode ?? ""),
        code: error.code ?? "CANONICAL_IDENTITY_ERROR",
        path: error.details?.path ?? [],
      });
    }
  }
  const canonicalIdentityGroups = [...canonicalGroupsByKey.values()].sort((left, right) =>
    `${left.schoolCode}|${left.canonicalIdentity}`.localeCompare(`${right.schoolCode}|${right.canonicalIdentity}`),
  );
  return {
    counts: {
      teachers: teachers.length,
      backofficeUsers: users.length,
      backofficeTeacherAccounts: teacherAccounts.length,
      postgresUsers: postgresUsers.length,
      postgresTeacherAccounts: postgresUsers.filter((user) => normalize(user.role) === "teacher").length,
      canonicalTeacherAccounts: new Set(canonicalUsers.map((user) => normalize(user.id))).size,
      canonicalTeacherIdentities: canonicalIdentityGroups.length,
      canonicalIdentityResolutionErrors: canonicalResolutionErrors.length,
    },
    collisions: {
      userId: duplicateKeys(teachers, "userId"),
      contactId: duplicateKeys(teachers, "contactId"),
      identifier: duplicateKeys(teachers, "identifier"),
      publicId: duplicateKeys(teachers, "publicId"),
    },
    accounts: {
      backoffice: accountClassifications,
      postgres: postgresAccountClassifications,
      incoherentBackoffice: accountClassifications.filter((item) => item.classification === "INCOHERENT_NO_TEACHER"),
      incoherentPostgres: postgresAccountClassifications.filter((item) => item.classification === "INCOHERENT_NO_TEACHER"),
    },
    teachersWithoutExpectedLink: teachers
      .filter((teacher) => !teacher.userId && !teacher.contactId)
      .map((teacher) => String(teacher.id)),
    teachersWithMissingBackofficeUser: teachers
      .filter((teacher) => teacher.userId && !users.some((user) => normalize(user.id) === normalize(teacher.userId)))
      .map((teacher) => String(teacher.id)),
    postgresTeachersWithMissingUser: postgresTeachers
      .filter((teacher) => !postgresUsersById.has(normalize(teacher.postgresUserId)))
      .map((teacher) => String(teacher.teacherCode)),
    civilIdentitySuspicions: civilSuspicions(teachers),
    canonicalIdentityAudit: {
      groupBy: "schoolCode + canonicalIdentity",
      groups: canonicalIdentityGroups,
      duplicateGroups: canonicalIdentityGroups.filter((group) => group.teacherIds.length > 1),
      resolutionErrors: canonicalResolutionErrors,
    },
    references: {
      backofficeDangling: boReferences.dangling,
      backofficeToRemovedIds: boReferences.removed,
      postgres: postgresReferences,
    },
    canonicalUserIds: [...new Set(canonicalUsers.map((user) => String(user.id)))].sort(),
  };
}

module.exports = { buildFullAudit, aliasChain, duplicateKeys };
