/**
 * Lot Pédagogie L3 — écarts causaux Mobile + parité des notes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PEDAGOGY_COPY, PEDAGOGY_MIN_TOUCH_DP } from "./pedagogyParityContract";
import {
  canonicalWeightedAverage,
  EVALUATIONS_V2_COPY,
  normalizeEvaluation,
  normalizeGrade,
  rosterStudentsForEvaluation,
} from "./evaluationsV2";

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative: string) => fs.readFileSync(path.join(srcRoot, relative), "utf8");

function sliceFirstCard(source: string, tag: string) {
  const start = source.indexOf(`<${tag}`);
  const end = source.indexOf(`</${tag}>`, start);
  if (start < 0 || end < 0) return "";
  return source.slice(start, end);
}

const cases: { id: string; title: string; run: () => void }[] = [
  {
    id: "PED-L3-10",
    title: "CTA créer Mobile = Nouvelle évaluation",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /PEDAGOGY_COPY\.newEvaluation|Nouvelle évaluation/);
      assert.equal(
        /Créer une évaluation/.test(screen),
        false,
        "le CTA liste utilise encore « Créer une évaluation » au lieu de « Nouvelle évaluation »",
      );
    },
  },
  {
    id: "PED-L3-11",
    title: "Création Mobile : champ Coefficient envoyé à l'API",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /Coefficient/, "aucun champ Coefficient sur le formulaire de création");
      assert.match(
        screen,
        /coefficient:/,
        "buildCreateEvaluationPayload n'est pas appelé avec le coefficient saisi (reste 1 silencieux)",
      );
      assert.match(
        screen,
        /parseEvaluationCoefficient\(createCoefficient\)/,
        "le champ Coefficient n'est pas validé avant l'envoi",
      );
      assert.match(screen, /Coefficient invalide/, "aucune erreur affichée si le coefficient est invalide");
      assert.equal(
        /Number\(String\(createCoefficient\)[\s\S]*?\) \|\| 1/.test(screen),
        false,
        "le coefficient saisi est encore substitué silencieusement par 1",
      );
      const lib = read("lib/evaluationsV2.ts");
      assert.match(lib, /parseEvaluationCoefficient/);
      assert.equal(
        /Number\(input\.coefficient \?\? 1\) \|\| 1/.test(lib),
        false,
        "buildCreateEvaluationPayload substitue encore 1 silencieusement",
      );
    },
  },
  {
    id: "PED-L3-12",
    title: "Carte évaluation : progression fermée ; coef, enseignant, date dépliés",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /ExpandableEntityCard/, "la liste évaluations n'utilise pas ExpandableEntityCard");
      const card = sliceFirstCard(screen, "ExpandableEntityCard");
      assert.ok(card, "aucune carte Entity évaluations");
      assert.match(card, /title=\{evaluation\.title\}/, "titre absent du résumé fermé");
      assert.match(
        card,
        /\$\{evaluation\.className\} • \$\{evaluation\.courseName\}/,
        "classe • cours absent du résumé fermé",
      );
      assert.match(card, /badge=\{evaluation\.status\}/, "statut absent du résumé fermé");
      assert.match(card, /summaryActions=/, "Saisir/Consulter et la progression doivent rester visibles carte fermée");
      assert.match(screen, /function EvaluationSummaryActions/, "CTA Saisir n'est pas extrait hors children");
      const summaryFnStart = screen.indexOf("function EvaluationSummaryActions");
      const summaryFn = summaryFnStart >= 0 ? screen.slice(summaryFnStart, screen.indexOf("\nfunction ", summaryFnStart + 1)) : "";
      assert.match(summaryFn, /PEDAGOGY_COPY\.progress/, "progression absente du résumé fermé");
      assert.match(summaryFn, /enterGrades/, "Saisir absent du résumé fermé");
      assert.match(summaryFn, /consult/, "Consulter absent du résumé fermé");
      assert.doesNotMatch(summaryFn, /coefficient/, "coefficient encore dans le résumé fermé");
      assert.doesNotMatch(summaryFn, /teacherName/, "enseignant encore dans le résumé fermé");
      assert.doesNotMatch(summaryFn, /editEvaluation|Publier|validate/, "actions secondaires encore dans le résumé fermé");
      assert.match(card, /evaluation\.coefficient/, "coefficient absent de la zone dépliée");
      assert.match(card, /evaluation\.teacherName/, "enseignant absent de la zone dépliée");
      assert.match(card, /evaluation\.date/, "date absente de la zone dépliée");
      assert.match(card, /PEDAGOGY_COPY\.editEvaluation/, "Modifier absent de la zone dépliée");
      assert.match(card, /EVALUATIONS_V2_COPY\.validate|PEDAGOGY_COPY\.validate/, "Valider absent de la zone dépliée");
      assert.match(card, /Publier|PEDAGOGY_COPY\.publish/, "Publier absent de la zone dépliée");
      assert.doesNotMatch(
        /subtitle=\{[\s\S]*?\}/.exec(card)?.[0] ?? "",
        /coefficient|teacherName|evaluation\.date/,
        "coef/enseignant/date encore dans le sous-titre fermé",
      );
    },
  },
  {
    id: "PED-L3-13",
    title: "Filtres Mobile période et statut",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /periodFilter|statusFilter/, "aucun filtre période/statut sur la liste enseignant");
      assert.match(screen, /À valider|pendingValidation|allStatuses/);
    },
  },
  {
    id: "PED-L3-14",
    title: "Liste Mobile hydrate GET /notes pour la progression",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(
        screen,
        /loadNotes/,
        "useFocusEffect ne charge pas les notes : le compteur de saisie reste périmé ou à 0",
      );
    },
  },
  {
    id: "PED-L3-15",
    title: "Roster Mobile : repli className si classId absent",
    run() {
      const roster = rosterStudentsForEvaluation(
        [
          { id: "s1", name: "Ada", className: "6ème A" },
          { id: "s2", name: "Eve", className: "6ème B" },
        ],
        {
          classId: "",
          classCode: "",
          className: "6ème A",
        },
      );
      assert.deepEqual(
        roster.map((row) => row.id),
        ["s1"],
        "un élève de la classe nommée 6ème A est exclu si l'évaluation n'a que className (création Web)",
      );
    },
  },
  {
    id: "PED-L3-16",
    title: "Sous-titre enseignant n'interdit pas la saisie avant validation",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.equal(
        /après validation/.test(screen),
        false,
        "le sous-titre enseignant affirme encore que la saisie n'est possible qu'après validation (contredit draft/open/locked)",
      );
    },
  },
  {
    id: "PED-L3-17",
    title: "Mobile : Modifier et Publier selon RBAC métier",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /Modifier/, "CTA Modifier absent");
      assert.match(screen, /Publier/, "CTA Publier absent alors que PATCH status Publiée existe");
    },
  },
  {
    id: "PED-L3-18",
    title: "Libellé Valider identique au Web",
    run() {
      assert.equal(EVALUATIONS_V2_COPY.validate, PEDAGOGY_COPY.validate);
      assert.equal(EVALUATIONS_V2_COPY.enterGrades, PEDAGOGY_COPY.enterGrades);
      assert.equal(EVALUATIONS_V2_COPY.saveGrades, PEDAGOGY_COPY.saveGrades);
    },
  },
  {
    id: "PED-L3-20",
    title: "Moyenne : coefficient matière ≠ coefficient d'évaluation",
    run() {
      const note = normalizeGrade({
        evaluationId: "EVAL-1",
        studentId: "s1",
        value: 10,
        scale: 20,
        coefficient: 4,
        gradeStatus: "graded",
      });
      const avg = canonicalWeightedAverage([note]);
      assert.equal(note.evaluationCoefficient, 1, "sans evaluationCoefficient API, ne pas voler le coef matière");
      assert.equal(avg.totalCoefficients, 1);
      assert.equal(avg.average, 10);

      const weighted = canonicalWeightedAverage([
        normalizeGrade({
          evaluationId: "EVAL-1",
          studentId: "s1",
          value: 10,
          scale: 20,
          coefficient: 4,
          evaluationCoefficient: 3,
          gradeStatus: "graded",
        }),
      ]);
      assert.equal(weighted.totalCoefficients, 3);
    },
  },
  {
    id: "PED-L3-21",
    title: "Même payload API → mêmes identifiants canoniques",
    run() {
      const raw = {
        id: "EVAL-PG-1",
        classId: "class-uuid",
        className: "6ème A",
        subject: "Mathématiques",
        teacherId: "ENS-1",
        teacherName: "Seke",
        date: "2026-09-10",
        coefficient: 2,
        scale: 20,
        period: "Trimestre 1",
        status: "open",
      };
      const evaluation = normalizeEvaluation(raw);
      assert.equal(evaluation.evaluationId, "EVAL-PG-1");
      assert.equal(evaluation.classId, "class-uuid");
      assert.equal(evaluation.className, "6ème A");
      assert.equal(evaluation.subject, "Mathématiques");
      assert.equal(evaluation.teacherId, "ENS-1");
      assert.equal(evaluation.date, "2026-09-10");
      assert.equal(evaluation.coefficient, 2);
      assert.equal(evaluation.status, "Ouverte");
    },
  },
  {
    id: "PED-L3-22",
    title: "Écritures Mobile : schoolId/schoolCode jamais envoyés",
    run() {
      const v2 = read("lib/evaluationsV2.ts");
      assert.match(v2, /stripEvaluationClientScope/);
      assert.match(v2, /schoolCode/);
      const api = read("services/api.ts");
      assert.match(api, /stripEvaluationClientScope/);
    },
  },
  {
    id: "PED-L3-23",
    title: "RBAC : enseignant ne valide pas ; préfet peut valider",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /canValidate/);
      assert.match(screen, /!teacher/);
    },
  },
  {
    id: "PED-L3-24",
    title: "Aucun import de data/notes demo",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      const student = read("screens/StudentNotesScreen.tsx");
      assert.doesNotMatch(screen, /from ["'].*data\/notes["']/);
      assert.doesNotMatch(student, /from ["'].*data\/notes["']/);
    },
  },
  {
    id: "PED-L3-25",
    title: "Cibles tactiles contrat ≥ 44 dp",
    run() {
      const screen = read("screens/TeacherGradesScreen.tsx");
      assert.match(screen, /MIN_TOUCH_TARGET_DP/);
      assert.equal(PEDAGOGY_MIN_TOUCH_DP, 44);
    },
  },
  {
    id: "PED-L3-26",
    title: "Moyenne générale Mobile = moteur canonique à deux niveaux",
    run() {
      const screen = read("screens/StudentNotesScreen.tsx");
      assert.match(
        screen,
        /canonicalStudentGeneralAverage/,
        "Mobile calcule encore la moyenne générale directement sur toutes les évaluations",
      );
      assert.equal(
        /schoolCoursesSnapshot|loadSchoolCourses/.test(screen),
        false,
        "Mobile ne doit pas charger /api/courses pour la moyenne générale",
      );
      assert.equal(
        /const average = canonicalWeightedAverage\(studentNotes\)/.test(screen),
        false,
        "la moyenne générale Mobile reste plate",
      );
      const engine = read("lib/pedagogyAverage.ts");
      assert.match(engine, /evaluationCoefficient/);
      assert.match(engine, /note\.coefficient/);
      assert.equal(
        /\/api\/courses/.test(engine),
        false,
        "pedagogyAverage.ts ne doit pas appeler le catalogue /api/courses",
      );
    },
  },
];

const failed: { id: string; title: string; message: string }[] = [];
const passedIds: string[] = [];
for (const testCase of cases) {
  try {
    testCase.run();
    passedIds.push(testCase.id);
  } catch (error) {
    failed.push({
      id: testCase.id,
      title: testCase.title,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const failedIds = failed.map((item) => item.id);
console.log(`parite L3 Pédagogie Mobile — ${passedIds.length} vert / ${failed.length} rouge / ${cases.length} cas`);
for (const id of passedIds) console.log(`  PASS ${id}`);
for (const item of failed) {
  console.log(`  FAIL [${item.id}] ${item.title}`);
  console.log(`    ${item.message}`);
}
console.log(
  `PARITE_L3_PEDAGOGY_MOBILE_REPORT ${JSON.stringify({ passedIds, failedIds, expectedIds: cases.map((item) => item.id) })}`,
);
if (failed.length) process.exit(1);
console.log("OK: L3 Pédagogie Mobile");
