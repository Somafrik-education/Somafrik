"use strict";

const DELETE_TO_CANON = new Map([
  ["TEACHERS-08537fff-7579-419e-b4b5-dfd6aa0580a1", "TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c"],
  ["TEACHERS-bad5646f-d53a-43b8-b2c1-fa87e6d719dd", "TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1"],
]);

const CANON_USER_IDS = new Map([
  ["TEACHERS-5707ff31-ac8a-4441-914f-63b4a62d0b8c", "43b64560-dfeb-4bca-8040-68cc935591cd"],
  ["TEACHERS-3a94b3c9-ad41-49e9-996f-b1fe62e7f6c1", "745d78af-4420-43c6-9432-6ffca2f59cc5"],
]);

const COLLISION_REPAIR = {
  teacherId: "TEACHERS-a40a415a-ceda-4ffa-9a66-f2d17c476567",
  previousPublicId: "CD-2026-0002-ENS-0001",
  publicId: "CD-2026-0002-ENS-0002",
};

const REFERENCE_FIELDS = new Set(["teacherId", "teacher_id"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function remapReferences(value, path = []) {
  if (Array.isArray(value)) return value.map((child, index) => remapReferences(child, [...path, index]));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const isReference = REFERENCE_FIELDS.has(key) || (key === "authorId" && path[0] === "notes");
    result[key] = isReference && DELETE_TO_CANON.has(String(child))
      ? DELETE_TO_CANON.get(String(child))
      : remapReferences(child, [...path, key]);
  }
  return result;
}

function buildCleanupState(input) {
  const state = remapReferences(clone(input));
  const teachers = Array.isArray(state.teachers) ? state.teachers : [];
  const presentIds = new Set(teachers.map((teacher) => String(teacher.id ?? "")));
  for (const [duplicateId, canonicalId] of DELETE_TO_CANON) {
    if (!presentIds.has(duplicateId)) throw new Error(`Fiche doublon attendue absente: ${duplicateId}`);
    if (!presentIds.has(canonicalId)) throw new Error(`Canon attendu absent: ${canonicalId}`);
  }
  const collision = teachers.find((teacher) => String(teacher.id) === COLLISION_REPAIR.teacherId);
  if (!collision || String(collision.publicId) !== COLLISION_REPAIR.previousPublicId) {
    throw new Error("Collision publicId attendue absente ou déjà modifiée");
  }
  state.teachers = teachers
    .filter((teacher) => !DELETE_TO_CANON.has(String(teacher.id)))
    .map((teacher) => {
      const id = String(teacher.id);
      if (CANON_USER_IDS.has(id)) return { ...teacher, userId: CANON_USER_IDS.get(id) };
      if (id === COLLISION_REPAIR.teacherId) return { ...teacher, publicId: COLLISION_REPAIR.publicId };
      return teacher;
    });
  return state;
}

function duplicateKeys(teachers, key) {
  const buckets = new Map();
  for (const teacher of teachers) {
    const value = String(teacher?.[key] ?? "").trim().toLowerCase();
    const schoolCode = String(teacher?.schoolCode ?? "").trim().toLowerCase();
    if (!value || !schoolCode) continue;
    const bucket = `${schoolCode}|${value}`;
    const ids = buckets.get(bucket) ?? [];
    ids.push(String(teacher.id));
    buckets.set(bucket, ids);
  }
  return [...buckets.entries()].filter(([, ids]) => ids.length > 1).map(([value, teacherIds]) => ({ value, teacherIds }));
}

function auditState(state) {
  const teachers = state.teachers ?? [];
  return {
    teacherCount: teachers.length,
    duplicateUserIds: duplicateKeys(teachers, "userId"),
    duplicateContactIds: duplicateKeys(teachers, "contactId"),
    duplicateIdentifiers: duplicateKeys(teachers, "identifier"),
    duplicatePublicIds: duplicateKeys(teachers, "publicId"),
  };
}

module.exports = {
  DELETE_TO_CANON,
  CANON_USER_IDS,
  COLLISION_REPAIR,
  buildCleanupState,
  auditState,
};
