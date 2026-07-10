/**
 * Concurrence optimiste sur les notes (version + conflit 409).
 */
const { BusinessError } = require("../services/authService");

function noteVersion(note = {}) {
  const value = Number(note.version ?? 1);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function findNoteByKeys(notes = [], payload = {}) {
  const evaluationId = String(payload.evaluationId ?? "").trim();
  const studentId = String(payload.studentId ?? "").trim();
  return (notes ?? []).find(
    (note) =>
      String(note.evaluationId ?? "") === evaluationId &&
      [note.studentId, note.id].some((value) => String(value ?? "") === studentId),
  );
}

function assertNoteOptimisticLock(currentNote, expectedVersion) {
  if (expectedVersion == null || expectedVersion === "") return;
  const expected = Number(expectedVersion);
  if (!Number.isFinite(expected)) return;
  if (!currentNote) return;
  const current = noteVersion(currentNote);
  if (expected !== current) {
    throw new BusinessError(
      409,
      "La note a été modifiée par un autre utilisateur. Rechargez la page avant de réenregistrer.",
    );
  }
}

function bumpNoteVersion(note = {}, principal = {}) {
  const now = new Date().toISOString();
  return {
    ...note,
    version: noteVersion(note) + 1,
    updatedAt: now,
    updatedBy: principal?.sub ?? note.updatedBy,
  };
}

module.exports = {
  noteVersion,
  findNoteByKeys,
  assertNoteOptimisticLock,
  bumpNoteVersion,
};
