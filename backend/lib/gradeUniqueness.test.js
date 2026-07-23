/**
 * D3.6b — Déduplication déterministe notes (version → updated_at → created_at → id).
 */
const assert = require("assert");
const { pickCanonicalGradeRow } = require("./gradeUniqueness");

function run() {
  const byVersion = pickCanonicalGradeRow([
    { id: "1", version: 1, updated_at: "2026-07-23T12:00:00Z", created_at: "2026-07-23T11:00:00Z" },
    { id: "2", version: 5, updated_at: "2026-07-20T12:00:00Z", created_at: "2026-07-20T11:00:00Z" },
  ]);
  assert.strictEqual(byVersion.id, "2", "version DESC prioritaire");

  const byUpdated = pickCanonicalGradeRow([
    { id: "a", version: 2, updated_at: "2026-07-21T10:00:00Z", created_at: "2026-07-21T09:00:00Z" },
    { id: "b", version: 2, updated_at: "2026-07-22T10:00:00Z", created_at: "2026-07-20T09:00:00Z" },
  ]);
  assert.strictEqual(byUpdated.id, "b", "updated_at DESC si version égale");

  const byCreated = pickCanonicalGradeRow([
    { id: "x", version: 1, updated_at: "2026-07-23T10:00:00Z", created_at: "2026-07-23T08:00:00Z" },
    { id: "y", version: 1, updated_at: "2026-07-23T10:00:00Z", created_at: "2026-07-23T09:00:00Z" },
  ]);
  assert.strictEqual(byCreated.id, "y", "created_at DESC ensuite");

  const byId = pickCanonicalGradeRow([
    { id: "aaa", version: 1, updated_at: "2026-07-23T10:00:00Z", created_at: "2026-07-23T10:00:00Z" },
    { id: "zzz", version: 1, updated_at: "2026-07-23T10:00:00Z", created_at: "2026-07-23T10:00:00Z" },
  ]);
  assert.strictEqual(byId.id, "zzz", "id DESC en dernier recours");

  console.log("gradeUniqueness.test.js : OK");
}

run();
