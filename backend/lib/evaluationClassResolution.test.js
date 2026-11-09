"use strict";

/**
 * MONO-FIX-A4 — résolution déterministe de la classe d'une évaluation (unit).
 * Parcours HTTP/PostgreSQL réel : evaluationClassResolution.http.pg.test.js.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveEvaluationClass, normalizeText } = require("./evaluationAttachment");

const SCHOOL = { id: "school-cd" };
const OPEN_YEAR = { id: "year-open" };
const CLASSES = [
  { id: "c-6a-1", class_code: "CLS-1", name: "6ème A", school_id: "school-cd", academic_year_id: "year-open" },
  { id: "c-6a-2", class_code: "CLS-2", name: "6eme a", school_id: "school-cd", academic_year_id: "year-open" },
  { id: "c-5a-open", class_code: "CLS-3", name: "5ème A", school_id: "school-cd", academic_year_id: "year-open" },
  { id: "c-5a-old", class_code: "CLS-4", name: "5ème A", school_id: "school-cd", academic_year_id: "year-closed" },
  { id: "c-4b", class_code: "CLS-5", name: "4ème B", school_id: "school-cd", academic_year_id: "year-open" },
  { id: "c-bi", class_code: "CLS-BI", name: "4ème B", school_id: "school-bi", academic_year_id: "year-bi" },
];

function deps({ openYear = OPEN_YEAR, ensureClass } = {}) {
  const calls = { ensureClass: 0 };
  return {
    calls,
    deps: {
      findClassById: async (schoolId, id) => CLASSES.find((row) => row.school_id === schoolId && (row.id === id || row.class_code === id)) ?? null,
      findClassByCode: async (schoolId, code) =>
        CLASSES.find((row) => row.school_id === schoolId && row.class_code.toLowerCase() === String(code).trim().toLowerCase()) ?? null,
      findClassesByName: async (schoolId, name) =>
        CLASSES.filter((row) => row.school_id === schoolId && normalizeText(row.name) === normalizeText(name)),
      getCurrentAcademicYear: async () => openYear,
      ensureClass: async (...args) => {
        calls.ensureClass += 1;
        return ensureClass ? ensureClass(...args) : null;
      },
    },
  };
}

const resolve = (evaluation, options = {}, depOptions = {}) =>
  resolveEvaluationClass(evaluation, SCHOOL, deps(depOptions).deps, { ensure: false, context: {}, ...options });

async function rejects(promise, code, statusCode) {
  await assert.rejects(promise, (error) => error.code === code && error.statusCode === statusCode);
}

test("priorité classId, puis classCode, puis nom ; concordance acceptée", async () => {
  assert.equal((await resolve({ classId: "c-6a-1" })).id, "c-6a-1");
  assert.equal((await resolve({ classId: "CLS-2" })).id, "c-6a-2", "classId = class_code (historique)");
  assert.equal((await resolve({ classCode: "cls-5" })).id, "c-4b");
  assert.equal((await resolve({ class_code: "CLS-5" })).id, "c-4b");
  assert.equal((await resolve({ classId: "c-6a-1", classCode: "CLS-1", className: "6EME A" })).id, "c-6a-1");
});

test("nom : unique accepté ; homonymes départagés par l'année ouverte ; sinon refus 409", async () => {
  assert.equal((await resolve({ className: "4ème B" })).id, "c-4b", "l'homonyme d'un autre établissement est ignoré");
  assert.equal((await resolve({ className: "5ème A" })).id, "c-5a-open");
  await rejects(resolve({ className: "6ème A" }), "EVAL_ATTACHMENT_CLASS_AMBIGUOUS", 409);
  await rejects(resolve({ className: "5ème A" }, {}, { openYear: null }), "EVAL_ATTACHMENT_CLASS_AMBIGUOUS", 409);
});

test("contradictions : jamais d'identifiant ignoré en silence", async () => {
  await rejects(resolve({ classId: "c-6a-1", classCode: "CLS-5" }), "EVAL_ATTACHMENT_CLASS_CONFLICT", 400);
  await rejects(resolve({ classId: "c-6a-1", className: "4ème B" }), "EVAL_ATTACHMENT_CLASS_CONFLICT", 400);
  await rejects(resolve({ classCode: "CLS-5", className: "6ème A" }), "EVAL_ATTACHMENT_CLASS_CONFLICT", 400);
});

test("identifiant inconnu ou d'un autre établissement : refus sans repli sur le nom, même avec ensure", async () => {
  for (const evaluation of [
    { classId: "inconnu", className: "4ème B" },
    { classCode: "CLS-404", className: "4ème B" },
    { classId: "c-bi" },
    { classCode: "CLS-BI" },
  ]) {
    await rejects(resolve(evaluation), "EVAL_ATTACHMENT_CLASS", 400);
    const { deps: withEnsure, calls } = deps({ ensureClass: async () => CLASSES[4] });
    await rejects(resolveEvaluationClass(evaluation, SCHOOL, withEnsure, { ensure: true, context: {} }), "EVAL_ATTACHMENT_CLASS", 400);
    assert.equal(calls.ensureClass, 0, `${JSON.stringify(evaluation)} : aucune création de classe`);
  }
  await rejects(resolve({}), "EVAL_ATTACHMENT_CLASS", 400);
});

test("ensure (import historique) : création par nom seulement si aucun résultat, jamais si ambigu", async () => {
  const created = { id: "c-new", name: "3ème C" };
  const { deps: d1, calls: c1 } = deps({ ensureClass: async () => created });
  assert.equal((await resolveEvaluationClass({ className: "3ème C" }, SCHOOL, d1, { ensure: true, context: {} })).id, "c-new");
  assert.equal(c1.ensureClass, 1);
  const { deps: d2, calls: c2 } = deps({ ensureClass: async () => created });
  await rejects(resolveEvaluationClass({ className: "6ème A" }, SCHOOL, d2, { ensure: true, context: {} }), "EVAL_ATTACHMENT_CLASS_AMBIGUOUS", 409);
  assert.equal(c2.ensureClass, 0);
  await rejects(resolve({ className: "3ème C" }), "EVAL_ATTACHMENT_CLASS", 400);
});
